import {
  type EnvironmentId,
  type FeatureCard,
  type FeatureCardId,
  type GitStatusResult,
  type IsoDateTime,
  type ProjectId,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveBoardColumns } from "./boardProjection";
import { DEFAULT_INTERACTION_MODE } from "./types";
import type { SidebarThreadSummary, ThreadSession } from "./types";

const ENV = "env-1" as unknown as EnvironmentId;
const PROJECT = "project-1" as unknown as ProjectId;

function makeCard(
  partial: Partial<FeatureCard> & { id: FeatureCardId; column: FeatureCard["column"] },
): FeatureCard {
  return {
    projectId: PROJECT,
    title: "T" as unknown as FeatureCard["title"],
    description: null,
    seededPrompt: null,
    sortOrder: 0,
    linkedThreadId: null,
    linkedProposedPlanId: null,
    createdAt: "2026-01-01T00:00:00.000Z" as unknown as IsoDateTime,
    updatedAt: "2026-01-01T00:00:00.000Z" as unknown as IsoDateTime,
    archivedAt: null,
    ...partial,
  };
}

function makeThread(
  overrides: Partial<SidebarThreadSummary> & { id: ThreadId },
): SidebarThreadSummary {
  return {
    environmentId: ENV,
    projectId: PROJECT,
    title: "T",
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function runningSession(): ThreadSession {
  return {
    provider: "codex",
    status: "running",
    orchestrationStatus: "running",
    activeTurnId: "turn-1" as unknown as TurnId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function settledSession(): ThreadSession {
  return {
    provider: "codex",
    status: "ready",
    orchestrationStatus: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("deriveBoardColumns", () => {
  it("returns 5 columns in fixed order", () => {
    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [],
      threads: [],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });
    expect(result.map((c) => c.kind)).toEqual([
      "ideas",
      "planned",
      "in-progress",
      "review",
      "done",
    ]);
  });

  it("sorts user cards by sortOrder within their stored column", () => {
    const a = makeCard({ id: "a" as unknown as FeatureCardId, column: "ideas", sortOrder: 20 });
    const b = makeCard({ id: "b" as unknown as FeatureCardId, column: "ideas", sortOrder: 10 });
    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [a, b],
      threads: [],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });
    const ideas = result.find((c) => c.kind === "ideas");
    expect(ideas?.items).toHaveLength(2);
    // sortOrder ascending
    expect(ideas?.items[0]?.kind === "user-card" && ideas?.items[0].card.id).toBe("b");
    expect(ideas?.items[1]?.kind === "user-card" && ideas?.items[1].card.id).toBe("a");
  });

  it("excludes archived cards", () => {
    const archived = makeCard({
      id: "x" as unknown as FeatureCardId,
      column: "ideas",
      archivedAt: "2026-01-02T00:00:00.000Z" as unknown as IsoDateTime,
    });
    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [archived],
      threads: [],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });
    expect(result.find((c) => c.kind === "ideas")?.items).toEqual([]);
  });

  it("places running threads in In Progress as ghost cards when no linked card exists", () => {
    const t = makeThread({ id: "t-1" as unknown as ThreadId, session: runningSession() });
    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [],
      threads: [t],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });
    const col = result.find((c) => c.kind === "in-progress");
    expect(col?.items).toHaveLength(1);
    const item = col?.items[0];
    expect(item?.kind === "live-thread" && item.isGhost).toBe(true);
  });

  it("hides dismissed ghost threads", () => {
    const t = makeThread({ id: "t-1" as unknown as ThreadId, session: runningSession() });
    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [],
      threads: [t],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set([t.id]),
    });
    expect(result.find((c) => c.kind === "in-progress")?.items).toEqual([]);
  });

  it("keeps linked cards visible even when dismissed set includes their thread", () => {
    const t = makeThread({ id: "t-1" as unknown as ThreadId, session: runningSession() });
    const card = makeCard({
      id: "c-1" as unknown as FeatureCardId,
      column: "planned",
      linkedThreadId: t.id,
    });
    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [card],
      threads: [t],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set([t.id]),
    });
    expect(result.find((c) => c.kind === "planned")?.items).toEqual([]);
    const col = result.find((c) => c.kind === "in-progress");
    expect(col?.items).toHaveLength(1);
    const item = col?.items[0];
    expect(item?.kind === "live-thread" && item.isGhost).toBe(false);
  });

  it("renders a linked running thread only once by consuming the planned card", () => {
    const t = makeThread({ id: "t-run" as unknown as ThreadId, session: runningSession() });
    const card = makeCard({
      id: "card-run" as unknown as FeatureCardId,
      column: "planned",
      linkedThreadId: t.id,
      title: "Run fix" as unknown as FeatureCard["title"],
    });

    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [card],
      threads: [t],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });

    expect(result.find((c) => c.kind === "planned")?.items).toEqual([]);
    const inProgress = result.find((c) => c.kind === "in-progress");
    expect(inProgress?.items).toHaveLength(1);
    const item = inProgress?.items[0];
    expect(item?.kind).toBe("live-thread");
    if (item?.kind === "live-thread") {
      expect(item.linkedCard?.id).toBe(card.id);
      expect(item.linkedCard?.title).toBe(card.title);
      expect(item.isGhost).toBe(false);
    }
  });

  it("moves settled threads with a completed turn to Review", () => {
    const t = makeThread({
      id: "t-2" as unknown as ThreadId,
      session: settledSession(),
      latestTurn: {
        turnId: "turn-1" as unknown as TurnId,
        state: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:10.000Z",
        sourceProposedPlan: null,
      } as unknown as SidebarThreadSummary["latestTurn"],
    });
    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [],
      threads: [t],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });
    expect(result.find((c) => c.kind === "review")?.items).toHaveLength(1);
    expect(result.find((c) => c.kind === "in-progress")?.items).toHaveLength(0);
  });

  it("renders a linked review thread only once by consuming the planned card", () => {
    const t = makeThread({
      id: "t-review" as unknown as ThreadId,
      session: settledSession(),
      latestTurn: {
        turnId: "turn-review" as unknown as TurnId,
        state: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:10.000Z",
        sourceProposedPlan: null,
      } as unknown as SidebarThreadSummary["latestTurn"],
    });
    const card = makeCard({
      id: "card-review" as unknown as FeatureCardId,
      column: "planned",
      linkedThreadId: t.id,
    });

    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [card],
      threads: [t],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });

    expect(result.find((c) => c.kind === "planned")?.items).toEqual([]);
    const review = result.find((c) => c.kind === "review");
    expect(review?.items).toHaveLength(1);
    const item = review?.items[0];
    expect(item?.kind).toBe("review-thread");
    if (item?.kind === "review-thread") {
      expect(item.linkedCard?.id).toBe(card.id);
    }
  });

  it("moves archived threads to Done", () => {
    const t = makeThread({
      id: "t-3" as unknown as ThreadId,
      archivedAt: "2026-01-02T00:00:00.000Z",
    });
    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [],
      threads: [t],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });
    const col = result.find((c) => c.kind === "done");
    expect(col?.items).toHaveLength(1);
    const item = col?.items[0];
    expect(item?.kind === "done-thread" && item.reason).toBe("archived");
  });

  it("renders a linked done thread only once by consuming the planned card", () => {
    const t = makeThread({
      id: "t-done" as unknown as ThreadId,
      archivedAt: "2026-01-02T00:00:00.000Z",
    });
    const card = makeCard({
      id: "card-done" as unknown as FeatureCardId,
      column: "planned",
      linkedThreadId: t.id,
    });

    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [card],
      threads: [t],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });

    expect(result.find((c) => c.kind === "planned")?.items).toEqual([]);
    const done = result.find((c) => c.kind === "done");
    expect(done?.items).toHaveLength(1);
    const item = done?.items[0];
    expect(item?.kind).toBe("done-thread");
    if (item?.kind === "done-thread") {
      expect(item.linkedCard?.id).toBe(card.id);
      expect(item.reason).toBe("archived");
    }
  });

  it("moves Review threads with a merged PR to Done", () => {
    const t = makeThread({
      id: "t-4" as unknown as ThreadId,
      branch: "feature/x",
      session: settledSession(),
      latestTurn: {
        turnId: "turn-1" as unknown as TurnId,
        state: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:10.000Z",
        sourceProposedPlan: null,
      } as unknown as SidebarThreadSummary["latestTurn"],
    });
    const gitStatus: GitStatusResult = {
      branch: "feature/x",
      pr: {
        number: 1,
        state: "merged",
        title: "PR",
        url: "https://github.com/x/y/pull/1",
      },
    } as unknown as GitStatusResult;
    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [],
      threads: [t],
      gitStatusByThreadId: new Map([[t.id, gitStatus]]),
      dismissedGhostThreadIds: new Set(),
    });
    expect(result.find((c) => c.kind === "review")?.items).toHaveLength(0);
    const doneCol = result.find((c) => c.kind === "done");
    expect(doneCol?.items).toHaveLength(1);
    const doneItem = doneCol?.items[0];
    expect(doneItem?.kind === "done-thread" && doneItem.reason).toBe("pr-merged");
  });

  it("keeps a linked card in planned when the linked top-level thread is missing", () => {
    const card = makeCard({
      id: "card-missing-thread" as unknown as FeatureCardId,
      column: "planned",
      linkedThreadId: "thread-missing" as unknown as ThreadId,
    });

    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [card],
      threads: [],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });

    const planned = result.find((c) => c.kind === "planned");
    expect(planned?.items).toHaveLength(1);
    expect(planned?.items[0]?.kind === "user-card" && planned.items[0].card.id).toBe(card.id);
  });

  it("keeps a linked card in planned when the linked top-level thread is hidden", () => {
    const t = makeThread({
      id: "t-hidden" as unknown as ThreadId,
      session: settledSession(),
      latestTurn: null,
    });
    const card = makeCard({
      id: "card-hidden-thread" as unknown as FeatureCardId,
      column: "planned",
      linkedThreadId: t.id,
    });

    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [card],
      threads: [t],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });

    const planned = result.find((c) => c.kind === "planned");
    expect(planned?.items).toHaveLength(1);
    expect(planned?.items[0]?.kind === "user-card" && planned.items[0].card.id).toBe(card.id);
    expect(result.find((c) => c.kind === "review")?.items).toEqual([]);
    expect(result.find((c) => c.kind === "done")?.items).toEqual([]);
  });

  it("keeps a linked card in planned when the linked thread is only a child task", () => {
    const childThread = makeThread({
      id: "t-child" as unknown as ThreadId,
      teamParentThreadId: "t-parent" as unknown as ThreadId,
      session: runningSession(),
    });
    const card = makeCard({
      id: "card-child-thread" as unknown as FeatureCardId,
      column: "planned",
      linkedThreadId: childThread.id,
    });

    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [card],
      threads: [childThread],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });

    const planned = result.find((c) => c.kind === "planned");
    expect(planned?.items).toHaveLength(1);
    expect(planned?.items[0]?.kind === "user-card" && planned.items[0].card.id).toBe(card.id);
    expect(result.find((c) => c.kind === "in-progress")?.items).toEqual([]);
  });

  it("never renders the same linked card in both planned and a derived column", () => {
    const t = makeThread({ id: "t-invariant" as unknown as ThreadId, session: runningSession() });
    const card = makeCard({
      id: "card-invariant" as unknown as FeatureCardId,
      column: "planned",
      linkedThreadId: t.id,
    });

    const result = deriveBoardColumns({
      projectId: PROJECT,
      cards: [card],
      threads: [t],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });

    const plannedCardIds = new Set(
      (result.find((c) => c.kind === "planned")?.items ?? []).flatMap((item) =>
        item.kind === "user-card" ? [item.card.id] : [],
      ),
    );
    const derivedLinkedCardIds = new Set(
      result
        .filter((column) => column.kind !== "ideas" && column.kind !== "planned")
        .flatMap((column) => column.items)
        .flatMap((item) => {
          if (item.kind === "live-thread") {
            return item.linkedCard ? [item.linkedCard.id] : [];
          }
          if (item.kind === "review-thread" || item.kind === "done-thread") {
            return item.linkedCard ? [item.linkedCard.id] : [];
          }
          return [];
        }),
    );

    expect(plannedCardIds.has(card.id)).toBe(false);
    expect(derivedLinkedCardIds.has(card.id)).toBe(true);
  });
});
