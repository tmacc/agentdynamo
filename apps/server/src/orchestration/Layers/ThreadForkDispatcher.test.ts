import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  ThreadId,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import { Effect, Layer, Option, Stream } from "effect";
import { expect } from "vitest";

import { ServerConfig } from "../../config.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import {
  GitStatusBroadcaster,
  type GitStatusBroadcasterShape,
} from "../../git/Services/GitStatusBroadcaster.ts";
import {
  ProjectSetupScriptRunner,
  type ProjectSetupScriptRunnerShape,
} from "../../project/Services/ProjectSetupScriptRunner.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ThreadForkDispatcher } from "../Services/ThreadForkDispatcher.ts";
import {
  ThreadForkMaterializer,
  type ThreadForkMaterializerShape,
} from "../Services/ThreadForkMaterializer.ts";
import { ThreadForkDispatcherLive } from "./ThreadForkDispatcher.ts";

const now = "2026-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-fork-test");
const sourceThreadId = ThreadId.make("thread-source");
const sourceUserMessageId = MessageId.make("message-source-user");
const modelSelection = {
  provider: "codex",
  model: "gpt-5.5",
} satisfies ModelSelection;

function makeTempRepoDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function removeTempDir(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

function runGit(
  git: GitCoreShape,
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, unknown> {
  return git
    .execute({
      operation: "ThreadForkDispatcher.test.git",
      cwd,
      args,
      timeoutMs: 10_000,
      maxOutputBytes: 1024 * 1024,
      truncateOutputAtMaxBytes: false,
    })
    .pipe(Effect.map((result) => result.stdout.trim()));
}

function initRepo(git: GitCoreShape, repoDir: string): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    yield* git.initRepo({ cwd: repoDir });
    yield* runGit(git, repoDir, ["config", "user.email", "test@example.com"]);
    yield* runGit(git, repoDir, ["config", "user.name", "Test User"]);
    writeFileSync(path.join(repoDir, "README.md"), "main\n");
    yield* runGit(git, repoDir, ["add", "."]);
    yield* runGit(git, repoDir, ["commit", "-m", "initial"]);
  });
}

function commitFile(input: {
  readonly git: GitCoreShape;
  readonly repoDir: string;
  readonly fileName: string;
  readonly contents: string;
  readonly message: string;
}): Effect.Effect<string, unknown> {
  return Effect.gen(function* () {
    writeFileSync(path.join(input.repoDir, input.fileName), input.contents);
    yield* runGit(input.git, input.repoDir, ["add", input.fileName]);
    yield* runGit(input.git, input.repoDir, ["commit", "-m", input.message]);
    return yield* runGit(input.git, input.repoDir, ["rev-parse", "HEAD"]);
  });
}

function projectShell(repoDir: string): OrchestrationProjectShell {
  return {
    id: projectId,
    title: "Fork Test Project",
    workspaceRoot: repoDir,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    worktreeSetup: null,
    createdAt: now,
    updatedAt: now,
  };
}

