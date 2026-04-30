import { Context } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface ProjectionMaintenanceShape {
  readonly repairLegacyAssistantCompletedTurns: () => Effect.Effect<
    {
      readonly repairedTurnCount: number;
      readonly promotedLatestCount: number;
    },
    ProjectionRepositoryError
  >;
}

export class ProjectionMaintenance extends Context.Service<
  ProjectionMaintenance,
  ProjectionMaintenanceShape
>()("t3/orchestration/Services/ProjectionMaintenance") {}
