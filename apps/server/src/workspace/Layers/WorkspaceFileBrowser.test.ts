import fsPromises from "node:fs/promises";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ProjectId } from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Option } from "effect";

import { ServerSecretStoreLive } from "../../auth/Layers/ServerSecretStore.ts";
import { ServerConfig } from "../../config.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorkspaceFileBrowser } from "../Services/WorkspaceFileBrowser.ts";
import { WorkspaceFileBrowserLive } from "./WorkspaceFileBrowser.ts";
import { WorkspacePathsLive } from "./WorkspacePaths.ts";

const makeGitCoreLayer = (options?: {
  readonly insideWorkTree?: boolean;
  readonly filterIgnoredPaths?: (relativePaths: ReadonlyArray<string>) => ReadonlyArray<string>;
}) =>
  Layer.mock(GitCore)({
    isInsideWorkTree: () => Effect.succeed(options?.insideWorkTree ?? false),
    filterIgnoredPaths: (_cwd, relativePaths) =>
      Effect.succeed(options?.filterIgnoredPaths?.(relativePaths) ?? relativePaths),
  });

const makeProjectionSnapshotQueryLayer = () =>
  Layer.mock(ProjectionSnapshotQuery)({
    getProjectShellById: (projectId) =>
      Effect.succeed(
        Option.some({
          id: projectId,
          title: "Test project",
          workspaceRoot: projectId,
          repositoryIdentity: null,
          defaultModelSelection: null,
          scripts: [],
          worktreeSetup: null,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        }),
      ),
    getThreadShellById: () => Effect.succeed(Option.none()),
  });

const projectTarget = (cwd: string) => ({ kind: "project", projectId: cwd as ProjectId }) as const;

const makeTestLayer = (options?: {
  readonly insideWorkTree?: boolean;
  readonly filterIgnoredPaths?: (relativePaths: ReadonlyArray<string>) => ReadonlyArray<string>;
}) =>
  WorkspaceFileBrowserLive.pipe(
    Layer.provide(WorkspacePathsLive),
    Layer.provideMerge(makeGitCoreLayer(options)),
    Layer.provideMerge(makeProjectionSnapshotQueryLayer()),
    Layer.provide(ServerSecretStoreLive),
    Layer.provide(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-workspace-file-browser-test-",
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

const TestLayer = makeTestLayer();
const GitIgnoredLayer = makeTestLayer({
  insideWorkTree: true,
  filterIgnoredPaths: (relativePaths) => relativePaths.filter((entry) => entry !== "ignored.md"),
});

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-workspace-file-browser-",
  });
});

const writeFile = Effect.fn("writeFile")(function* (
  cwd: string,
  relativePath: string,
  contents: string | Uint8Array,
) {
  const absolutePath = path.join(cwd, relativePath);
  yield* Effect.promise(() => fsPromises.mkdir(path.dirname(absolutePath), { recursive: true }));
  yield* Effect.promise(() => fsPromises.writeFile(absolutePath, contents));
});

