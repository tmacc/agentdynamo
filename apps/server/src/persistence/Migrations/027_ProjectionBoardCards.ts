import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_board_cards (
      card_id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      seeded_prompt TEXT,
      column_name TEXT NOT NULL,
      sort_order REAL NOT NULL,
      linked_thread_id TEXT,
      linked_proposed_plan_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_board_cards_project_id
    ON projection_board_cards(project_id)
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
