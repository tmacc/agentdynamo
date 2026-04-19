import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_board_dismissed_ghosts (
      project_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      dismissed_at TEXT NOT NULL,
      PRIMARY KEY (project_id, thread_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_board_dismissed_ghosts_project_id
    ON projection_board_dismissed_ghosts(project_id)
  `;
});
