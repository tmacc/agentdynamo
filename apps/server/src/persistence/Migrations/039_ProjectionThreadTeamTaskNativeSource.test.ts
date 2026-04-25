import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("039_ProjectionThreadTeamTaskNativeSource", (it) => {
  it.effect("adds native provider mirror columns and preserves old rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 38 });
      yield* sql`
        INSERT INTO projection_thread_team_tasks (
          task_id,
          parent_thread_id,
          child_thread_id,
          title,
          task,
          role_label,
          kind,
          model_selection_json,
          model_selection_mode,
          model_selection_reason,
          workspace_mode,
          resolved_workspace_mode,
          setup_mode,
          resolved_setup_mode,
          status,
          latest_summary,
          error_text,
          prompt_stats_json,
          created_at,
          started_at,
          completed_at,
          updated_at
        )
        VALUES (
          'team-task-old',
          'thread-parent',
          'thread-child',
          'Old task',
          'Do old work',
          NULL,
          'general',
          '{"provider":"codex","model":"gpt-5.5"}',
          'coordinator-selected',
          'Selected by coordinator.',
          'auto',
          'shared',
          'auto',
          'skip',
          'running',
          NULL,
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z',
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 39 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_team_tasks)
      `;
      const columnNames = new Set(columns.map((column) => column.name));
      assert.ok(columnNames.has("source"));
      assert.ok(columnNames.has("child_thread_materialized"));
      assert.ok(columnNames.has("native_provider_ref_json"));

      const oldRows = yield* sql<{
        readonly source: string;
        readonly childThreadMaterialized: number;
        readonly nativeProviderRef: string | null;
      }>`
        SELECT
          source,
          child_thread_materialized AS "childThreadMaterialized",
          native_provider_ref_json AS "nativeProviderRef"
        FROM projection_thread_team_tasks
        WHERE task_id = 'team-task-old'
      `;
      assert.deepStrictEqual(oldRows[0], {
        source: "dynamo",
        childThreadMaterialized: 1,
        nativeProviderRef: null,
      });

      yield* sql`
        INSERT INTO projection_thread_team_tasks (
          task_id,
          parent_thread_id,
          child_thread_id,
          title,
          task,
          role_label,
          kind,
          model_selection_json,
          model_selection_mode,
          model_selection_reason,
          workspace_mode,
          resolved_workspace_mode,
          setup_mode,
          resolved_setup_mode,
          source,
          child_thread_materialized,
          native_provider_ref_json,
          status,
          latest_summary,
          error_text,
          prompt_stats_json,
          created_at,
          started_at,
          completed_at,
          updated_at
        )
        VALUES (
          'team-task-native',
          'thread-parent',
          'native-child:codex:abc123',
          'Native task',
          'Provider-native Codex subagent',
          NULL,
          'general',
          '{"provider":"codex","model":"gpt-5.5"}',
          'coordinator-selected',
          'Provider-native subagent; exact worker runtime is managed by the provider.',
          'shared',
          'shared',
          'skip',
          'skip',
          'native-provider',
          0,
          '{"provider":"codex","providerItemId":"item-1"}',
          'completed',
          'Done',
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:01:00.000Z',
          '2026-01-01T00:01:00.000Z'
        )
      `;

      const nativeRows = yield* sql<{
        readonly source: string;
        readonly childThreadMaterialized: number;
        readonly nativeProviderRef: string | null;
      }>`
        SELECT
          source,
          child_thread_materialized AS "childThreadMaterialized",
          native_provider_ref_json AS "nativeProviderRef"
        FROM projection_thread_team_tasks
        WHERE task_id = 'team-task-native'
      `;
      assert.deepStrictEqual(nativeRows[0], {
        source: "native-provider",
        childThreadMaterialized: 0,
        nativeProviderRef: '{"provider":"codex","providerItemId":"item-1"}',
      });
    }),
  );

  it.effect("040 recovers databases that already recorded 039 without the native columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 39 });
      yield* sql`ALTER TABLE projection_thread_team_tasks DROP COLUMN source`;
      yield* sql`ALTER TABLE projection_thread_team_tasks DROP COLUMN child_thread_materialized`;
      yield* sql`ALTER TABLE projection_thread_team_tasks DROP COLUMN native_provider_ref_json`;

      yield* runMigrations({ toMigrationInclusive: 40 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_team_tasks)
      `;
      const columnNames = new Set(columns.map((column) => column.name));
      assert.ok(columnNames.has("source"));
      assert.ok(columnNames.has("child_thread_materialized"));
      assert.ok(columnNames.has("native_provider_ref_json"));
    }),
  );
});
