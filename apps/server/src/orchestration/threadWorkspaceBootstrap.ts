import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { Cause, Effect, Exit } from "effect";

import type { GitCoreShape } from "../git/Services/GitCore.ts";
import type { GitStatusBroadcasterShape } from "../git/Services/GitStatusBroadcaster.ts";
import type {
  ProjectSetupScriptRunnerResultStarted,
  ProjectSetupScriptRunnerShape,
} from "../project/Services/ProjectSetupScriptRunner.ts";

const toError = (cause: unknown, message: string): Error =>
  cause instanceof Error ? cause : new Error(message, { cause });

export interface PrepareThreadWorkspaceInput {
  readonly threadId: ThreadId;
  readonly projectId?: ProjectId;
  readonly projectCwd?: string;
  readonly currentWorktreePath?: string | null;
  readonly currentBranch?: string | null;
  readonly prepareWorktree?: {
    readonly projectCwd: string;
    readonly baseBranch: string;
    readonly branch?: string;
  };
  readonly runSetupScript?: boolean;
  readonly setupFailureMode: "ignore" | "fail-request";
  readonly cleanupOnFailure?: boolean;
  readonly onWorktreeCreated?: (input: {
    readonly branch: string;
    readonly worktreePath: string;
  }) => Effect.Effect<void, Error, never>;
  readonly onSetupStarted?: (
    result: ProjectSetupScriptRunnerResultStarted & {
      readonly requestedAt: string;
      readonly worktreePath: string;
    },
  ) => Effect.Effect<void, Error, never>;
  readonly onSetupLaunchFailure?: (input: {
    readonly requestedAt: string;
    readonly worktreePath: string;
    readonly error: unknown;
  }) => Effect.Effect<void, Error, never>;
}

export interface PrepareThreadWorkspaceResult {
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly cleanup: Effect.Effect<void, never, never>;
}

export function prepareThreadWorkspace(dependencies: {
  readonly git: GitCoreShape;
  readonly gitStatusBroadcaster: GitStatusBroadcasterShape;
  readonly projectSetupScriptRunner: ProjectSetupScriptRunnerShape;
}) {
  return (
    input: PrepareThreadWorkspaceInput,
  ): Effect.Effect<PrepareThreadWorkspaceResult, Error, never> => {
    let cleanupCwd: string | null = null;
    let currentWorktreePath: string | null = input.currentWorktreePath ?? null;

    const cleanupCreatedWorktree = () =>
      cleanupCwd && currentWorktreePath
        ? dependencies.git
            .removeWorktree({
              cwd: cleanupCwd,
              path: currentWorktreePath,
              force: true,
            })
            .pipe(Effect.ignoreCause({ log: true }))
        : Effect.void;

    return Effect.gen(function* () {
      let currentBranch = input.currentBranch ?? null;

      if (input.prepareWorktree) {
        const worktree = yield* dependencies.git.createWorktree({
          cwd: input.prepareWorktree.projectCwd,
          branch: input.prepareWorktree.baseBranch,
          newBranch: input.prepareWorktree.branch,
          path: null,
        });
        currentBranch = worktree.worktree.branch;
        currentWorktreePath = worktree.worktree.path;
        cleanupCwd = input.prepareWorktree.projectCwd;

        yield* dependencies.gitStatusBroadcaster
          .refreshStatus(currentWorktreePath)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

        if (input.onWorktreeCreated) {
          yield* input
            .onWorktreeCreated({
              branch: currentBranch,
              worktreePath: currentWorktreePath,
            })
            .pipe(Effect.asVoid);
        }
      }

      if (input.runSetupScript && currentWorktreePath) {
        const requestedAt = new Date().toISOString();
        const setupExit = yield* Effect.exit(
          dependencies.projectSetupScriptRunner.runForThread({
            threadId: input.threadId,
            ...(input.projectId ? { projectId: input.projectId } : {}),
            ...(input.projectCwd ? { projectCwd: input.projectCwd } : {}),
            worktreePath: currentWorktreePath,
          }),
        );

        if (Exit.isFailure(setupExit)) {
          if (input.onSetupLaunchFailure) {
            yield* input
              .onSetupLaunchFailure({
                requestedAt,
                worktreePath: currentWorktreePath,
                error: Cause.squash(setupExit.cause),
              })
              .pipe(Effect.asVoid);
          }

          if (input.setupFailureMode === "fail-request") {
            return yield* Effect.fail(new Error("Failed to launch the setup script."));
          }
        } else if (setupExit.value.status === "started" && input.onSetupStarted) {
          yield* input
            .onSetupStarted({
              ...setupExit.value,
              requestedAt,
              worktreePath: currentWorktreePath,
            })
            .pipe(Effect.asVoid);
        }
      }

      const cleanup = cleanupCwd && currentWorktreePath ? cleanupCreatedWorktree() : Effect.void;

      return {
        branch: currentBranch,
        worktreePath: currentWorktreePath,
        cleanup,
      } satisfies PrepareThreadWorkspaceResult;
    }).pipe(
      Effect.catch((error) =>
        (input.cleanupOnFailure ? cleanupCreatedWorktree() : Effect.void).pipe(
          Effect.flatMap(() =>
            Effect.fail(toError(error, "Failed to prepare the thread workspace.")),
          ),
        ),
      ),
    );
  };
}
