import { Context } from "effect";
import type { Effect } from "effect";
import type { ProjectId, ThreadId } from "@t3tools/contracts";

export interface ProjectSetupScriptRunnerResultNoScript {
  readonly status: "no-script";
}

export interface ProjectSetupScriptRunnerResultStarted {
  readonly status: "started";
  readonly scriptId: string;
  readonly scriptName: string;
  readonly terminalId: string;
  readonly cwd: string;
}

export type ProjectSetupScriptRunnerResult =
  | ProjectSetupScriptRunnerResultNoScript
  | ProjectSetupScriptRunnerResultStarted;

export interface ProjectSetupScriptRunnerInput {
  readonly threadId: ThreadId;
  readonly projectId?: ProjectId;
  readonly projectCwd?: string;
  readonly worktreePath: string;
  readonly preferredTerminalId?: string;
}

export interface ProjectSetupScriptRunnerShape {
  readonly runForThread: (
    input: ProjectSetupScriptRunnerInput,
  ) => Effect.Effect<ProjectSetupScriptRunnerResult, Error>;
}

export class ProjectSetupScriptRunner extends Context.Service<
  ProjectSetupScriptRunner,
  ProjectSetupScriptRunnerShape
>()("t3/project/ProjectSetupScriptRunner") {}
