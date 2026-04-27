import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  attachmentRelativePath,
  createAttachmentId,
  resolveAttachmentPath,
  toSafeThreadAttachmentSegment,
} from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import { GitStatusBroadcaster } from "../../git/Services/GitStatusBroadcaster.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectSetupScriptRunner } from "../../project/Services/ProjectSetupScriptRunner.ts";
import {
  ThreadForkDispatcher,
  type ThreadForkDispatcherShape,
} from "../Services/ThreadForkDispatcher.ts";
import { ThreadForkMaterializer } from "../Services/ThreadForkMaterializer.ts";
import {
  buildTemporaryWorktreeBranchName,
  resolveForkWorktreeBaseBranch,
} from "@t3tools/shared/git";
import {
  CommandId,
  ContextHandoffId,
  MessageId,
  type OrchestrationForkThreadResult,
  OrchestrationForkThreadError,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  ThreadId,
  type ChatAttachment,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema } from "effect";

const serverCommandId = (tag: string): CommandId =>
  CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

const FORK_WORKTREE_PATCH_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

function toForkThreadError(cause: unknown, fallbackMessage: string): OrchestrationForkThreadError {
  return Schema.is(OrchestrationForkThreadError)(cause)
    ? cause
    : new OrchestrationForkThreadError({
        message: cause instanceof Error ? cause.message : fallbackMessage,
        cause,
      });
}

type ForkRow =
  | { readonly kind: "message"; readonly source: OrchestrationMessage }
  | { readonly kind: "plan"; readonly source: OrchestrationProposedPlan };

function sortForkRows(rows: ReadonlyArray<ForkRow>): ReadonlyArray<ForkRow> {
  return [...rows].toSorted((left, right) => {
    const createdAtComparison = left.source.createdAt.localeCompare(right.source.createdAt);
    if (createdAtComparison !== 0) {
      return createdAtComparison;
    }
    if (left.kind !== right.kind) {
      return left.kind === "message" ? -1 : 1;
    }
    const leftId = left.kind === "message" ? left.source.id : String(left.source.id);
    const rightId = right.kind === "message" ? right.source.id : String(right.source.id);
    return leftId.localeCompare(rightId);
  });
}

function timestampAt(baseTimeMs: number, offset: number): string {
  return new Date(baseTimeMs + offset).toISOString();
}

function cloneAttachmentForThread(input: {
  readonly attachmentsDir: string;
  readonly targetThreadId: ThreadId;
  readonly attachment: ChatAttachment;
}): Effect.Effect<ChatAttachment, OrchestrationForkThreadError> {
  return Effect.gen(function* () {
    const sourcePath = resolveAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment: input.attachment,
    });
    if (!sourcePath) {
      return yield* new OrchestrationForkThreadError({
        message: `Imported attachment '${input.attachment.id}' could not be resolved.`,
      });
    }

    const attachmentId = createAttachmentId(input.targetThreadId);
    if (!attachmentId) {
      return yield* new OrchestrationForkThreadError({
        message: "Failed to allocate an attachment id for the forked thread.",
      });
    }

    const clonedAttachment = {
      ...input.attachment,
      id: attachmentId,
    };
    const targetPath = resolveAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment: clonedAttachment,
    });
    if (!targetPath) {
      return yield* new OrchestrationForkThreadError({
        message: `Imported attachment '${input.attachment.id}' could not be re-targeted.`,
      });
    }

    yield* Effect.try({
      try: () => {
        mkdirSync(path.dirname(targetPath), { recursive: true });
        copyFileSync(sourcePath, targetPath);
      },
      catch: (cause) =>
        new OrchestrationForkThreadError({
          message: `Failed to clone imported attachment '${input.attachment.id}'.`,
          cause,
        }),
    });

    return clonedAttachment;
  });
}

const cleanupClonedAttachments = (paths: ReadonlyArray<string>) =>
  Effect.forEach(
    paths,
    (filePath) =>
      Effect.sync(() => {
        rmSync(filePath, { force: true });
      }).pipe(Effect.ignoreCause({ log: true })),
    { concurrency: 1, discard: true },
  ).pipe(Effect.asVoid);

