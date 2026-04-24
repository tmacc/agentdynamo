import { ModelSelection, OrchestrationContextHandoffRenderStats } from "@t3tools/contracts";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionThreadTeamTaskInput,
  ListProjectionThreadTeamTasksByChildInput,
  ListProjectionThreadTeamTasksByParentInput,
  ProjectionThreadTeamTask,
  ProjectionThreadTeamTaskRepository,
  type ProjectionThreadTeamTaskRepositoryShape,
} from "../Services/ProjectionThreadTeamTasks.ts";

const ProjectionThreadTeamTaskDbRow = ProjectionThreadTeamTask.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
    promptStats: Schema.NullOr(Schema.fromJsonString(OrchestrationContextHandoffRenderStats)),
  }),
);

const selectColumns = `
  task_id AS "taskId",
  parent_thread_id AS "parentThreadId",
  child_thread_id AS "childThreadId",
  title,
  task,
  role_label AS "roleLabel",
  kind,
  model_selection_json AS "modelSelection",
  model_selection_mode AS "modelSelectionMode",
  model_selection_reason AS "modelSelectionReason",
  workspace_mode AS "workspaceMode",
  resolved_workspace_mode AS "resolvedWorkspaceMode",
  setup_mode AS "setupMode",
  resolved_setup_mode AS "resolvedSetupMode",
  status,
  latest_summary AS "latestSummary",
  error_text AS "errorText",
  prompt_stats_json AS "promptStats",
  created_at AS "createdAt",
  started_at AS "startedAt",
  completed_at AS "completedAt",
  updated_at AS "updatedAt"
`;

const makeProjectionThreadTeamTaskRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionThreadTeamTask,
    execute: (row) =>
      sql`
        INSERT INTO projection_thread_team_tasks (
          task_id,
          parent_thread_id,
          child_thread_id,
          title,
          task,
          role_label,
          kind,
          model_selection_json,
          model_selection_mode,
          model_selection_reason,
          workspace_mode,
          resolved_workspace_mode,
          setup_mode,
          resolved_setup_mode,
          status,
          latest_summary,
          error_text,
          prompt_stats_json,
          created_at,
          started_at,
          completed_at,
          updated_at
        )
        VALUES (
          ${row.taskId},
          ${row.parentThreadId},
          ${row.childThreadId},
          ${row.title},
          ${row.task},
          ${row.roleLabel},
          ${row.kind},
          ${JSON.stringify(row.modelSelection)},
          ${row.modelSelectionMode},
          ${row.modelSelectionReason},
          ${row.workspaceMode},
          ${row.resolvedWorkspaceMode},
          ${row.setupMode},
          ${row.resolvedSetupMode},
          ${row.status},
          ${row.latestSummary},
          ${row.errorText},
          ${row.promptStats === null ? null : JSON.stringify(row.promptStats)},
          ${row.createdAt},
          ${row.startedAt},
          ${row.completedAt},
          ${row.updatedAt}
        )
        ON CONFLICT (task_id)
        DO UPDATE SET
          parent_thread_id = excluded.parent_thread_id,
          child_thread_id = excluded.child_thread_id,
          title = excluded.title,
          task = excluded.task,
          role_label = excluded.role_label,
          kind = excluded.kind,
          model_selection_json = excluded.model_selection_json,
          model_selection_mode = excluded.model_selection_mode,
          model_selection_reason = excluded.model_selection_reason,
          workspace_mode = excluded.workspace_mode,
          resolved_workspace_mode = excluded.resolved_workspace_mode,
          setup_mode = excluded.setup_mode,
          resolved_setup_mode = excluded.resolved_setup_mode,
          status = excluded.status,
          latest_summary = excluded.latest_summary,
          error_text = excluded.error_text,
          prompt_stats_json = excluded.prompt_stats_json,
          created_at = excluded.created_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          updated_at = excluded.updated_at
      `,
  });

  const getByTaskIdRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadTeamTaskInput,
    Result: ProjectionThreadTeamTaskDbRow,
    execute: ({ taskId }) =>
      sql`SELECT ${sql.unsafe(selectColumns)} FROM projection_thread_team_tasks WHERE task_id = ${taskId}`,
  });

  const listByParentRows = SqlSchema.findAll({
    Request: ListProjectionThreadTeamTasksByParentInput,
    Result: ProjectionThreadTeamTaskDbRow,
    execute: ({ parentThreadId }) =>
      sql`
        SELECT ${sql.unsafe(selectColumns)}
        FROM projection_thread_team_tasks
        WHERE parent_thread_id = ${parentThreadId}
        ORDER BY created_at ASC, task_id ASC
      `,
  });

  const listByChildRows = SqlSchema.findAll({
    Request: ListProjectionThreadTeamTasksByChildInput,
    Result: ProjectionThreadTeamTaskDbRow,
    execute: ({ childThreadId }) =>
      sql`
        SELECT ${sql.unsafe(selectColumns)}
        FROM projection_thread_team_tasks
        WHERE child_thread_id = ${childThreadId}
        ORDER BY created_at ASC, task_id ASC
      `,
  });

  const upsert: ProjectionThreadTeamTaskRepositoryShape["upsert"] = (task) =>
    upsertRow(task).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadTeamTaskRepository.upsert:query")),
    );

  const getByTaskId: ProjectionThreadTeamTaskRepositoryShape["getByTaskId"] = (input) =>
    getByTaskIdRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadTeamTaskRepository.getByTaskId:query"),
      ),
      Effect.map((row) => (Option.isSome(row) ? Option.some(row.value) : Option.none())),
    );

  const listByParentThreadId: ProjectionThreadTeamTaskRepositoryShape["listByParentThreadId"] = (
    input,
  ) =>
    listByParentRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadTeamTaskRepository.listByParentThreadId:query"),
      ),
    );

  const listByChildThreadId: ProjectionThreadTeamTaskRepositoryShape["listByChildThreadId"] = (
    input,
  ) =>
    listByChildRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadTeamTaskRepository.listByChildThreadId:query"),
      ),
    );

  return {
    upsert,
    getByTaskId,
    listByParentThreadId,
    listByChildThreadId,
  } satisfies ProjectionThreadTeamTaskRepositoryShape;
});

export const ProjectionThreadTeamTaskRepositoryLive = Layer.effect(
  ProjectionThreadTeamTaskRepository,
  makeProjectionThreadTeamTaskRepository,
);
