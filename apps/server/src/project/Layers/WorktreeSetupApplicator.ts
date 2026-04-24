import crypto from "node:crypto";

import { CommandId } from "@t3tools/contracts";
import { Effect, Layer } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { buildWorktreeSetupProfile, computeWorktreeSetupAnalysis } from "../worktreeSetup.ts";
import { WorktreeSetupRuntime } from "../Services/WorktreeSetupRuntime.ts";
import {
  WorktreeSetupApplicator,
  type WorktreeSetupApplicatorShape,
} from "../Services/WorktreeSetupApplicator.ts";

class WorktreeSetupApplyFailure extends Error {
  override readonly name = "WorktreeSetupApplyFailure";
}

const makeWorktreeSetupApplicator = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const runtime = yield* WorktreeSetupRuntime;

  const apply: WorktreeSetupApplicatorShape["apply"] = (input) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const project = readModel.projects.find((entry) => entry.id === input.projectId);
      if (!project) {
        return yield* Effect.fail(new Error(`Project ${input.projectId} was not found.`));
      }
      const analysis = yield* Effect.tryPromise({
        try: () =>
          computeWorktreeSetupAnalysis({
            projectCwd: input.projectCwd,
            profile: project.worktreeSetup ?? null,
          }),
        catch: (cause) =>
          new WorktreeSetupApplyFailure(
            cause instanceof Error ? cause.message : "Failed to scan worktree setup.",
            { cause },
          ),
      });
      if (analysis.scanFingerprint !== input.scanFingerprint) {
        return yield* Effect.fail(
          new Error("The project changed after scanning. Review worktree setup and try again."),
        );
      }
      if (input.devCommand.trim().length === 0) {
        return yield* Effect.fail(new Error("Dev command is required."));
      }
      if (input.envStrategy !== "none" && !input.envSourcePath) {
        return yield* Effect.fail(
          new Error("Choose a valid env source file or switch to no env handling."),
        );
      }
      if (input.portCount < 1) {
        return yield* Effect.fail(new Error("At least one port is required."));
      }

      const now = new Date().toISOString();
      const profile = buildWorktreeSetupProfile({
        scanFingerprint: input.scanFingerprint,
        recommendation: {
          packageManager: analysis.recommendation.packageManager,
          framework: analysis.recommendation.framework,
          installCommand: input.installCommand,
          devCommand: input.devCommand.trim(),
          envStrategy: input.envStrategy,
          envSourcePath: input.envStrategy === "none" ? null : input.envSourcePath,
          portCount: input.portCount,
        },
        autoRunSetupOnWorktreeCreate: input.autoRunSetupOnWorktreeCreate,
        now,
      });

      yield* runtime.materializeProjectHelpers({
        projectId: input.projectId,
        profile,
      });

      yield* orchestrationEngine.dispatch({
        type: "project.meta.update",
        commandId: CommandId.make(`cmd-worktree-setup-${crypto.randomUUID()}`),
        projectId: input.projectId,
        worktreeSetup: profile,
      });

      return {
        profile,
        warnings: analysis.warnings,
      };
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("worktree setup apply failed", {
          projectId: input.projectId,
          detail: cause.message,
        }).pipe(Effect.flatMap(() => Effect.fail(cause))),
      ),
    );

  return {
    apply,
  } satisfies WorktreeSetupApplicatorShape;
});

export const WorktreeSetupApplicatorLive = Layer.effect(
  WorktreeSetupApplicator,
  makeWorktreeSetupApplicator,
);
