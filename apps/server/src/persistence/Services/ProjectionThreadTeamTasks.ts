import {
  IsoDateTime,
  OrchestrationContextHandoffRenderStats,
  NativeProviderTeamTaskRef,
  ModelSelection,
  OrchestrationTeamTask,
  TeamTaskId,
  TeamTaskKind,
  TeamTaskModelSelectionMode,
  TeamTaskResolvedSetupMode,
  TeamTaskResolvedWorkspaceMode,
  TeamTaskSetupMode,
  TeamTaskSource,
  TeamTaskStatus,
  TeamTaskWorkspaceMode,
  ThreadId,
} from "@t3tools/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadTeamTask = Schema.Struct({
  taskId: TeamTaskId,
  parentThreadId: ThreadId,
  childThreadId: ThreadId,
  title: Schema.String,
  task: Schema.String,
  roleLabel: Schema.NullOr(Schema.String),
  kind: TeamTaskKind,
  modelSelection: ModelSelection,
  modelSelectionMode: TeamTaskModelSelectionMode,
  modelSelectionReason: Schema.String,
  workspaceMode: TeamTaskWorkspaceMode,
  resolvedWorkspaceMode: TeamTaskResolvedWorkspaceMode,
  setupMode: TeamTaskSetupMode,
  resolvedSetupMode: TeamTaskResolvedSetupMode,
  source: TeamTaskSource,
  childThreadMaterialized: Schema.Boolean,
  nativeProviderRef: Schema.NullOr(NativeProviderTeamTaskRef),
  status: TeamTaskStatus,
  latestSummary: Schema.NullOr(Schema.String),
  errorText: Schema.NullOr(Schema.String),
  promptStats: Schema.NullOr(OrchestrationContextHandoffRenderStats),
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type ProjectionThreadTeamTask = typeof ProjectionThreadTeamTask.Type;

export const UpsertProjectionThreadTeamTaskInput = ProjectionThreadTeamTask;
export type UpsertProjectionThreadTeamTaskInput = typeof UpsertProjectionThreadTeamTaskInput.Type;

export const GetProjectionThreadTeamTaskInput = Schema.Struct({
  taskId: TeamTaskId,
});
export type GetProjectionThreadTeamTaskInput = typeof GetProjectionThreadTeamTaskInput.Type;

export const ListProjectionThreadTeamTasksByParentInput = Schema.Struct({
  parentThreadId: ThreadId,
});
export type ListProjectionThreadTeamTasksByParentInput =
  typeof ListProjectionThreadTeamTasksByParentInput.Type;

export const ListProjectionThreadTeamTasksByChildInput = Schema.Struct({
  childThreadId: ThreadId,
});
export type ListProjectionThreadTeamTasksByChildInput =
  typeof ListProjectionThreadTeamTasksByChildInput.Type;

export function projectionTeamTaskToReadModel(
  row: ProjectionThreadTeamTask,
): OrchestrationTeamTask {
  return {
    id: row.taskId,
    parentThreadId: row.parentThreadId,
    childThreadId: row.childThreadId,
    title: row.title,
    task: row.task,
    roleLabel: row.roleLabel,
    kind: row.kind,
    modelSelection: row.modelSelection,
    modelSelectionMode: row.modelSelectionMode,
    modelSelectionReason: row.modelSelectionReason,
    workspaceMode: row.workspaceMode,
    resolvedWorkspaceMode: row.resolvedWorkspaceMode,
    setupMode: row.setupMode,
    resolvedSetupMode: row.resolvedSetupMode,
    source: row.source,
    childThreadMaterialized: row.childThreadMaterialized,
    nativeProviderRef: row.nativeProviderRef,
    status: row.status,
    latestSummary: row.latestSummary,
    errorText: row.errorText,
    ...(row.promptStats !== null ? { promptStats: row.promptStats } : {}),
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

export interface ProjectionThreadTeamTaskRepositoryShape {
  readonly upsert: (
    task: ProjectionThreadTeamTask,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getByTaskId: (
    input: GetProjectionThreadTeamTaskInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadTeamTask>, ProjectionRepositoryError>;

  readonly listByParentThreadId: (
    input: ListProjectionThreadTeamTasksByParentInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadTeamTask>, ProjectionRepositoryError>;

  readonly listByChildThreadId: (
    input: ListProjectionThreadTeamTasksByChildInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadTeamTask>, ProjectionRepositoryError>;
}

export class ProjectionThreadTeamTaskRepository extends Context.Service<
  ProjectionThreadTeamTaskRepository,
  ProjectionThreadTeamTaskRepositoryShape
>()("t3/persistence/Services/ProjectionThreadTeamTasks/Repository") {}
