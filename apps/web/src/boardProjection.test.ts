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
    const col = result.find((c) => c.kind === "in-progress");
    expect(col?.items).toHaveLength(1);
    const item = col?.items[0];
    expect(item?.kind === "live-thread" && item.isGhost).toBe(false);
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
});
