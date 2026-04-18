import {
  OrchestrationDispatchCommandError,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { buildChildPrompt, selectChildTranscriptMessages } from "./TeamOrchestrationService.ts";
import { TeamOrchestrationServiceLive } from "./TeamOrchestrationService.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadBootstrapDispatcher } from "../../orchestration/Services/ThreadBootstrapDispatcher.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TeamCoordinatorSessionRegistry } from "../Services/TeamCoordinatorSessionRegistry.ts";
import { TeamOrchestrationService } from "../Services/TeamOrchestrationService.ts";

function makeReadModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    projects: [
      {
        id: "project-1",
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModelSelection: null,
        scripts: [],
        worktreeReadiness: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: "thread-parent",
        projectId: "project-1",
        title: "Parent thread",
        messages: [{ role: "user", text: "Review the current worktree" }],
        proposedPlans: [],
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "main",
        worktreePath: "/repo/project/.worktrees/parent",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        teamParentThreadId: null,
        teamTasks: [],
      },
    ],
    providerSessions: [],
    providerStatuses: [],
    pendingApprovals: [],
    latestTurnByThreadId: {},
  } as unknown as OrchestrationReadModel;
}

describe("selectChildTranscriptMessages", () => {
  it("keeps only recent user context and excludes the duplicated latest goal", () => {
    expect(
      selectChildTranscriptMessages({
        latestGoal: "Review the current working tree",
        messages: [
          { role: "user", text: "Initial repo context" },
          { role: "assistant", text: "I'm dispatching two reviewers now." },
          { role: "user", text: "Focus on bugs and missing tests only" },
          { role: "assistant", text: "Waiting for both children." },
          { role: "user", text: "Review the current working tree" },
        ],
      }),
    ).toEqual([
      { role: "user", text: "Initial repo context" },
      { role: "user", text: "Focus on bugs and missing tests only" },
    ]);
  });
});

describe("buildChildPrompt", () => {
  it("tells child agents not to delegate and to return the deliverable directly", () => {
    const prompt = buildChildPrompt({
      parentTitle: "Current working tree review",
      latestGoal: "Review the current working tree",
      latestPlanMarkdown: "1. Spawn reviewers\n2. Wait\n3. Merge findings",
      branch: "main",
      worktreePath: "/tmp/project",
      roleLabel: "Frontend reviewer",
      contextBrief: "Review only for bugs, regressions, risks, and missing tests.",
      relevantFiles: ["apps/web/src/components/ChatView.tsx"],
      task: "Review the frontend changes. Do not make edits.",
      transcript: [{ role: "user", text: "Focus on bugs and missing tests only" }],
    });

    expect(prompt).toContain("You are a child agent working for a coordinator thread.");
    expect(prompt).toContain(
      "Do not delegate, spawn subagents, or use native collaboration tools.",
    );
    expect(prompt).toContain("Assigned role: Frontend reviewer");
    expect(prompt).toContain("Recent user context:\nUSER:\nFocus on bugs and missing tests only");
    expect(prompt).toContain("Return the requested deliverable directly.");
    expect(prompt).toContain(
      "Only include branch/worktree handoff details if you actually made code changes in your own workspace.",
    );
    expect(prompt).not.toContain("When you finish, summarize what changed");
  });
});

describe("TeamOrchestrationService", () => {
  it("does not request setup scripts for worktree child bootstraps", async () => {
    let capturedBootstrap: any = null;
    const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));

    const service = await Effect.runPromise(
      Effect.service(TeamOrchestrationService).pipe(
        Effect.provide(
          TeamOrchestrationServiceLive.pipe(
            Layer.provideMerge(
              Layer.succeed(OrchestrationEngineService, {
                getReadModel: () => Effect.succeed(makeReadModel()),
                readEvents: () => Stream.empty,
                dispatch,
                streamDomainEvents: Stream.empty,
              }),
            ),
            Layer.provideMerge(
              Layer.succeed(ProjectionSnapshotQuery, {
                getThreadDetailById: () => Effect.succeed(Option.none()),
              } as never),
            ),
            Layer.provideMerge(
              Layer.succeed(ThreadBootstrapDispatcher, {
                dispatch: (command) => {
                  capturedBootstrap = command.bootstrap ?? null;
                  return Effect.fail(
                    new OrchestrationDispatchCommandError({
                      message: "bootstrap blocked for test",
                    }),
                  );
                },
              }),
            ),
            Layer.provideMerge(
              Layer.succeed(ProviderRegistry, {
                getProviders: Effect.succeed([
                  {
                    provider: "codex",
                    enabled: true,
                    installed: true,
                    supportsTeamWorker: true,
                    models: [{ slug: "gpt-5" }],
                  },
                ]),
                refresh: () => Effect.succeed([]),
                streamChanges: Stream.empty,
              } as never),
            ),
            Layer.provideMerge(ServerSettingsService.layerTest({ teamAgents: true })),
            Layer.provideMerge(
              Layer.succeed(GitCore, {
                isInsideWorkTree: () => Effect.succeed(true),
                status: () =>
                  Effect.succeed({
                    branch: "main",
                  }),
              } as never),
            ),
            Layer.provideMerge(
              Layer.succeed(TeamCoordinatorSessionRegistry, {
                getCoordinatorSessionConfig: () => Effect.fail(new Error("unused")),
                authenticateCoordinatorAccessToken: () => Effect.succeed(Option.none()),
              }),
            ),
          ),
        ),
      ),
    );

    await expect(
      Effect.runPromise(
        service.spawnChild({
          parentThreadId: ThreadId.make("thread-parent"),
          provider: "codex",
          model: "gpt-5",
          title: "Frontend review",
          task: "Review the current changes",
        }),
      ),
    ).rejects.toThrow("Failed to spawn child");

    expect(capturedBootstrap).not.toBeNull();
    expect(capturedBootstrap?.prepareWorktree).toEqual({
      projectCwd: "/repo/project/.worktrees/parent",
      baseBranch: "main",
      branch: expect.stringMatching(/^agent\/frontend-review-/),
    });
    expect(capturedBootstrap?.runSetupScript).toBe(false);
    expect(dispatch).toHaveBeenCalled();
  });
});
