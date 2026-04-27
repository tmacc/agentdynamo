import { Effect, Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  ProviderKind,
  ProjectWorktreeSetupEnvStrategy,
  ProjectWorktreeSetupFramework,
  ProjectWorktreeSetupPackageManager,
  ProjectWorktreeSetupProfile,
  ProjectWorktreeSetupStorageMode,
} from "./orchestration.ts";
import { ServerProviderAuth, ServerProviderState } from "./server.ts";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_FILE_PATH_MAX_LENGTH = 2_048;

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

export const ProjectFilePreviewKind = Schema.Literals([
  "markdown",
  "code",
  "text",
  "image",
  "svg",
  "pdf",
  "audio",
  "video",
  "unsupported",
]);
export type ProjectFilePreviewKind = typeof ProjectFilePreviewKind.Type;

export const ProjectFileEntryKind = Schema.Literals(["file", "directory"]);
export type ProjectFileEntryKind = typeof ProjectFileEntryKind.Type;

export const ProjectFileEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_FILE_PATH_MAX_LENGTH)),
  kind: ProjectFileEntryKind,
  openPath: TrimmedNonEmptyString,
  sizeBytes: Schema.optional(NonNegativeInt),
  modifiedAt: Schema.optional(IsoDateTime),
  mimeType: Schema.optional(TrimmedNonEmptyString),
  previewKind: Schema.optional(ProjectFilePreviewKind),
});
export type ProjectFileEntry = typeof ProjectFileEntry.Type;

export const ProjectListDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: Schema.optional(
    Schema.String.check(Schema.isMaxLength(PROJECT_FILE_PATH_MAX_LENGTH)),
  ),
});
export type ProjectListDirectoryInput = typeof ProjectListDirectoryInput.Type;

export const ProjectListDirectoryResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: Schema.String,
  entries: Schema.Array(ProjectFileEntry),
  truncated: Schema.Boolean,
});
export type ProjectListDirectoryResult = typeof ProjectListDirectoryResult.Type;

export class ProjectListDirectoryError extends Schema.TaggedErrorClass<ProjectListDirectoryError>()(
  "ProjectListDirectoryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_FILE_PATH_MAX_LENGTH)),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
  openPath: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  sizeBytes: NonNegativeInt,
  modifiedAt: Schema.optional(IsoDateTime),
  mimeType: TrimmedNonEmptyString,
  previewKind: ProjectFilePreviewKind,
  content: Schema.String,
  truncated: Schema.Boolean,
  maxBytes: NonNegativeInt,
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export class ProjectReadFileError extends Schema.TaggedErrorClass<ProjectReadFileError>()(
  "ProjectReadFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectCreateFilePreviewUrlInput = ProjectReadFileInput;
export type ProjectCreateFilePreviewUrlInput = typeof ProjectCreateFilePreviewUrlInput.Type;

export const ProjectCreateFilePreviewUrlResult = Schema.Struct({
  url: TrimmedNonEmptyString,
  expiresAt: IsoDateTime,
  mimeType: TrimmedNonEmptyString,
  previewKind: ProjectFilePreviewKind,
});
export type ProjectCreateFilePreviewUrlResult = typeof ProjectCreateFilePreviewUrlResult.Type;

export class ProjectCreateFilePreviewUrlError extends Schema.TaggedErrorClass<ProjectCreateFilePreviewUrlError>()(
  "ProjectCreateFilePreviewUrlError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWorktreeSetupTrigger = Schema.Literals([
  "thread_worktree",
  "pull_request_worktree",
  "fork_worktree",
  "team_worktree",
  "manual",
]);
export type ProjectWorktreeSetupTrigger = typeof ProjectWorktreeSetupTrigger.Type;

export const ProjectWorktreeSetupWarning = Schema.Struct({
  id: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  severity: Schema.Literals(["info", "warning"]),
});
export type ProjectWorktreeSetupWarning = typeof ProjectWorktreeSetupWarning.Type;

export const ProjectWorktreeSetupRecommendation = Schema.Struct({
  packageManager: ProjectWorktreeSetupPackageManager,
  framework: ProjectWorktreeSetupFramework,
  installCommand: Schema.NullOr(TrimmedNonEmptyString),
  devCommand: Schema.NullOr(TrimmedNonEmptyString),
  envStrategy: ProjectWorktreeSetupEnvStrategy,
  envSourcePath: Schema.NullOr(TrimmedNonEmptyString),
  portCount: NonNegativeInt,
  confidence: Schema.Literals(["high", "medium", "low"]),
});
export type ProjectWorktreeSetupRecommendation = typeof ProjectWorktreeSetupRecommendation.Type;

export const ProjectScanWorktreeSetupInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  projectCwd: TrimmedNonEmptyString,
  trigger: ProjectWorktreeSetupTrigger,
  effectiveBaseBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type ProjectScanWorktreeSetupInput = typeof ProjectScanWorktreeSetupInput.Type;

export const ProjectScanWorktreeSetupResult = Schema.Struct({
  configured: Schema.Boolean,
  promptRequired: Schema.Boolean,
  profile: Schema.optional(ProjectWorktreeSetupProfile),
  scanFingerprint: TrimmedNonEmptyString,
  detectedProjectType: TrimmedNonEmptyString,
  recommendation: ProjectWorktreeSetupRecommendation,
  warnings: Schema.Array(ProjectWorktreeSetupWarning).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  runtimeHelperPreview: Schema.Struct({
    storageMode: ProjectWorktreeSetupStorageMode,
    setupDescription: TrimmedNonEmptyString,
    devDescription: TrimmedNonEmptyString,
  }),
});
export type ProjectScanWorktreeSetupResult = typeof ProjectScanWorktreeSetupResult.Type;

export class ProjectScanWorktreeSetupError extends Schema.TaggedErrorClass<ProjectScanWorktreeSetupError>()(
  "ProjectScanWorktreeSetupError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectApplyWorktreeSetupInput = Schema.Struct({
  projectId: ProjectId,
  projectCwd: TrimmedNonEmptyString,
  scanFingerprint: TrimmedNonEmptyString,
  installCommand: Schema.NullOr(TrimmedNonEmptyString),
  devCommand: TrimmedNonEmptyString,
  envStrategy: ProjectWorktreeSetupEnvStrategy,
  envSourcePath: Schema.NullOr(TrimmedNonEmptyString),
  portCount: NonNegativeInt,
  autoRunSetupOnWorktreeCreate: Schema.Boolean,
});
export type ProjectApplyWorktreeSetupInput = typeof ProjectApplyWorktreeSetupInput.Type;

