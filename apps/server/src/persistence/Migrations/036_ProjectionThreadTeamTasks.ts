import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_team_tasks (
      task_id TEXT PRIMARY KEY,
      parent_thread_id TEXT NOT NULL,
      child_thread_id TEXT NOT NULL,
      title TEXT NOT NULL,
      task TEXT NOT NULL,
      role_label TEXT,
      kind TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      model_selection_mode TEXT NOT NULL,
      model_selection_reason TEXT NOT NULL,
      workspace_mode TEXT NOT NULL,
      resolved_workspace_mode TEXT NOT NULL,
      setup_mode TEXT NOT NULL,
      resolved_setup_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      latest_summary TEXT,
      error_text TEXT,
      prompt_stats_json TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_team_tasks_parent_created
    ON projection_thread_team_tasks(parent_thread_id, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_team_tasks_child
    ON projection_thread_team_tasks(child_thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_team_tasks_parent_status
    ON projection_thread_team_tasks(parent_thread_id, status)
  `;
});
