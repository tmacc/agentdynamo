import { Effect, Layer, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { ModelSelection } from "@t3tools/contracts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionThreadTeamTaskByChildThreadInput,
  GetProjectionThreadTeamTaskInput,
  ListProjectionThreadTeamTasksByParentInput,
  ProjectionThreadTeamTask,
  ProjectionThreadTeamTaskRepository,
  type ProjectionThreadTeamTaskRepositoryShape,
} from "../Services/ProjectionThreadTeamTasks.ts";

const ProjectionThreadTeamTaskDbRow = ProjectionThreadTeamTask.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
  }),
);

const makeProjectionThreadTeamTaskRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadTeamTaskRow = SqlSchema.void({
    Request: ProjectionThreadTeamTask,
    execute: (row) => sql`
      INSERT INTO projection_thread_team_tasks (
        task_id,
        parent_thread_id,
        child_thread_id,
        title,
        role_label,
        model_selection_json,
        workspace_mode,
        status,
        latest_summary,
        error_text,
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
        ${row.roleLabel},
        ${JSON.stringify(row.modelSelection)},
        ${row.workspaceMode},
        ${row.status},
        ${row.latestSummary},
        ${row.errorText},
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
        role_label = excluded.role_label,
        model_selection_json = excluded.model_selection_json,
        workspace_mode = excluded.workspace_mode,
        status = excluded.status,
        latest_summary = excluded.latest_summary,
        error_text = excluded.error_text,
        created_at = excluded.created_at,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `,
  });

  const getProjectionThreadTeamTaskRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadTeamTaskInput,
    Result: ProjectionThreadTeamTaskDbRow,
    execute: ({ taskId }) => sql`
      SELECT
        task_id AS "taskId",
        parent_thread_id AS "parentThreadId",
        child_thread_id AS "childThreadId",
        title,
        role_label AS "roleLabel",
        model_selection_json AS "modelSelection",
        workspace_mode AS "workspaceMode",
        status,
        latest_summary AS "latestSummary",
        error_text AS "errorText",
        created_at AS "createdAt",
        started_at AS "startedAt",
        completed_at AS "completedAt",
        updated_at AS "updatedAt"
      FROM projection_thread_team_tasks
      WHERE task_id = ${taskId}
    `,
  });

  const getProjectionThreadTeamTaskByChildThreadRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadTeamTaskByChildThreadInput,
    Result: ProjectionThreadTeamTaskDbRow,
    execute: ({ childThreadId }) => sql`
      SELECT
        task_id AS "taskId",
        parent_thread_id AS "parentThreadId",
        child_thread_id AS "childThreadId",
        title,
        role_label AS "roleLabel",
        model_selection_json AS "modelSelection",
        workspace_mode AS "workspaceMode",
        status,
        latest_summary AS "latestSummary",
        error_text AS "errorText",
        created_at AS "createdAt",
        started_at AS "startedAt",
        completed_at AS "completedAt",
        updated_at AS "updatedAt"
      FROM projection_thread_team_tasks
      WHERE child_thread_id = ${childThreadId}
    `,
  });

  const listProjectionThreadTeamTaskRows = SqlSchema.findAll({
    Request: ListProjectionThreadTeamTasksByParentInput,
    Result: ProjectionThreadTeamTaskDbRow,
    execute: ({ parentThreadId }) => sql`
      SELECT
        task_id AS "taskId",
        parent_thread_id AS "parentThreadId",
        child_thread_id AS "childThreadId",
        title,
        role_label AS "roleLabel",
        model_selection_json AS "modelSelection",
        workspace_mode AS "workspaceMode",
        status,
        latest_summary AS "latestSummary",
        error_text AS "errorText",
        created_at AS "createdAt",
        started_at AS "startedAt",
        completed_at AS "completedAt",
        updated_at AS "updatedAt"
      FROM projection_thread_team_tasks
      WHERE parent_thread_id = ${parentThreadId}
      ORDER BY created_at ASC, task_id ASC
    `,
  });

  const upsert: ProjectionThreadTeamTaskRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadTeamTaskRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadTeamTaskRepository.upsert:query")),
    );

  const getByTaskId: ProjectionThreadTeamTaskRepositoryShape["getByTaskId"] = (input) =>
    getProjectionThreadTeamTaskRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadTeamTaskRepository.getByTaskId:query"),
      ),
    );

  const getByChildThreadId: ProjectionThreadTeamTaskRepositoryShape["getByChildThreadId"] = (
    input,
  ) =>
    getProjectionThreadTeamTaskByChildThreadRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadTeamTaskRepository.getByChildThreadId:query"),
      ),
    );

  const listByParentThreadId: ProjectionThreadTeamTaskRepositoryShape["listByParentThreadId"] = (
    input,
  ) =>
    listProjectionThreadTeamTaskRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadTeamTaskRepository.listByParentThreadId:query"),
      ),
    );

  return {
    upsert,
    getByTaskId,
    getByChildThreadId,
    listByParentThreadId,
  } satisfies ProjectionThreadTeamTaskRepositoryShape;
});

export const ProjectionThreadTeamTaskRepositoryLive = Layer.effect(
  ProjectionThreadTeamTaskRepository,
  makeProjectionThreadTeamTaskRepository,
);
