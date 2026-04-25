import { Layer } from "effect";

import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { ProjectionBoardCardRepositoryLive } from "../persistence/Layers/ProjectionBoardCards.ts";
import { ProjectionBoardDismissedGhostRepositoryLive } from "../persistence/Layers/ProjectionBoardDismissedGhosts.ts";
import { ProjectionNativeSubagentTraceRepositoryLive } from "../persistence/Layers/ProjectionNativeSubagentTrace.ts";
import { ProjectionThreadTeamTaskRepositoryLive } from "../persistence/Layers/ProjectionThreadTeamTasks.ts";
import { OrchestrationEngineLive } from "./Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./Layers/ProjectionSnapshotQuery.ts";

export const OrchestrationEventInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationEventStoreLive,
  OrchestrationCommandReceiptRepositoryLive,
);

export const OrchestrationProjectionPipelineLayerLive = OrchestrationProjectionPipelineLive.pipe(
  Layer.provide(OrchestrationEventStoreLive),
);

export const OrchestrationInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationProjectionSnapshotQueryLive,
  OrchestrationEventInfrastructureLayerLive,
  OrchestrationProjectionPipelineLayerLive,
  ProjectionBoardCardRepositoryLive,
  ProjectionBoardDismissedGhostRepositoryLive,
  ProjectionThreadTeamTaskRepositoryLive,
  ProjectionNativeSubagentTraceRepositoryLive,
);

export const OrchestrationLayerLive = Layer.mergeAll(
  OrchestrationInfrastructureLayerLive,
  OrchestrationEngineLive.pipe(Layer.provide(OrchestrationInfrastructureLayerLive)),
);
