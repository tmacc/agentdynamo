import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import createProjectionThreadTeamTasks from "./036_ProjectionThreadTeamTasks.ts";

const requiredColumns = [
  "task_id",
  "parent_thread_id",
  "child_thread_id",
  "title",
  "task",
  "role_label",
  "kind",
  "model_selection_json",
  "model_selection_mode",
  "model_selection_reason",
  "workspace_mode",
  "resolved_workspace_mode",
  "setup_mode",
  "resolved_setup_mode",
  "status",
  "latest_summary",
  "error_text",
  "prompt_stats_json",
  "created_at",
  "started_at",
  "completed_at",
  "updated_at",
] as const;

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_team_tasks)
  `;

  if (columns.length > 0) {
    const columnNames = new Set(columns.map((column) => column.name));
    const isCompatible = requiredColumns.every((column) => columnNames.has(column));
    if (!isCompatible) {
      yield* sql`DROP TABLE IF EXISTS projection_thread_team_tasks`;
    }
  }

  yield* createProjectionThreadTeamTasks;
});
