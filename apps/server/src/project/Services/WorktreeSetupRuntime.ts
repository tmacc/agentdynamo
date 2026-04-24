import type { ProjectId, ProjectWorktreeSetupProfile, ThreadId } from "@t3tools/contracts";
import { Context, type Effect } from "effect";

import type { WorktreeRuntimePreparation, WorktreeSetupHelperPaths } from "../worktreeSetup.ts";

export interface WorktreeSetupRuntimeMaterializeInput {
  readonly projectId: ProjectId;
  readonly profile: ProjectWorktreeSetupProfile;
}

export interface WorktreeSetupRuntimePrepareInput {
  readonly projectId: ProjectId;
  readonly projectCwd: string;
  readonly worktreePath: string;
  readonly profile: ProjectWorktreeSetupProfile;
}

export interface WorktreeSetupRuntimeRunInput {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly projectCwd: string;
  readonly worktreePath: string;
  readonly profile: ProjectWorktreeSetupProfile;
  readonly preferredTerminalId?: string;
}

export interface WorktreeSetupRuntimeRunResult {
  readonly status: "started";
  readonly scriptId: "worktree-setup" | "worktree-dev";
  readonly scriptName: string;
  readonly terminalId: string;
  readonly cwd: string;
}

export interface WorktreeSetupRuntimeShape {
  readonly materializeProjectHelpers: (
    input: WorktreeSetupRuntimeMaterializeInput,
  ) => Effect.Effect<WorktreeSetupHelperPaths, Error>;
  readonly prepareWorktreeRuntime: (
    input: WorktreeSetupRuntimePrepareInput,
  ) => Effect.Effect<WorktreeRuntimePreparation, Error>;
  readonly runSetupForThread: (
    input: WorktreeSetupRuntimeRunInput,
  ) => Effect.Effect<WorktreeSetupRuntimeRunResult, Error>;
  readonly runDevForThread: (
    input: WorktreeSetupRuntimeRunInput,
  ) => Effect.Effect<WorktreeSetupRuntimeRunResult, Error>;
}

export class WorktreeSetupRuntime extends Context.Service<
  WorktreeSetupRuntime,
  WorktreeSetupRuntimeShape
>()("t3/project/WorktreeSetupRuntime") {}
