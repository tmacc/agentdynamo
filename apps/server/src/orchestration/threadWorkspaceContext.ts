import { ProjectId, type ThreadId } from "@t3tools/contracts";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import { Effect } from "effect";

import { GitCore } from "../git/Services/GitCore.ts";

export interface ThreadWorkspaceContextInput {
  readonly thread: {
    readonly id?: ThreadId;
    readonly projectId: ProjectId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
  };
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly workspaceRoot: string;
  }>;
}

export interface ThreadWorkspaceContext {
  readonly cwd: string | undefined;
  readonly projectRoot: string | undefined;
  readonly storedBranch: string | null;
  readonly liveBranch: string | null;
  readonly effectiveBranch: string | null;
  readonly worktreePath: string | null;
  readonly isGitRepo: boolean;
  readonly worktreeBaseRef: string;
}

export const resolveThreadWorkspaceContext = Effect.fn("resolveThreadWorkspaceContext")(function* (
  input: ThreadWorkspaceContextInput,
) {
  const git = yield* GitCore;
  const projectRoot = input.projects.find(
    (project) => project.id === input.thread.projectId,
  )?.workspaceRoot;
  const cwd = input.thread.worktreePath ?? projectRoot;
  let isGitRepo = false;
  let liveBranch: string | null = null;

  if (cwd !== undefined) {
    const status = yield* git.status({ cwd }).pipe(
      Effect.map((value) => value),
      Effect.catch(() => Effect.succeed(null)),
    );
    isGitRepo = status?.isRepo === true;
    liveBranch = status?.branch ?? null;
  }

  const effectiveBranch = liveBranch ?? input.thread.branch;
  return {
    cwd,
    projectRoot,
    storedBranch: input.thread.branch,
    liveBranch,
    effectiveBranch,
    worktreePath: input.thread.worktreePath,
    isGitRepo,
    worktreeBaseRef: isGitRepo ? "HEAD" : (effectiveBranch ?? "HEAD"),
  } satisfies ThreadWorkspaceContext;
});

export function shouldSyncThreadBranchFromLiveGit(input: {
  readonly storedBranch: string | null;
  readonly liveBranch: string | null;
  readonly hasWorktreePath: boolean;
}): boolean {
  if (!input.hasWorktreePath) return false;
  if (input.liveBranch === null) return false;
  if (input.storedBranch === input.liveBranch) return false;
  if (input.storedBranch === null) return true;

  const normalizedStoredBranch = input.storedBranch.trim().toLowerCase();
  if (normalizedStoredBranch === "main" || normalizedStoredBranch === "master") {
    return true;
  }

  if (
    !isTemporaryWorktreeBranch(input.storedBranch) &&
    isTemporaryWorktreeBranch(input.liveBranch)
  ) {
    return false;
  }

  return true;
}
