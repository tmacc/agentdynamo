import type {
  EnvironmentId,
  ProjectScanWorktreeSetupResult,
  ProjectWorktreeSetupEnvStrategy,
  ProjectWorktreeSetupTrigger,
} from "@t3tools/contracts";
import { useCallback, useRef, useState } from "react";

import { WorktreeSetupDialog } from "../components/WorktreeSetupDialog";
import { ensureEnvironmentApi } from "../environmentApi";
import type { Project } from "../types";
import { useSettings, useUpdateSettings } from "./useSettings";
import { toastManager } from "../components/ui/toast";

interface PendingSetupState {
  readonly project: Project;
  readonly trigger: ProjectWorktreeSetupTrigger;
  readonly scanResult: ProjectScanWorktreeSetupResult | null;
  readonly phase: "scanning" | "review" | "applying";
  readonly installCommand: string;
  readonly devCommand: string;
  readonly envStrategy: ProjectWorktreeSetupEnvStrategy;
  readonly autoRunSetupOnWorktreeCreate: boolean;
  readonly errorMessage: string | null;
}

export function useEnsureWorktreeSetup(environmentId: EnvironmentId) {
  const promptStateByProjectId = useSettings(
    (settings) => settings.worktreeSetupPromptStateByProjectId,
  );
  const { updateSettings } = useUpdateSettings();
  const [pending, setPending] = useState<PendingSetupState | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const closePending = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setPending(null);
  }, []);

  const ensureProjectWorktreeSetup = useCallback(
    async (input: {
      project: Project | null | undefined;
      trigger: ProjectWorktreeSetupTrigger;
    }): Promise<boolean> => {
      const project = input.project;
      if (!project) return true;
      if (
        project.worktreeSetup?.status === "configured" &&
        promptStateByProjectId[project.id] === "disabled"
      ) {
        return true;
      }
      if (!project.worktreeSetup && promptStateByProjectId[project.id] === "disabled") {
        return true;
      }

      const api = ensureEnvironmentApi(environmentId);
      setPending({
        project,
        trigger: input.trigger,
        scanResult: null,
        phase: "scanning",
        installCommand: "",
        devCommand: "",
        envStrategy: "none",
        autoRunSetupOnWorktreeCreate: true,
        errorMessage: null,
      });

      try {
        const scanResult = await api.projects.scanWorktreeSetup({
          projectId: project.id,
          projectCwd: project.cwd,
          trigger: input.trigger,
        });
        if (!scanResult.promptRequired && input.trigger !== "manual") {
          setPending(null);
          return true;
        }
        return await new Promise<boolean>((resolve) => {
          resolverRef.current = resolve;
          setPending({
            project,
            trigger: input.trigger,
            scanResult,
            phase: "review",
            installCommand:
              scanResult.profile?.installCommand ?? scanResult.recommendation.installCommand ?? "",
            devCommand:
              scanResult.profile?.devCommand ?? scanResult.recommendation.devCommand ?? "",
            envStrategy: scanResult.profile?.envStrategy ?? scanResult.recommendation.envStrategy,
            autoRunSetupOnWorktreeCreate: scanResult.profile?.autoRunSetupOnWorktreeCreate ?? true,
            errorMessage: null,
          });
        });
      } catch (error) {
        setPending(null);
        toastManager.add({
          type: "error",
          title: "Worktree setup scan failed",
          description: error instanceof Error ? error.message : "Continue without setup or retry.",
        });
        return true;
      }
    },
    [environmentId, promptStateByProjectId],
  );

  const handleApply = useCallback(async () => {
    if (!pending?.scanResult) return;
    setPending((current) =>
      current ? { ...current, phase: "applying", errorMessage: null } : current,
    );
    try {
      const api = ensureEnvironmentApi(environmentId);
      const result = await api.projects.applyWorktreeSetup({
        projectId: pending.project.id,
        projectCwd: pending.project.cwd,
        scanFingerprint: pending.scanResult.scanFingerprint,
        installCommand:
          pending.installCommand.trim().length > 0 ? pending.installCommand.trim() : null,
        devCommand: pending.devCommand.trim(),
        envStrategy: pending.envStrategy,
        envSourcePath:
          pending.envStrategy === "none"
            ? null
            : (pending.scanResult.recommendation.envSourcePath ?? null),
        portCount: pending.scanResult.recommendation.portCount,
        autoRunSetupOnWorktreeCreate: pending.autoRunSetupOnWorktreeCreate,
      });
      for (const warning of result.warnings) {
        toastManager.add({
          type: warning.severity === "warning" ? "warning" : "info",
          title: "Worktree setup warning",
          description: warning.message,
        });
      }
      closePending(true);
    } catch (error) {
      setPending((current) =>
        current
          ? {
              ...current,
              phase: "review",
              errorMessage: error instanceof Error ? error.message : "Failed to apply setup.",
            }
          : current,
      );
    }
  }, [closePending, environmentId, pending]);

  const handleNeverAskAgain = useCallback(() => {
    if (!pending) return;
    updateSettings({
      worktreeSetupPromptStateByProjectId: {
        ...promptStateByProjectId,
        [pending.project.id]: "disabled",
      },
    });
    closePending(true);
  }, [closePending, pending, promptStateByProjectId, updateSettings]);

  const missingEnvSource =
    pending?.envStrategy !== "none" && pending?.scanResult?.recommendation.envSourcePath === null;
  const canApply =
    pending?.phase === "review" && pending.devCommand.trim().length > 0 && !missingEnvSource;

  return {
    ensureProjectWorktreeSetup,
    dialog: (
      <WorktreeSetupDialog
        open={pending !== null}
        phase={pending?.phase ?? "scanning"}
        scanResult={pending?.scanResult ?? null}
        installCommand={pending?.installCommand ?? ""}
        devCommand={pending?.devCommand ?? ""}
        envStrategy={pending?.envStrategy ?? "none"}
        autoRunSetupOnWorktreeCreate={pending?.autoRunSetupOnWorktreeCreate ?? true}
        errorMessage={pending?.errorMessage ?? null}
        canApply={Boolean(canApply)}
        onInstallCommandChange={(value) =>
          setPending((current) => (current ? { ...current, installCommand: value } : current))
        }
        onDevCommandChange={(value) =>
          setPending((current) => (current ? { ...current, devCommand: value } : current))
        }
        onEnvStrategyChange={(value) =>
          setPending((current) => (current ? { ...current, envStrategy: value } : current))
        }
        onAutoRunSetupOnWorktreeCreateChange={(value) =>
          setPending((current) =>
            current ? { ...current, autoRunSetupOnWorktreeCreate: value } : current,
          )
        }
        onApply={() => {
          void handleApply();
        }}
        onSkipOnce={() => closePending(true)}
        onNeverAskAgain={handleNeverAskAgain}
      />
    ),
  };
}
