import type {
  ProjectCreateFilePreviewUrlInput,
  ProjectCreateFilePreviewUrlResult,
  ProjectGetFileMetadataInput,
  ProjectGetFileMetadataResult,
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
} from "@t3tools/contracts";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

export class WorkspaceFileBrowserError extends Schema.TaggedErrorClass<WorkspaceFileBrowserError>()(
  "WorkspaceFileBrowserError",
  {
    cwd: Schema.optional(Schema.String),
    relativePath: Schema.optional(Schema.String),
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface WorkspaceFileBrowserRawFile {
  readonly absolutePath: string;
  readonly realPath: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly previewKind: "image" | "svg" | "pdf" | "audio" | "video";
}

export interface WorkspaceFileBrowserShape {
  readonly listDirectory: (
    input: ProjectListDirectoryInput,
  ) => Effect.Effect<ProjectListDirectoryResult, WorkspaceFileBrowserError>;
  readonly getFileMetadata: (
    input: ProjectGetFileMetadataInput,
  ) => Effect.Effect<ProjectGetFileMetadataResult, WorkspaceFileBrowserError>;
  readonly readFile: (
    input: ProjectReadFileInput,
  ) => Effect.Effect<ProjectReadFileResult, WorkspaceFileBrowserError>;
  readonly createFilePreviewUrl: (
    input: ProjectCreateFilePreviewUrlInput,
  ) => Effect.Effect<ProjectCreateFilePreviewUrlResult, WorkspaceFileBrowserError>;
  readonly resolveRawPreviewToken: (
    token: string,
  ) => Effect.Effect<WorkspaceFileBrowserRawFile, WorkspaceFileBrowserError>;
}

export class WorkspaceFileBrowser extends Context.Service<
  WorkspaceFileBrowser,
  WorkspaceFileBrowserShape
>()("t3/workspace/Services/WorkspaceFileBrowser") {}
