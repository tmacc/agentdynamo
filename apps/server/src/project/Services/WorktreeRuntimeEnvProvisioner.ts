import { Context } from "effect";
import type { Effect } from "effect";

export interface WorktreeRuntimeEnvProvisionedFile {
  readonly envFilePath: string;
  readonly created: boolean;
  readonly values: Record<string, string>;
}

export interface WorktreeRuntimeEnvProvisionerShape {
  readonly ensureEnvFile: (input: {
    readonly projectCwd: string;
    readonly worktreePath: string;
    readonly portCount: number;
  }) => Effect.Effect<WorktreeRuntimeEnvProvisionedFile, Error>;
}

export class WorktreeRuntimeEnvProvisioner extends Context.Service<
  WorktreeRuntimeEnvProvisioner,
  WorktreeRuntimeEnvProvisionerShape
>()("t3/project/WorktreeRuntimeEnvProvisioner") {}
