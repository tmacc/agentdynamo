import type {
  FeatureCard,
  FeatureCardColumn,
  GitStatusResult,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

import { isActiveTurnInProgress, isLatestTurnSettled } from "./session-logic";
import { resolveThreadPr, type ThreadPr } from "./components/ThreadStatusIndicators";
import type { SidebarThreadSummary } from "./types";

export type BoardItem =
  | {
      readonly kind: "user-card";
      readonly card: FeatureCard;
    }
  | {
      readonly kind: "live-thread";
      readonly thread: SidebarThreadSummary;
      readonly linkedCard: FeatureCard | null;
      readonly isGhost: boolean;
    }
  | {
      readonly kind: "review-thread";
      readonly thread: SidebarThreadSummary;
      readonly linkedCard: FeatureCard | null;
      readonly pr: ThreadPr | null;
    }
  | {
      readonly kind: "done-thread";
      readonly thread: SidebarThreadSummary;
      readonly linkedCard: FeatureCard | null;
      readonly pr: ThreadPr | null;
      readonly reason: "archived" | "pr-merged";
    };

export interface BoardColumnData {
  readonly kind: FeatureCardColumn;
  readonly items: ReadonlyArray<BoardItem>;
}

export interface DeriveBoardColumnsInput {
  readonly projectId: ProjectId;
  readonly cards: ReadonlyArray<FeatureCard>;
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  readonly gitStatusByThreadId: ReadonlyMap<ThreadId, GitStatusResult | null>;
  readonly dismissedGhostThreadIds: ReadonlySet<ThreadId>;
}

type TopLevelThreadBoardState = "in-progress" | "review" | "done" | "hidden";

type CanonicalBoardWorkItem =
  | {
      readonly kind: "stored-card";
      readonly id: FeatureCard["id"];
      readonly column: "ideas" | "planned";
      readonly card: FeatureCard;
    }
  | {
      readonly kind: "linked-thread";
      readonly id: FeatureCard["id"];
      readonly column: "in-progress" | "review" | "done";
      readonly card: FeatureCard;
      readonly thread: SidebarThreadSummary;
      readonly pr: ThreadPr | null;
      readonly doneReason: "archived" | "pr-merged" | null;
    }
  | {
      readonly kind: "ghost-thread";
      readonly id: ThreadId;
      readonly column: "in-progress";
      readonly thread: SidebarThreadSummary;
    }
  | {
      readonly kind: "unlinked-thread";
      readonly id: ThreadId;
      readonly column: "review" | "done";
      readonly thread: SidebarThreadSummary;
      readonly pr: ThreadPr | null;
      readonly doneReason: "archived" | "pr-merged" | null;
    };

type StoredCardWorkItem = Extract<CanonicalBoardWorkItem, { kind: "stored-card" }>;
type LinkedThreadWorkItem = Extract<CanonicalBoardWorkItem, { kind: "linked-thread" }>;
type GhostThreadWorkItem = Extract<CanonicalBoardWorkItem, { kind: "ghost-thread" }>;
type UnlinkedThreadWorkItem = Extract<CanonicalBoardWorkItem, { kind: "unlinked-thread" }>;

function bySortOrder(a: FeatureCard, b: FeatureCard): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.createdAt.localeCompare(b.createdAt);
}

function byUpdatedAtDesc(a: SidebarThreadSummary, b: SidebarThreadSummary): number {
  const left = a.updatedAt ?? a.createdAt;
  const right = b.updatedAt ?? b.createdAt;
  return right.localeCompare(left);
}

function byDoneAtDesc(a: SidebarThreadSummary, b: SidebarThreadSummary): number {
  const left = a.archivedAt ?? a.updatedAt ?? a.createdAt;
  const right = b.archivedAt ?? b.updatedAt ?? b.createdAt;
  return right.localeCompare(left);
}

export function isThreadInProgress(thread: SidebarThreadSummary): boolean {
  if (thread.archivedAt !== null) return false;
  if (isActiveTurnInProgress(thread.session)) return true;
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return true;
  if (thread.session) return false;
  return thread.latestTurn?.state === "running";
}

export function isThreadReview(thread: SidebarThreadSummary): boolean {
  if (thread.archivedAt !== null) return false;
  if (isThreadInProgress(thread)) return false;
  const hasLatest = Boolean(thread.latestTurn?.turnId);
  if (!hasLatest) return false;
  return isLatestTurnSettled(thread.latestTurn, thread.session);
}

export function threadDoneReason(
  thread: SidebarThreadSummary,
  pr: ThreadPr | null,
): "archived" | "pr-merged" | null {
  if (thread.archivedAt !== null) return "archived";
  if (pr?.state === "merged") return "pr-merged";
  return null;
}

function classifyTopLevelThread(
  thread: SidebarThreadSummary,
  pr: ThreadPr | null,
): TopLevelThreadBoardState {
  if (isThreadInProgress(thread)) return "in-progress";
  if (threadDoneReason(thread, pr)) return "done";
  if (isThreadReview(thread)) return "review";
  return "hidden";
}

function workItemToBoardItem(item: CanonicalBoardWorkItem): BoardItem {
  switch (item.kind) {
    case "stored-card":
      return {
        kind: "user-card",
        card: item.card,
      };
    case "linked-thread":
      switch (item.column) {
        case "in-progress":
          return {
            kind: "live-thread",
            thread: item.thread,
            linkedCard: item.card,
            isGhost: false,
          };
        case "review":
          return {
            kind: "review-thread",
            thread: item.thread,
            linkedCard: item.card,
            pr: item.pr,
          };
        case "done":
          return {
            kind: "done-thread",
            thread: item.thread,
            linkedCard: item.card,
            pr: item.pr,
            reason: item.doneReason ?? "archived",
          };
      }
    case "ghost-thread":
      return {
        kind: "live-thread",
        thread: item.thread,
        linkedCard: null,
        isGhost: true,
      };
    case "unlinked-thread":
      if (item.column === "review") {
        return {
          kind: "review-thread",
          thread: item.thread,
          linkedCard: null,
          pr: item.pr,
        };
      }
      return {
        kind: "done-thread",
        thread: item.thread,
        linkedCard: null,
        pr: item.pr,
        reason: item.doneReason ?? "archived",
      };
  }
}

