import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const currentColumns = [
  "thread_id",
  "provider_name",
  "adapter_key",
  "runtime_mode",
  "status",
  "last_seen_at",
  "resume_cursor_json",
  "runtime_payload_json",
] as const;

function assertHasCurrentColumns(columnNames: ReadonlySet<string>) {
  for (const column of currentColumns) {
    assert.ok(columnNames.has(column), `missing ${column}`);
  }
}

const assertProviderRuntimeUpsertPrepares = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    INSERT INTO provider_session_runtime (
      thread_id,
      provider_name,
      adapter_key,
      runtime_mode,
      status,
      last_seen_at,
      resume_cursor_json,
      runtime_payload_json
    )
    VALUES (
      'thread-upsert',
      'codex',
      'codex',
      'full-access',
      'running',
      '2026-04-25T00:00:00.000Z',
      NULL,
      '{"cwd":"/tmp/project"}'
    )
    ON CONFLICT (thread_id)
    DO UPDATE SET
      provider_name = excluded.provider_name,
      adapter_key = excluded.adapter_key,
      runtime_mode = excluded.runtime_mode,
      status = excluded.status,
      last_seen_at = excluded.last_seen_at,
      resume_cursor_json = excluded.resume_cursor_json,
      runtime_payload_json = excluded.runtime_payload_json
  `;
});

layer("042_EnsureProviderSessionRuntimeSchema", (it) => {
  it.effect("repairs legacy provider_session_runtime rows from older installed databases", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 3 });
      yield* sql`
        CREATE TABLE provider_session_runtime (
          thread_id TEXT PRIMARY KEY,
          provider_name TEXT NOT NULL,
          provider_thread_id TEXT,
          runtime_mode TEXT NOT NULL DEFAULT 'full-access',
          status TEXT NOT NULL,
          resume_cursor_json TEXT,
          last_error TEXT,
          updated_at TEXT NOT NULL
        )
      `;
      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id,
          provider_name,
          provider_thread_id,
          runtime_mode,
          status,
          resume_cursor_json,
          last_error,
          updated_at
        )
        VALUES (
          'thread-existing',
          'claudeAgent',
          'provider-thread-existing',
          'read-only',
          'running',
          NULL,
          NULL,
          '2026-04-24T12:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 42 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(provider_session_runtime)
      `;
      assertHasCurrentColumns(new Set(columns.map((column) => column.name)));

      const rows = yield* sql<{
        readonly adapterKey: string;
        readonly lastSeenAt: string;
        readonly runtimePayload: string | null;
      }>`
        SELECT
          adapter_key AS "adapterKey",
          last_seen_at AS "lastSeenAt",
          runtime_payload_json AS "runtimePayload"
        FROM provider_session_runtime
        WHERE thread_id = 'thread-existing'
      `;
      assert.deepStrictEqual(rows[0], {
        adapterKey: "claudeAgent",
        lastSeenAt: "2026-04-24T12:00:00.000Z",
        runtimePayload: null,
      });

      yield* assertProviderRuntimeUpsertPrepares;
    }),
  );

  it.effect("runs after databases already recorded newer migrations with a stale table shape", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 41 });
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 42`;
      yield* sql`ALTER TABLE provider_session_runtime DROP COLUMN adapter_key`;
      yield* sql`ALTER TABLE provider_session_runtime DROP COLUMN last_seen_at`;
      yield* sql`ALTER TABLE provider_session_runtime DROP COLUMN runtime_payload_json`;

      yield* runMigrations({ toMigrationInclusive: 42 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(provider_session_runtime)
      `;
      assertHasCurrentColumns(new Set(columns.map((column) => column.name)));

      yield* assertProviderRuntimeUpsertPrepares;
    }),
  );

  it.effect("043 repairs slot-era tables after 42 was already recorded", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 42 });
      yield* sql`DROP TABLE provider_session_runtime`;
      yield* sql`
        CREATE TABLE provider_session_runtime (
          thread_id TEXT NOT NULL,
          provider_name TEXT NOT NULL,
          adapter_key TEXT NOT NULL,
          runtime_mode TEXT NOT NULL DEFAULT 'full-access',
          status TEXT NOT NULL,
          slot_state TEXT NOT NULL DEFAULT 'stopped',
          last_seen_at TEXT NOT NULL,
          resume_cursor_json TEXT,
          runtime_payload_json TEXT,
          PRIMARY KEY (thread_id, provider_name)
        )
      `;
      yield* sql`
        CREATE UNIQUE INDEX idx_provider_session_runtime_active_thread
        ON provider_session_runtime(thread_id)
        WHERE slot_state = 'active'
      `;
      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id,
          provider_name,
          adapter_key,
          runtime_mode,
          status,
          slot_state,
          last_seen_at,
          resume_cursor_json,
          runtime_payload_json
        )
        VALUES
          (
            'thread-slot',
            'codex',
            'codex',
            'full-access',
            'stopped',
            'expired',
            '2026-04-24T12:00:00.000Z',
            NULL,
            '{"cwd":"/tmp/codex"}'
          ),
          (
            'thread-slot',
            'claudeAgent',
            'claudeAgent',
            'read-only',
            'running',
            'active',
            '2026-04-24T12:05:00.000Z',
            '{"cursor":"claude"}',
            '{"cwd":"/tmp/claude"}'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 43 });

      const columns = yield* sql<{ readonly name: string; readonly pk: number }>`
        PRAGMA table_info(provider_session_runtime)
      `;
      assertHasCurrentColumns(new Set(columns.map((column) => column.name)));
      assert.deepStrictEqual(
        columns
          .filter((column) => column.pk > 0)
          .map((column) => [column.name, column.pk] as const),
        [["thread_id", 1]],
      );
      assert.equal(
        columns.some((column) => column.name === "slot_state"),
        false,
      );

      const rows = yield* sql<{
        readonly providerName: string;
        readonly adapterKey: string;
        readonly runtimeMode: string;
        readonly resumeCursor: string | null;
        readonly runtimePayload: string | null;
      }>`
        SELECT
          provider_name AS "providerName",
          adapter_key AS "adapterKey",
          runtime_mode AS "runtimeMode",
          resume_cursor_json AS "resumeCursor",
          runtime_payload_json AS "runtimePayload"
        FROM provider_session_runtime
        WHERE thread_id = 'thread-slot'
      `;
      assert.deepStrictEqual(rows, [
        {
          providerName: "claudeAgent",
          adapterKey: "claudeAgent",
          runtimeMode: "read-only",
          resumeCursor: '{"cursor":"claude"}',
          runtimePayload: '{"cwd":"/tmp/claude"}',
        },
      ]);

      yield* assertProviderRuntimeUpsertPrepares;
    }),
  );
});