function sourceThreadShell(overrides: {
  readonly branch: string | null;
  readonly worktreePath?: string | null;
}): OrchestrationThreadShell {
  return {
    id: sourceThreadId,
    projectId,
    title: "Source Thread",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: overrides.branch,
    worktreePath: overrides.worktreePath ?? null,
    latestTurn: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    session: null,
    contextHandoffs: [],
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function makeProjectionQuery(input: {
  readonly repoDir: string;
  readonly sourceThread: OrchestrationThreadShell;
  readonly commands: ReadonlyArray<OrchestrationCommand>;
}): ProjectionSnapshotQueryShape {
  return {
    getSnapshot: () => Effect.die("getSnapshot should not be called"),
    getShellSnapshot: () => Effect.die("getShellSnapshot should not be called"),
    getCounts: () => Effect.die("getCounts should not be called"),
    getActiveProjectByWorkspaceRoot: () =>
      Effect.die("getActiveProjectByWorkspaceRoot should not be called"),
    getProjectShellById: (nextProjectId) =>
      Effect.succeed(
        nextProjectId === projectId ? Option.some(projectShell(input.repoDir)) : Option.none(),
      ),
    getFirstActiveThreadIdByProjectId: () =>
      Effect.die("getFirstActiveThreadIdByProjectId should not be called"),
    getThreadCheckpointContext: () => Effect.die("getThreadCheckpointContext should not be called"),
    getThreadDetailById: () => Effect.die("getThreadDetailById should not be called"),
    getTeamTaskTrace: () => Effect.die("getTeamTaskTrace should not be called"),
    getThreadShellById: (threadId) => {
      if (threadId === sourceThreadId) {
        return Effect.succeed(Option.some(input.sourceThread));
      }

      const forkCommand = input.commands.find(
        (command): command is Extract<OrchestrationCommand, { type: "thread.fork" }> =>
          command.type === "thread.fork" && command.threadId === threadId,
      );
      if (!forkCommand) {
        return Effect.succeed(Option.none());
      }

      return Effect.succeed(
        Option.some({
          ...input.sourceThread,
          id: forkCommand.threadId,
          title: forkCommand.title,
          branch: forkCommand.branch,
          worktreePath: forkCommand.worktreePath,
          forkOrigin: forkCommand.forkOrigin,
          createdAt: forkCommand.createdAt,
          updatedAt: forkCommand.createdAt,
        }),
      );
    },
  };
}

function makeEngine(commands: OrchestrationCommand[]): OrchestrationEngineShape {
  return {
    getReadModel: () => Effect.die("getReadModel should not be called"),
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    dispatch: (command) =>
      Effect.sync(() => {
        commands.push(command);
        return { sequence: commands.length };
      }),
  };
}

function makeMaterializer(): ThreadForkMaterializerShape {
  return {
    materialize: () =>
      Effect.succeed({
        importedMessages: [],
        importedProposedPlans: [],
      }),
  };
}

function makeStatusBroadcaster(): GitStatusBroadcasterShape {
  return {
    getStatus: () => Effect.die("getStatus should not be called"),
    refreshLocalStatus: () => Effect.die("refreshLocalStatus should not be called"),
    refreshStatus: () =>
      Effect.succeed({
        isRepo: true,
        hasOriginRemote: false,
        isDefaultBranch: false,
        branch: "fork",
        hasWorkingTreeChanges: false,
        workingTree: { files: [], insertions: 0, deletions: 0 },
        hasUpstream: false,
        aheadCount: 0,
        behindCount: 0,
        pr: null,
      }),
    streamStatus: () => Stream.empty,
  };
}

function runFork(input: {
  readonly repoDir: string;
  readonly sourceThread: OrchestrationThreadShell;
  readonly baseBranch?: string;
  readonly commands?: OrchestrationCommand[];
  readonly gitOverride?: GitCoreShape;
  readonly setupScriptRunner?: ProjectSetupScriptRunnerShape;
}) {
  const commands = input.commands ?? [];
  const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-thread-fork-dispatcher-test-",
  });
  const gitLayer = input.gitOverride ? Layer.succeed(GitCore, input.gitOverride) : GitCoreLive;
  const dependencies = Layer.mergeAll(
    gitLayer,
    Layer.succeed(ProjectionSnapshotQuery, makeProjectionQuery({ ...input, commands })),
    Layer.succeed(OrchestrationEngineService, makeEngine(commands)),
    Layer.succeed(ThreadForkMaterializer, makeMaterializer()),
    Layer.succeed(GitStatusBroadcaster, makeStatusBroadcaster()),
    Layer.succeed(
      ProjectSetupScriptRunner,
      input.setupScriptRunner ?? {
        runForThread: () => Effect.succeed({ status: "no-script" as const }),
      },
    ),
  ).pipe(Layer.provideMerge(serverConfigLayer), Layer.provideMerge(NodeServices.layer));
  const layer = ThreadForkDispatcherLive.pipe(Layer.provide(dependencies));

  return Effect.gen(function* () {
    const dispatcher = yield* ThreadForkDispatcher;
    const result = yield* dispatcher.forkThread({
      sourceThreadId,
      sourceUserMessageId,
      mode: "worktree",
      ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
    });
    return { result, commands };
  }).pipe(Effect.provide(layer));
}

const GitCoreTestLayer = GitCoreLive.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-thread-fork-git-test-" })),
  Layer.provide(NodeServices.layer),
);
const TestLayer = Layer.mergeAll(NodeServices.layer, GitCoreTestLayer);