const cleanupThreadAttachmentFiles = (input: {
  readonly attachmentsDir: string;
  readonly threadId: ThreadId;
}) => {
  const threadSegment = toSafeThreadAttachmentSegment(input.threadId);
  if (!threadSegment) {
    return Effect.void;
  }

  return Effect.sync(() => {
    const pendingDirs = [input.attachmentsDir];
    while (pendingDirs.length > 0) {
      const currentDir = pendingDirs.pop();
      if (!currentDir) {
        continue;
      }
      for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        const entryPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          pendingDirs.push(entryPath);
          continue;
        }
        if (entry.name.startsWith(`${threadSegment}-`)) {
          rmSync(entryPath, { force: true });
        }
      }
    }
  }).pipe(Effect.ignoreCause({ log: true }), Effect.asVoid);
};

const removeTemporaryIndexDir = (dir: string) =>
  Effect.sync(() => {
    rmSync(dir, { recursive: true, force: true });
  }).pipe(Effect.ignoreCause({ log: true }), Effect.asVoid);

function buildSourceWorkspaceDirtyPatch(input: {
  readonly git: GitCoreShape;
  readonly sourceWorkspaceCwd: string;
}): Effect.Effect<string, OrchestrationForkThreadError> {
  return Effect.gen(function* () {
    const tempDir = yield* Effect.try({
      try: () => mkdtempSync(path.join(tmpdir(), "dynamo-fork-patch-")),
      catch: (cause) =>
        new OrchestrationForkThreadError({
          message: "Failed to create a temporary Git index for source workspace changes.",
          cause,
        }),
    });
    const indexFile = path.join(tempDir, "index");
    const env = { GIT_INDEX_FILE: indexFile };

    const generatePatch = Effect.gen(function* () {
      yield* input.git.execute({
        operation: "ThreadForkDispatcher.dirtyPatch.readTree",
        cwd: input.sourceWorkspaceCwd,
        args: ["read-tree", "HEAD"],
        env,
      });
      yield* input.git.execute({
        operation: "ThreadForkDispatcher.dirtyPatch.addAll",
        cwd: input.sourceWorkspaceCwd,
        args: ["add", "-A"],
        env,
      });
      const patch = yield* input.git.execute({
        operation: "ThreadForkDispatcher.dirtyPatch.diff",
        cwd: input.sourceWorkspaceCwd,
        args: ["diff", "--cached", "--binary", "--full-index", "HEAD"],
        env,
        maxOutputBytes: FORK_WORKTREE_PATCH_MAX_OUTPUT_BYTES,
        truncateOutputAtMaxBytes: false,
      });
      return patch.stdout;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationForkThreadError({
            message: "Failed to snapshot source workspace changes for the fork.",
            cause,
          }),
      ),
    );

    return yield* generatePatch.pipe(Effect.ensuring(removeTemporaryIndexDir(tempDir)));
  });
}

function applySourceWorkspaceDirtyPatch(input: {
  readonly git: GitCoreShape;
  readonly worktreePath: string;
  readonly patch: string;
}): Effect.Effect<void, OrchestrationForkThreadError> {
  if (input.patch.trim().length === 0) {
    return Effect.void;
  }

  return Effect.gen(function* () {
    yield* input.git.execute({
      operation: "ThreadForkDispatcher.dirtyPatch.check",
      cwd: input.worktreePath,
      args: ["apply", "--check", "--whitespace=nowarn", "-"],
      stdin: input.patch,
      maxOutputBytes: FORK_WORKTREE_PATCH_MAX_OUTPUT_BYTES,
      truncateOutputAtMaxBytes: false,
    });
    yield* input.git.execute({
      operation: "ThreadForkDispatcher.dirtyPatch.apply",
      cwd: input.worktreePath,
      args: ["apply", "--whitespace=nowarn", "-"],
      stdin: input.patch,
      maxOutputBytes: FORK_WORKTREE_PATCH_MAX_OUTPUT_BYTES,
      truncateOutputAtMaxBytes: false,
    });
  }).pipe(
    Effect.mapError(
      (cause) =>
        new OrchestrationForkThreadError({
          message: "Failed to copy source workspace changes into the fork worktree.",
          cause,
        }),
    ),
  );
}

