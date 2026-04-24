import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS team_coordinator_access_grants (
      grant_id TEXT PRIMARY KEY,
      parent_thread_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_team_coordinator_access_grants_parent
    ON team_coordinator_access_grants(parent_thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_team_coordinator_access_grants_token_hash
    ON team_coordinator_access_grants(token_hash)
  `;
});
