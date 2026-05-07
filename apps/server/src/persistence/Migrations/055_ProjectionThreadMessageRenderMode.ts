import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

type TableColumn = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<TableColumn>`
    PRAGMA table_info(projection_thread_messages)
  `;
  if (columns.length === 0) {
    return yield* Effect.fail(
      new Error("projection_thread_messages table is missing before migration 55"),
    );
  }
  if (columns.some((column) => column.name === "render_mode")) {
    return;
  }

  yield* sql`
    ALTER TABLE projection_thread_messages
    ADD COLUMN render_mode TEXT
  `;
});