const makeThreadForkDispatcher = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const materializer = yield* ThreadForkMaterializer;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const serverConfig = yield* ServerConfig;
  const git = yield* GitCore;
  const gitStatusBroadcaster = yield* GitStatusBroadcaster;
  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;

  const forkThread: ThreadForkDispatcherShape["forkThread"] = (input) =>
    Effect.gen(function* () {
      const sourceThread = yield* projectionSnapshotQuery
        .getThreadShellById(input.sourceThreadId)
        .pipe(
          Effect.mapError((cause) => toForkThreadError(cause, "Failed to load the source thread.")),
        );
      if (Option.isNone(sourceThread)) {
        return yield* new OrchestrationForkThreadError({
          message: "The source thread was not found.",
        });
      }

      const sourceProject = yield* projectionSnapshotQuery
        .getProjectShellById(sourceThread.value.projectId)
        .pipe(
          Effect.mapError((cause) =>
            toForkThreadError(cause, "Failed to load the source project."),
          ),
        );
      if (Option.isNone(sourceProject)) {
        return yield* new OrchestrationForkThreadError({
          message: "The source project was not found.",
        });
      }

      const childThreadId = ThreadId.make(crypto.randomUUID());
      let cleanupWorkspace = Effect.void;
      let childThreadCreated = false;
      const clonedAttachmentPaths: string[] = [];

      const cleanupForkAttempt = () =>
        Effect.uninterruptible(
          cleanupClonedAttachments(clonedAttachmentPaths).pipe(
            Effect.andThen(
              cleanupThreadAttachmentFiles({
                attachmentsDir: serverConfig.attachmentsDir,
                threadId: childThreadId,
              }),
            ),
            Effect.andThen(cleanupWorkspace),
            Effect.andThen(
              childThreadCreated
                ? orchestrationEngine
                    .dispatch({
                      type: "thread.delete",
                      commandId: serverCommandId("thread-fork-delete"),
                      threadId: childThreadId,
                    })
                    .pipe(Effect.ignoreCause({ log: true }), Effect.asVoid)
                : Effect.void,
            ),
          ),
        );

      return yield* Effect.gen(function* () {
        const forkedAt = new Date().toISOString();
        const defaultTitle = `Fork of ${sourceThread.value.title}`;
        const materialized = yield* materializer.materialize({
          sourceThreadId: input.sourceThreadId,
          sourceUserMessageId: input.sourceUserMessageId,
        });

        let branch: string | null = null;
        let worktreePath: string | null = null;

        if (input.mode === "worktree") {
          const sourceWorkspaceCwd =
            sourceThread.value.worktreePath ?? sourceProject.value.workspaceRoot;
          const sourceWorkspaceStatus = yield* git
            .statusDetailsLocal(sourceWorkspaceCwd)
            .pipe(
              Effect.mapError((cause) =>
                toForkThreadError(cause, "Failed to read the source workspace branch."),
              ),
            );
          const baseBranch = resolveForkWorktreeBaseBranch({
            currentWorkspaceBranch: sourceWorkspaceStatus.branch,
            requestedBaseBranch: input.baseBranch,
            sourceThreadBranch: sourceThread.value.branch,
          });
          if (!baseBranch) {
            return yield* new OrchestrationForkThreadError({
              message: "Worktree forks require a source workspace branch.",
            });
          }
          const sourceDirtyPatch = yield* buildSourceWorkspaceDirtyPatch({
            git,
            sourceWorkspaceCwd,
          });
          const worktree = yield* git
            .createWorktree({
              cwd: sourceProject.value.workspaceRoot,
              branch: baseBranch,
              newBranch: buildTemporaryWorktreeBranchName(),
              path: null,
            })
            .pipe(
              Effect.mapError((cause) =>
                toForkThreadError(cause, "Failed to prepare the fork worktree."),
              ),
            );
          branch = worktree.worktree.branch;
          worktreePath = worktree.worktree.path;
          cleanupWorkspace = git
            .removeWorktree({
              cwd: sourceProject.value.workspaceRoot,
              path: worktreePath,
              force: true,
            })
            .pipe(Effect.ignoreCause({ log: true }), Effect.asVoid);
          yield* applySourceWorkspaceDirtyPatch({
            git,
            worktreePath,
            patch: sourceDirtyPatch,
          });
          yield* gitStatusBroadcaster
            .refreshStatus(worktreePath)
            .pipe(Effect.ignoreCause({ log: true }));
          yield* projectSetupScriptRunner
            .runForThread({
              threadId: childThreadId,
              projectId: sourceThread.value.projectId,
              projectCwd: sourceProject.value.workspaceRoot,
              worktreePath,
            })
            .pipe(
              Effect.mapError((cause) =>
                toForkThreadError(cause, "Failed to start the worktree setup script."),
              ),
            );
        }

        const combinedRows = sortForkRows([
          ...materialized.importedMessages.map((source) => ({ kind: "message" as const, source })),
          ...materialized.importedProposedPlans.map((source) => ({
            kind: "plan" as const,
            source,
          })),
        ]);

        const baseTimeMs = Date.parse(forkedAt);
        const clonedMessages = new Map<string, OrchestrationMessage>();
        const clonedPlans = new Map<string, OrchestrationProposedPlan>();
        let importedUntilAt = forkedAt;

        for (const [index, row] of combinedRows.entries()) {
          const syntheticTimestamp = timestampAt(baseTimeMs, index - combinedRows.length);
          importedUntilAt = syntheticTimestamp;

          if (row.kind === "message") {
            const attachments =
              row.source.attachments && row.source.attachments.length > 0
                ? yield* Effect.forEach(
                    row.source.attachments,
                    (attachment) =>
                      cloneAttachmentForThread({
                        attachmentsDir: serverConfig.attachmentsDir,
                        targetThreadId: childThreadId,
                        attachment,
                      }).pipe(
                        Effect.tap((clonedAttachment) =>
                          Effect.sync(() => {
                            const clonedAttachmentPath = path.join(
                              serverConfig.attachmentsDir,
                              attachmentRelativePath(clonedAttachment),
                            );
                            clonedAttachmentPaths.push(clonedAttachmentPath);
                          }),
                        ),
                      ),
                    { concurrency: 1 },
                  )
                : undefined;

            clonedMessages.set(row.source.id, {
              id: MessageId.make(`message:${crypto.randomUUID()}`),
              role: row.source.role,
              text: row.source.text,
              ...(attachments ? { attachments } : {}),
              turnId: null,
              streaming: row.source.role === "assistant" ? false : row.source.streaming,
              createdAt: syntheticTimestamp,
              updatedAt: syntheticTimestamp,
            });
            continue;
          }

          clonedPlans.set(String(row.source.id), {
            id: `plan:${crypto.randomUUID()}`,
            turnId: null,
            planMarkdown: row.source.planMarkdown,
            implementedAt: row.source.implementedAt === null ? null : syntheticTimestamp,
            implementationThreadId:
              row.source.implementedAt === null ? null : row.source.implementationThreadId,
            createdAt: syntheticTimestamp,
            updatedAt: syntheticTimestamp,
          });
        }

        yield* orchestrationEngine
          .dispatch({
            type: "thread.fork",
            commandId: serverCommandId("thread-fork"),
            handoffId: ContextHandoffId.make(`handoff:${crypto.randomUUID()}`),
            threadId: childThreadId,
            projectId: sourceThread.value.projectId,
            title: defaultTitle,
            modelSelection: sourceThread.value.modelSelection,
            runtimeMode: sourceThread.value.runtimeMode,
            interactionMode: sourceThread.value.interactionMode,
            branch,
            worktreePath,
            forkOrigin: {
              sourceThreadId: input.sourceThreadId,
              sourceThreadTitle: sourceThread.value.title,
              sourceUserMessageId: input.sourceUserMessageId,
              importedUntilAt,
              forkedAt,
            },
            clonedMessages: [...clonedMessages.values()],
            clonedProposedPlans: [...clonedPlans.values()],
            createdAt: forkedAt,
          })
          .pipe(
            Effect.mapError((cause) =>
              toForkThreadError(cause, "Failed to create the forked thread."),
            ),
          );
        childThreadCreated = true;

        const thread = yield* projectionSnapshotQuery
          .getThreadShellById(childThreadId)
          .pipe(
            Effect.mapError((cause) =>
              toForkThreadError(cause, "Failed to load the forked thread."),
            ),
          );
        if (Option.isNone(thread)) {
          return yield* new OrchestrationForkThreadError({
            message: "The forked thread could not be loaded after creation.",
          });
        }

        return {
          thread: thread.value,
        } satisfies OrchestrationForkThreadResult;
      }).pipe(
        Effect.onError(() => cleanupForkAttempt()),
        Effect.mapError((cause) => toForkThreadError(cause, "Failed to fork thread.")),
      );
    });

  return {
    forkThread,
  } satisfies ThreadForkDispatcherShape;
});

export const ThreadForkDispatcherLive = Layer.effect(
  ThreadForkDispatcher,
  makeThreadForkDispatcher,
);
