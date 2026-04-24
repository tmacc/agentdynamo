import type {
  ProjectScanWorktreeSetupInput,
  ProjectScanWorktreeSetupResult,
} from "@t3tools/contracts";
import { Context, type Effect } from "effect";

export interface WorktreeSetupScannerShape {
  readonly scan: (
    input: ProjectScanWorktreeSetupInput,
  ) => Effect.Effect<ProjectScanWorktreeSetupResult, Error>;
}

export class WorktreeSetupScanner extends Context.Service<
  WorktreeSetupScanner,
  WorktreeSetupScannerShape
>()("t3/project/WorktreeSetupScanner") {}
