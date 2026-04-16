import type {
  ModelSelection,
  OrchestrationTeamTask,
  OrchestrationTeamTaskId,
  OrchestrationTeamTaskStatus,
  ProviderSessionStartInput,
  ThreadId,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect, Option } from "effect";

export interface TeamChildResult extends OrchestrationTeamTask {
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly diffSummary: string | null;
  readonly latestOutputText: string | null;
}

export interface SpawnTeamChildInput {
  readonly parentThreadId: ThreadId;
  readonly provider: ModelSelection["provider"];
  readonly model: string;
  readonly title: string;
  readonly task: string;
  readonly roleLabel?: string | null;
  readonly contextBrief?: string | null;
  readonly relevantFiles?: ReadonlyArray<string>;
}

export interface SendTeamChildMessageInput {
  readonly parentThreadId: ThreadId;
  readonly taskId: OrchestrationTeamTaskId;
  readonly message: string;
}

export interface CloseTeamChildInput {
  readonly parentThreadId: ThreadId;
  readonly taskId: OrchestrationTeamTaskId;
  readonly reason?: string | null;
}

export interface WaitForTeamChildrenInput {
  readonly parentThreadId: ThreadId;
  readonly taskIds?: ReadonlyArray<OrchestrationTeamTaskId>;
  readonly timeoutSeconds?: number;
}

export interface TeamOrchestrationServiceShape {
  readonly getCoordinatorSessionConfig: (
    threadId: ThreadId,
  ) => Effect.Effect<NonNullable<ProviderSessionStartInput["teamCoordinator"]>, Error>;
  readonly authenticateCoordinatorAccessToken: (
    accessToken: string,
  ) => Effect.Effect<Option.Option<ThreadId>>;
  readonly spawnChild: (input: SpawnTeamChildInput) => Effect.Effect<TeamChildResult, Error>;
  readonly listChildren: (input: {
    readonly parentThreadId: ThreadId;
    readonly statusFilter?: ReadonlyArray<OrchestrationTeamTaskStatus>;
  }) => Effect.Effect<ReadonlyArray<TeamChildResult>, Error>;
  readonly waitForChildren: (
    input: WaitForTeamChildrenInput,
  ) => Effect.Effect<ReadonlyArray<TeamChildResult>, Error>;
  readonly sendChildMessage: (
    input: SendTeamChildMessageInput,
  ) => Effect.Effect<TeamChildResult, Error>;
  readonly closeChild: (input: CloseTeamChildInput) => Effect.Effect<TeamChildResult, Error>;
}

export class TeamOrchestrationService extends Context.Service<
  TeamOrchestrationService,
  TeamOrchestrationServiceShape
>()("t3/team/Services/TeamOrchestrationService") {}
