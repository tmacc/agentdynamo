import type {
  ProjectApplyWorktreeReadinessInput,
  ProjectApplyWorktreeReadinessResult,
  ProjectScanWorktreeReadinessInput,
  ProjectScanWorktreeReadinessResult,
} from "@t3tools/contracts";

export function classifyWorktreeReadinessFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return "unknown";
  }

  const message = error.message.toLowerCase();
  if (message.includes("not found")) {
    return "project_not_found";
  }
  if (message.includes("changed after scanning")) {
    return "stale_scan";
  }
  if (message.includes("env source")) {
    return "env_source_required";
  }
  if (message.includes("overwrite confirmation")) {
    return "overwrite_confirmation_required";
  }
  if (message.includes("no dev command")) {
    return "missing_dev_command";
  }
  if (message.includes("failed to determine whether") && message.includes("is tracked by git")) {
    return "git_tracking_check_failed";
  }
  if (message.includes("must remain untracked") || message.includes("tracked by git")) {
    return "tracked_local_env_file";
  }
  return "unknown";
}

export function buildWorktreeReadinessScanTelemetryProperties(input: {
  readonly request: ProjectScanWorktreeReadinessInput;
  readonly result: ProjectScanWorktreeReadinessResult;
}): Readonly<Record<string, unknown>> {
  const { request, result } = input;
  return {
    trigger: request.trigger,
    configured: result.configured,
    promptRequired: result.promptRequired,
    hasExistingProfile: result.profile !== undefined,
    detectedProjectType: result.detectedProjectType,
    packageManager: result.recommendation.packageManager,
    framework: result.recommendation.framework,
    envStrategy: result.recommendation.envStrategy,
    portCount: result.recommendation.portCount,
    confidence: result.recommendation.confidence,
    installCommandDetected: result.recommendation.installCommand !== null,
    devCommandDetected: result.recommendation.devCommand !== null,
    hasEnvSourcePath: result.recommendation.envSourcePath !== null,
    warningCount: result.warnings.length,
    proposedScriptCount: result.proposedScripts.length,
    proposedFileCount: result.proposedFiles.length,
  };
}

export function buildWorktreeReadinessApplyTelemetryProperties(input: {
  readonly request: ProjectApplyWorktreeReadinessInput;
  readonly result: ProjectApplyWorktreeReadinessResult;
}): Readonly<Record<string, unknown>> {
  const { request, result } = input;
  return {
    packageManager: result.profile.packageManager,
    framework: result.profile.framework,
    envStrategy: result.profile.envStrategy,
    portCount: result.profile.portCount,
    hasInstallCommand: request.installCommand !== null,
    hasEnvSourcePath: request.envSourcePath !== null,
    overwriteManagedFiles: request.overwriteManagedFiles,
    writtenFileCount: result.writtenFiles.length,
    generatedFileCount: result.profile.generatedFiles.length,
    scriptCount: result.scripts.length,
    updatedGitignore: result.updatedGitignore,
    warningCount: result.warnings.length,
  };
}
