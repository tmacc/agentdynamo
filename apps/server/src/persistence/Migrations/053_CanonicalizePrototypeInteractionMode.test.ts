import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("053_CanonicalizePrototypeInteractionMode", (it) => {
  it.effect("runs after historical fork migration ids and maps prototype mode to plan", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 48 });

      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (49, 'EnsureProjectionThreadReviewState'),
          (50, 'EnsureProjectionThreadReviewState'),
          (51, 'ProjectionThreadPrototypeRef'),
          (52, 'EnsureProjectionThreadPrototypeRef')
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          deleted_at,
          runtime_mode,
          interaction_mode
        )
        VALUES
          (
            'thread-prototype',
            'project-1',
            'Prototype thread',
            '{"model":"gpt-5.4","instanceId":"codex"}',
            NULL, NULL, NULL,
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z',
            NULL, NULL, 0, 0, 0, NULL,
            'full-access', 'prototype'
          ),
          (
            'thread-default',
            'project-1',
            'Default thread',
            '{"model":"gpt-5.4","instanceId":"codex"}',
            NULL, NULL, NULL,
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z',
            NULL, NULL, 0, 0, 0, NULL,
            'full-access', 'default'
          )
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES
          (
            'event-thread-created',
            'thread',
            'thread-prototype',
            1,
            'thread.created',
            '2026-01-01T00:00:00.000Z',
            'cmd-created',
            NULL,
            'corr-created',
            'user',
            '{"threadId":"thread-prototype","interactionMode":"prototype"}',
            '{}'
          ),
          (
            'event-interaction-set',
            'thread',
            'thread-prototype',
            2,
            'thread.interaction-mode-set',
            '2026-01-01T00:00:01.000Z',
            'cmd-mode',
            NULL,
            'corr-mode',
            'user',
            '{"threadId":"thread-prototype","interactionMode":"prototype"}',
            '{}'
          ),
          (
            'event-turn-start',
            'thread',
            'thread-prototype',
            3,
            'thread.turn-start-requested',
            '2026-01-01T00:00:02.000Z',
            'cmd-turn',
            NULL,
            'corr-turn',
            'user',
            '{"threadId":"thread-prototype","createThread":{"interactionMode":"prototype"}}',
            '{}'
          )
      `;

      const executed = yield* runMigrations();
      assert.ok(
        executed.some(([id, name]) => id === 53 && name === "CanonicalizePrototypeInteractionMode"),
      );

      const threadRows = yield* sql<{
        readonly thread_id: string;
        readonly interaction_mode: string;
      }>`
        SELECT thread_id, interaction_mode
        FROM projection_threads
        ORDER BY thread_id
      `;
      assert.deepStrictEqual(threadRows, [
        { thread_id: "thread-default", interaction_mode: "default" },
        { thread_id: "thread-prototype", interaction_mode: "plan" },
      ]);

      const eventRows = yield* sql<{
        readonly event_type: string;
        readonly interaction_mode: string | null;
        readonly create_thread_interaction_mode: string | null;
      }>`
        SELECT
          event_type,
          json_extract(payload_json, '$.interactionMode') AS interaction_mode,
          json_extract(payload_json, '$.createThread.interactionMode') AS create_thread_interaction_mode
        FROM orchestration_events
        ORDER BY sequence
      `;
      assert.deepStrictEqual(eventRows, [
        {
          event_type: "thread.created",
          interaction_mode: "plan",
          create_thread_interaction_mode: null,
        },
        {
          event_type: "thread.interaction-mode-set",
          interaction_mode: "plan",
          create_thread_interaction_mode: null,
        },
        {
          event_type: "thread.turn-start-requested",
          interaction_mode: null,
          create_thread_interaction_mode: "plan",
        },
      ]);
    }),
  );
});
