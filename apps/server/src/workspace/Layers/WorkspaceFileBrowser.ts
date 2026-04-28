import * as Crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import pathNode from "node:path";

import Mime from "@effect/platform-node/Mime";
import type {
  ProjectFileEntry,
  ProjectFilePreviewKind,
  ProjectReadFileResult,
  ProjectWorkspaceTarget,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Path } from "effect";

import { ServerSecretStore } from "../../auth/Services/ServerSecretStore.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";
import {
  WorkspaceFileBrowser,
  WorkspaceFileBrowserError,
  type WorkspaceFileBrowserRawFile,
  type WorkspaceFileBrowserShape,
} from "../Services/WorkspaceFileBrowser.ts";
import {
  basenameOf,
  hasIgnoredWorkspaceDirectorySegment,
  IGNORED_WORKSPACE_DIRECTORY_NAMES,
  isPathInIgnoredWorkspaceDirectory,
  isSafeWorkspaceRelativePath,
  toPosixPath,
} from "../workspacePathPolicy.ts";

const DIRECTORY_ENTRY_LIMIT = 2_000;
const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;
const RAW_PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000;
const RAW_PREVIEW_SECRET_NAME = "project-file-preview-token";
const RAW_PREVIEW_PATH = "/api/project-files/raw";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
const CODE_EXTENSIONS = new Set([
  ".astro",
  ".c",
  ".cjs",
  ".clj",
  ".cpp",
  ".cs",
  ".css",
  ".cts",
  ".go",
  ".graphql",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".less",
  ".lua",
  ".mjs",
  ".mts",
  ".php",
  ".prisma",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zig",
]);
const TEXT_FILENAMES = new Set([
  ".env",
  ".env.example",
  ".gitignore",
  ".npmrc",
  "dockerfile",
  "license",
  "makefile",
]);

type BinaryPreviewKind = "image" | "svg" | "pdf" | "audio" | "video";

interface ResolvedWorkspacePath {
  readonly cwd: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly realPath: string;
}

interface ResolvedWorkspaceTarget {
  readonly target: ProjectWorkspaceTarget;
  readonly cwd: string;
}

interface PreviewTokenPayload {
  readonly target: ProjectWorkspaceTarget;
  readonly workspaceRoot: string;
  readonly relativePath: string;
  readonly exp: number;
  readonly sizeBytes: number;
  readonly modifiedMs: number;
}

function toBrowserPath(pathname: string, token: string): string {
  const params = new URLSearchParams({ token });
  return `${pathname}?${params.toString()}`;
}

