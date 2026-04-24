import { Effect, Schema } from "effect";
import { NonNegativeInt, PositiveInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  ProjectWorktreeSetupEnvStrategy,
  ProjectWorktreeSetupFramework,
  ProjectWorktreeSetupPackageManager,
  ProjectWorktreeSetupProfile,
  ProjectWorktreeSetupStorageMode,
} from "./orchestration.ts";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;

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
