import {
  ContextHandoffId,
  IsoDateTime,
  MessageId,
  OrchestrationContextHandoffReason,
  OrchestrationContextHandoffRenderStats,
  ProviderKind,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadContextHandoff = Schema.Struct({
  handoffId: ContextHandoffId,
  threadId: ThreadId,
  reason: OrchestrationContextHandoffReason,
  sourceThreadId: Schema.NullOr(ThreadId),
  sourceThreadTitle: Schema.NullOr(Schema.String),
  sourceUserMessageId: Schema.NullOr(MessageId),
  sourceProvider: Schema.NullOr(ProviderKind),
  targetProvider: Schema.NullOr(ProviderKind),
  importedUntilAt: IsoDateTime,
  createdAt: IsoDateTime,
  deliveredAt: Schema.NullOr(IsoDateTime),
  deliveredProvider: Schema.NullOr(ProviderKind),
  deliveredTurnId: Schema.NullOr(TurnId),
  deliveredLiveMessageId: Schema.NullOr(MessageId),
  lastFailureAt: Schema.NullOr(IsoDateTime),
  lastFailureDetail: Schema.NullOr(Schema.String),
  renderStats: Schema.NullOr(OrchestrationContextHandoffRenderStats),
});
export type ProjectionThreadContextHandoff = typeof ProjectionThreadContextHandoff.Type;

export const MarkProjectionThreadContextHandoffDeliveredInput = Schema.Struct({
  handoffId: ContextHandoffId,
  threadId: ThreadId,
  liveMessageId: MessageId,
  provider: ProviderKind,
  turnId: TurnId,
  renderStats: OrchestrationContextHandoffRenderStats,
  deliveredAt: IsoDateTime,
});
export type MarkProjectionThreadContextHandoffDeliveredInput =
  typeof MarkProjectionThreadContextHandoffDeliveredInput.Type;

export const MarkProjectionThreadContextHandoffDeliveryFailedInput = Schema.Struct({
  handoffId: ContextHandoffId,
  threadId: ThreadId,
  liveMessageId: MessageId,
  provider: Schema.NullOr(ProviderKind),
  detail: Schema.String,
  renderStats: Schema.NullOr(OrchestrationContextHandoffRenderStats),
  failedAt: IsoDateTime,
});
export type MarkProjectionThreadContextHandoffDeliveryFailedInput =
  typeof MarkProjectionThreadContextHandoffDeliveryFailedInput.Type;

export const ListProjectionThreadContextHandoffsByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionThreadContextHandoffsByThreadInput =
  typeof ListProjectionThreadContextHandoffsByThreadInput.Type;

export interface ProjectionThreadContextHandoffRepositoryShape {
  readonly upsertPrepared: (
    handoff: ProjectionThreadContextHandoff,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly markDelivered: (
    input: MarkProjectionThreadContextHandoffDeliveredInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly markDeliveryFailed: (
    input: MarkProjectionThreadContextHandoffDeliveryFailedInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly listByThreadId: (
    input: ListProjectionThreadContextHandoffsByThreadInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadContextHandoff>, ProjectionRepositoryError>;

  readonly getPendingByThreadId: (
    input: ListProjectionThreadContextHandoffsByThreadInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadContextHandoff>, ProjectionRepositoryError>;
}

export class ProjectionThreadContextHandoffRepository extends Context.Service<
  ProjectionThreadContextHandoffRepository,
  ProjectionThreadContextHandoffRepositoryShape
>()("t3/persistence/Services/ProjectionThreadContextHandoffs/Repository") {}
