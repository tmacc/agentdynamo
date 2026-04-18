import type {
  FeatureCard,
  FeatureCardId,
  GitStatusResult,
  IsoDateTime,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  resolveBoardColumnDropPlacement,
  resolveBoardGitStatusTargets,
  resolveBoardThreadGitStatusMap,
} from "./BoardView";
import { DEFAULT_INTERACTION_MODE } from "../../types";
import type { SidebarThreadSummary, ThreadSession } from "../../types";

const ENV = "env-1" as never;
const PROJECT = "project-1" as ProjectId;

function makeCard(
  partial: Partial<FeatureCard> & { id: FeatureCardId; column: FeatureCard["column"] },
): FeatureCard {
  return {
    projectId: PROJECT,
    title: "T" as never,
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

function settledSession(): ThreadSession {
  return {
    provider: "codex",
    status: "ready",
    orchestrationStatus: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
    session: settledSession(),
    createdAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    latestTurn: {
      turnId: "turn-1" as TurnId,
      state: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:10.000Z",
      assistantMessageId: null,
      requestedAt: "2026-01-01T00:00:00.000Z",
    },
    branch: null,
    worktreePath: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

describe("BoardView helpers", () => {
  it("deduplicates git status targets by environment and cwd", () => {
    const targets = resolveBoardGitStatusTargets(
      [
        makeThread({
          id: "thread-1" as ThreadId,
          branch: "feature/a",
          worktreePath: "/tmp/worktree-a",
        }),
        makeThread({
          id: "thread-2" as ThreadId,
          branch: "feature/b",
          worktreePath: "/tmp/worktree-a",
        }),
        makeThread({
          id: "thread-3" as ThreadId,
          branch: "feature/c",
          worktreePath: "/tmp/worktree-c",
        }),
      ],
      "/tmp/project",
    );

    expect(targets).toEqual([
      { environmentId: ENV, cwd: "/tmp/worktree-a" },
      { environmentId: ENV, cwd: "/tmp/worktree-c" },
    ]);
  });

  it("maps per-thread git status by each thread's cwd", () => {
    const threads = [
      makeThread({
        id: "thread-1" as ThreadId,
        branch: "feature/a",
        worktreePath: "/tmp/worktree-a",
      }),
      makeThread({
        id: "thread-2" as ThreadId,
        branch: "feature/b",
        worktreePath: "/tmp/worktree-b",
      }),
    ];
    const statusA = {
      branch: "feature/a",
      pr: { number: 1, state: "open", title: "A", url: "https://example.test/a" },
    } as unknown as GitStatusResult;
    const statusB = {
      branch: "feature/b",
      pr: { number: 2, state: "merged", title: "B", url: "https://example.test/b" },
    } as unknown as GitStatusResult;

    const result = resolveBoardThreadGitStatusMap(
      threads,
      "/tmp/project",
      new Map([
        [`${ENV}:/tmp/worktree-a`, statusA],
        [`${ENV}:/tmp/worktree-b`, statusB],
      ]),
    );

    expect(result.get("thread-1" as ThreadId)).toBe(statusA);
    expect(result.get("thread-2" as ThreadId)).toBe(statusB);
  });

  it("appends background drops to the end of the target column", () => {
    expect(
      resolveBoardColumnDropPlacement(
        [
          makeCard({
            id: "card-1" as FeatureCardId,
            column: "planned",
            sortOrder: 10,
          }),
          makeCard({
            id: "card-2" as FeatureCardId,
            column: "planned",
            sortOrder: 20,
          }),
        ],
        "planned",
      ),
    ).toEqual({
      beforeId: "card-2",
      afterId: null,
    });

    expect(resolveBoardColumnDropPlacement([], "ideas")).toEqual({
      beforeId: null,
      afterId: null,
    });
  });
});