export const ProjectApplyWorktreeSetupResult = Schema.Struct({
  profile: ProjectWorktreeSetupProfile,
  warnings: Schema.Array(ProjectWorktreeSetupWarning).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type ProjectApplyWorktreeSetupResult = typeof ProjectApplyWorktreeSetupResult.Type;

export class ProjectApplyWorktreeSetupError extends Schema.TaggedErrorClass<ProjectApplyWorktreeSetupError>()(
  "ProjectApplyWorktreeSetupError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectIntelligenceViewMode = Schema.Literals(["project", "thread"]);
export type ProjectIntelligenceViewMode = typeof ProjectIntelligenceViewMode.Type;

export const ProjectIntelligenceSectionId = Schema.Literals([
  "overview",
  "loaded-context",
  "tools",
  "providers",
  "memory",
  "runtime",
  "code-stats",
  "warnings",
]);
export type ProjectIntelligenceSectionId = typeof ProjectIntelligenceSectionId.Type;

export const ProjectIntelligenceSurfaceKind = Schema.Literals([
  "instruction",
  "skill",
  "slash-command",
  "custom-agent",
  "hook",
  "mcp-server",
  "memory",
  "plugin",
  "settings",
  "project-script",
  "worktree-setup",
  "model",
  "team-capability",
  "runtime-config",
]);
export type ProjectIntelligenceSurfaceKind = typeof ProjectIntelligenceSurfaceKind.Type;

export const ProjectIntelligenceActivation = Schema.Literals([
  "always-loaded",
  "on-command",
  "on-skill-match",
  "on-agent-invoke",
  "on-hook-event",
  "on-mcp-tool",
  "manual",
  "runtime-config",
  "separate-memory",
]);
export type ProjectIntelligenceActivation = typeof ProjectIntelligenceActivation.Type;

export const ProjectIntelligenceScope = Schema.Literals([
  "thread-workspace",
  "project",
  "user",
  "system",
  "provider-runtime",
]);
export type ProjectIntelligenceScope = typeof ProjectIntelligenceScope.Type;

export const ProjectIntelligenceOwner = Schema.Union([
  ProviderKind,
  Schema.Literals(["shared", "dynamo"]),
]);
export type ProjectIntelligenceOwner = typeof ProjectIntelligenceOwner.Type;

export const ProjectIntelligenceHealth = Schema.Literals(["ok", "info", "warning", "error"]);
export type ProjectIntelligenceHealth = typeof ProjectIntelligenceHealth.Type;

export const ProjectIntelligenceSurfaceId = TrimmedNonEmptyString.pipe(
  Schema.brand("ProjectIntelligenceSurfaceId"),
);
export type ProjectIntelligenceSurfaceId = typeof ProjectIntelligenceSurfaceId.Type;

export const ProjectIntelligenceMetadataEntry = Schema.Struct({
  label: TrimmedNonEmptyString,
  value: TrimmedNonEmptyString,
});
export type ProjectIntelligenceMetadataEntry = typeof ProjectIntelligenceMetadataEntry.Type;

export const ProjectIntelligenceSurfaceSummary = Schema.Struct({
  id: ProjectIntelligenceSurfaceId,
  owner: ProjectIntelligenceOwner,
  provider: Schema.optional(ProviderKind),
  kind: ProjectIntelligenceSurfaceKind,
  label: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  openPath: Schema.optional(TrimmedNonEmptyString),
  scope: ProjectIntelligenceScope,
  activation: ProjectIntelligenceActivation,
  enabled: Schema.Boolean,
  health: ProjectIntelligenceHealth,
  description: Schema.optional(TrimmedNonEmptyString),
  triggerLabel: Schema.optional(TrimmedNonEmptyString),
  sourceLabel: Schema.optional(TrimmedNonEmptyString),
  excerpt: Schema.optional(Schema.String),
  lineCount: Schema.optional(NonNegativeInt),
  approxTokenCount: Schema.optional(NonNegativeInt),
  metadata: Schema.Array(ProjectIntelligenceMetadataEntry).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  derivedFrom: Schema.optional(ProjectIntelligenceSurfaceId),
});
export type ProjectIntelligenceSurfaceSummary = typeof ProjectIntelligenceSurfaceSummary.Type;

export const ProjectIntelligenceProviderSummary = Schema.Struct({
  provider: ProviderKind,
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  status: ServerProviderState,
  auth: ServerProviderAuth,
  version: Schema.NullOr(TrimmedNonEmptyString),
  message: Schema.optional(TrimmedNonEmptyString),
  modelCount: NonNegativeInt,
  skillCount: NonNegativeInt,
  slashCommandCount: NonNegativeInt,
  supportsCoordinatorTools: Schema.Boolean,
  supportsWorker: Schema.Boolean,
  health: ProjectIntelligenceHealth,
});
export type ProjectIntelligenceProviderSummary = typeof ProjectIntelligenceProviderSummary.Type;

export const ProjectIntelligenceWarning = Schema.Struct({
  id: TrimmedNonEmptyString,
  severity: Schema.Literals(["info", "warning", "error"]),
  message: TrimmedNonEmptyString,
  surfaceId: Schema.optional(ProjectIntelligenceSurfaceId),
  provider: Schema.optional(ProviderKind),
  path: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectIntelligenceWarning = typeof ProjectIntelligenceWarning.Type;

export const ProjectIntelligenceCodeStats = Schema.Struct({
  basis: TrimmedNonEmptyString,
  fileCount: NonNegativeInt,
  loc: NonNegativeInt,
  approxTokenCount: NonNegativeInt,
  partial: Schema.Boolean,
});
export type ProjectIntelligenceCodeStats = typeof ProjectIntelligenceCodeStats.Type;

export const ProjectGetIntelligenceInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  projectCwd: TrimmedNonEmptyString,
  effectiveCwd: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  viewMode: ProjectIntelligenceViewMode,
  refresh: Schema.optional(Schema.Boolean),
});
export type ProjectGetIntelligenceInput = typeof ProjectGetIntelligenceInput.Type;

export const ProjectGetIntelligenceResult = Schema.Struct({
  resolvedAt: IsoDateTime,
  viewMode: ProjectIntelligenceViewMode,
  projectCwd: TrimmedNonEmptyString,
  effectiveCwd: Schema.optional(TrimmedNonEmptyString),
  surfaces: Schema.Array(ProjectIntelligenceSurfaceSummary),
  providers: Schema.Array(ProjectIntelligenceProviderSummary),
  codeStats: Schema.optional(ProjectIntelligenceCodeStats),
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
  projectCwd: TrimmedNonEmptyString,
  effectiveCwd: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  viewMode: ProjectIntelligenceViewMode,
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
  maxBytes: NonNegativeInt,
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
