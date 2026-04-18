import type {
  ProjectApplyWorktreeReadinessInput,
  ProjectApplyWorktreeReadinessResult,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface WorktreeReadinessApplicatorShape {
  readonly apply: (
    input: ProjectApplyWorktreeReadinessInput,
  ) => Effect.Effect<ProjectApplyWorktreeReadinessResult, Error>;
}

export class WorktreeReadinessApplicator extends Context.Service<
  WorktreeReadinessApplicator,
  WorktreeReadinessApplicatorShape
>()("t3/project/WorktreeReadinessApplicator") {}
