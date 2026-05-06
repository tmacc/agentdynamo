import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Canonicalize Dynamo's historical `prototype` interaction mode to upstream's
 * merged `plan` mode. Rows with the legacy value predate the upstream
 * VCS/source-control sync and otherwise fail projection snapshot decoding.
 *
 * This intentionally uses migration id 53 because older Dynamo dev databases
 * already used ids 49-52 for fork-local migrations that were later replaced
 * during upstream sync conflict resolution.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_threads
    SET interaction_mode = 'plan'
    WHERE interaction_mode = 'prototype'
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(payload_json, '$.interactionMode', 'plan')
    WHERE event_type IN ('thread.created', 'thread.interaction-mode-set')
      AND json_extract(payload_json, '$.interactionMode') = 'prototype'
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(payload_json, '$.createThread.interactionMode', 'plan')
    WHERE event_type = 'thread.turn-start-requested'
      AND json_extract(payload_json, '$.createThread.interactionMode') = 'prototype'
  `;
});
