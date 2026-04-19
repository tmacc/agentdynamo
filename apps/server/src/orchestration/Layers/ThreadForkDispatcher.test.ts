import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import type {
  ChatAttachment,
  OrchestrationCommand,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
} from "@t3tools/contracts";
import { MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Deferred, Effect, Fiber, Layer, Option, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { GitStatusBroadcaster } from "../../git/Services/GitStatusBroadcaster.ts";
import { ProjectSetupScriptRunner } from "../../project/Services/ProjectSetupScriptRunner.ts";
import type { OrchestrationDispatchError } from "../Errors.ts";
import { OrchestrationListenerCallbackError } from "../Errors.ts";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ThreadForkDispatcher } from "../Services/ThreadForkDispatcher.ts";
import {
  ThreadForkMaterializer,
  type ThreadForkMaterialization,
} from "../Services/ThreadForkMaterializer.ts";
import { ThreadForkDispatcherLive } from "./ThreadForkDispatcher.ts";

const createdBaseDirs = new Set<string>();

const sourceProjectId = ProjectId.make("project-source");
const sourceThreadId = ThreadId.make("thread-source");
const defaultModelSelection = {
  provider: "codex",
  model: "gpt-5-codex",
} as const;

function makeSourceThreadShell(
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: sourceThreadId,
    projectId: sourceProjectId,
    title: "Source Thread",
    modelSelection: defaultModelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function makeSourceProjectShell(baseDir: string): OrchestrationProjectShell {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: sourceProjectId,
    title: "Source Project",
    workspaceRoot: path.join(baseDir, "workspace"),
    defaultModelSelection,
    scripts: [],
    createdAt: now,
    updatedAt: now,
  };
}

function makeImageAttachment(id: string, name = "image.png"): ChatAttachment {
  return {
    type: "image",
    id,
    name,
    mimeType: "image/png",
    sizeBytes: 4,
  };
}

function writeAttachmentFixture(
  attachmentsDir: string,
  attachment: ChatAttachment,
  contents = "data",
): void {
  const attachmentPath = resolveAttachmentPath({
    attachmentsDir,
    attachment,
  });
  if (!attachmentPath) {
    throw new Error(`Failed to resolve attachment fixture path for '${attachment.id}'.`);
  }
  fs.mkdirSync(path.dirname(attachmentPath), { recursive: true });
  fs.writeFileSync(attachmentPath, contents);
}

function listAllFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    return entry.isDirectory() ? listAllFiles(fullPath) : [fullPath];
  });
}

