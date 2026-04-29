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

interface WorktreeSetupRuntimeOptions {
  readonly platform?: NodeJS.Platform;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function cmdQuotePath(value: string): string {
  if (value.includes('"')) {
    throw new WorktreeSetupRuntimeFailure(
      `Cannot launch Windows worktree helper with a quote in its path: ${value}`,
    );
  }
  return `"${value}"`;
}

function commandLaunchInput(input: {
  readonly platform: NodeJS.Platform;
  readonly posixEnvFilePath: string;
  readonly powerShellEnvFilePath: string;
  readonly posixHelperPath: string;
  readonly windowsCommandPath: string;
}): { readonly envFilePath: string; readonly initialCommand: string } {
  if (input.platform === "win32") {
    return {
      envFilePath: input.powerShellEnvFilePath,
      initialCommand: `cmd.exe /d /s /c ${cmdQuotePath(input.windowsCommandPath)}`,
    };
  }
  return {
    envFilePath: input.posixEnvFilePath,
    initialCommand: shellQuote(input.posixHelperPath),
  };
}

export const makeWorktreeSetupRuntimeWithOptions = (
  options: WorktreeSetupRuntimeOptions = {},
) =>
  Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const terminalManager = yield* TerminalManager;
  const platform = options.platform ?? process.platform;

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
      const launchInput = commandLaunchInput({
        platform,
        posixEnvFilePath: prepared.envFilePath,
        powerShellEnvFilePath: prepared.powerShellEnvFilePath,
        posixHelperPath: prepared.helperPaths.setupHelperPath,
        windowsCommandPath: prepared.helperPaths.setupWindowsCommandPath,
      });
      yield* terminalManager.open({
        threadId: input.threadId,
        terminalId,
        cwd: input.worktreePath,
        worktreePath: input.worktreePath,
        env: {
          DYNAMO_WORKTREE_ENV_FILE: launchInput.envFilePath,
        },
        initialCommand: launchInput.initialCommand,
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
      const launchInput = commandLaunchInput({
        platform,
        posixEnvFilePath: prepared.envFilePath,
        powerShellEnvFilePath: prepared.powerShellEnvFilePath,
        posixHelperPath: prepared.helperPaths.devHelperPath,
        windowsCommandPath: prepared.helperPaths.devWindowsCommandPath,
      });
      yield* terminalManager.open({
        threadId: input.threadId,
        terminalId,
        cwd: input.worktreePath,
        worktreePath: input.worktreePath,
        env: {
          DYNAMO_WORKTREE_ENV_FILE: launchInput.envFilePath,
        },
        initialCommand: launchInput.initialCommand,
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
  makeWorktreeSetupRuntimeWithOptions(),
);
