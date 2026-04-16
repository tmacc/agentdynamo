import {
  IsoDateTime,
  ModelSelection,
  OrchestrationTeamTaskId,
  OrchestrationTeamTaskStatus,
  OrchestrationTeamTaskWorkspaceMode,
  ThreadId,
} from "@t3tools/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadTeamTask = Schema.Struct({
  taskId: OrchestrationTeamTaskId,
  parentThreadId: ThreadId,
  childThreadId: ThreadId,
  title: Schema.String,
  roleLabel: Schema.NullOr(Schema.String),
  modelSelection: ModelSelection,
  workspaceMode: OrchestrationTeamTaskWorkspaceMode,
  status: OrchestrationTeamTaskStatus,
  latestSummary: Schema.NullOr(Schema.String),
  errorText: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type ProjectionThreadTeamTask = typeof ProjectionThreadTeamTask.Type;

export const GetProjectionThreadTeamTaskInput = Schema.Struct({
  taskId: OrchestrationTeamTaskId,
});
export type GetProjectionThreadTeamTaskInput = typeof GetProjectionThreadTeamTaskInput.Type;

export const GetProjectionThreadTeamTaskByChildThreadInput = Schema.Struct({
  childThreadId: ThreadId,
});
export type GetProjectionThreadTeamTaskByChildThreadInput =
  typeof GetProjectionThreadTeamTaskByChildThreadInput.Type;

export const ListProjectionThreadTeamTasksByParentInput = Schema.Struct({
  parentThreadId: ThreadId,
});
export type ListProjectionThreadTeamTasksByParentInput =
  typeof ListProjectionThreadTeamTasksByParentInput.Type;

export interface ProjectionThreadTeamTaskRepositoryShape {
  readonly upsert: (
    row: ProjectionThreadTeamTask,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByTaskId: (
    input: GetProjectionThreadTeamTaskInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadTeamTask>, ProjectionRepositoryError>;
  readonly getByChildThreadId: (
    input: GetProjectionThreadTeamTaskByChildThreadInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadTeamTask>, ProjectionRepositoryError>;
  readonly listByParentThreadId: (
    input: ListProjectionThreadTeamTasksByParentInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadTeamTask>, ProjectionRepositoryError>;
}

export class ProjectionThreadTeamTaskRepository extends Context.Service<
  ProjectionThreadTeamTaskRepository,
  ProjectionThreadTeamTaskRepositoryShape
>()("t3/persistence/Services/ProjectionThreadTeamTasks/ProjectionThreadTeamTaskRepository") {}
