import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import createProviderSessionRuntime from "./004_ProviderSessionRuntime.ts";

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

const legacyConstraintColumns = ["provider_thread_id", "last_error", "updated_at"] as const;

const columnExists = (columns: ReadonlyArray<{ readonly name: string }>, name: string) =>
  columns.some((column) => column.name === name);

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(provider_session_runtime)
  `;

  if (columns.length === 0) {
    yield* createProviderSessionRuntime;
    return;
  }

  const hasCurrentColumns = currentColumns.every((column) => columnExists(columns, column));
  const hasLegacyConstraintColumns = legacyConstraintColumns.some((column) =>
    columnExists(columns, column),
  );

  if (!hasCurrentColumns || hasLegacyConstraintColumns) {
    const providerNameExpression = columnExists(columns, "provider_name")
      ? "COALESCE(NULLIF(provider_name, ''), 'codex')"
      : "'codex'";
    const adapterKeyExpression = columnExists(columns, "adapter_key")
      ? columnExists(columns, "provider_name")
        ? "COALESCE(NULLIF(adapter_key, ''), NULLIF(provider_name, ''), 'codex')"
        : "COALESCE(NULLIF(adapter_key, ''), 'codex')"
      : providerNameExpression;
    const runtimeModeExpression = columnExists(columns, "runtime_mode")
      ? "COALESCE(NULLIF(runtime_mode, ''), 'full-access')"
      : "'full-access'";
    const statusExpression = columnExists(columns, "status")
      ? "CASE WHEN status IN ('starting', 'running', 'stopped', 'error') THEN status ELSE 'stopped' END"
      : "'stopped'";
    const lastSeenAtExpression = columnExists(columns, "last_seen_at")
      ? columnExists(columns, "updated_at")
        ? "COALESCE(NULLIF(last_seen_at, ''), NULLIF(updated_at, ''), '1970-01-01T00:00:00.000Z')"
        : "COALESCE(NULLIF(last_seen_at, ''), '1970-01-01T00:00:00.000Z')"
      : columnExists(columns, "updated_at")
        ? "COALESCE(NULLIF(updated_at, ''), '1970-01-01T00:00:00.000Z')"
        : "'1970-01-01T00:00:00.000Z'";
    const resumeCursorExpression = columnExists(columns, "resume_cursor_json")
      ? "resume_cursor_json"
      : "NULL";
    const runtimePayloadExpression = columnExists(columns, "runtime_payload_json")
      ? "runtime_payload_json"
      : "NULL";

    yield* sql`DROP TABLE IF EXISTS provider_session_runtime_current`;
    yield* sql`
      CREATE TABLE provider_session_runtime_current (
        thread_id TEXT PRIMARY KEY,
        provider_name TEXT NOT NULL,
        adapter_key TEXT NOT NULL,
        runtime_mode TEXT NOT NULL DEFAULT 'full-access',
        status TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        resume_cursor_json TEXT,
        runtime_payload_json TEXT
      )
    `;

    if (columnExists(columns, "thread_id")) {
      yield* sql`
        INSERT INTO provider_session_runtime_current (
          thread_id,
          provider_name,
          adapter_key,
          runtime_mode,
          status,
          last_seen_at,
          resume_cursor_json,
          runtime_payload_json
        )
        SELECT
          thread_id,
          ${sql.unsafe(providerNameExpression)},
          ${sql.unsafe(adapterKeyExpression)},
          ${sql.unsafe(runtimeModeExpression)},
          ${sql.unsafe(statusExpression)},
          ${sql.unsafe(lastSeenAtExpression)},
          ${sql.unsafe(resumeCursorExpression)},
          ${sql.unsafe(runtimePayloadExpression)}
        FROM provider_session_runtime
        WHERE thread_id IS NOT NULL AND thread_id != ''
      `;
    }

    yield* sql`DROP TABLE provider_session_runtime`;
    yield* sql`
      ALTER TABLE provider_session_runtime_current
      RENAME TO provider_session_runtime
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_status
    ON provider_session_runtime(status)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_provider
    ON provider_session_runtime(provider_name)
  `;
});