function toIsoDate(ms: number): string | undefined {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function base64UrlEncode(input: Buffer | Uint8Array | string): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecodeUtf8(input: string): string | null {
  try {
    return Buffer.from(input, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function signPayload(payload: string, secret: Uint8Array): string {
  return Crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length && Crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function createToken(payload: PreviewTokenPayload, secret: Uint8Array): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function isProjectWorkspaceTarget(value: unknown): value is ProjectWorkspaceTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<ProjectWorkspaceTarget>;
  if (target.kind === "project") {
    return typeof target.projectId === "string" && target.projectId.length > 0;
  }
  if (target.kind === "thread") {
    return typeof target.threadId === "string" && target.threadId.length > 0;
  }
  return false;
}

function decodeToken(
  token: string,
  secret: Uint8Array,
): PreviewTokenPayload | WorkspaceFileBrowserError {
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra !== undefined) {
    return new WorkspaceFileBrowserError({
      operation: "workspaceFileBrowser.decodeToken",
      detail: "Invalid preview token.",
    });
  }
  const expectedSignature = signPayload(encodedPayload, secret);
  if (!timingSafeEqualString(signature, expectedSignature)) {
    return new WorkspaceFileBrowserError({
      operation: "workspaceFileBrowser.decodeToken",
      detail: "Invalid preview token.",
    });
  }
  const decoded = base64UrlDecodeUtf8(encodedPayload);
  if (!decoded) {
    return new WorkspaceFileBrowserError({
      operation: "workspaceFileBrowser.decodeToken",
      detail: "Invalid preview token.",
    });
  }
  const parsed = safeJsonParse(decoded);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !isProjectWorkspaceTarget((parsed as PreviewTokenPayload).target) ||
    typeof (parsed as PreviewTokenPayload).workspaceRoot !== "string" ||
    typeof (parsed as PreviewTokenPayload).relativePath !== "string" ||
    typeof (parsed as PreviewTokenPayload).exp !== "number" ||
    typeof (parsed as PreviewTokenPayload).sizeBytes !== "number" ||
    typeof (parsed as PreviewTokenPayload).modifiedMs !== "number"
  ) {
    return new WorkspaceFileBrowserError({
      operation: "workspaceFileBrowser.decodeToken",
      detail: "Invalid preview token.",
    });
  }
  const payload = parsed as PreviewTokenPayload;
  if (Date.now() > payload.exp) {
    return new WorkspaceFileBrowserError({
      cwd: payload.workspaceRoot,
      relativePath: payload.relativePath,
      operation: "workspaceFileBrowser.decodeToken",
      detail: "Preview token expired.",
    });
  }
  return payload;
}

function isWorkspaceFileBrowserError(value: unknown): value is WorkspaceFileBrowserError {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    value._tag === "WorkspaceFileBrowserError"
  );
}

function classifyMimeType(filePath: string): string {
  const base = basenameOf(filePath).toLowerCase();
  if (base === "dockerfile" || base === "makefile") return "text/plain";
  return Mime.getType(filePath) ?? "application/octet-stream";
}

function classifyPreviewKind(input: {
  readonly filePath: string;
  readonly mimeType: string;
  readonly textCompatible?: boolean;
  readonly svgCompatible?: boolean;
}): ProjectFilePreviewKind {
  const extension = pathNode.extname(input.filePath).toLowerCase();
  const base = basenameOf(input.filePath).toLowerCase();
  if ((extension === ".svg" || input.mimeType === "image/svg+xml") && input.svgCompatible) {
    return "svg";
  }
  if (
    (MARKDOWN_EXTENSIONS.has(extension) ||
      CODE_EXTENSIONS.has(extension) ||
      TEXT_FILENAMES.has(base)) &&
    !input.textCompatible
  ) {
    return "unsupported";
  }
  if (input.mimeType === "application/pdf") return "pdf";
  if (input.mimeType.startsWith("image/")) return "image";
  if (input.mimeType.startsWith("audio/")) return "audio";
  if (input.mimeType.startsWith("video/")) return "video";
  if (MARKDOWN_EXTENSIONS.has(extension) && input.textCompatible) return "markdown";
  if (CODE_EXTENSIONS.has(extension) && input.textCompatible) return "code";
  if (TEXT_FILENAMES.has(base) && input.textCompatible) return "text";
  if (input.mimeType.startsWith("text/") && input.textCompatible) {
    return CODE_EXTENSIONS.has(extension) ? "code" : "text";
  }
  if (input.textCompatible) return "text";
  return "unsupported";
}

function isTextPreviewKind(kind: ProjectFilePreviewKind): boolean {
  return kind === "markdown" || kind === "code" || kind === "text";
}

function isBinaryPreviewKind(kind: ProjectFilePreviewKind): kind is BinaryPreviewKind {
  return (
    kind === "image" || kind === "svg" || kind === "pdf" || kind === "audio" || kind === "video"
  );
}

function looksUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const controlCount = [...decoded].filter((char) => {
      const code = char.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    }).length;
    return controlCount <= Math.max(4, decoded.length * 0.01);
  } catch {
    return false;
  }
}

function looksSvg(bytes: Uint8Array): boolean {
  if (!looksUtf8Text(bytes)) return false;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trimStart();
    return decoded.startsWith("<svg") || decoded.includes("<svg");
  } catch {
    return false;
  }
}

function toError(input: {
  readonly cwd?: string;
  readonly relativePath?: string;
  readonly operation: string;
  readonly detail: string;
  readonly cause?: unknown;
}): WorkspaceFileBrowserError {
  return new WorkspaceFileBrowserError({
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.relativePath !== undefined ? { relativePath: input.relativePath } : {}),
    operation: input.operation,
    detail: input.detail,
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
  });
}

