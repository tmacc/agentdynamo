import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    WITH ranked_cards AS (
      SELECT
        card_id,
        ROW_NUMBER() OVER (
          PARTITION BY linked_thread_id
          ORDER BY created_at ASC, card_id ASC
        ) AS row_number
      FROM projection_board_cards
      WHERE linked_thread_id IS NOT NULL
    )
    UPDATE projection_board_cards
    SET linked_thread_id = NULL
    WHERE card_id IN (
      SELECT card_id
      FROM ranked_cards
      WHERE row_number > 1
    )
  `;

  yield* sql`
    DROP INDEX IF EXISTS idx_projection_board_cards_linked_thread_id
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_board_cards_linked_thread_id_unique
    ON projection_board_cards(linked_thread_id)
    WHERE linked_thread_id IS NOT NULL
  `;
});
