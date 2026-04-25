import {
  IsoDateTime,
  NativeSubagentTraceItemId,
  NativeSubagentTraceItemStatus,
  OrchestrationNativeSubagentTraceItem,
  TeamTaskId,
  ThreadId,
} from "@t3tools/contracts";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionNativeSubagentTraceItem = OrchestrationNativeSubagentTraceItem;
export type ProjectionNativeSubagentTraceItem = typeof ProjectionNativeSubagentTraceItem.Type;

export const UpsertProjectionNativeSubagentTraceItemInput = ProjectionNativeSubagentTraceItem;
export type UpsertProjectionNativeSubagentTraceItemInput =
  typeof UpsertProjectionNativeSubagentTraceItemInput.Type;

export const AppendProjectionNativeSubagentTraceContentInput = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  traceItemId: NativeSubagentTraceItemId,
  delta: Schema.String,
  updatedAt: IsoDateTime,
});
export type AppendProjectionNativeSubagentTraceContentInput =
  typeof AppendProjectionNativeSubagentTraceContentInput.Type;

export const MarkProjectionNativeSubagentTraceItemCompletedInput = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  traceItemId: NativeSubagentTraceItemId,
  status: NativeSubagentTraceItemStatus,
  detail: Schema.optional(Schema.NullOr(Schema.String)),
  outputSummary: Schema.optional(Schema.NullOr(Schema.String)),
  completedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MarkProjectionNativeSubagentTraceItemCompletedInput =
  typeof MarkProjectionNativeSubagentTraceItemCompletedInput.Type;

export const ListProjectionNativeSubagentTraceByTaskInput = Schema.Struct({
  parentThreadId: ThreadId,
  taskId: TeamTaskId,
  limit: Schema.optional(Schema.Int),
});
export type ListProjectionNativeSubagentTraceByTaskInput =
  typeof ListProjectionNativeSubagentTraceByTaskInput.Type;

export interface ProjectionNativeSubagentTraceRepositoryShape {
  readonly upsertItem: (
    item: UpsertProjectionNativeSubagentTraceItemInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly appendContent: (
    input: AppendProjectionNativeSubagentTraceContentInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly markCompleted: (
    input: MarkProjectionNativeSubagentTraceItemCompletedInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listByTask: (
    input: ListProjectionNativeSubagentTraceByTaskInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionNativeSubagentTraceItem>, ProjectionRepositoryError>;
}

export class ProjectionNativeSubagentTraceRepository extends Context.Service<
  ProjectionNativeSubagentTraceRepository,
  ProjectionNativeSubagentTraceRepositoryShape
>()("t3/persistence/Services/ProjectionNativeSubagentTrace/Repository") {}
