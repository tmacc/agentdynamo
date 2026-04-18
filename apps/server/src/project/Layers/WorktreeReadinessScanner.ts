import { Effect, Layer } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { AnalyticsService } from "../../telemetry/Services/AnalyticsService.ts";
import { computeReadinessAnalysis } from "./WorktreeReadinessShared.ts";
import {
  buildWorktreeReadinessScanTelemetryProperties,
  classifyWorktreeReadinessFailure,
} from "./WorktreeReadinessTelemetry.ts";
import {
  WorktreeReadinessScanner,
  type WorktreeReadinessScannerShape,
} from "../Services/WorktreeReadinessScanner.ts";

const makeWorktreeReadinessScanner = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const analytics = yield* AnalyticsService;

  const scan: WorktreeReadinessScannerShape["scan"] = (input) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const project =
        (input.projectId
          ? readModel.projects.find((entry) => entry.id === input.projectId)
          : null) ??
        readModel.projects.find((entry) => entry.workspaceRoot === input.projectCwd) ??
        null;
      const analysis = yield* Effect.tryPromise(() =>
        computeReadinessAnalysis({
          projectCwd: input.projectCwd,
          profile: project?.worktreeReadiness ?? null,
        }),
      );

      const result = {
        configured: project?.worktreeReadiness?.status === "configured",
        promptRequired:
          input.trigger !== "team_worktree" && project?.worktreeReadiness?.status !== "configured",
        ...(project?.worktreeReadiness ? { profile: project.worktreeReadiness } : {}),
        scanFingerprint: analysis.scanFingerprint,
        detectedProjectType: analysis.detectedProjectType,
        recommendation: analysis.recommendation,
        warnings: analysis.warnings,
        proposedScripts: analysis.proposedScripts,
        proposedFiles: analysis.proposedFiles,
      };

      yield* analytics.record(
        "project.worktree_readiness.scanned",
        buildWorktreeReadinessScanTelemetryProperties({
          request: input,
          result,
        }),
      );

      return result;
    }).pipe(
      Effect.catch((cause) => {
        const error = cause instanceof Error ? cause : new Error("Failed to scan project");
        return Effect.logWarning("worktree readiness scan failed", {
          trigger: input.trigger,
          hasProjectId: input.projectId !== undefined,
          detail: error.message,
        }).pipe(
          Effect.flatMap(() =>
            analytics.record("project.worktree_readiness.scan_failed", {
              trigger: input.trigger,
              hasProjectId: input.projectId !== undefined,
              failureKind: classifyWorktreeReadinessFailure(error),
            }),
          ),
          Effect.flatMap(() => Effect.fail(error)),
        );
      }),
    );

  return {
    scan,
  } satisfies WorktreeReadinessScannerShape;
});

export const WorktreeReadinessScannerLive = Layer.effect(
  WorktreeReadinessScanner,
  makeWorktreeReadinessScanner,
);
