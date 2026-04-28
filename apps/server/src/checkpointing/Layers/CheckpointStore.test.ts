import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, PlatformError, Scope } from "effect";
import { describe, expect } from "vitest";

import { checkpointRefForThreadTurn } from "../Utils.ts";
import { CheckpointStoreLive } from "./CheckpointStore.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { GitCommandError } from "@t3tools/contracts";
import { ServerConfig } from "../../config.ts";
import { ThreadId } from "@t3tools/contracts";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-checkpoint-store-test-",
});
const GitCoreTestLayer = GitCoreLive.pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provide(NodeServices.layer),
);
const CheckpointStoreTestLayer = CheckpointStoreLive.pipe(
  Layer.provide(GitCoreTestLayer),
  Layer.provide(NodeServices.layer),
);
const TestLayer = Layer.mergeAll(NodeServices.layer, GitCoreTestLayer, CheckpointStoreTestLayer);

function makeTmpDir(
  prefix = "checkpoint-store-test-",
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix });
  });
}

function writeTextFile(
  filePath: string,
  contents: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFileString(filePath, contents);
  });
}

function git(
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, GitCommandError, GitCore> {
  return Effect.gen(function* () {
    const gitCore = yield* GitCore;
    const result = yield* gitCore.execute({
      operation: "CheckpointStore.test.git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });
}

function initRepoWithCommit(
  cwd: string,
): Effect.Effect<
  void,
  GitCommandError | PlatformError.PlatformError,
  GitCore | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const core = yield* GitCore;
    yield* core.initRepo({ cwd });
    yield* git(cwd, ["config", "user.email", "test@test.com"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* writeTextFile(path.join(cwd, "README.md"), "# test\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "initial commit"]);
  });
}

function buildLargeText(lineCount = 5_000): string {
  return Array.from({ length: lineCount }, (_, index) => `line ${String(index).padStart(5, "0")}`)
    .join("\n")
    .concat("\n");
}

it.layer(TestLayer)("CheckpointStoreLive", (it) => {
  describe("diffCheckpoints", () => {
    it.effect("returns full oversized checkpoint diffs without truncation", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(path.join(tmp, "README.md"), buildLargeText());
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const diff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
        });

        expect(diff).toContain("diff --git");
        expect(diff).not.toContain("[truncated]");
        expect(diff).toContain("+line 04999");
      }),
    );
  });

  describe("summarizeCheckpointDiff", () => {
    it.effect("summarizes modified, added, and renamed files", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* writeTextFile(path.join(tmp, "old-name.txt"), "one\ntwo\n");
        yield* git(tmp, ["add", "."]);
        yield* git(tmp, ["commit", "-m", "add rename source"]);

        const checkpointStore = yield* CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store-summary");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(path.join(tmp, "README.md"), "# test updated\nextra\n");
        yield* writeTextFile(path.join(tmp, "added.txt"), "first\nsecond\n");
        yield* git(tmp, ["mv", "old-name.txt", "renamed-name.txt"]);
        yield* writeTextFile(path.join(tmp, "renamed-name.txt"), "one\ntwo\nthree\n");
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const files = yield* checkpointStore.summarizeCheckpointDiff({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
        });

        expect(files).toContainEqual({ path: "README.md", additions: 2, deletions: 1 });
        expect(files).toContainEqual({ path: "added.txt", additions: 2, deletions: 0 });
        expect(files).toContainEqual({ path: "renamed-name.txt", additions: 1, deletions: 0 });
        expect(files.map((file) => file.path)).not.toContain("old-name.txt");
      }),
    );

    it.effect("detects renames even when user git config disables rename detection", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* writeTextFile(path.join(tmp, "rename-source.txt"), "one\ntwo\n");
        yield* git(tmp, ["add", "."]);
        yield* git(tmp, ["commit", "-m", "add rename source"]);

        const checkpointStore = yield* CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store-rename-config");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* git(tmp, ["config", "diff.renames", "false"]);
        yield* git(tmp, ["mv", "rename-source.txt", "rename-destination.txt"]);
        yield* writeTextFile(path.join(tmp, "rename-destination.txt"), "one\ntwo\nthree\n");
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const files = yield* checkpointStore.summarizeCheckpointDiff({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
        });

        expect(files).toContainEqual({
          path: "rename-destination.txt",
          additions: 1,
          deletions: 0,
        });
        expect(files.map((file) => file.path)).not.toContain("rename-source.txt");
      }),
    );

    it.effect("preserves unusual destination paths", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const renamePairs = [
          ["space-old.txt", "name with spaces.txt", "space"],
          ["arrow-old.txt", "new => still tricky.txt", "arrow"],
          ["brace-old.txt", "{newbrace}.txt", "brace"],
        ] as const;
        for (const [sourcePath, , contents] of renamePairs) {
          yield* writeTextFile(path.join(tmp, sourcePath), `${contents}\n`);
        }
        yield* git(tmp, ["add", "."]);
        yield* git(tmp, ["commit", "-m", "add unusual rename sources"]);

        const checkpointStore = yield* CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store-unusual-paths");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        for (const [sourcePath, destinationPath, contents] of renamePairs) {
          yield* git(tmp, ["mv", sourcePath, destinationPath]);
          yield* writeTextFile(path.join(tmp, destinationPath), `${contents}\nextra\n`);
        }
        yield* writeTextFile(path.join(tmp, "tab\tnew.txt"), "tab\nextra\n");
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const files = yield* checkpointStore.summarizeCheckpointDiff({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
        });

        expect(files).toHaveLength(4);
        expect(files).toContainEqual({ path: "name with spaces.txt", additions: 1, deletions: 0 });
        expect(files).toContainEqual({
          path: "new => still tricky.txt",
          additions: 1,
          deletions: 0,
        });
        expect(files).toContainEqual({ path: "{newbrace}.txt", additions: 1, deletions: 0 });
        expect(files).toContainEqual({ path: "tab\tnew.txt", additions: 2, deletions: 0 });
        for (const [sourcePath] of renamePairs) {
          expect(files.map((file) => file.path)).not.toContain(sourcePath);
        }
      }),
    );
  });
});
