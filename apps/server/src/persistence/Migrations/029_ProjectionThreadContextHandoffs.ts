import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_context_handoffs (
      handoff_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      source_thread_id TEXT,
      source_thread_title TEXT,
      source_user_message_id TEXT,
      source_provider TEXT,
      target_provider TEXT,
      imported_until_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      delivered_provider TEXT,
      delivered_turn_id TEXT,
      delivered_live_message_id TEXT,
      last_failure_at TEXT,
      last_failure_detail TEXT,
      render_stats_json TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_context_handoffs_thread_created
    ON projection_thread_context_handoffs (thread_id, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_context_handoffs_pending_thread
    ON projection_thread_context_handoffs (thread_id, delivered_at)
  `;
});
