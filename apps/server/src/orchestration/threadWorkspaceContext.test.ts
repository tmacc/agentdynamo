import { GitCommandError, ProjectId, type GitStatusResult } from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { GitCore, type GitCoreShape } from "../git/Services/GitCore.ts";
import {
  resolveThreadWorkspaceContext,
  shouldSyncThreadBranchFromLiveGit,
} from "./threadWorkspaceContext.ts";

const gitStatus = (overrides: Partial<GitStatusResult> = {}): GitStatusResult => ({
  isRepo: true,
  hasOriginRemote: false,
  isDefaultBranch: false,
  branch: "feature/live",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: false,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
  ...overrides,
});

async function runWithGit<T>(
  git: Partial<GitCoreShape>,
  effect: Effect.Effect<T, unknown, GitCore>,
) {
  const runtime = ManagedRuntime.make(Layer.succeed(GitCore, git as unknown as GitCoreShape));
  try {
    return await runtime.runPromise(effect);
  } finally {
    await runtime.dispose();
  }
}

describe("threadWorkspaceContext", () => {
  it("prefers the thread worktree path over the project root", async () => {
    const context = await runWithGit(
      { status: () => Effect.succeed(gitStatus({ branch: "t3code/411b93f1" })) },
      resolveThreadWorkspaceContext({
        thread: {
          projectId: ProjectId.make("project-1"),
          branch: "main",
          worktreePath: "/repo/worktrees/t3code-411b93f1",
        },
        projects: [{ id: ProjectId.make("project-1"), workspaceRoot: "/repo/project" }],
      }),
    );

    expect(context.cwd).toBe("/repo/worktrees/t3code-411b93f1");
    expect(context.projectRoot).toBe("/repo/project");
  });

  it("uses the live git branch as the effective branch when available", async () => {
    const context = await runWithGit(
      { status: () => Effect.succeed(gitStatus({ branch: "t3code/411b93f1" })) },
      resolveThreadWorkspaceContext({
        thread: {
          projectId: ProjectId.make("project-1"),
          branch: "main",
          worktreePath: "/repo/worktrees/t3code-411b93f1",
        },
        projects: [{ id: ProjectId.make("project-1"), workspaceRoot: "/repo/project" }],
      }),
    );

    expect(context.liveBranch).toBe("t3code/411b93f1");
    expect(context.effectiveBranch).toBe("t3code/411b93f1");
    expect(context.worktreeBaseRef).toBe("HEAD");
  });

  it("returns a non-git context when git status fails", async () => {
    const context = await runWithGit(
      {
        status: () =>
          Effect.fail(
            new GitCommandError({
              operation: "status",
              command: "git status",
              cwd: "/repo/project",
              detail: "not a repository",
            }),
          ),
      },
      resolveThreadWorkspaceContext({
        thread: {
          projectId: ProjectId.make("project-1"),
          branch: "main",
          worktreePath: null,
        },
        projects: [{ id: ProjectId.make("project-1"), workspaceRoot: "/repo/project" }],
      }),
    );

    expect(context.cwd).toBe("/repo/project");
    expect(context.isGitRepo).toBe(false);
    expect(context.liveBranch).toBeNull();
    expect(context.effectiveBranch).toBe("main");
  });

  it("syncs a stale default branch in a worktree from live git", () => {
    expect(
      shouldSyncThreadBranchFromLiveGit({
        storedBranch: "main",
        liveBranch: "t3code/411b93f1",
        hasWorktreePath: true,
      }),
    ).toBe(true);
  });

  it("does not sync branch metadata for project-root threads", () => {
    expect(
      shouldSyncThreadBranchFromLiveGit({
        storedBranch: null,
        liveBranch: "feature/live",
        hasWorktreePath: false,
      }),
    ).toBe(false);
  });

  it("syncs a missing branch only for worktree-backed threads", () => {
    expect(
      shouldSyncThreadBranchFromLiveGit({
        storedBranch: null,
        liveBranch: "feature/live",
        hasWorktreePath: true,
      }),
    ).toBe(true);
  });

  it("does not replace a semantic branch with a temporary worktree branch", () => {
    expect(
      shouldSyncThreadBranchFromLiveGit({
        storedBranch: "feature/foo",
        liveBranch: "t3code/deadbeef",
        hasWorktreePath: true,
      }),
    ).toBe(false);
  });
});
