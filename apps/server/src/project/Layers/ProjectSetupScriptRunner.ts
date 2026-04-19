import { projectScriptRuntimeEnv, setupProjectScript } from "@t3tools/shared/projectScripts";
import { Effect, Layer } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import { materializeManagedWorktreeScripts } from "./WorktreeReadinessShared.ts";
import { WorktreeRuntimeEnvProvisionerLive } from "./WorktreeRuntimeEnvProvisioner.ts";
import { WorktreeRuntimeEnvProvisioner } from "../Services/WorktreeRuntimeEnvProvisioner.ts";
import {
  type ProjectSetupScriptRunnerShape,
  ProjectSetupScriptRunner,
} from "../Services/ProjectSetupScriptRunner.ts";

const makeProjectSetupScriptRunner = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const terminalManager = yield* TerminalManager;
  const worktreeRuntimeEnvProvisioner = yield* WorktreeRuntimeEnvProvisioner;

  const runForThread: ProjectSetupScriptRunnerShape["runForThread"] = (input) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const project =
        (input.projectId
          ? readModel.projects.find((entry) => entry.id === input.projectId)
          : null) ??
        (input.projectCwd
          ? readModel.projects.find((entry) => entry.workspaceRoot === input.projectCwd)
          : null) ??
        null;

      if (!project) {
        return yield* Effect.fail(new Error("Project was not found for setup script execution."));
      }

      const readinessProfile =
        project.worktreeReadiness?.status === "configured" ? project.worktreeReadiness : null;

      if (readinessProfile) {
        yield* worktreeRuntimeEnvProvisioner.ensureEnvFile({
          projectCwd: project.workspaceRoot,
          worktreePath: input.worktreePath,
          portCount: readinessProfile.portCount,
        });
        yield* Effect.promise(() =>
          materializeManagedWorktreeScripts({
            rootPath: input.worktreePath,
            installCommand: readinessProfile.installCommand,
            envStrategy: readinessProfile.envStrategy,
            envSourcePath: readinessProfile.envSourcePath,
            framework: readinessProfile.framework,
            packageManager: readinessProfile.packageManager,
            devCommand: readinessProfile.devCommand,
            policy: {
              mode: "bootstrap_safe",
            },
          }),
        );
      }

      const script = setupProjectScript(project.scripts);
      if (!script) {
        return {
          status: "no-script",
        } as const;
      }

      const terminalId = input.preferredTerminalId ?? `setup-${script.id}`;
      const cwd = input.worktreePath;
      const env = projectScriptRuntimeEnv({
        project: { cwd: project.workspaceRoot },
        worktreePath: input.worktreePath,
      });

      yield* terminalManager.open({
        threadId: input.threadId,
        terminalId,
        cwd,
        worktreePath: input.worktreePath,
        env,
      });
      yield* terminalManager.write({
        threadId: input.threadId,
        terminalId,
        data: `${script.command}\r`,
      });

      return {
        status: "started",
        scriptId: script.id,
        scriptName: script.name,
        terminalId,
        cwd,
      } as const;
    });

  return {
    runForThread,
  } satisfies ProjectSetupScriptRunnerShape;
});

export const ProjectSetupScriptRunnerLive = Layer.effect(
  ProjectSetupScriptRunner,
  makeProjectSetupScriptRunner,
).pipe(Layer.provideMerge(WorktreeRuntimeEnvProvisionerLive));
