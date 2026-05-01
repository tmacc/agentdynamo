import {
  type EnvironmentId,
  type FeatureCard,
  type FeatureCardId,
  type IsoDateTime,
  type ProjectId,
  ProviderDriverKind,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveBoardColumns } from "./boardProjection";
import { DEFAULT_INTERACTION_MODE } from "./types";
import type { SidebarThreadSummary, ThreadSession } from "./types";

const ENVIRONMENT_ID = "env-1" as EnvironmentId;
const PROJECT_ID = "project-1" as ProjectId;

function makeCard(
  partial: Partial<FeatureCard> & { id: FeatureCardId; column: FeatureCard["column"] },
): FeatureCard {
  return {
    projectId: PROJECT_ID,
    title: "Card" as FeatureCard["title"],
    description: null,
    seededPrompt: null,
    sortOrder: 0,
    linkedThreadId: null,
    linkedProposedPlanId: null,
    createdAt: "2026-01-01T00:00:00.000Z" as IsoDateTime,
    updatedAt: "2026-01-01T00:00:00.000Z" as IsoDateTime,
    archivedAt: null,
    ...partial,
  };
}

function makeThread(
  partial: Partial<SidebarThreadSummary> & { id: ThreadId },
): SidebarThreadSummary {
  const { id, ...rest } = partial;
  return {
    id,
    environmentId: ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    title: "Thread",
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
    ...rest,
  };
}

function runningSession(): ThreadSession {
  return {
    provider: ProviderDriverKind.make("codex"),
    status: "running",
    orchestrationStatus: "running",
    activeTurnId: "turn-1" as TurnId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function settledSession(): ThreadSession {
  return {
    provider: ProviderDriverKind.make("codex"),
    status: "ready",
    orchestrationStatus: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("deriveBoardColumns", () => {
  it("returns 5 columns in fixed order", () => {
    const result = deriveBoardColumns({
      projectId: PROJECT_ID,
      cards: [],
      threads: [],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });

    expect(result.map((column) => column.kind)).toEqual([
      "ideas",
      "planned",
      "in-progress",
      "review",
      "done",
    ]);
  });

  it("sorts user cards by sort order within a stored column", () => {
    const first = makeCard({
      id: "card-1" as FeatureCardId,
      column: "ideas",
      sortOrder: 20,
    });
    const second = makeCard({
      id: "card-2" as FeatureCardId,
      column: "ideas",
      sortOrder: 10,
    });

    const result = deriveBoardColumns({
      projectId: PROJECT_ID,
      cards: [first, second],
      threads: [],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });

    const ideas = result.find((column) => column.kind === "ideas");
    expect(ideas?.items).toHaveLength(2);
    expect(ideas?.items[0]?.kind === "user-card" && ideas.items[0].card.id).toBe("card-2");
    expect(ideas?.items[1]?.kind === "user-card" && ideas.items[1].card.id).toBe("card-1");
  });

  it("renders running threads as ghost cards when they are unlinked", () => {
    const thread = makeThread({
      id: "thread-1" as ThreadId,
      session: runningSession(),
    });

    const result = deriveBoardColumns({
      projectId: PROJECT_ID,
      cards: [],
      threads: [thread],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });

    const inProgress = result.find((column) => column.kind === "in-progress");
    expect(inProgress?.items).toHaveLength(1);
    expect(inProgress?.items[0]?.kind).toBe("live-thread");
    if (inProgress?.items[0]?.kind === "live-thread") {
      expect(inProgress.items[0].isGhost).toBe(true);
    }
  });

  it("hides dismissed ghost threads", () => {
    const thread = makeThread({
      id: "thread-1" as ThreadId,
      session: runningSession(),
    });

    const result = deriveBoardColumns({
      projectId: PROJECT_ID,
      cards: [],
      threads: [thread],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set([thread.id]),
    });

    expect(result.find((column) => column.kind === "in-progress")?.items).toEqual([]);
  });

  it("moves a linked planned card into in-progress with its thread", () => {
    const thread = makeThread({
      id: "thread-1" as ThreadId,
      session: runningSession(),
    });
    const card = makeCard({
      id: "card-1" as FeatureCardId,
      column: "planned",
      linkedThreadId: thread.id,
      title: "Ship fix" as FeatureCard["title"],
    });

    const result = deriveBoardColumns({
      projectId: PROJECT_ID,
      cards: [card],
      threads: [thread],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });

    expect(result.find((column) => column.kind === "planned")?.items).toEqual([]);
    const inProgress = result.find((column) => column.kind === "in-progress");
    expect(inProgress?.items).toHaveLength(1);
    if (inProgress?.items[0]?.kind === "live-thread") {
      expect(inProgress.items[0].linkedCard?.id).toBe(card.id);
      expect(inProgress.items[0].isGhost).toBe(false);
    }
  });

  it("classifies settled threads as review and archived threads as done", () => {
    const reviewThread = makeThread({
      id: "thread-review" as ThreadId,
      session: settledSession(),
      latestTurn: {
        turnId: "turn-review" as TurnId,
        state: "completed",
        requestedAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:05:00.000Z",
        assistantMessageId: null,
      },
    });
    const doneThread = makeThread({
      id: "thread-done" as ThreadId,
      archivedAt: "2026-01-02T00:00:00.000Z",
    });

    const result = deriveBoardColumns({
      projectId: PROJECT_ID,
      cards: [],
      threads: [reviewThread, doneThread],
      gitStatusByThreadId: new Map(),
      dismissedGhostThreadIds: new Set(),
    });

    expect(result.find((column) => column.kind === "review")?.items).toHaveLength(1);
    expect(result.find((column) => column.kind === "done")?.items).toHaveLength(1);
  });
});
