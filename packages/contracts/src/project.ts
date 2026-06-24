import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
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
const PROJECT_READ_FILE_PATH_MAX_LENGTH = 512;

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
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export const ProjectListEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ProjectListEntriesInput = typeof ProjectListEntriesInput.Type;

export const ProjectListEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectListEntriesResult = typeof ProjectListEntriesResult.Type;

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
    cause: Schema.optional(Schema.Defect()),
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
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const ProjectIntelligenceViewMode = Schema.Literals(["project", "thread"]);
export type ProjectIntelligenceViewMode = typeof ProjectIntelligenceViewMode.Type;

export const ProjectIntelligenceSectionId = Schema.Literals([
  "context-inspector",
  "providers",
  "code-stats",
  "runtime",
  "warnings",
]);
export type ProjectIntelligenceSectionId = typeof ProjectIntelligenceSectionId.Type;

export const ProjectIntelligenceSurfaceKind = Schema.Literals([
  "instruction",
  "model",
  "skill",
  "slash-command",
  "agent",
  "custom-agent",
  "hook",
  "mcp-server",
  "plugin",
  "tool",
  "setting",
  "settings",
  "memory",
  "env",
  "file",
  "provider",
  "project-script",
  "runtime-config",
  "team-capability",
  "worktree-setup",
]);
export type ProjectIntelligenceSurfaceKind = typeof ProjectIntelligenceSurfaceKind.Type;

export const ProjectIntelligenceActivation = Schema.Literals([
  "always-loaded",
  "on-command",
  "on-skill-match",
  "on-agent-invoke",
  "on-hook-event",
  "on-mcp-tool",
  "available",
  "disabled",
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
  "global",
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
  sourceLabel: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(TrimmedNonEmptyString),
  triggerLabel: Schema.optional(TrimmedNonEmptyString),
  command: Schema.optional(TrimmedNonEmptyString),
  excerpt: Schema.optional(Schema.String),
  sourceExcerpt: Schema.optional(Schema.String),
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
  state: Schema.optional(ServerProviderState),
  auth: ServerProviderAuth,
  version: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  message: Schema.optional(TrimmedNonEmptyString),
  modelCount: NonNegativeInt,
  agentCount: Schema.optional(NonNegativeInt),
  skillCount: NonNegativeInt,
  slashCommandCount: NonNegativeInt,
  mcpServerCount: Schema.optional(NonNegativeInt),
  settingsCount: Schema.optional(NonNegativeInt),
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
  totalLines: Schema.optional(NonNegativeInt),
  scannedAt: Schema.optional(IsoDateTime),
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
    cause: Schema.optional(Schema.Defect()),
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
  updatedAt: Schema.optional(IsoDateTime),
  warning: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectReadIntelligenceSurfaceResult = typeof ProjectReadIntelligenceSurfaceResult.Type;

export class ProjectReadIntelligenceSurfaceError extends Schema.TaggedErrorClass<ProjectReadIntelligenceSurfaceError>()(
  "ProjectReadIntelligenceSurfaceError",
  {
    message: TrimmedNonEmptyString,
    surfaceId: Schema.optional(ProjectIntelligenceSurfaceId),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const PROJECT_CONTEXT_OVERRIDES_FILE_VERSION = 1 as const;

export const ProjectContextOverridesFile = Schema.Struct({
  version: Schema.Literals([PROJECT_CONTEXT_OVERRIDES_FILE_VERSION]),
  enabledOverrides: Schema.Record(ProjectIntelligenceSurfaceId, Schema.Boolean).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
export type ProjectContextOverridesFile = typeof ProjectContextOverridesFile.Type;

export const ProjectGetSurfaceOverridesInput = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
});
export type ProjectGetSurfaceOverridesInput = typeof ProjectGetSurfaceOverridesInput.Type;

export const ProjectGetSurfaceOverridesResult = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  enabledOverrides: Schema.Record(ProjectIntelligenceSurfaceId, Schema.Boolean).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
export type ProjectGetSurfaceOverridesResult = typeof ProjectGetSurfaceOverridesResult.Type;

export class ProjectGetSurfaceOverridesError extends Schema.TaggedErrorClass<ProjectGetSurfaceOverridesError>()(
  "ProjectGetSurfaceOverridesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const ProjectSetSurfaceEnabledInput = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  surfaceId: ProjectIntelligenceSurfaceId,
  enabled: Schema.NullOr(Schema.Boolean),
});
export type ProjectSetSurfaceEnabledInput = typeof ProjectSetSurfaceEnabledInput.Type;

export const ProjectSetSurfaceEnabledResult = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  enabledOverrides: Schema.Record(ProjectIntelligenceSurfaceId, Schema.Boolean).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
export type ProjectSetSurfaceEnabledResult = typeof ProjectSetSurfaceEnabledResult.Type;

export class ProjectSetSurfaceEnabledError extends Schema.TaggedErrorClass<ProjectSetSurfaceEnabledError>()(
  "ProjectSetSurfaceEnabledError",
  {
    message: TrimmedNonEmptyString,
    surfaceId: Schema.optional(ProjectIntelligenceSurfaceId),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const ProjectEntriesFailure = Schema.Literals([
  "workspace_root_not_found",
  "workspace_root_create_failed",
  "workspace_root_stat_failed",
  "workspace_root_not_directory",
  "search_index_create_failed",
  "search_index_scan_timed_out",
  "search_index_search_failed",
]);
export type ProjectEntriesFailure = typeof ProjectEntriesFailure.Type;

type ProjectEntriesFailureContext = {
  readonly failure: ProjectEntriesFailure;
  readonly normalizedCwd?: string;
  readonly timeout?: string;
  readonly detail?: string;
  readonly cause?: unknown;
};

function decodedProjectErrorMessage(props: object): string | undefined {
  if (!("message" in props)) return undefined;
  return typeof props.message === "string" ? props.message : undefined;
}

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    queryLength: Schema.optional(NonNegativeInt),
    limit: Schema.optional(PositiveInt),
    failure: Schema.optional(ProjectEntriesFailure),
    normalizedCwd: Schema.optional(TrimmedNonEmptyString),
    timeout: Schema.optional(TrimmedNonEmptyString),
    detail: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // The structured fields are optional on the wire so newer peers can decode legacy message-only
  // failures. New application code must provide them through this constructor.
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(
    props: ProjectEntriesFailureContext & {
      readonly cwd: string;
      readonly queryLength: number;
      readonly limit: number;
    },
  ) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ??
        `Failed to search workspace entries in '${props.cwd}'.`,
    } as any);
  }
}

export class ProjectListEntriesError extends Schema.TaggedErrorClass<ProjectListEntriesError>()(
  "ProjectListEntriesError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(ProjectEntriesFailure),
    normalizedCwd: Schema.optional(TrimmedNonEmptyString),
    timeout: Schema.optional(TrimmedNonEmptyString),
    detail: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: ProjectEntriesFailureContext & { readonly cwd: string }) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ?? `Failed to list workspace entries in '${props.cwd}'.`,
    } as any);
  }
}

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_READ_FILE_PATH_MAX_LENGTH)),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  contents: Schema.String,
  byteLength: NonNegativeInt,
  truncated: Schema.Boolean,
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export const ProjectFileFailure = Schema.Literals([
  "workspace_path_outside_root",
  "resolved_path_outside_root",
  "path_not_file",
  "binary_file",
  "operation_failed",
]);
export type ProjectFileFailure = typeof ProjectFileFailure.Type;

