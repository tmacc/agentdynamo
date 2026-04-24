import { Effect, Layer } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { computeWorktreeSetupAnalysis } from "../worktreeSetup.ts";
import {
  WorktreeSetupScanner,
  type WorktreeSetupScannerShape,
} from "../Services/WorktreeSetupScanner.ts";

class WorktreeSetupScanFailure extends Error {
  override readonly name = "WorktreeSetupScanFailure";
}

const makeWorktreeSetupScanner = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;

  const scan: WorktreeSetupScannerShape["scan"] = (input) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const project =
        (input.projectId
          ? readModel.projects.find((entry) => entry.id === input.projectId)
          : null) ??
        readModel.projects.find((entry) => entry.workspaceRoot === input.projectCwd) ??
        null;
      const analysis = yield* Effect.tryPromise({
        try: () =>
          computeWorktreeSetupAnalysis({
            projectCwd: input.projectCwd,
            profile: project?.worktreeSetup ?? null,
          }),
        catch: (cause) =>
          new WorktreeSetupScanFailure(
            cause instanceof Error ? cause.message : "Failed to scan worktree setup.",
            { cause },
          ),
      });
      const profile = project?.worktreeSetup ?? null;
      const configured =
        profile?.status === "configured" && profile.scanFingerprint === analysis.scanFingerprint;
      const promptRequired =
        input.trigger === "manual" ||
        !configured ||
        profile?.scanFingerprint !== analysis.scanFingerprint;
      return {
        configured,
        promptRequired,
        ...(profile ? { profile } : {}),
        scanFingerprint: analysis.scanFingerprint,
        detectedProjectType: analysis.detectedProjectType,
        recommendation: analysis.recommendation,
        warnings: analysis.warnings,
        runtimeHelperPreview: {
          storageMode: "dynamo-managed" as const,
          setupDescription: "Dynamo stores generated setup helpers in runtime data.",
          devDescription: "Dynamo stores generated dev helpers in runtime data.",
        },
      };
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("worktree setup scan failed", {
          trigger: input.trigger,
          hasProjectId: input.projectId !== undefined,
          detail: cause.message,
        }).pipe(Effect.flatMap(() => Effect.fail(cause))),
      ),
    );

  return {
    scan,
  } satisfies WorktreeSetupScannerShape;
});

export const WorktreeSetupScannerLive = Layer.effect(
  WorktreeSetupScanner,
  makeWorktreeSetupScanner,
);
