import { Effect, Schema } from "effect";
import {
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
  IsoDateTime,
  ProjectId,
} from "./baseSchemas";
import {
  ProjectScript,
  ProjectWorktreeReadinessEnvStrategy,
  ProjectWorktreeReadinessFramework,
  ProjectWorktreeReadinessPackageManager,
  ProjectWorktreeReadinessProfile,
} from "./orchestration";
import { ServerProviderAuth, ServerProviderModel, ServerProviderState } from "./server";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_INTELLIGENCE_SURFACE_CONTENT_MAX_BYTES = 64 * 1024;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectIntelligenceViewMode = Schema.Literals(["project", "thread"]);
export type ProjectIntelligenceViewMode = typeof ProjectIntelligenceViewMode.Type;

export const ProjectIntelligenceSectionId = Schema.Literals([
  "overview",
  "always-loaded",
  "codex-layer",
  "claude-layer",
  "memory",
  "code-stats",
  "warnings",
]);
export type ProjectIntelligenceSectionId = typeof ProjectIntelligenceSectionId.Type;

export const ProjectIntelligenceSurfaceId = TrimmedNonEmptyString.pipe(
  Schema.brand("ProjectIntelligenceSurfaceId"),
);
export type ProjectIntelligenceSurfaceId = typeof ProjectIntelligenceSurfaceId.Type;

export const ProjectIntelligenceSurfaceKind = Schema.Literals([
  "instruction",
  "agent",
  "command",
  "skill",
  "slash-command",
  "hook",
  "settings",
  "plugin",
  "memory",
]);
export type ProjectIntelligenceSurfaceKind = typeof ProjectIntelligenceSurfaceKind.Type;

export const ProjectIntelligenceActivation = Schema.Literals([
  "always-loaded",
  "on-agent-invoke",
  "on-command",
  "on-skill-match",
  "on-event",
  "runtime-config",
  "separate-memory",
]);
export type ProjectIntelligenceActivation = typeof ProjectIntelligenceActivation.Type;

export const ProjectIntelligenceOwner = Schema.Literals(["shared", "codex", "claude"]);
export type ProjectIntelligenceOwner = typeof ProjectIntelligenceOwner.Type;

export const ProjectIntelligenceScope = Schema.Literals([
  "effective-project",
  "base-project",
  "user",
  "system",
]);
export type ProjectIntelligenceScope = typeof ProjectIntelligenceScope.Type;

export const ProjectIntelligenceFrontmatter = Schema.Record(Schema.String, Schema.String).pipe(
  Schema.withDecodingDefault(Effect.succeed({})),
);
export type ProjectIntelligenceFrontmatter = typeof ProjectIntelligenceFrontmatter.Type;

export const ProjectIntelligenceCodeStats = Schema.Struct({
  basis: TrimmedNonEmptyString,
  fileCount: NonNegativeInt,
  loc: NonNegativeInt,
  approxTokenCount: NonNegativeInt,
  partial: Schema.Boolean,
});
export type ProjectIntelligenceCodeStats = typeof ProjectIntelligenceCodeStats.Type;

export const ProjectIntelligencePermissionsSummary = Schema.Struct({
  defaultMode: TrimmedNonEmptyString,
  allowCount: NonNegativeInt,
  askCount: NonNegativeInt,
  denyCount: NonNegativeInt,
});
export type ProjectIntelligencePermissionsSummary =
  typeof ProjectIntelligencePermissionsSummary.Type;

export const ProjectIntelligenceHookConfigSummary = Schema.Struct({
  event: TrimmedNonEmptyString,
  matcher: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  actionSummary: TrimmedNonEmptyString,
});
export type ProjectIntelligenceHookConfigSummary = typeof ProjectIntelligenceHookConfigSummary.Type;

