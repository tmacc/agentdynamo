import type {
  ProjectApplyWorktreeSetupInput,
  ProjectApplyWorktreeSetupResult,
} from "@t3tools/contracts";
import { Context, type Effect } from "effect";

export interface WorktreeSetupApplicatorShape {
  readonly apply: (
    input: ProjectApplyWorktreeSetupInput,
  ) => Effect.Effect<ProjectApplyWorktreeSetupResult, Error>;
}

export class WorktreeSetupApplicator extends Context.Service<
  WorktreeSetupApplicator,
  WorktreeSetupApplicatorShape
>()("t3/project/WorktreeSetupApplicator") {}