it.layer(TestLayer)("ThreadForkDispatcher", (it) => {
  it.effect("forks from the exact non-default source branch HEAD", () =>
    Effect.gen(function* () {
      const repoDir = makeTempRepoDir("dynamo-thread-fork-branch-");
      const git = yield* GitCore;

      yield* Effect.gen(function* () {
        yield* initRepo(git, repoDir);
        yield* runGit(git, repoDir, ["checkout", "-b", "feature/source"]);
        yield* commitFile({
          git,
          repoDir,
          fileName: "feature.txt",
          contents: "feature branch content\n",
          message: "feature commit",
        });

        const { result } = yield* runFork({
          repoDir,
          sourceThread: sourceThreadShell({ branch: "main" }),
        });

        expect(result.thread.worktreePath).not.toBeNull();
        expect(readFileSync(path.join(result.thread.worktreePath!, "feature.txt"), "utf8")).toBe(
          "feature branch content\n",
        );
      }).pipe(Effect.ensuring(Effect.sync(() => removeTempDir(repoDir))));
    }),
  );

  it.effect("forks from detached HEAD instead of stale thread metadata", () =>
    Effect.gen(function* () {
      const repoDir = makeTempRepoDir("dynamo-thread-fork-detached-");
      const git = yield* GitCore;

      yield* Effect.gen(function* () {
        yield* initRepo(git, repoDir);
        const detachedSha = yield* commitFile({
          git,
          repoDir,
          fileName: "detached.txt",
          contents: "detached content\n",
          message: "detached-only commit",
        });
        yield* runGit(git, repoDir, ["checkout", "--detach", detachedSha]);

        const { result } = yield* runFork({
          repoDir,
          sourceThread: sourceThreadShell({ branch: "main" }),
        });

        expect(result.thread.worktreePath).not.toBeNull();
        expect(readFileSync(path.join(result.thread.worktreePath!, "detached.txt"), "utf8")).toBe(
          "detached content\n",
        );
      }).pipe(Effect.ensuring(Effect.sync(() => removeTempDir(repoDir))));
    }),
  );

  it.effect("copies dirty non-ignored source changes before setup runs", () =>
    Effect.gen(function* () {
      const repoDir = makeTempRepoDir("dynamo-thread-fork-dirty-");
      const git = yield* GitCore;
      const setupCalls: string[] = [];

      yield* Effect.gen(function* () {
        yield* initRepo(git, repoDir);
        writeFileSync(path.join(repoDir, ".gitignore"), "ignored.txt\n");
        writeFileSync(path.join(repoDir, "delete-me.txt"), "delete me\n");
        yield* runGit(git, repoDir, ["add", ".gitignore", "delete-me.txt"]);
        yield* runGit(git, repoDir, ["commit", "-m", "tracked fixtures"]);

        writeFileSync(path.join(repoDir, "README.md"), "dirty readme\n");
        unlinkSync(path.join(repoDir, "delete-me.txt"));
        writeFileSync(path.join(repoDir, "untracked.txt"), "new untracked\n");
        writeFileSync(path.join(repoDir, "ignored.txt"), "ignored\n");

        const { result } = yield* runFork({
          repoDir,
          sourceThread: sourceThreadShell({ branch: "main" }),
          setupScriptRunner: {
            runForThread: (input) =>
              Effect.sync(() => {
                setupCalls.push(input.worktreePath);
                expect(readFileSync(path.join(input.worktreePath, "README.md"), "utf8")).toBe(
                  "dirty readme\n",
                );
                expect(existsSync(path.join(input.worktreePath, "delete-me.txt"))).toBe(false);
                expect(readFileSync(path.join(input.worktreePath, "untracked.txt"), "utf8")).toBe(
                  "new untracked\n",
                );
                expect(existsSync(path.join(input.worktreePath, "ignored.txt"))).toBe(false);
                return { status: "no-script" as const };
              }),
          },
        });

        expect(setupCalls).toEqual([result.thread.worktreePath]);
        const status = yield* runGit(git, result.thread.worktreePath!, ["status", "--porcelain"]);
        expect(status.split(/\r?\n/g).toSorted()).toEqual([
          " D delete-me.txt",
          "?? untracked.txt",
          "M README.md",
        ]);
      }).pipe(Effect.ensuring(Effect.sync(() => removeTempDir(repoDir))));
    }),
  );

  it.effect("removes the worktree and temporary branch when setup fails", () =>
    Effect.gen(function* () {
      const repoDir = makeTempRepoDir("dynamo-thread-fork-cleanup-");
      const git = yield* GitCore;

      yield* Effect.gen(function* () {
        yield* initRepo(git, repoDir);
        const exit = yield* runFork({
          repoDir,
          sourceThread: sourceThreadShell({ branch: "main" }),
          setupScriptRunner: {
            runForThread: () => Effect.fail(new Error("setup failed")),
          },
        }).pipe(Effect.result);

        expect(exit._tag).toBe("Failure");
        const branches = (yield* runGit(git, repoDir, ["branch", "--format=%(refname:short)"]))
          .split(/\r?\n/g)
          .filter((branch) => branch.length > 0);
        expect(branches.some((branch) => isTemporaryWorktreeBranch(branch))).toBe(false);
        const worktrees = yield* runGit(git, repoDir, ["worktree", "list", "--porcelain"]);
        expect(worktrees).not.toContain("t3code-");
      }).pipe(Effect.ensuring(Effect.sync(() => removeTempDir(repoDir))));
    }),
  );

  it.effect("removes the worktree and temporary branch when patch application fails", () =>
    Effect.gen(function* () {
      const repoDir = makeTempRepoDir("dynamo-thread-fork-patch-fail-");
      const git = yield* GitCore;
      const commands: OrchestrationCommand[] = [];

      yield* Effect.gen(function* () {
        yield* initRepo(git, repoDir);
        writeFileSync(path.join(repoDir, "README.md"), "dirty readme\n");

        const conflictingGit: GitCoreShape = {
          ...git,
          createWorktree: (input) =>
            git.createWorktree(input).pipe(
              Effect.tap((result) =>
                Effect.sync(() => {
                  writeFileSync(path.join(result.worktree.path, "README.md"), "conflict\n");
                }),
              ),
            ),
        };

        const exit = yield* runFork({
          repoDir,
          sourceThread: sourceThreadShell({ branch: "main" }),
          commands,
          gitOverride: conflictingGit,
        }).pipe(Effect.result);

        expect(exit._tag).toBe("Failure");
        expect(commands.some((command) => command.type === "thread.fork")).toBe(false);
        const branches = (yield* runGit(git, repoDir, ["branch", "--format=%(refname:short)"]))
          .split(/\r?\n/g)
          .filter((branch) => branch.length > 0);
        expect(branches.some((branch) => isTemporaryWorktreeBranch(branch))).toBe(false);
        const worktrees = yield* runGit(git, repoDir, ["worktree", "list", "--porcelain"]);
        expect(worktrees).not.toContain("t3code-");
      }).pipe(Effect.ensuring(Effect.sync(() => removeTempDir(repoDir))));
    }),
  );

  it.effect("retries once when source HEAD moves during snapshot validation", () =>
    Effect.gen(function* () {
      const repoDir = makeTempRepoDir("dynamo-thread-fork-head-retry-");
      const git = yield* GitCore;
      let sourceHeadCalls = 0;

      yield* Effect.gen(function* () {
        yield* initRepo(git, repoDir);

        const movingHeadGit: GitCoreShape = {
          ...git,
          execute: (input) => {
            if (input.operation !== "ThreadForkDispatcher.sourceHead") {
              return git.execute(input);
            }

            sourceHeadCalls += 1;
            return git.execute(input).pipe(
              Effect.map((result) =>
                sourceHeadCalls === 2
                  ? {
                      ...result,
                      stdout: "0000000000000000000000000000000000000000\n",
                    }
                  : result,
              ),
            );
          },
        };

        const { result } = yield* runFork({
          repoDir,
          sourceThread: sourceThreadShell({ branch: "main" }),
          gitOverride: movingHeadGit,
        });

        expect(sourceHeadCalls).toBe(4);
        expect(result.thread.worktreePath).not.toBeNull();
        expect(readFileSync(path.join(result.thread.worktreePath!, "README.md"), "utf8")).toBe(
          "main\n",
        );
      }).pipe(Effect.ensuring(Effect.sync(() => removeTempDir(repoDir))));
    }),
  );
});