export const ProjectIntelligenceSettingsSummary = Schema.Struct({
  permissionsMode: Schema.optional(TrimmedNonEmptyString),
  allowCount: NonNegativeInt,
  askCount: NonNegativeInt,
  denyCount: NonNegativeInt,
  enabledPluginIds: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  featureFlags: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type ProjectIntelligenceSettingsSummary = typeof ProjectIntelligenceSettingsSummary.Type;

export const ProjectIntelligenceSurfaceSummary = Schema.Struct({
  id: ProjectIntelligenceSurfaceId,
  owner: ProjectIntelligenceOwner,
  kind: ProjectIntelligenceSurfaceKind,
  label: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  openPath: Schema.optional(TrimmedNonEmptyString),
  aliases: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  scope: ProjectIntelligenceScope,
  activation: ProjectIntelligenceActivation,
  enabled: Schema.Boolean,
  description: Schema.optional(TrimmedNonEmptyString),
  triggerLabel: Schema.optional(TrimmedNonEmptyString),
  sourceLabel: Schema.optional(TrimmedNonEmptyString),
  promptExcerpt: Schema.optional(Schema.String),
  lineCount: NonNegativeInt,
  approxTokenCount: NonNegativeInt,
  frontmatter: ProjectIntelligenceFrontmatter,
  derivedFrom: Schema.optional(ProjectIntelligenceSurfaceId),
  hookConfig: Schema.optional(ProjectIntelligenceHookConfigSummary),
  settingsSummary: Schema.optional(ProjectIntelligenceSettingsSummary),
});
export type ProjectIntelligenceSurfaceSummary = typeof ProjectIntelligenceSurfaceSummary.Type;

export const ProjectIntelligenceProviderRuntimeSummary = Schema.Struct({
  provider: Schema.Literals(["codex", "claudeAgent"]),
  status: ServerProviderState,
  auth: ServerProviderAuth,
  models: Schema.Array(ServerProviderModel),
  discoveredSkillCount: NonNegativeInt,
  discoveredSlashCommandCount: NonNegativeInt,
  permissionsSummary: Schema.optional(ProjectIntelligencePermissionsSummary),
  enabledPluginIds: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  featureFlags: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type ProjectIntelligenceProviderRuntimeSummary =
  typeof ProjectIntelligenceProviderRuntimeSummary.Type;

export const ProjectIntelligenceWarning = Schema.Struct({
  id: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  severity: Schema.Literals(["info", "warning"]),
  surfaceId: Schema.optional(ProjectIntelligenceSurfaceId),
  path: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectIntelligenceWarning = typeof ProjectIntelligenceWarning.Type;

export const ProjectIntelligenceScopeSummary = Schema.Struct({
  kind: ProjectIntelligenceScope,
  cwd: TrimmedNonEmptyString,
  surfaceIds: Schema.Array(ProjectIntelligenceSurfaceId).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  codeStats: Schema.optional(ProjectIntelligenceCodeStats),
});
export type ProjectIntelligenceScopeSummary = typeof ProjectIntelligenceScopeSummary.Type;

export const ProjectGetIntelligenceInput = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  effectiveCwd: Schema.optional(TrimmedNonEmptyString),
  viewMode: ProjectIntelligenceViewMode,
});
export type ProjectGetIntelligenceInput = typeof ProjectGetIntelligenceInput.Type;

export const ProjectGetIntelligenceResult = Schema.Struct({
  resolvedAt: IsoDateTime,
  viewMode: ProjectIntelligenceViewMode,
  projectCwd: TrimmedNonEmptyString,
  effectiveCwd: Schema.optional(TrimmedNonEmptyString),
  surfaces: Schema.Array(ProjectIntelligenceSurfaceSummary),
  scopeSummaries: Schema.Array(ProjectIntelligenceScopeSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  providerRuntime: Schema.Array(ProjectIntelligenceProviderRuntimeSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  warnings: Schema.Array(ProjectIntelligenceWarning).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type ProjectGetIntelligenceResult = typeof ProjectGetIntelligenceResult.Type;

export class ProjectGetIntelligenceError extends Schema.TaggedErrorClass<ProjectGetIntelligenceError>()(
  "ProjectGetIntelligenceError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectReadIntelligenceSurfaceInput = Schema.Struct({
  surfaceId: ProjectIntelligenceSurfaceId,
});
export type ProjectReadIntelligenceSurfaceInput = typeof ProjectReadIntelligenceSurfaceInput.Type;

export const ProjectIntelligenceContentType = Schema.Literals(["markdown", "text", "json"]);
export type ProjectIntelligenceContentType = typeof ProjectIntelligenceContentType.Type;

export const ProjectReadIntelligenceSurfaceResult = Schema.Struct({
  surfaceId: ProjectIntelligenceSurfaceId,
  contentType: ProjectIntelligenceContentType,
  content: Schema.String,
  truncated: Schema.Boolean,
  maxBytes: NonNegativeInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(PROJECT_INTELLIGENCE_SURFACE_CONTENT_MAX_BYTES)),
  ),
  warning: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectReadIntelligenceSurfaceResult = typeof ProjectReadIntelligenceSurfaceResult.Type;

export class ProjectReadIntelligenceSurfaceError extends Schema.TaggedErrorClass<ProjectReadIntelligenceSurfaceError>()(
  "ProjectReadIntelligenceSurfaceError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWorktreeReadinessTrigger = Schema.Literals([
  "thread_worktree",
  "pull_request_worktree",
  "team_worktree",
]);
export type ProjectWorktreeReadinessTrigger = typeof ProjectWorktreeReadinessTrigger.Type;

export const ProjectWorktreeReadinessWarning = Schema.Struct({
  id: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  severity: Schema.Literals(["info", "warning"]),
});
export type ProjectWorktreeReadinessWarning = typeof ProjectWorktreeReadinessWarning.Type;

export const ProjectWorktreeReadinessProposedScript = Schema.Struct({
  kind: Schema.Literals(["setup", "dev"]),
  label: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
});
export type ProjectWorktreeReadinessProposedScript =
  typeof ProjectWorktreeReadinessProposedScript.Type;

export const ProjectWorktreeReadinessProposedFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  managed: Schema.Boolean,
  contentPreview: Schema.String,
  action: Schema.Literals(["create", "update", "preserve"]),
});
export type ProjectWorktreeReadinessProposedFile = typeof ProjectWorktreeReadinessProposedFile.Type;

export const ProjectWorktreeReadinessRecommendation = Schema.Struct({
  packageManager: ProjectWorktreeReadinessPackageManager,
  framework: ProjectWorktreeReadinessFramework,
  installCommand: Schema.NullOr(TrimmedNonEmptyString),
  devCommand: Schema.NullOr(TrimmedNonEmptyString),
  envStrategy: ProjectWorktreeReadinessEnvStrategy,
  envSourcePath: Schema.NullOr(TrimmedNonEmptyString),
  portCount: NonNegativeInt,
  confidence: Schema.Literals(["high", "medium", "low"]),
});
export type ProjectWorktreeReadinessRecommendation =
  typeof ProjectWorktreeReadinessRecommendation.Type;

export const ProjectScanWorktreeReadinessInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  projectCwd: TrimmedNonEmptyString,
  trigger: ProjectWorktreeReadinessTrigger,
  effectiveBaseBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type ProjectScanWorktreeReadinessInput = typeof ProjectScanWorktreeReadinessInput.Type;

export const ProjectScanWorktreeReadinessResult = Schema.Struct({
  configured: Schema.Boolean,
  promptRequired: Schema.Boolean,
  profile: Schema.optional(ProjectWorktreeReadinessProfile),
  scanFingerprint: TrimmedNonEmptyString,
  detectedProjectType: TrimmedNonEmptyString,
  recommendation: ProjectWorktreeReadinessRecommendation,
  warnings: Schema.Array(ProjectWorktreeReadinessWarning).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  proposedScripts: Schema.Array(ProjectWorktreeReadinessProposedScript).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  proposedFiles: Schema.Array(ProjectWorktreeReadinessProposedFile).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type ProjectScanWorktreeReadinessResult = typeof ProjectScanWorktreeReadinessResult.Type;

export class ProjectScanWorktreeReadinessError extends Schema.TaggedErrorClass<ProjectScanWorktreeReadinessError>()(
  "ProjectScanWorktreeReadinessError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectApplyWorktreeReadinessInput = Schema.Struct({
  projectId: ProjectId,
  projectCwd: TrimmedNonEmptyString,
  scanFingerprint: TrimmedNonEmptyString,
  installCommand: Schema.NullOr(TrimmedNonEmptyString),
  devCommand: TrimmedNonEmptyString,
  envStrategy: ProjectWorktreeReadinessEnvStrategy,
  envSourcePath: Schema.NullOr(TrimmedNonEmptyString),
  portCount: NonNegativeInt,
  overwriteManagedFiles: Schema.Boolean,
});
export type ProjectApplyWorktreeReadinessInput = typeof ProjectApplyWorktreeReadinessInput.Type;

export const ProjectApplyWorktreeReadinessResult = Schema.Struct({
  profile: ProjectWorktreeReadinessProfile,
  scripts: Schema.Array(ProjectScript),
  writtenFiles: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  updatedGitignore: Schema.Boolean,
  warnings: Schema.Array(ProjectWorktreeReadinessWarning).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type ProjectApplyWorktreeReadinessResult = typeof ProjectApplyWorktreeReadinessResult.Type;

export class ProjectApplyWorktreeReadinessError extends Schema.TaggedErrorClass<ProjectApplyWorktreeReadinessError>()(
  "ProjectApplyWorktreeReadinessError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
