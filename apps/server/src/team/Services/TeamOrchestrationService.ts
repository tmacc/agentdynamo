import {
  type ModelSelection,
  type OrchestrationTeamTask,
  type ProviderKind,
  type TeamTaskId,
  type TeamTaskKind,
  type TeamTaskSetupMode,
  type TeamTaskWorkspaceMode,
  type ThreadId,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface SpawnTeamChildInput {
  readonly parentThreadId: ThreadId;
  readonly title: string;
  readonly task: string;
  readonly roleLabel?: string;
  readonly taskKind?: TeamTaskKind;
  readonly contextBrief?: string;
  readonly relevantFiles?: ReadonlyArray<string>;
  readonly provider?: ProviderKind;
  readonly model?: string;
  readonly workspaceMode?: TeamTaskWorkspaceMode;
  readonly setupMode?: TeamTaskSetupMode;
}

export interface ListTeamChildrenInput {
  readonly parentThreadId: ThreadId;
  readonly statusFilter?: ReadonlyArray<OrchestrationTeamTask["status"]>;
}

export interface WaitForTeamChildrenInput extends ListTeamChildrenInput {
  readonly taskIds?: ReadonlyArray<TeamTaskId>;
  readonly timeoutSeconds?: number;
}

export interface SendTeamChildMessageInput {
  readonly parentThreadId: ThreadId;
  readonly taskId: TeamTaskId;
  readonly message: string;
}

export interface CloseTeamChildInput {
  readonly parentThreadId: ThreadId;
  readonly taskId: TeamTaskId;
  readonly reason?: string;
}

export interface TeamChildResult {
  readonly task: OrchestrationTeamTask;
  readonly modelSelection: ModelSelection;
  readonly childThreadId: ThreadId;
}

export interface TeamOrchestrationServiceShape {
  readonly spawnChild: (input: SpawnTeamChildInput) => Effect.Effect<TeamChildResult, Error>;
  readonly listChildren: (
    input: ListTeamChildrenInput,
  ) => Effect.Effect<ReadonlyArray<OrchestrationTeamTask>, Error>;
  readonly waitForChildren: (
    input: WaitForTeamChildrenInput,
  ) => Effect.Effect<ReadonlyArray<OrchestrationTeamTask>, Error>;
  readonly sendChildMessage: (
    input: SendTeamChildMessageInput,
  ) => Effect.Effect<TeamChildResult, Error>;
  readonly closeChild: (input: CloseTeamChildInput) => Effect.Effect<TeamChildResult, Error>;
}

export class TeamOrchestrationService extends Context.Service<
  TeamOrchestrationService,
  TeamOrchestrationServiceShape
>()("t3/team/Services/TeamOrchestrationService") {}
