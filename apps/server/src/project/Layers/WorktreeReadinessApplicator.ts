import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { CommandId } from "@t3tools/contracts";
import { Effect, Layer } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { AnalyticsService } from "../../telemetry/Services/AnalyticsService.ts";
import {
  buildManagedWorktreeScriptFiles,
  buildManagedScripts,
  computeReadinessAnalysis,
  ensureGitignoreEntry,
  mergeReadinessScripts,
  writeExecutableFile,
  WORKTREE_DEV_SCRIPT_PATH,
  WORKTREE_LOCAL_ENV_PATH,
  WORKTREE_SETUP_SCRIPT_PATH,
} from "./WorktreeReadinessShared.ts";
import {
  buildWorktreeReadinessApplyTelemetryProperties,
  classifyWorktreeReadinessFailure,
} from "./WorktreeReadinessTelemetry.ts";
import {
  WorktreeReadinessApplicator,
  type WorktreeReadinessApplicatorShape,
} from "../Services/WorktreeReadinessApplicator.ts";

const makeWorktreeReadinessApplicator = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const analytics = yield* AnalyticsService;

  const apply: WorktreeReadinessApplicatorShape["apply"] = (input) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const project = readModel.projects.find((entry) => entry.id === input.projectId);
      if (!project) {
        return yield* Effect.fail(new Error(`Project ${input.projectId} was not found.`));
      }

      const analysis = yield* Effect.tryPromise(() =>
        computeReadinessAnalysis({
          projectCwd: input.projectCwd,
          profile: project.worktreeReadiness ?? null,
        }),
      );
      if (analysis.scanFingerprint !== input.scanFingerprint) {
        return yield* Effect.fail(
          new Error("The project changed after scanning. Review worktree readiness and try again."),
        );
      }
      if (input.envStrategy !== "none" && !input.envSourcePath) {
        return yield* Effect.fail(
          new Error("Choose a valid env source file or switch to No env handling."),
        );
      }

      const recommendation = {
        ...analysis.recommendation,
        installCommand: input.installCommand,
        devCommand: input.devCommand,
        envStrategy: input.envStrategy,
        envSourcePath: input.envSourcePath,
        portCount: input.portCount,
      } as const;

      const managedTargets = buildManagedWorktreeScriptFiles({
        installCommand: recommendation.installCommand,
        envStrategy: recommendation.envStrategy,
        envSourcePath: recommendation.envSourcePath,
        framework: recommendation.framework,
        packageManager: recommendation.packageManager,
        devCommand: recommendation.devCommand,
      });

      const writtenFiles: string[] = [];
      for (const [relativePath, nextContent] of managedTargets) {
        const absolutePath = path.join(input.projectCwd, relativePath);
        const existingContent = yield* Effect.tryPromise(async () => {
          try {
            return await fs.readFile(absolutePath, "utf8");
          } catch {
            return null;
          }
        });
        if (
          existingContent !== null &&
          existingContent !== nextContent &&
          !input.overwriteManagedFiles
        ) {
          return yield* Effect.fail(
            new Error(
              `Worktree helper already exists and requires overwrite confirmation: ${relativePath}`,
            ),
          );
        }
        if (existingContent !== nextContent) {
          yield* Effect.tryPromise(() => writeExecutableFile(absolutePath, nextContent));
          writtenFiles.push(relativePath);
        }
      }

      const updatedGitignore = yield* Effect.tryPromise(() =>
        ensureGitignoreEntry(input.projectCwd, WORKTREE_LOCAL_ENV_PATH),
      );

      const nextScripts = mergeReadinessScripts(
        project.scripts,
        buildManagedScripts({ recommendation }),
      );
      const now = new Date().toISOString();
      const profile = {
        version: 1,
        status: "configured",
        scanFingerprint: input.scanFingerprint,
        lastScannedAt: now,
        lastAppliedAt: now,
        packageManager: recommendation.packageManager,
        framework: recommendation.framework,
        installCommand: recommendation.installCommand,
        devCommand: recommendation.devCommand,
        envStrategy: recommendation.envStrategy,
        envSourcePath: recommendation.envSourcePath,
        portCount: recommendation.portCount,
        generatedFiles: [WORKTREE_SETUP_SCRIPT_PATH, WORKTREE_DEV_SCRIPT_PATH],
        setupScriptCommand: WORKTREE_SETUP_SCRIPT_PATH,
        devScriptCommand: WORKTREE_DEV_SCRIPT_PATH,
      } as const;

      yield* orchestrationEngine.dispatch({
        type: "project.meta.update",
        commandId: CommandId.make(`cmd-worktree-readiness-${crypto.randomUUID()}`),
        projectId: input.projectId,
        scripts: nextScripts,
        worktreeReadiness: profile,
      });

      const result = {
        profile,
        scripts: nextScripts,
        writtenFiles,
        updatedGitignore,
      };

      yield* Effect.logInfo("worktree readiness applied", {
        projectId: input.projectId,
        writtenFileCount: writtenFiles.length,
        updatedGitignore,
        envStrategy: profile.envStrategy,
        portCount: profile.portCount,
      });
      yield* analytics.record(
        "project.worktree_readiness.applied",
        buildWorktreeReadinessApplyTelemetryProperties({
          request: input,
          result,
        }),
      );

      return result;
    }).pipe(
      Effect.catch((cause) => {
        const error =
          cause instanceof Error ? cause : new Error("Failed to apply worktree readiness.");
        return Effect.logWarning("worktree readiness apply failed", {
          projectId: input.projectId,
          overwriteManagedFiles: input.overwriteManagedFiles,
          envStrategy: input.envStrategy,
          detail: error.message,
        }).pipe(
          Effect.flatMap(() =>
            analytics.record("project.worktree_readiness.apply_failed", {
              overwriteManagedFiles: input.overwriteManagedFiles,
              envStrategy: input.envStrategy,
              portCount: input.portCount,
              failureKind: classifyWorktreeReadinessFailure(error),
            }),
          ),
          Effect.flatMap(() => Effect.fail(error)),
        );
      }),
    );

  return {
    apply,
  } satisfies WorktreeReadinessApplicatorShape;
});

export const WorktreeReadinessApplicatorLive = Layer.effect(
  WorktreeReadinessApplicator,
  makeWorktreeReadinessApplicator,
);
