import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("032_BackfillProjectionThreadActivitySequence", (it) => {
  it.effect("backfills missing projection activity sequences from orchestration_events", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 31 });

      yield* sql`
        INSERT INTO orchestration_events (
          sequence,
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
            41,
            'event-thread-activity-1',
            'thread',
            'thread-1',
            1,
            'thread.activity-appended',
            '2026-04-19T12:30:01.000Z',
            'cmd-thread-activity-1',
            NULL,
            'cmd-thread-activity-1',
            'system',
            '{"threadId":"thread-1","activity":{"id":"activity-1","tone":"info","kind":"team.task.spawned","summary":"Spawned task","payload":{"taskId":"team-task:1"},"turnId":null,"createdAt":"2026-04-19T12:30:01.000Z"}}',
            '{}'
          ),
          (
            42,
            'event-thread-activity-2',
            'thread',
            'thread-1',
            2,
            'thread.activity-appended',
            '2026-04-19T12:30:02.000Z',
            'cmd-thread-activity-2',
            NULL,
            'cmd-thread-activity-2',
            'system',
            '{"threadId":"thread-1","activity":{"id":"activity-2","tone":"info","kind":"team.task.completed","summary":"Completed task","payload":{"taskId":"team-task:1"},"turnId":null,"createdAt":"2026-04-19T12:30:02.000Z"}}',
            '{}'
          )
      `;

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          sequence,
          created_at
        )
        VALUES
          (
            'activity-1',
            'thread-1',
            NULL,
            'info',
            'team.task.spawned',
            'Spawned task',
            '{"taskId":"team-task:1"}',
            NULL,
            '2026-04-19T12:30:01.000Z'
          ),
          (
            'activity-2',
            'thread-1',
            NULL,
            'info',
            'team.task.completed',
            'Completed task',
            '{"taskId":"team-task:1"}',
            NULL,
            '2026-04-19T12:30:02.000Z'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 32 });

      const rows = yield* sql<{
        readonly activityId: string;
        readonly sequence: number | null;
      }>`
        SELECT
          activity_id AS "activityId",
          sequence
        FROM projection_thread_activities
        ORDER BY activity_id ASC
      `;

      assert.deepStrictEqual(rows, [
        {
          activityId: "activity-1",
          sequence: 41,
        },
        {
          activityId: "activity-2",
          sequence: 42,
        },
      ]);
    }),
  );
});
