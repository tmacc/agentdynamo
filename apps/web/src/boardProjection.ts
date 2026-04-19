import type {
  FeatureCard,
  FeatureCardColumn,
  GitStatusResult,
  OrchestrationTeamTaskStatus,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

import { isLatestTurnSettled } from "./session-logic";
import { resolveThreadPr, type ThreadPr } from "./components/ThreadStatusIndicators";
import type { SidebarThreadSummary } from "./types";

/**
 * A child task rendered as a small pill on the parent thread's board card.
 */
export interface BoardTeamTaskPill {
  readonly threadId: ThreadId;
  readonly roleLabel: string | null;
  readonly status: OrchestrationTeamTaskStatus | null;
}

export type BoardItem =
  | {
      readonly kind: "user-card";
      readonly card: FeatureCard;
    }
  | {
      readonly kind: "live-thread";
      readonly thread: SidebarThreadSummary;
      readonly linkedCard: FeatureCard | null;
      readonly teamTasks: ReadonlyArray<BoardTeamTaskPill>;
      /** True when this is a ghost card (running thread with no linked user card). */
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

/**
 * Input to the pure derivation function. All inputs are already scoped to
 * the current project (the caller filters `threads` by `projectId`).
 */
export interface DeriveBoardColumnsInput {
  readonly projectId: ProjectId;
  readonly cards: ReadonlyArray<FeatureCard>;
  readonly threads: ReadonlyArray<SidebarThreadSummary>;
  readonly gitStatusByThreadId: ReadonlyMap<ThreadId, GitStatusResult | null>;
  readonly dismissedGhostThreadIds: ReadonlySet<ThreadId>;
}

function bySortOrder(a: FeatureCard, b: FeatureCard): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.createdAt.localeCompare(b.createdAt);
}

function byUpdatedAtDesc(a: SidebarThreadSummary, b: SidebarThreadSummary): number {
  const left = a.updatedAt ?? a.createdAt;
  const right = b.updatedAt ?? b.createdAt;
  return right.localeCompare(left);
}

export function isThreadInProgress(thread: SidebarThreadSummary): boolean {
  if (thread.archivedAt !== null) return false;
  const orchestrationStatus = thread.session?.orchestrationStatus;
  if (orchestrationStatus === "running") return true;
  if (thread.session?.activeTurnId) return true;
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return true;
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

function collectTeamTaskPills(
  parent: SidebarThreadSummary,
  threadsByParent: ReadonlyMap<ThreadId, SidebarThreadSummary[]>,
): BoardTeamTaskPill[] {
  const children = threadsByParent.get(parent.id) ?? [];
  return children.map((child) => ({
    threadId: child.id,
    roleLabel: child.teamRoleLabel ?? null,
    status: child.teamStatus ?? null,
  }));
}

export function deriveBoardColumns(input: DeriveBoardColumnsInput): BoardColumnData[] {
  const { cards, threads, gitStatusByThreadId, dismissedGhostThreadIds } = input;

  // Cards (visible = not archived).
  const liveCards = cards.filter((c) => c.archivedAt === null);
  const ideas = liveCards.filter((c) => c.column === "ideas").toSorted(bySortOrder);
  const planned = liveCards.filter((c) => c.column === "planned").toSorted(bySortOrder);

  // Card lookup by linked thread.
  const cardByThreadId = new Map<ThreadId, FeatureCard>();
  for (const card of liveCards) {
    if (card.linkedThreadId) {
      cardByThreadId.set(card.linkedThreadId, card);
    }
  }

  // Bucket threads by parent for team-task pill rendering.
  const teamChildrenByParentId = new Map<ThreadId, SidebarThreadSummary[]>();
  for (const t of threads) {
    if (t.teamParentThreadId) {
      const list = teamChildrenByParentId.get(t.teamParentThreadId) ?? [];
      list.push(t);
      teamChildrenByParentId.set(t.teamParentThreadId, list);
    }
  }

  // We only show top-level (non-child) threads as cards; children are pills.
  const topLevelThreads = threads.filter((t) => !t.teamParentThreadId);

  // Pre-compute PR status for each thread.
  const prByThreadId = new Map<ThreadId, ThreadPr | null>();
  for (const t of topLevelThreads) {
    const status = gitStatusByThreadId.get(t.id) ?? null;
    prByThreadId.set(t.id, resolveThreadPr(t.branch, status));
  }

  // In Progress: running threads.
  const inProgressThreads = topLevelThreads.filter(isThreadInProgress).toSorted(byUpdatedAtDesc);
  const inProgressItems: BoardItem[] = inProgressThreads
    .filter((t) => {
      // Hide dismissed ghost cards (unlinked threads the user hid).
      if (cardByThreadId.has(t.id)) return true; // linked cards always show
      return !dismissedGhostThreadIds.has(t.id);
    })
    .map((t) => ({
      kind: "live-thread" as const,
      thread: t,
      linkedCard: cardByThreadId.get(t.id) ?? null,
      teamTasks: collectTeamTaskPills(t, teamChildrenByParentId),
      isGhost: !cardByThreadId.has(t.id),
    }));

  // Review: settled turns, not archived, not in-progress.
  const reviewThreads = topLevelThreads.filter(isThreadReview).toSorted(byUpdatedAtDesc);
  const reviewItems: BoardItem[] = reviewThreads
    .filter((t) => {
      const pr = prByThreadId.get(t.id) ?? null;
      // If PR is merged, the thread belongs in Done, not Review.
      if (pr?.state === "merged") return false;
      return true;
    })
    .map((t) => ({
      kind: "review-thread" as const,
      thread: t,
      linkedCard: cardByThreadId.get(t.id) ?? null,
      pr: prByThreadId.get(t.id) ?? null,
    }));

  // Done: archived threads OR threads whose PR is merged.
  const doneItems: BoardItem[] = topLevelThreads
    .map((t) => {
      const pr = prByThreadId.get(t.id) ?? null;
      const reason = threadDoneReason(t, pr);
      if (!reason) return null;
      return {
        kind: "done-thread" as const,
        thread: t,
        linkedCard: cardByThreadId.get(t.id) ?? null,
        pr,
        reason,
      };
    })
    .filter((item): item is Extract<BoardItem, { kind: "done-thread" }> => item !== null)
    .toSorted((a, b) => {
      const ta = a.thread.archivedAt ?? a.thread.updatedAt ?? a.thread.createdAt;
      const tb = b.thread.archivedAt ?? b.thread.updatedAt ?? b.thread.createdAt;
      return tb.localeCompare(ta);
    });

  return [
    {
      kind: "ideas",
      items: ideas.map((card) => ({ kind: "user-card" as const, card })),
    },
    {
      kind: "planned",
      items: planned.map((card) => ({ kind: "user-card" as const, card })),
    },
    {
      kind: "in-progress",
      items: inProgressItems,
    },
    {
      kind: "review",
      items: reviewItems,
    },
    {
      kind: "done",
      items: doneItems,
    },
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
