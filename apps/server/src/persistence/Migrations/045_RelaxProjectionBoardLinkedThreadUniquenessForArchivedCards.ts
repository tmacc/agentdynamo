import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DROP INDEX IF EXISTS idx_projection_board_cards_linked_thread_id_unique
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_board_cards_linked_thread_id_unique
    ON projection_board_cards(linked_thread_id)
    WHERE linked_thread_id IS NOT NULL AND archived_at IS NULL
  `;
});
