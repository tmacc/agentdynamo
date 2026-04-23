import { Schema } from "effect";

import {
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

const LinkedProposedPlanId = TrimmedNonEmptyString;

export const FeatureCardId = TrimmedNonEmptyString.pipe(Schema.brand("FeatureCardId"));
export type FeatureCardId = typeof FeatureCardId.Type;

export const FeatureCardStoredColumn = Schema.Literals(["ideas", "planned"]);
export type FeatureCardStoredColumn = typeof FeatureCardStoredColumn.Type;

export const FeatureCardColumn = Schema.Literals([
  "ideas",
  "planned",
  "in-progress",
  "review",
  "done",
]);
export type FeatureCardColumn = typeof FeatureCardColumn.Type;

export const FeatureCard = Schema.Struct({
  id: FeatureCardId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  seededPrompt: Schema.NullOr(Schema.String),
  column: FeatureCardStoredColumn,
  sortOrder: Schema.Number,
  linkedThreadId: Schema.NullOr(ThreadId),
  linkedProposedPlanId: Schema.NullOr(LinkedProposedPlanId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
});
export type FeatureCard = typeof FeatureCard.Type;

export const BoardCreateCardCommand = Schema.Struct({
  type: Schema.Literal("board.card.create"),
  commandId: CommandId,
  cardId: FeatureCardId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  seededPrompt: Schema.NullOr(Schema.String),
  column: FeatureCardStoredColumn,
  sortOrder: Schema.Number,
  linkedThreadId: Schema.NullOr(ThreadId),
  linkedProposedPlanId: Schema.NullOr(LinkedProposedPlanId),
  createdAt: IsoDateTime,
});
export type BoardCreateCardCommand = typeof BoardCreateCardCommand.Type;

export const BoardUpdateCardCommand = Schema.Struct({
  type: Schema.Literal("board.card.update"),
  commandId: CommandId,
  cardId: FeatureCardId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  seededPrompt: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: IsoDateTime,
});
export type BoardUpdateCardCommand = typeof BoardUpdateCardCommand.Type;

export const BoardMoveCardCommand = Schema.Struct({
  type: Schema.Literal("board.card.move"),
  commandId: CommandId,
  cardId: FeatureCardId,
  projectId: ProjectId,
  toColumn: FeatureCardStoredColumn,
  sortOrder: Schema.Number,
  updatedAt: IsoDateTime,
});
export type BoardMoveCardCommand = typeof BoardMoveCardCommand.Type;

export const BoardArchiveCardCommand = Schema.Struct({
  type: Schema.Literal("board.card.archive"),
  commandId: CommandId,
  cardId: FeatureCardId,
  projectId: ProjectId,
  archivedAt: IsoDateTime,
});
export type BoardArchiveCardCommand = typeof BoardArchiveCardCommand.Type;

export const BoardDeleteCardCommand = Schema.Struct({
  type: Schema.Literal("board.card.delete"),
  commandId: CommandId,
  cardId: FeatureCardId,
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});
export type BoardDeleteCardCommand = typeof BoardDeleteCardCommand.Type;

export const BoardLinkThreadCommand = Schema.Struct({
  type: Schema.Literal("board.card.linkThread"),
  commandId: CommandId,
  cardId: FeatureCardId,
  projectId: ProjectId,
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});
export type BoardLinkThreadCommand = typeof BoardLinkThreadCommand.Type;

export const BoardUnlinkThreadCommand = Schema.Struct({
  type: Schema.Literal("board.card.unlinkThread"),
  commandId: CommandId,
  cardId: FeatureCardId,
  projectId: ProjectId,
  previousThreadId: Schema.NullOr(ThreadId),
  updatedAt: IsoDateTime,
});
export type BoardUnlinkThreadCommand = typeof BoardUnlinkThreadCommand.Type;

export const BoardGhostCardDismissCommand = Schema.Struct({
  type: Schema.Literal("board.ghost-card.dismiss"),
  commandId: CommandId,
  projectId: ProjectId,
  threadId: ThreadId,
  dismissedAt: IsoDateTime,
});
export type BoardGhostCardDismissCommand = typeof BoardGhostCardDismissCommand.Type;

export const BoardGhostCardUndismissCommand = Schema.Struct({
  type: Schema.Literal("board.ghost-card.undismiss"),
  commandId: CommandId,
  projectId: ProjectId,
  threadId: ThreadId,
  undismissedAt: IsoDateTime,
});
export type BoardGhostCardUndismissCommand = typeof BoardGhostCardUndismissCommand.Type;

export const BoardCommand = Schema.Union([
  BoardCreateCardCommand,
  BoardUpdateCardCommand,
  BoardMoveCardCommand,
  BoardArchiveCardCommand,
  BoardDeleteCardCommand,
  BoardLinkThreadCommand,
  BoardUnlinkThreadCommand,
  BoardGhostCardDismissCommand,
  BoardGhostCardUndismissCommand,
]);
export type BoardCommand = typeof BoardCommand.Type;

export const BoardCardCreatedPayload = Schema.Struct({
  cardId: FeatureCardId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  seededPrompt: Schema.NullOr(Schema.String),
  column: FeatureCardStoredColumn,
  sortOrder: Schema.Number,
  linkedThreadId: Schema.NullOr(ThreadId),
  linkedProposedPlanId: Schema.NullOr(LinkedProposedPlanId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BoardCardCreatedPayload = typeof BoardCardCreatedPayload.Type;

export const BoardCardUpdatedPayload = Schema.Struct({
  cardId: FeatureCardId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  seededPrompt: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: IsoDateTime,
});
export type BoardCardUpdatedPayload = typeof BoardCardUpdatedPayload.Type;

export const BoardCardMovedPayload = Schema.Struct({
  cardId: FeatureCardId,
  projectId: ProjectId,
  toColumn: FeatureCardStoredColumn,
  sortOrder: Schema.Number,
  updatedAt: IsoDateTime,
});
export type BoardCardMovedPayload = typeof BoardCardMovedPayload.Type;

export const BoardCardArchivedPayload = Schema.Struct({
  cardId: FeatureCardId,
  projectId: ProjectId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BoardCardArchivedPayload = typeof BoardCardArchivedPayload.Type;

export const BoardCardDeletedPayload = Schema.Struct({
  cardId: FeatureCardId,
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});
export type BoardCardDeletedPayload = typeof BoardCardDeletedPayload.Type;

export const BoardCardThreadLinkedPayload = Schema.Struct({
  cardId: FeatureCardId,
  projectId: ProjectId,
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});
export type BoardCardThreadLinkedPayload = typeof BoardCardThreadLinkedPayload.Type;

export const BoardCardThreadUnlinkedPayload = Schema.Struct({
  cardId: FeatureCardId,
  projectId: ProjectId,
  previousThreadId: Schema.NullOr(ThreadId),
  updatedAt: IsoDateTime,
});
export type BoardCardThreadUnlinkedPayload = typeof BoardCardThreadUnlinkedPayload.Type;

export const BoardGhostCardDismissedPayload = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  dismissedAt: IsoDateTime,
});
export type BoardGhostCardDismissedPayload = typeof BoardGhostCardDismissedPayload.Type;

export const BoardGhostCardUndismissedPayload = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  undismissedAt: IsoDateTime,
});
export type BoardGhostCardUndismissedPayload = typeof BoardGhostCardUndismissedPayload.Type;

export const BoardDismissedGhost = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  dismissedAt: IsoDateTime,
});
export type BoardDismissedGhost = typeof BoardDismissedGhost.Type;

export const BOARD_WS_METHODS = {
  listCards: "board.listCards",
  listDismissedGhosts: "board.listDismissedGhosts",
  subscribeProject: "board.subscribeProject",
} as const;

export const BoardListCardsInput = Schema.Struct({
  projectId: ProjectId,
});
export type BoardListCardsInput = typeof BoardListCardsInput.Type;

export const BoardListCardsResult = Schema.Struct({
  cards: Schema.Array(FeatureCard),
});
export type BoardListCardsResult = typeof BoardListCardsResult.Type;

export const BoardListDismissedGhostsInput = Schema.Struct({
  projectId: ProjectId,
});
export type BoardListDismissedGhostsInput = typeof BoardListDismissedGhostsInput.Type;

export const BoardListDismissedGhostsResult = Schema.Struct({
  dismissed: Schema.Array(BoardDismissedGhost),
});
export type BoardListDismissedGhostsResult = typeof BoardListDismissedGhostsResult.Type;

export const BoardSubscribeProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type BoardSubscribeProjectInput = typeof BoardSubscribeProjectInput.Type;

export const BoardSnapshot = Schema.Struct({
  kind: Schema.Literal("snapshot"),
  cards: Schema.Array(FeatureCard),
  dismissedGhosts: Schema.Array(BoardDismissedGhost),
  snapshotSequence: NonNegativeInt,
});
export type BoardSnapshot = typeof BoardSnapshot.Type;

export const BoardStreamEvent = Schema.Union([
  BoardSnapshot,
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: Schema.Unknown,
  }),
]);
export type BoardStreamEvent = typeof BoardStreamEvent.Type;

export class BoardListCardsError extends Schema.TaggedErrorClass<BoardListCardsError>()(
  "BoardListCardsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class BoardListDismissedGhostsError extends Schema.TaggedErrorClass<BoardListDismissedGhostsError>()(
  "BoardListDismissedGhostsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class BoardSubscribeProjectError extends Schema.TaggedErrorClass<BoardSubscribeProjectError>()(
  "BoardSubscribeProjectError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const BOARD_DEFAULT_SORT_SPACING = 1_024;
export const BOARD_REINDEX_THRESHOLD = 1e-6;

export function computeMidpointSortOrder(prev: number | null, next: number | null): number {
  if (prev === null && next === null) {
    return 0;
  }
  if (prev === null) {
    return next! - BOARD_DEFAULT_SORT_SPACING;
  }
  if (next === null) {
    return prev + BOARD_DEFAULT_SORT_SPACING;
  }
  return (prev + next) / 2;
}