it.layer(TestLayer)("WorkspaceFileBrowserLive", (it) => {
  describe("listDirectory", () => {
    it.effect(
      "lists entries sorted with directories first and skips heavy ignored directories",
      () =>
        Effect.gen(function* () {
          const browser = yield* WorkspaceFileBrowser;
          const cwd = yield* makeTempDir;
          yield* writeFile(cwd, "z-file.md", "# z\n");
          yield* writeFile(cwd, "src/index.ts", "export {};\n");
          yield* writeFile(cwd, "node_modules/pkg/index.js", "module.exports = {};\n");
          yield* writeFile(cwd, "a-file.txt", "a\n");

          const result = yield* browser.listDirectory({ target: projectTarget(cwd) });

          expect(result.truncated).toBe(false);
          expect(result.entries.map((entry) => entry.relativePath)).toEqual([
            "src",
            "a-file.txt",
            "z-file.md",
          ]);
          expect(result.entries[0]?.kind).toBe("directory");
          expect(result.entries[1]?.previewKind).toBe("text");
          expect(result.entries[2]?.previewKind).toBe("markdown");
        }),
    );

    it.effect("rejects traversal and symlinks escaping the workspace root", () =>
      Effect.gen(function* () {
        const browser = yield* WorkspaceFileBrowser;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* writeFile(outsideDir, "escape.md", "# escape\n");
        yield* Effect.promise(() =>
          fsPromises.symlink(path.join(outsideDir, "escape.md"), path.join(cwd, "escape.md")),
        );

        const traversal = yield* browser
          .listDirectory({ target: projectTarget(cwd), relativePath: "../" })
          .pipe(Effect.result);
        const symlink = yield* browser
          .readFile({ target: projectTarget(cwd), relativePath: "escape.md" })
          .pipe(Effect.result);

        expect(traversal._tag).toBe("Failure");
        expect(symlink._tag).toBe("Failure");
      }),
    );
  });

  describe("readFile", () => {
    it.effect("reads and truncates markdown/code/text previews", () =>
      Effect.gen(function* () {
        const browser = yield* WorkspaceFileBrowser;
        const cwd = yield* makeTempDir;
        const large = `${"a".repeat(512 * 1024)}tail`;
        yield* writeFile(cwd, "README.md", large);

        const result = yield* browser.readFile({
          target: projectTarget(cwd),
          relativePath: "README.md",
        });

        expect(result.previewKind).toBe("markdown");
        expect(result.truncated).toBe(true);
        expect(result.maxBytes).toBe(512 * 1024);
        expect(result.content.length).toBe(512 * 1024);
      }),
    );

    it.effect("rejects binary preview files for text reads", () =>
      Effect.gen(function* () {
        const browser = yield* WorkspaceFileBrowser;
        const cwd = yield* makeTempDir;
        yield* writeFile(cwd, "pixel.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

        const result = yield* browser
          .readFile({ target: projectTarget(cwd), relativePath: "pixel.png" })
          .pipe(Effect.result);

        expect(result._tag).toBe("Failure");
      }),
    );

    it.effect("rejects binary files with source-code extensions", () =>
      Effect.gen(function* () {
        const browser = yield* WorkspaceFileBrowser;
        const cwd = yield* makeTempDir;
        yield* writeFile(cwd, "binary.ts", new Uint8Array([0, 1, 2, 3, 4, 5]));

        const metadata = yield* browser.getFileMetadata({
          target: projectTarget(cwd),
          relativePath: "binary.ts",
        });
        const read = yield* browser
          .readFile({ target: projectTarget(cwd), relativePath: "binary.ts" })
          .pipe(Effect.result);

        expect(metadata.previewKind).toBe("unsupported");
        expect(read._tag).toBe("Failure");
      }),
    );

    it.effect("rejects direct reads inside ignored workspace directories", () =>
      Effect.gen(function* () {
        const browser = yield* WorkspaceFileBrowser;
        const cwd = yield* makeTempDir;
        yield* writeFile(cwd, "src/node_modules/pkg/index.js", "module.exports = {};\n");

        const result = yield* browser
          .readFile({
            target: projectTarget(cwd),
            relativePath: "src/node_modules/pkg/index.js",
          })
          .pipe(Effect.result);

        expect(result._tag).toBe("Failure");
      }),
    );
  });

  describe("createFilePreviewUrl", () => {
    it.effect("signs one-file preview URLs and rejects tampered tokens", () =>
      Effect.gen(function* () {
        const browser = yield* WorkspaceFileBrowser;
        const cwd = yield* makeTempDir;
        yield* writeFile(cwd, "image.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');

        const previewUrl = yield* browser.createFilePreviewUrl({
          target: projectTarget(cwd),
          relativePath: "image.svg",
        });
        const token = new URL(previewUrl.url, "http://localhost").searchParams.get("token");
        expect(token).toBeTruthy();

        const rawFile = yield* browser.resolveRawPreviewToken(token ?? "");
        const tampered = yield* browser
          .resolveRawPreviewToken(`${token ?? ""}x`)
          .pipe(Effect.result);

        expect(previewUrl.previewKind).toBe("svg");
        expect(rawFile.mimeType).toBe("image/svg+xml");
        expect(tampered._tag).toBe("Failure");
      }),
    );
  });
});

it.layer(GitIgnoredLayer)("WorkspaceFileBrowserLive git filtering", (it) => {
  it.effect("filters git-ignored entries when the workspace is inside a git worktree", () =>
    Effect.gen(function* () {
      const browser = yield* WorkspaceFileBrowser;
      const cwd = yield* makeTempDir;
      yield* writeFile(cwd, "keep.md", "# keep\n");
      yield* writeFile(cwd, "ignored.md", "# ignored\n");

      const result = yield* browser.listDirectory({ target: projectTarget(cwd) });

      expect(result.entries.map((entry) => entry.relativePath)).toEqual(["keep.md"]);
    }),
  );

  it.effect("rejects direct reads of git-ignored files", () =>
    Effect.gen(function* () {
      const browser = yield* WorkspaceFileBrowser;
      const cwd = yield* makeTempDir;
      yield* writeFile(cwd, "ignored.md", "# ignored\n");

      const result = yield* browser
        .readFile({ target: projectTarget(cwd), relativePath: "ignored.md" })
        .pipe(Effect.result);

      expect(result._tag).toBe("Failure");
    }),
  );
});
