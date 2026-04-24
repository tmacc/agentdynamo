import { Effect, Layer } from "effect";

import { ServerConfig } from "../../config.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import { materializeWorktreeSetupHelpers, prepareWorktreeSetupRuntime } from "../worktreeSetup.ts";
import {
  WorktreeSetupRuntime,
  type WorktreeSetupRuntimeShape,
} from "../Services/WorktreeSetupRuntime.ts";

class WorktreeSetupRuntimeFailure extends Error {
  override readonly name = "WorktreeSetupRuntimeFailure";
}

const makeWorktreeSetupRuntime = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const terminalManager = yield* TerminalManager;

  const materializeProjectHelpers: WorktreeSetupRuntimeShape["materializeProjectHelpers"] = (
    input,
  ) =>
    Effect.tryPromise({
      try: () =>
        materializeWorktreeSetupHelpers({
          stateDir: serverConfig.stateDir,
          projectId: input.projectId,
          profile: input.profile,
        }),
      catch: (cause) =>
        new WorktreeSetupRuntimeFailure(
          cause instanceof Error ? cause.message : "Failed to materialize worktree setup helpers.",
          { cause },
        ),
    });

  const prepareWorktreeRuntime: WorktreeSetupRuntimeShape["prepareWorktreeRuntime"] = (input) =>
    Effect.tryPromise({
      try: () =>
        prepareWorktreeSetupRuntime({
          stateDir: serverConfig.stateDir,
          projectId: input.projectId,
          projectCwd: input.projectCwd,
          worktreePath: input.worktreePath,
          profile: input.profile,
        }),
      catch: (cause) =>
        new WorktreeSetupRuntimeFailure(
          cause instanceof Error ? cause.message : "Failed to prepare worktree setup runtime.",
          { cause },
        ),
    });

  const runSetupForThread: WorktreeSetupRuntimeShape["runSetupForThread"] = (input) =>
    Effect.gen(function* () {
      const prepared = yield* prepareWorktreeRuntime(input);
      const terminalId = input.preferredTerminalId ?? "worktree-setup";
      yield* terminalManager.open({
        threadId: input.threadId,
        terminalId,
        cwd: input.worktreePath,
        worktreePath: input.worktreePath,
        env: {
          DYNAMO_WORKTREE_ENV_FILE: prepared.envFilePath,
        },
      });
      yield* terminalManager.write({
        threadId: input.threadId,
        terminalId,
        data: `${prepared.helperPaths.setupHelperPath}\r`,
      });
      return {
        status: "started",
        scriptId: "worktree-setup",
        scriptName: "Worktree setup",
        terminalId,
        cwd: input.worktreePath,
      } as const;
    });

  const runDevForThread: WorktreeSetupRuntimeShape["runDevForThread"] = (input) =>
    Effect.gen(function* () {
      const prepared = yield* prepareWorktreeRuntime(input);
      const terminalId = input.preferredTerminalId ?? "worktree-dev";
      yield* terminalManager.open({
        threadId: input.threadId,
        terminalId,
        cwd: input.worktreePath,
        worktreePath: input.worktreePath,
        env: {
          DYNAMO_WORKTREE_ENV_FILE: prepared.envFilePath,
        },
      });
      yield* terminalManager.write({
        threadId: input.threadId,
        terminalId,
        data: `${prepared.helperPaths.devHelperPath}\r`,
      });
      return {
        status: "started",
        scriptId: "worktree-dev",
        scriptName: "Run dev",
        terminalId,
        cwd: input.worktreePath,
      } as const;
    });

  return {
    materializeProjectHelpers,
    prepareWorktreeRuntime,
    runSetupForThread,
    runDevForThread,
  } satisfies WorktreeSetupRuntimeShape;
});

export const WorktreeSetupRuntimeLive = Layer.effect(
  WorktreeSetupRuntime,
  makeWorktreeSetupRuntime,
);