export const ProjectFileOperation = Schema.Literals([
  "realpath-workspace-root",
  "realpath-target",
  "open",
  "stat",
  "read",
  "close",
  "make-directory",
  "write-file",
]);
export type ProjectFileOperation = typeof ProjectFileOperation.Type;

type ProjectFileFailureContext = {
  readonly cwd: string;
  readonly relativePath: string;
  readonly failure: ProjectFileFailure;
  readonly resolvedPath?: string;
  readonly resolvedWorkspaceRoot?: string;
  readonly operation?: ProjectFileOperation;
  readonly operationPath?: string;
  readonly cause?: unknown;
};

export class ProjectReadFileError extends Schema.TaggedErrorClass<ProjectReadFileError>()(
  "ProjectReadFileError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    relativePath: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(ProjectFileFailure),
    resolvedPath: Schema.optional(TrimmedNonEmptyString),
    resolvedWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
    operation: Schema.optional(ProjectFileOperation),
    operationPath: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: ProjectFileFailureContext) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ??
        `Failed to read workspace file '${props.relativePath}' in '${props.cwd}'.`,
    } as any);
  }
}

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
    cwd: Schema.optional(TrimmedNonEmptyString),
    relativePath: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(ProjectFileFailure),
    resolvedPath: Schema.optional(TrimmedNonEmptyString),
    resolvedWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
    operation: Schema.optional(ProjectFileOperation),
    operationPath: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: ProjectFileFailureContext) {
    super({
      ...props,
      message:
        decodedProjectErrorMessage(props) ??
        `Failed to write workspace file '${props.relativePath}' in '${props.cwd}'.`,
    } as any);
  }
}