export const makeWorkspaceFileBrowser = Effect.gen(function* () {
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const secretStore = yield* ServerSecretStore;
  const projectionQuery = yield* ProjectionSnapshotQuery;
  const gitOption = yield* Effect.serviceOption(GitCore);

  const signingSecret = yield* secretStore.getOrCreateRandom(RAW_PREVIEW_SECRET_NAME, 32).pipe(
    Effect.mapError((cause) =>
      toError({
        operation: "workspaceFileBrowser.signingSecret",
        detail: cause.message,
        cause,
      }),
    ),
  );

  const isInsideGitWorkTree = (cwd: string): Effect.Effect<boolean> =>
    Option.match(gitOption, {
      onSome: (git) => git.isInsideWorkTree(cwd).pipe(Effect.catch(() => Effect.succeed(false))),
      onNone: () => Effect.succeed(false),
    });

  const filterGitIgnoredPaths = (
    cwd: string,
    relativePaths: string[],
  ): Effect.Effect<string[], never> =>
    Option.match(gitOption, {
      onSome: (git) =>
        git.filterIgnoredPaths(cwd, relativePaths).pipe(
          Effect.map((paths) => [...paths]),
          Effect.catch(() => Effect.succeed(relativePaths)),
        ),
      onNone: () => Effect.succeed(relativePaths),
    });

  const normalizeCwd = (cwd: string) =>
    workspacePaths.normalizeWorkspaceRoot(cwd).pipe(
      Effect.mapError((cause) =>
        toError({
          cwd,
          operation: "workspaceFileBrowser.normalizeCwd",
          detail: cause.message,
          cause,
        }),
      ),
    );

  const resolveWorkspaceTarget = Effect.fn("WorkspaceFileBrowser.resolveWorkspaceTarget")(
    function* (
      target: ProjectWorkspaceTarget,
    ): Effect.fn.Return<ResolvedWorkspaceTarget, WorkspaceFileBrowserError> {
      const workspaceRoot =
        target.kind === "project"
          ? yield* projectionQuery.getProjectShellById(target.projectId).pipe(
              Effect.mapError((cause) =>
                toError({
                  operation: "workspaceFileBrowser.resolveWorkspaceTarget",
                  detail: "Failed to resolve project workspace.",
                  cause,
                }),
              ),
              Effect.flatMap(
                Option.match({
                  onNone: () =>
                    Effect.fail(
                      toError({
                        operation: "workspaceFileBrowser.resolveWorkspaceTarget",
                        detail: "Project workspace is unavailable.",
                      }),
                    ),
                  onSome: (project) => Effect.succeed(project.workspaceRoot),
                }),
              ),
            )
          : yield* projectionQuery.getThreadShellById(target.threadId).pipe(
              Effect.mapError((cause) =>
                toError({
                  operation: "workspaceFileBrowser.resolveWorkspaceTarget",
                  detail: "Failed to resolve thread workspace.",
                  cause,
                }),
              ),
              Effect.flatMap(
                Option.match({
                  onNone: () =>
                    Effect.fail(
                      toError({
                        operation: "workspaceFileBrowser.resolveWorkspaceTarget",
                        detail: "Thread workspace is unavailable.",
                      }),
                    ),
                  onSome: (thread) =>
                    projectionQuery.getProjectShellById(thread.projectId).pipe(
                      Effect.mapError((cause) =>
                        toError({
                          operation: "workspaceFileBrowser.resolveWorkspaceTarget",
                          detail: "Failed to resolve project workspace.",
                          cause,
                        }),
                      ),
                      Effect.flatMap(
                        Option.match({
                          onNone: () =>
                            Effect.fail(
                              toError({
                                operation: "workspaceFileBrowser.resolveWorkspaceTarget",
                                detail: "Project workspace is unavailable.",
                              }),
                            ),
                          onSome: (project) =>
                            Effect.succeed(thread.worktreePath ?? project.workspaceRoot),
                        }),
                      ),
                    ),
                }),
              ),
            );
      const cwd = yield* normalizeCwd(workspaceRoot);
      return { target, cwd };
    },
  );

  const assertRealPathInsideRoot = Effect.fn("WorkspaceFileBrowser.assertRealPathInsideRoot")(
    function* (input: { cwd: string; relativePath: string; absolutePath: string }) {
      const realRoot = yield* Effect.tryPromise({
        try: () => fsPromises.realpath(input.cwd),
        catch: (cause) =>
          toError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileBrowser.realpathRoot",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      const realPath = yield* Effect.tryPromise({
        try: () => fsPromises.realpath(input.absolutePath),
        catch: (cause) =>
          toError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileBrowser.realpathFile",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      const relativeToRoot = toPosixPath(path.relative(realRoot, realPath));
      if (
        relativeToRoot === ".." ||
        relativeToRoot.startsWith("../") ||
        path.isAbsolute(relativeToRoot)
      ) {
        return yield* toError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileBrowser.pathContainment",
          detail: "Workspace file path must stay within the project root.",
        });
      }
      return realPath;
    },
  );

  const resolvePath = Effect.fn("WorkspaceFileBrowser.resolvePath")(function* (
    cwdInput: string,
    relativePathInput: string | undefined,
    options?: { readonly allowRoot?: boolean },
  ): Effect.fn.Return<ResolvedWorkspacePath, WorkspaceFileBrowserError> {
    const cwd = yield* normalizeCwd(cwdInput);
    const rawRelativePath = (relativePathInput ?? "").trim();
    if (rawRelativePath.includes("\0")) {
      return yield* toError({
        cwd,
        relativePath: rawRelativePath,
        operation: "workspaceFileBrowser.resolvePath",
        detail: "Workspace file path is invalid.",
      });
    }
    if (rawRelativePath.length === 0) {
      if (!options?.allowRoot) {
        return yield* toError({
          cwd,
          relativePath: rawRelativePath,
          operation: "workspaceFileBrowser.resolvePath",
          detail: "Workspace file path is required.",
        });
      }
      const realPath = yield* assertRealPathInsideRoot({
        cwd,
        relativePath: "",
        absolutePath: cwd,
      });
      return { cwd, relativePath: "", absolutePath: cwd, realPath };
    }
    if (!isSafeWorkspaceRelativePath(toPosixPath(rawRelativePath))) {
      return yield* toError({
        cwd,
        relativePath: rawRelativePath,
        operation: "workspaceFileBrowser.resolvePath",
        detail: "Workspace file path must stay within the project root.",
      });
    }
    if (hasIgnoredWorkspaceDirectorySegment(toPosixPath(rawRelativePath))) {
      return yield* toError({
        cwd,
        relativePath: rawRelativePath,
        operation: "workspaceFileBrowser.resolvePath",
        detail: "Workspace file path is ignored.",
      });
    }
    const resolved = yield* workspacePaths
      .resolveRelativePathWithinRoot({
        workspaceRoot: cwd,
        relativePath: rawRelativePath,
      })
      .pipe(
        Effect.mapError((cause) =>
          toError({
            cwd,
            relativePath: rawRelativePath,
            operation: "workspaceFileBrowser.resolveRelativePath",
            detail: cause.message,
            cause,
          }),
        ),
      );
    const realPath = yield* assertRealPathInsideRoot({
      cwd,
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath,
    });
    return {
      cwd,
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      realPath,
    };
  });

  const assertGitAllowed = Effect.fn("WorkspaceFileBrowser.assertGitAllowed")(function* (
    resolved: ResolvedWorkspacePath,
  ) {
    if (!resolved.relativePath || !(yield* isInsideGitWorkTree(resolved.cwd))) {
      return;
    }
    const allowed = yield* filterGitIgnoredPaths(resolved.cwd, [resolved.relativePath]);
    if (!allowed.includes(resolved.relativePath)) {
      return yield* toError({
        cwd: resolved.cwd,
        relativePath: resolved.relativePath,
        operation: "workspaceFileBrowser.gitIgnoredPath",
        detail: "Workspace file path is ignored.",
      });
    }
  });

  const statPath = Effect.fn("WorkspaceFileBrowser.statPath")(function* (
    resolved: ResolvedWorkspacePath,
  ) {
    return yield* Effect.tryPromise({
      try: () => fsPromises.stat(resolved.realPath),
      catch: (cause) =>
        toError({
          cwd: resolved.cwd,
          relativePath: resolved.relativePath,
          operation: "workspaceFileBrowser.statPath",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  });

  const readTextCompatiblePrefix = async (realPath: string): Promise<Uint8Array> => {
    const file = await fsPromises.open(realPath, "r");
    try {
      const buffer = Buffer.alloc(Math.min(8_192, TEXT_PREVIEW_MAX_BYTES));
      const result = await file.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, result.bytesRead);
    } finally {
      await file.close();
    }
  };

  const classifyFile = Effect.fn("WorkspaceFileBrowser.classifyFile")(function* (
    resolved: ResolvedWorkspacePath,
  ) {
    const mimeType = classifyMimeType(resolved.absolutePath);
    let textCompatible = false;
    let svgCompatible = false;
    if (
      mimeType === "application/octet-stream" ||
      mimeType.startsWith("text/") ||
      mimeType === "image/svg+xml" ||
      pathNode.extname(resolved.relativePath).toLowerCase() === ".svg" ||
      MARKDOWN_EXTENSIONS.has(pathNode.extname(resolved.relativePath).toLowerCase()) ||
      CODE_EXTENSIONS.has(pathNode.extname(resolved.relativePath).toLowerCase())
    ) {
      const prefix = yield* Effect.tryPromise({
        try: () => readTextCompatiblePrefix(resolved.realPath),
        catch: (cause) =>
          toError({
            cwd: resolved.cwd,
            relativePath: resolved.relativePath,
            operation: "workspaceFileBrowser.readTextCompatiblePrefix",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      }).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())));
      textCompatible = looksUtf8Text(prefix);
      svgCompatible = looksSvg(prefix);
    }
    return {
      mimeType,
      previewKind: classifyPreviewKind({
        filePath: resolved.relativePath,
        mimeType,
        textCompatible,
        svgCompatible,
      }),
    };
  });

  const toFileEntry = Effect.fn("WorkspaceFileBrowser.toFileEntry")(function* (
    cwd: string,
    relativePath: string,
    name: string,
    kind: "file" | "directory",
  ): Effect.fn.Return<ProjectFileEntry, WorkspaceFileBrowserError> {
    const absolutePath = path.join(cwd, relativePath);
    const stat = yield* Effect.tryPromise({
      try: () => fsPromises.stat(absolutePath),
      catch: (cause) =>
        toError({
          cwd,
          relativePath,
          operation: "workspaceFileBrowser.entryStat",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    const baseEntry = {
      name,
      relativePath,
      kind,
      openPath: absolutePath,
      ...(toIsoDate(stat.mtimeMs) ? { modifiedAt: toIsoDate(stat.mtimeMs) } : {}),
    };
    if (kind === "directory") {
      return baseEntry;
    }
    const classified = yield* classifyFile({
      cwd,
      relativePath,
      absolutePath,
      realPath: absolutePath,
    });
    return {
      ...baseEntry,
      sizeBytes: Math.max(0, stat.size),
      mimeType: classified.mimeType,
      previewKind: classified.previewKind,
    };
  });

  const listDirectory: WorkspaceFileBrowserShape["listDirectory"] = Effect.fn(
    "WorkspaceFileBrowser.listDirectory",
  )(function* (input) {
    const workspace = yield* resolveWorkspaceTarget(input.target);
    const resolved = yield* resolvePath(workspace.cwd, input.relativePath, { allowRoot: true });
    const stat = yield* statPath(resolved);
    if (!stat.isDirectory()) {
      return yield* toError({
        cwd: resolved.cwd,
        relativePath: resolved.relativePath,
        operation: "workspaceFileBrowser.listDirectory",
        detail: "Workspace path is not a directory.",
      });
    }
    const dirents = yield* Effect.tryPromise({
      try: () => fsPromises.readdir(resolved.absolutePath, { withFileTypes: true }),
      catch: (cause) =>
        toError({
          cwd: resolved.cwd,
          relativePath: resolved.relativePath,
          operation: "workspaceFileBrowser.readdir",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    const candidates = dirents.flatMap((dirent) => {
      if (!dirent.name || dirent.name === "." || dirent.name === "..") return [];
      if (dirent.isDirectory() && IGNORED_WORKSPACE_DIRECTORY_NAMES.has(dirent.name)) return [];
      if (!dirent.isDirectory() && !dirent.isFile()) return [];
      const relativePath = toPosixPath(
        resolved.relativePath ? path.join(resolved.relativePath, dirent.name) : dirent.name,
      );
      if (isPathInIgnoredWorkspaceDirectory(relativePath)) return [];
      return [{ dirent, relativePath }];
    });
    const allowedPaths = (yield* isInsideGitWorkTree(resolved.cwd))
      ? new Set(
          yield* filterGitIgnoredPaths(
            resolved.cwd,
            candidates.map((entry) => entry.relativePath),
          ),
        )
      : null;
    const sorted = candidates
      .filter((entry) => !allowedPaths || allowedPaths.has(entry.relativePath))
      .toSorted((left, right) => {
        const kindCompare = Number(right.dirent.isDirectory()) - Number(left.dirent.isDirectory());
        return (
          kindCompare ||
          left.dirent.name.localeCompare(right.dirent.name, undefined, { sensitivity: "base" })
        );
      });
    const limited = sorted.slice(0, DIRECTORY_ENTRY_LIMIT);
    const entries = yield* Effect.forEach(
      limited,
      (entry) =>
        toFileEntry(
          resolved.cwd,
          entry.relativePath,
          entry.dirent.name,
          entry.dirent.isDirectory() ? "directory" : "file",
        ),
      { concurrency: 16 },
    );
    return {
      cwd: resolved.cwd,
      relativePath: resolved.relativePath,
      entries,
      truncated: sorted.length > DIRECTORY_ENTRY_LIMIT,
    };
  });

  const getFileMetadata: WorkspaceFileBrowserShape["getFileMetadata"] = Effect.fn(
    "WorkspaceFileBrowser.getFileMetadata",
  )(function* (input) {
    const workspace = yield* resolveWorkspaceTarget(input.target);
    const resolved = yield* resolvePath(workspace.cwd, input.relativePath);
    yield* assertGitAllowed(resolved);
    const stat = yield* statPath(resolved);
    if (!stat.isFile()) {
      return yield* toError({
        cwd: resolved.cwd,
        relativePath: resolved.relativePath,
        operation: "workspaceFileBrowser.getFileMetadata",
        detail: "Workspace path is not a file.",
      });
    }
    const classified = yield* classifyFile(resolved);
    return {
      name: basenameOf(resolved.relativePath),
      relativePath: resolved.relativePath,
      kind: "file",
      openPath: resolved.absolutePath,
      sizeBytes: Math.max(0, stat.size),
      ...(toIsoDate(stat.mtimeMs) ? { modifiedAt: toIsoDate(stat.mtimeMs) } : {}),
      mimeType: classified.mimeType,
      previewKind: classified.previewKind,
    };
  });

  const readFile: WorkspaceFileBrowserShape["readFile"] = Effect.fn(
    "WorkspaceFileBrowser.readFile",
  )(function* (input) {
    const workspace = yield* resolveWorkspaceTarget(input.target);
    const resolved = yield* resolvePath(workspace.cwd, input.relativePath);
    yield* assertGitAllowed(resolved);
    const stat = yield* statPath(resolved);
    if (!stat.isFile()) {
      return yield* toError({
        cwd: resolved.cwd,
        relativePath: resolved.relativePath,
        operation: "workspaceFileBrowser.readFile",
        detail: "Workspace path is not a file.",
      });
    }
    const classified = yield* classifyFile(resolved);
    if (!isTextPreviewKind(classified.previewKind)) {
      return yield* toError({
        cwd: resolved.cwd,
        relativePath: resolved.relativePath,
        operation: "workspaceFileBrowser.readFile",
        detail: "Workspace file is not a text preview type.",
      });
    }
    const buffer = yield* Effect.tryPromise({
      try: async () => {
        const file = await fsPromises.open(resolved.realPath, "r");
        try {
          const bytes = Buffer.alloc(Math.min(TEXT_PREVIEW_MAX_BYTES, stat.size));
          const result = await file.read(bytes, 0, bytes.length, 0);
          return bytes.subarray(0, result.bytesRead);
        } finally {
          await file.close();
        }
      },
      catch: (cause) =>
        toError({
          cwd: resolved.cwd,
          relativePath: resolved.relativePath,
          operation: "workspaceFileBrowser.readFileBytes",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    const content = new TextDecoder("utf-8")
      .decode(buffer)
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n");
    return {
      cwd: resolved.cwd,
      relativePath: resolved.relativePath,
      openPath: resolved.absolutePath,
      name: basenameOf(resolved.relativePath),
      sizeBytes: Math.max(0, stat.size),
      ...(toIsoDate(stat.mtimeMs) ? { modifiedAt: toIsoDate(stat.mtimeMs) } : {}),
      mimeType: classified.mimeType,
      previewKind: classified.previewKind,
      content,
      truncated: stat.size > TEXT_PREVIEW_MAX_BYTES,
      maxBytes: TEXT_PREVIEW_MAX_BYTES,
    } satisfies ProjectReadFileResult;
  });

  const resolveBinaryPreview = Effect.fn("WorkspaceFileBrowser.resolveBinaryPreview")(
    function* (input: {
      target: ProjectWorkspaceTarget;
      relativePath: string;
      expectedWorkspaceRoot?: string;
    }): Effect.fn.Return<
      {
        readonly resolved: ResolvedWorkspacePath;
        readonly stat: Awaited<ReturnType<typeof fsPromises.stat>>;
        readonly mimeType: string;
        readonly previewKind: BinaryPreviewKind;
      },
      WorkspaceFileBrowserError
    > {
      const workspace = yield* resolveWorkspaceTarget(input.target);
      if (input.expectedWorkspaceRoot && workspace.cwd !== input.expectedWorkspaceRoot) {
        return yield* toError({
          cwd: workspace.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileBrowser.resolveBinaryPreview",
          detail: "Workspace changed after the preview token was issued.",
        });
      }
      const resolved = yield* resolvePath(workspace.cwd, input.relativePath);
      yield* assertGitAllowed(resolved);
      const stat = yield* statPath(resolved);
      if (!stat.isFile()) {
        return yield* toError({
          cwd: resolved.cwd,
          relativePath: resolved.relativePath,
          operation: "workspaceFileBrowser.resolveBinaryPreview",
          detail: "Workspace path is not a file.",
        });
      }
      const classified = yield* classifyFile(resolved);
      if (!isBinaryPreviewKind(classified.previewKind)) {
        return yield* toError({
          cwd: resolved.cwd,
          relativePath: resolved.relativePath,
          operation: "workspaceFileBrowser.resolveBinaryPreview",
          detail: "Workspace file is not a supported binary preview type.",
        });
      }
      return {
        resolved,
        stat,
        mimeType: classified.mimeType,
        previewKind: classified.previewKind,
      };
    },
  );

  const createFilePreviewUrl: WorkspaceFileBrowserShape["createFilePreviewUrl"] = Effect.fn(
    "WorkspaceFileBrowser.createFilePreviewUrl",
  )(function* (input) {
    const preview = yield* resolveBinaryPreview(input);
    const expiresAtMs = Date.now() + RAW_PREVIEW_TOKEN_TTL_MS;
    const token = createToken(
      {
        target: input.target,
        workspaceRoot: preview.resolved.cwd,
        relativePath: preview.resolved.relativePath,
        exp: expiresAtMs,
        sizeBytes: Number(preview.stat.size),
        modifiedMs: Number(preview.stat.mtimeMs),
      },
      signingSecret,
    );
    return {
      url: toBrowserPath(RAW_PREVIEW_PATH, token),
      expiresAt: new Date(expiresAtMs).toISOString(),
      mimeType: preview.mimeType,
      previewKind: preview.previewKind,
      openPath: preview.resolved.absolutePath,
    };
  });

  const resolveRawPreviewToken: WorkspaceFileBrowserShape["resolveRawPreviewToken"] = Effect.fn(
    "WorkspaceFileBrowser.resolveRawPreviewToken",
  )(function* (token) {
    const decoded = decodeToken(token, signingSecret);
    if (isWorkspaceFileBrowserError(decoded)) {
      return yield* decoded;
    }
    const preview = yield* resolveBinaryPreview({
      target: decoded.target,
      expectedWorkspaceRoot: decoded.workspaceRoot,
      relativePath: decoded.relativePath,
    });
    if (
      Number(preview.stat.size) !== decoded.sizeBytes ||
      Math.floor(Number(preview.stat.mtimeMs)) !== Math.floor(decoded.modifiedMs)
    ) {
      return yield* toError({
        cwd: decoded.workspaceRoot,
        relativePath: decoded.relativePath,
        operation: "workspaceFileBrowser.resolveRawPreviewToken",
        detail: "Workspace file changed after the preview token was issued.",
      });
    }
    return {
      absolutePath: preview.resolved.absolutePath,
      realPath: preview.resolved.realPath,
      mimeType: preview.mimeType,
      sizeBytes: Number(preview.stat.size),
      previewKind: preview.previewKind,
    } satisfies WorkspaceFileBrowserRawFile;
  });

  return {
    listDirectory,
    getFileMetadata,
    readFile,
    createFilePreviewUrl,
    resolveRawPreviewToken,
  } satisfies WorkspaceFileBrowserShape;
});

export const WorkspaceFileBrowserLive = Layer.effect(
  WorkspaceFileBrowser,
  makeWorkspaceFileBrowser,
);
