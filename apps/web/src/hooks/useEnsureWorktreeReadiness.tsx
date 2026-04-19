import type {
  EnvironmentId,
  ProjectScanWorktreeReadinessResult,
  ProjectWorktreeReadinessEnvStrategy,
  ProjectWorktreeReadinessTrigger,
} from "@t3tools/contracts";
import { useCallback, useRef, useState } from "react";

import { ensureEnvironmentApi } from "../environmentApi";
import type { Project } from "../types";
import { useSettings, useUpdateSettings } from "./useSettings";
import { WorktreeReadinessDialog } from "../components/WorktreeReadinessDialog";
import { toastManager } from "../components/ui/toast";

interface PendingReadinessState {
  readonly project: Project;
  readonly trigger: ProjectWorktreeReadinessTrigger;
  readonly scanResult: ProjectScanWorktreeReadinessResult | null;
  readonly phase: "scanning" | "review" | "applying";
  readonly installCommand: string;
  readonly devCommand: string;
  readonly envStrategy: ProjectWorktreeReadinessEnvStrategy;
  readonly overwriteManagedFiles: boolean;
  readonly errorMessage: string | null;
}

export function useEnsureWorktreeReadiness(environmentId: EnvironmentId) {
  const promptStateByProjectId = useSettings(
    (settings) => settings.worktreeReadinessPromptStateByProjectId,
  );
  const { updateSettings } = useUpdateSettings();
  const [pending, setPending] = useState<PendingReadinessState | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const closePending = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setPending(null);
  }, []);

  const ensureProjectWorktreeReadiness = useCallback(
    async (input: {
      project: Project | null | undefined;
      trigger: ProjectWorktreeReadinessTrigger;
    }): Promise<boolean> => {
      const project = input.project;
      if (!project) {
        return true;
      }
      if (project.worktreeReadiness?.status === "configured") {
        return true;
      }
      if (promptStateByProjectId[project.id] === "disabled") {
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
        overwriteManagedFiles: false,
        errorMessage: null,
      });

      try {
        const scanResult = await api.projects.scanWorktreeReadiness({
          projectId: project.id,
          projectCwd: project.cwd,
          trigger: input.trigger,
        });
        if (!scanResult.promptRequired) {
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
            installCommand: scanResult.recommendation.installCommand ?? "",
            devCommand: scanResult.recommendation.devCommand ?? "",
            envStrategy: scanResult.recommendation.envStrategy,
            overwriteManagedFiles: false,
            errorMessage: null,
          });
        });
      } catch (error) {
        setPending(null);
        toastManager.add({
          type: "error",
          title: "Worktree readiness scan failed",
          description: error instanceof Error ? error.message : "Continue without setup or retry.",
        });
        return true;
      }
    },
    [environmentId, promptStateByProjectId],
  );

  const handleApply = useCallback(async () => {
    if (!pending?.scanResult) {
      return;
    }
    setPending((current) =>
      current ? { ...current, phase: "applying", errorMessage: null } : current,
    );
    try {
      const api = ensureEnvironmentApi(environmentId);
      const result = await api.projects.applyWorktreeReadiness({
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
        overwriteManagedFiles: pending.overwriteManagedFiles,
      });
      result.warnings.forEach((warning) => {
        toastManager.add({
          type: warning.severity === "warning" ? "warning" : "info",
          title: "Worktree readiness warning",
          description: warning.message,
        });
      });
      closePending(true);
    } catch (error) {
      setPending((current) =>
        current
          ? {
              ...current,
              phase: "review",
              errorMessage:
                error instanceof Error ? error.message : "Failed to apply worktree readiness.",
            }
          : current,
      );
    }
  }, [closePending, environmentId, pending]);

  const handleNeverAskAgain = useCallback(() => {
    if (!pending) {
      return;
    }
    updateSettings({
      worktreeReadinessPromptStateByProjectId: {
        ...promptStateByProjectId,
        [pending.project.id]: "disabled",
      },
    });
    closePending(true);
  }, [closePending, pending, promptStateByProjectId, updateSettings]);

  const requiresOverwriteConfirmation =
    (pending?.scanResult?.proposedFiles.some((file) => file.action === "update") ?? false) &&
    !pending?.overwriteManagedFiles;
  const missingEnvSource =
    pending?.envStrategy !== "none" && pending?.scanResult?.recommendation.envSourcePath === null;
  const canApply =
    pending?.phase === "review" &&
    (pending?.devCommand.trim().length ?? 0) > 0 &&
    !requiresOverwriteConfirmation &&
    !missingEnvSource;

  return {
    ensureProjectWorktreeReadiness,
    dialog: (
      <WorktreeReadinessDialog
        open={pending !== null}
        phase={pending?.phase ?? "scanning"}
        scanResult={pending?.scanResult ?? null}
        installCommand={pending?.installCommand ?? ""}
        devCommand={pending?.devCommand ?? ""}
        envStrategy={pending?.envStrategy ?? "none"}
        overwriteManagedFiles={pending?.overwriteManagedFiles ?? false}
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
        onOverwriteManagedFilesChange={(value) =>
          setPending((current) =>
            current ? { ...current, overwriteManagedFiles: value } : current,
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
