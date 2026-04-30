import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import {
  ProjectionMaintenance,
  type ProjectionMaintenanceShape,
} from "../Services/ProjectionMaintenance.ts";

const makeProjectionMaintenance = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const repairLegacyAssistantCompletedTurns: ProjectionMaintenanceShape["repairLegacyAssistantCompletedTurns"] =
    () =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`DROP TABLE IF EXISTS temp_legacy_assistant_turn_repairs`;
            yield* sql`DROP TABLE IF EXISTS temp_legacy_assistant_turn_promotions`;

            yield* sql`
              CREATE TEMP TABLE temp_legacy_assistant_turn_repairs AS
              SELECT
                turn.thread_id,
                turn.turn_id,
                message.message_id,
                message.created_at AS message_created_at,
                message.updated_at AS message_updated_at,
                COALESCE(turn.started_at, turn.requested_at, message.created_at) AS candidate_order_time
              FROM projection_turns AS turn
              JOIN projection_thread_messages AS message
                ON message.thread_id = turn.thread_id
               AND message.turn_id = turn.turn_id
               AND message.role = 'assistant'
               AND message.is_streaming = 0
              WHERE turn.turn_id IS NOT NULL
                AND turn.state = 'running'
                AND turn.completed_at IS NULL
                AND NOT EXISTS (
                  SELECT 1
                  FROM projection_thread_sessions AS session
                  WHERE session.thread_id = turn.thread_id
                    AND session.active_turn_id = turn.turn_id
                    AND session.status IN ('starting', 'running', 'recovering')
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM orchestration_events AS event
                  WHERE event.event_type = 'thread.turn-completed'
                    AND json_extract(event.payload_json, '$.threadId') = turn.thread_id
                    AND json_extract(event.payload_json, '$.turnId') = turn.turn_id
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM projection_thread_messages AS newer_message
                  WHERE newer_message.thread_id = message.thread_id
                    AND newer_message.turn_id = message.turn_id
                    AND newer_message.role = 'assistant'
                    AND newer_message.is_streaming = 0
                    AND (
                      newer_message.updated_at > message.updated_at
                      OR (
                        newer_message.updated_at = message.updated_at
                        AND newer_message.created_at > message.created_at
                      )
                      OR (
                        newer_message.updated_at = message.updated_at
                        AND newer_message.created_at = message.created_at
                        AND newer_message.message_id > message.message_id
                      )
                    )
                )
            `;

            const repairedRows = yield* sql<{ readonly count: number }>`
              SELECT COUNT(*) AS count
              FROM temp_legacy_assistant_turn_repairs
            `;
            const repairedTurnCount = repairedRows[0]?.count ?? 0;

            yield* sql`
              UPDATE projection_turns
              SET
                state = 'completed',
                assistant_message_id = COALESCE(
                  assistant_message_id,
                  (
                    SELECT repair.message_id
                    FROM temp_legacy_assistant_turn_repairs AS repair
                    WHERE repair.thread_id = projection_turns.thread_id
                      AND repair.turn_id = projection_turns.turn_id
                    LIMIT 1
                  )
                ),
                completed_at = (
                  SELECT repair.message_updated_at
                  FROM temp_legacy_assistant_turn_repairs AS repair
                  WHERE repair.thread_id = projection_turns.thread_id
                    AND repair.turn_id = projection_turns.turn_id
                  LIMIT 1
                ),
                started_at = COALESCE(
                  started_at,
                  (
                    SELECT repair.message_created_at
                    FROM temp_legacy_assistant_turn_repairs AS repair
                    WHERE repair.thread_id = projection_turns.thread_id
                      AND repair.turn_id = projection_turns.turn_id
                    LIMIT 1
                  )
                ),
                requested_at = COALESCE(
                  requested_at,
                  (
                    SELECT repair.message_created_at
                    FROM temp_legacy_assistant_turn_repairs AS repair
                    WHERE repair.thread_id = projection_turns.thread_id
                      AND repair.turn_id = projection_turns.turn_id
                    LIMIT 1
                  )
                )
              WHERE EXISTS (
                SELECT 1
                FROM temp_legacy_assistant_turn_repairs AS repair
                WHERE repair.thread_id = projection_turns.thread_id
                  AND repair.turn_id = projection_turns.turn_id
              )
            `;

            yield* sql`
              CREATE TEMP TABLE temp_legacy_assistant_turn_promotions AS
              SELECT
                repair.thread_id,
                repair.turn_id,
                repair.candidate_order_time
              FROM temp_legacy_assistant_turn_repairs AS repair
              JOIN projection_threads AS thread
                ON thread.thread_id = repair.thread_id
              LEFT JOIN projection_turns AS current_latest
                ON current_latest.thread_id = thread.thread_id
               AND current_latest.turn_id = thread.latest_turn_id
              WHERE (
                  thread.latest_turn_id IS NULL
                  OR thread.latest_turn_id = repair.turn_id
                  OR (
                    repair.candidate_order_time IS NOT NULL
                    AND COALESCE(current_latest.started_at, current_latest.requested_at) IS NOT NULL
                    AND repair.candidate_order_time > COALESCE(
                      current_latest.started_at,
                      current_latest.requested_at
                    )
                  )
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM temp_legacy_assistant_turn_repairs AS other
                  WHERE other.thread_id = repair.thread_id
                    AND (
                      COALESCE(other.candidate_order_time, '') > COALESCE(repair.candidate_order_time, '')
                      OR (
                        COALESCE(other.candidate_order_time, '') = COALESCE(repair.candidate_order_time, '')
                        AND other.turn_id > repair.turn_id
                      )
                    )
                )
            `;

            const promotedRows = yield* sql<{ readonly count: number }>`
              SELECT COUNT(*) AS count
              FROM temp_legacy_assistant_turn_promotions
            `;
            const promotedLatestCount = promotedRows[0]?.count ?? 0;

            yield* sql`
              UPDATE projection_threads
              SET
                latest_turn_id = (
                  SELECT promotion.turn_id
                  FROM temp_legacy_assistant_turn_promotions AS promotion
                  WHERE promotion.thread_id = projection_threads.thread_id
                  LIMIT 1
                ),
                updated_at = COALESCE(
                  (
                    SELECT promotion.candidate_order_time
                    FROM temp_legacy_assistant_turn_promotions AS promotion
                    WHERE promotion.thread_id = projection_threads.thread_id
                    LIMIT 1
                  ),
                  updated_at
                )
              WHERE EXISTS (
                SELECT 1
                FROM temp_legacy_assistant_turn_promotions AS promotion
                WHERE promotion.thread_id = projection_threads.thread_id
              )
            `;

            yield* sql`DROP TABLE IF EXISTS temp_legacy_assistant_turn_promotions`;
            yield* sql`DROP TABLE IF EXISTS temp_legacy_assistant_turn_repairs`;

            return { repairedTurnCount, promotedLatestCount };
          }),
        )
        .pipe(
          Effect.mapError(
            toPersistenceSqlError("ProjectionMaintenance.repairLegacyAssistantCompletedTurns"),
          ),
        );

  return {
    repairLegacyAssistantCompletedTurns,
  } satisfies ProjectionMaintenanceShape;
});

export const ProjectionMaintenanceLive = Layer.effect(
  ProjectionMaintenance,
  makeProjectionMaintenance,
);