export function deriveBoardColumns(input: DeriveBoardColumnsInput): BoardColumnData[] {
  const { cards, threads, gitStatusByThreadId, dismissedGhostThreadIds } = input;
  const liveCards = cards.filter((card) => card.archivedAt === null);
  const topLevelThreads = threads;
  const topLevelThreadById = new Map<ThreadId, SidebarThreadSummary>();
  for (const thread of topLevelThreads) {
    topLevelThreadById.set(thread.id, thread);
  }

  const prByThreadId = new Map<ThreadId, ThreadPr | null>();
  for (const thread of topLevelThreads) {
    const status = gitStatusByThreadId.get(thread.id) ?? null;
    prByThreadId.set(thread.id, resolveThreadPr(thread.branch, status));
  }

  const classificationByThreadId = new Map<ThreadId, TopLevelThreadBoardState>();
  for (const thread of topLevelThreads) {
    classificationByThreadId.set(
      thread.id,
      classifyTopLevelThread(thread, prByThreadId.get(thread.id) ?? null),
    );
  }

  const claimedTopLevelThreadIds = new Set<ThreadId>();
  const workItems: CanonicalBoardWorkItem[] = [];

  for (const card of liveCards) {
    if (card.linkedThreadId === null) {
      workItems.push({ kind: "stored-card", id: card.id, column: card.column, card });
      continue;
    }

    const thread = topLevelThreadById.get(card.linkedThreadId) ?? null;
    if (thread === null) {
      workItems.push({ kind: "stored-card", id: card.id, column: card.column, card });
      continue;
    }

    const column = classificationByThreadId.get(thread.id) ?? "hidden";
    if (card.column !== "planned" || column === "hidden") {
      claimedTopLevelThreadIds.add(thread.id);
      workItems.push({ kind: "stored-card", id: card.id, column: card.column, card });
      continue;
    }

    claimedTopLevelThreadIds.add(thread.id);
    const pr = prByThreadId.get(thread.id) ?? null;
    workItems.push({
      kind: "linked-thread",
      id: card.id,
      column,
      card,
      thread,
      pr,
      doneReason: threadDoneReason(thread, pr),
    });
  }

  for (const thread of topLevelThreads) {
    if (claimedTopLevelThreadIds.has(thread.id)) {
      continue;
    }

    const column = classificationByThreadId.get(thread.id) ?? "hidden";
    const pr = prByThreadId.get(thread.id) ?? null;
    if (column === "in-progress") {
      if (dismissedGhostThreadIds.has(thread.id)) {
        continue;
      }
      workItems.push({
        kind: "ghost-thread",
        id: thread.id,
        column,
        thread,
      });
      continue;
    }

    if (column === "review" || column === "done") {
      workItems.push({
        kind: "unlinked-thread",
        id: thread.id,
        column,
        thread,
        pr,
        doneReason: threadDoneReason(thread, pr),
      });
    }
  }

  const ideasItems = workItems
    .filter(
      (item): item is StoredCardWorkItem => item.kind === "stored-card" && item.column === "ideas",
    )
    .toSorted((left, right) => bySortOrder(left.card, right.card))
    .map(workItemToBoardItem);

  const plannedItems = workItems
    .filter(
      (item): item is StoredCardWorkItem =>
        item.kind === "stored-card" && item.column === "planned",
    )
    .toSorted((left, right) => bySortOrder(left.card, right.card))
    .map(workItemToBoardItem);

  const inProgressItems = workItems
    .filter(
      (item): item is LinkedThreadWorkItem | GhostThreadWorkItem =>
        item.column === "in-progress" &&
        (item.kind === "linked-thread" || item.kind === "ghost-thread"),
    )
    .toSorted((left, right) => byUpdatedAtDesc(left.thread, right.thread))
    .map(workItemToBoardItem);

  const reviewItems = workItems
    .filter(
      (item): item is LinkedThreadWorkItem | UnlinkedThreadWorkItem =>
        item.column === "review" &&
        (item.kind === "linked-thread" || item.kind === "unlinked-thread"),
    )
    .toSorted((left, right) => byUpdatedAtDesc(left.thread, right.thread))
    .map(workItemToBoardItem);

  const doneItems = workItems
    .filter(
      (item): item is LinkedThreadWorkItem | UnlinkedThreadWorkItem =>
        item.column === "done" &&
        (item.kind === "linked-thread" || item.kind === "unlinked-thread"),
    )
    .toSorted((left, right) => byDoneAtDesc(left.thread, right.thread))
    .map(workItemToBoardItem);

  return [
    { kind: "ideas", items: ideasItems },
    { kind: "planned", items: plannedItems },
    { kind: "in-progress", items: inProgressItems },
    { kind: "review", items: reviewItems },
    { kind: "done", items: doneItems },
  ];
}

export const BOARD_COLUMN_LABELS: Record<FeatureCardColumn, string> = {
  ideas: "Ideas",
  planned: "Planned",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
};

export const BOARD_COLUMN_ORDER: ReadonlyArray<FeatureCardColumn> = [
  "ideas",
  "planned",
  "in-progress",
  "review",
  "done",
];

export function isStoredBoardColumn(column: FeatureCardColumn): column is "ideas" | "planned" {
  return column === "ideas" || column === "planned";
}
