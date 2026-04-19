import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    WITH matching_activity_events AS (
      SELECT
        json_extract(payload_json, '$.threadId') AS thread_id,
        json_extract(payload_json, '$.activity.id') AS activity_id,
        sequence
      FROM orchestration_events
      WHERE event_type = 'thread.activity-appended'
        AND json_extract(payload_json, '$.threadId') IS NOT NULL
        AND json_extract(payload_json, '$.activity.id') IS NOT NULL
    )
    UPDATE projection_thread_activities
    SET sequence = (
      SELECT matching_activity_events.sequence
      FROM matching_activity_events
      WHERE matching_activity_events.thread_id = projection_thread_activities.thread_id
        AND matching_activity_events.activity_id = projection_thread_activities.activity_id
    )
    WHERE projection_thread_activities.sequence IS NULL
      AND EXISTS (
        SELECT 1
        FROM matching_activity_events
        WHERE matching_activity_events.thread_id = projection_thread_activities.thread_id
          AND matching_activity_events.activity_id = projection_thread_activities.activity_id
      )
  `;
});
