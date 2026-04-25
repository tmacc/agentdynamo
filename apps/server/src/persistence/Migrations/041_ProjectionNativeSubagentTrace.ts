import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_native_subagent_trace_items (
      parent_thread_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      trace_item_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_thread_id TEXT,
      provider_turn_id TEXT,
      provider_item_id TEXT,
      provider_tool_use_id TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT,
      detail TEXT,
      text TEXT,
      tool_name TEXT,
      input_summary TEXT,
      output_summary TEXT,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (task_id, trace_item_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_native_trace_parent_task_sequence
    ON projection_native_subagent_trace_items(parent_thread_id, task_id, sequence)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_native_trace_provider_thread
    ON projection_native_subagent_trace_items(provider, provider_thread_id)
  `;
});
