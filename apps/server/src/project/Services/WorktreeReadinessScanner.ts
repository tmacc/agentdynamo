import type {
  ProjectScanWorktreeReadinessInput,
  ProjectScanWorktreeReadinessResult,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface WorktreeReadinessScannerShape {
  readonly scan: (
    input: ProjectScanWorktreeReadinessInput,
  ) => Effect.Effect<ProjectScanWorktreeReadinessResult, Error>;
}

export class WorktreeReadinessScanner extends Context.Service<
  WorktreeReadinessScanner,
  WorktreeReadinessScannerShape
>()("t3/project/WorktreeReadinessScanner") {}