function makeDispatcherTestLayer(options: {
  readonly materialized: ThreadForkMaterialization;
  readonly onDispatch?: (
    command: OrchestrationCommand,
  ) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError>;
  readonly onCreateWorktree?: () => { readonly branch: string; readonly path: string };
}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-thread-fork-dispatcher-"));
  createdBaseDirs.add(baseDir);
  const createdThreadIds = new Set<string>();
  const deletedThreadIds = new Set<string>();
  const dispatchedCommands: OrchestrationCommand[] = [];
  const removedWorktrees: Array<{
    readonly cwd: string;
    readonly path: string;
    readonly force: boolean;
  }> = [];

  const dispatch = vi.fn<OrchestrationEngineShape["dispatch"]>((command) => {
    dispatchedCommands.push(command);
    if (command.type === "thread.fork") {
      return (
        options.onDispatch
          ? options.onDispatch(command)
          : Effect.sync(() => {
              createdThreadIds.add(command.threadId);
              return { sequence: dispatchedCommands.length };
            })
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            createdThreadIds.add(command.threadId);
          }),
        ),
      );
    }

    if (command.type === "thread.delete") {
      deletedThreadIds.add(command.threadId);
    }

    return options.onDispatch
      ? options.onDispatch(command)
      : Effect.succeed({ sequence: dispatchedCommands.length });
  });

  const layer = ThreadForkDispatcherLive.pipe(
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery)({
        getSnapshot: () =>
          Effect.die(new Error("getSnapshot should not be called in ThreadForkDispatcher tests")),
        getShellSnapshot: () =>
          Effect.die(
            new Error("getShellSnapshot should not be called in ThreadForkDispatcher tests"),
          ),
        getCounts: () =>
          Effect.die(new Error("getCounts should not be called in ThreadForkDispatcher tests")),
        getActiveProjectByWorkspaceRoot: () =>
          Effect.die(
            new Error(
              "getActiveProjectByWorkspaceRoot should not be called in ThreadForkDispatcher tests",
            ),
          ),
        getProjectShellById: (projectId) =>
          Effect.succeed(
            projectId === sourceProjectId
              ? Option.some(makeSourceProjectShell(baseDir))
              : Option.none(),
          ),
        getFirstActiveThreadIdByProjectId: () =>
          Effect.die(
            new Error(
              "getFirstActiveThreadIdByProjectId should not be called in ThreadForkDispatcher tests",
            ),
          ),
        getThreadCheckpointContext: () =>
          Effect.die(
            new Error(
              "getThreadCheckpointContext should not be called in ThreadForkDispatcher tests",
            ),
          ),
        getThreadShellById: (threadId) =>
          Effect.succeed(
            threadId === sourceThreadId
              ? Option.some(makeSourceThreadShell())
              : createdThreadIds.has(threadId) && !deletedThreadIds.has(threadId)
                ? Option.some(
                    makeSourceThreadShell({
                      id: threadId,
                      title: "Fork of Source Thread",
                    }),
                  )
                : Option.none(),
          ),
        getThreadDetailById: () =>
          Effect.die(
            new Error("getThreadDetailById should not be called in ThreadForkDispatcher tests"),
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(ThreadForkMaterializer)({
        materialize: () => Effect.succeed(options.materialized),
      }),
    ),
    Layer.provide(
      Layer.mock(OrchestrationEngineService)({
        getReadModel: () =>
          Effect.die(new Error("getReadModel should not be called in ThreadForkDispatcher tests")),
        readEvents: () => Stream.empty,
        dispatch,
        streamDomainEvents: Stream.empty,
      }),
    ),
    Layer.provide(
      Layer.mock(GitCore)({
        createWorktree: () =>
          Effect.succeed({
            worktree: options.onCreateWorktree
              ? options.onCreateWorktree()
              : {
                  branch: "fork-worktree-branch",
                  path: path.join(baseDir, "worktrees", "fork-worktree"),
                },
          }),
        removeWorktree: (input) =>
          Effect.sync(() => {
            removedWorktrees.push({
              cwd: input.cwd,
              path: input.path,
              force: input.force ?? false,
            });
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(GitStatusBroadcaster)({
        refreshStatus: () =>
          Effect.succeed({
            isRepo: true,
            hasAnyRemote: true,
            hasOriginRemote: true,
            isDefaultBranch: false,
            branch: "fork-worktree-branch",
            hasWorkingTreeChanges: false,
            workingTree: {
              files: [],
              insertions: 0,
              deletions: 0,
            },
            hasUpstream: true,
            aheadCount: 0,
            behindCount: 0,
            pr: null,
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectSetupScriptRunner)({
        runForThread: () => Effect.succeed({ status: "no-script" as const }),
      }),
    ),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );

  return {
    baseDir,
    layer,
    dispatch,
    dispatchedCommands,
    removedWorktrees,
  };
}

afterEach(() => {
  for (const baseDir of createdBaseDirs) {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
  createdBaseDirs.clear();
});

describe("ThreadForkDispatcher", () => {
  it("removes cloned attachments when cloning fails after at least one copy", async () => {
    const existingAttachment = makeImageAttachment("attachment-existing");
    const missingAttachment = makeImageAttachment("attachment-missing");
    const harness = makeDispatcherTestLayer({
      materialized: {
        importedMessages: [
          {
            id: MessageId.make("message-imported"),
            role: "user" as const,
            text: "Imported message",
            attachments: [existingAttachment, missingAttachment],
            turnId: null,
            streaming: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        importedProposedPlans: [],
      },
    });

    const serverConfig = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ServerConfig;
      }).pipe(Effect.provide(harness.layer)),
    );
    writeAttachmentFixture(serverConfig.attachmentsDir, existingAttachment);

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const dispatcher = yield* ThreadForkDispatcher;
          return yield* dispatcher.forkThread({
            sourceThreadId,
            sourceUserMessageId: MessageId.make("message-source"),
            mode: "local",
          });
        }).pipe(Effect.provide(harness.layer)),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationForkThreadError",
      message: "Failed to clone imported attachments.",
    });

    expect(listAllFiles(serverConfig.attachmentsDir)).toEqual([
      resolveAttachmentPath({
        attachmentsDir: serverConfig.attachmentsDir,
        attachment: existingAttachment,
      }),
    ]);
    expect(harness.dispatchedCommands.map((command) => command.type)).toEqual(["thread.delete"]);
  });

  it("runs workspace cleanup and attempts thread deletion when dispatch fails after worktree prep", async () => {
    const harness = makeDispatcherTestLayer({
      materialized: {
        importedMessages: [],
        importedProposedPlans: [],
      },
      onDispatch: (command) =>
        command.type === "thread.fork"
          ? Effect.fail(
              new OrchestrationListenerCallbackError({
                listener: "domain-event",
                detail: "dispatch exploded",
              }),
            )
          : Effect.succeed({ sequence: 1 }),
    });

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const dispatcher = yield* ThreadForkDispatcher;
          return yield* dispatcher.forkThread({
            sourceThreadId,
            sourceUserMessageId: MessageId.make("message-source"),
            mode: "worktree",
            baseBranch: "main",
          });
        }).pipe(Effect.provide(harness.layer)),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationForkThreadError",
      message: expect.stringContaining("dispatch exploded"),
    });

    expect(harness.removedWorktrees).toHaveLength(1);
    expect(harness.dispatchedCommands.map((command) => command.type)).toEqual([
      "thread.fork",
      "thread.delete",
    ]);
  });

  it("reclaims cloned attachments and worktree state when thread creation dispatch fails", async () => {
    const existingAttachment = makeImageAttachment("attachment-worktree-source");
    const harness = makeDispatcherTestLayer({
      materialized: {
        importedMessages: [
          {
            id: MessageId.make("message-imported"),
            role: "assistant" as const,
            text: "Imported answer",
            attachments: [existingAttachment],
            turnId: null,
            streaming: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        importedProposedPlans: [],
      },
      onDispatch: (command) =>
        command.type === "thread.fork"
          ? Effect.fail(
              new OrchestrationListenerCallbackError({
                listener: "domain-event",
                detail: "dispatch exploded",
              }),
            )
          : Effect.succeed({ sequence: 1 }),
    });

    const serverConfig = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ServerConfig;
      }).pipe(Effect.provide(harness.layer)),
    );
    writeAttachmentFixture(serverConfig.attachmentsDir, existingAttachment);

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const dispatcher = yield* ThreadForkDispatcher;
          return yield* dispatcher.forkThread({
            sourceThreadId,
            sourceUserMessageId: MessageId.make("message-source"),
            mode: "worktree",
            baseBranch: "main",
          });
        }).pipe(Effect.provide(harness.layer)),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationForkThreadError",
      message: expect.stringContaining("dispatch exploded"),
    });

    expect(listAllFiles(serverConfig.attachmentsDir)).toEqual([
      resolveAttachmentPath({
        attachmentsDir: serverConfig.attachmentsDir,
        attachment: existingAttachment,
      }),
    ]);
    expect(harness.removedWorktrees).toHaveLength(1);
    expect(harness.dispatchedCommands.map((command) => command.type)).toContain("thread.delete");
  });

  it("runs the same cleanup path when the fork is interrupted", async () => {
    const existingAttachment = makeImageAttachment("attachment-interrupt-source");
    const forkDispatchGate = await Effect.runPromise(Deferred.make<void, never>());
    const dispatchStarted = await Effect.runPromise(Deferred.make<void, never>());
    const harness = makeDispatcherTestLayer({
      materialized: {
        importedMessages: [
          {
            id: MessageId.make("message-imported"),
            role: "assistant" as const,
            text: "Imported answer",
            attachments: [existingAttachment],
            turnId: null,
            streaming: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        importedProposedPlans: [],
      },
      onDispatch: (command) =>
        command.type === "thread.fork"
          ? Deferred.succeed(dispatchStarted, undefined).pipe(
              Effect.orDie,
              Effect.andThen(Deferred.await(forkDispatchGate).pipe(Effect.as({ sequence: 1 }))),
            )
          : Effect.succeed({ sequence: 1 }),
    });

    const serverConfig = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ServerConfig;
      }).pipe(Effect.provide(harness.layer)),
    );
    writeAttachmentFixture(serverConfig.attachmentsDir, existingAttachment);

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* ThreadForkDispatcher;
        const context = yield* Effect.context<never>();
        const runFork = Effect.runForkWith(context);

        const forkFiber = runFork(
          dispatcher.forkThread({
            sourceThreadId,
            sourceUserMessageId: MessageId.make("message-source"),
            mode: "worktree",
            baseBranch: "main",
          }),
        );

        yield* Deferred.await(dispatchStarted);
        yield* Fiber.interrupt(forkFiber);
        return yield* Fiber.await(forkFiber);
      }).pipe(Effect.provide(harness.layer)),
    );

    expect(exit._tag).toBe("Failure");
    expect(listAllFiles(serverConfig.attachmentsDir)).toEqual([
      resolveAttachmentPath({
        attachmentsDir: serverConfig.attachmentsDir,
        attachment: existingAttachment,
      }),
    ]);
    expect(harness.removedWorktrees).toHaveLength(1);
    expect(harness.dispatchedCommands.map((command) => command.type)).toEqual([
      "thread.fork",
      "thread.delete",
    ]);
  });

  it("assigns imported timestamps strictly before the fork time while preserving row order", async () => {
    const harness = makeDispatcherTestLayer({
      materialized: {
        importedMessages: [
          {
            id: MessageId.make("message-imported-user"),
            role: "user" as const,
            text: "Imported question",
            turnId: null,
            streaming: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: MessageId.make("message-imported-assistant"),
            role: "assistant" as const,
            text: "Imported answer",
            turnId: null,
            streaming: false,
            createdAt: "2026-01-01T00:00:02.000Z",
            updatedAt: "2026-01-01T00:00:02.000Z",
          },
        ],
        importedProposedPlans: [
          {
            id: "plan-imported",
            turnId: null,
            planMarkdown: "Plan",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
      },
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* ThreadForkDispatcher;
        return yield* dispatcher.forkThread({
          sourceThreadId,
          sourceUserMessageId: MessageId.make("message-source"),
          mode: "local",
        });
      }).pipe(Effect.provide(harness.layer)),
    );

    const forkCommand = harness.dispatchedCommands.find(
      (command): command is Extract<OrchestrationCommand, { type: "thread.fork" }> =>
        command.type === "thread.fork",
    );
    expect(result.thread.id).toBeTruthy();
    expect(forkCommand).toBeDefined();
    expect(
      forkCommand!.forkOrigin.importedUntilAt.localeCompare(forkCommand!.forkOrigin.forkedAt),
    ).toBeLessThan(0);

    const orderedImportedTimestamps = [
      ...forkCommand!.clonedMessages.map((message) => message.createdAt),
      ...forkCommand!.clonedProposedPlans.map((plan) => plan.createdAt),
    ].toSorted();
    expect(orderedImportedTimestamps).toEqual([
      forkCommand!.clonedMessages[0]?.createdAt,
      forkCommand!.clonedProposedPlans[0]?.createdAt,
      forkCommand!.clonedMessages[1]?.createdAt,
    ]);
    expect(forkCommand!.forkOrigin.importedUntilAt).toBe(forkCommand!.clonedMessages[1]?.createdAt);
  });
});
