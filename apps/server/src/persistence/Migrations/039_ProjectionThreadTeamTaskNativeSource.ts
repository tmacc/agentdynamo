import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const columnExists = (columns: ReadonlyArray<{ readonly name: string }>, name: string) =>
  columns.some((column) => column.name === name);

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_team_tasks)
  `;

  if (!columnExists(columns, "source")) {
    yield* sql`
      ALTER TABLE projection_thread_team_tasks
      ADD COLUMN source TEXT NOT NULL DEFAULT 'dynamo'
    `;
  }

  if (!columnExists(columns, "child_thread_materialized")) {
    yield* sql`
      ALTER TABLE projection_thread_team_tasks
      ADD COLUMN child_thread_materialized INTEGER NOT NULL DEFAULT 1
    `;
  }

  if (!columnExists(columns, "native_provider_ref_json")) {
    yield* sql`
      ALTER TABLE projection_thread_team_tasks
      ADD COLUMN native_provider_ref_json TEXT
    `;
  }
});
