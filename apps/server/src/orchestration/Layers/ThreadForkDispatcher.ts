import {
  CommandId,
  MessageId,
  OrchestrationForkThreadError,
  type OrchestrationForkThreadResult,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  ThreadId,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { Effect, Layer, Option, Schema } from "effect";

import { cloneAttachmentForThread } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { GitStatusBroadcaster } from "../../git/Services/GitStatusBroadcaster.ts";
import { ProjectSetupScriptRunner } from "../../project/Services/ProjectSetupScriptRunner.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ThreadForkDispatcher,
  type ThreadForkDispatcherShape,
} from "../Services/ThreadForkDispatcher.ts";
import { ThreadForkMaterializer } from "../Services/ThreadForkMaterializer.ts";
import { prepareThreadWorkspace } from "../threadWorkspaceBootstrap.ts";

const serverCommandId = (tag: string): CommandId =>
  CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

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

const makeThreadForkDispatcher = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const materializer = yield* ThreadForkMaterializer;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const serverConfig = yield* ServerConfig;
  const git = yield* GitCore;
  const gitStatusBroadcaster = yield* GitStatusBroadcaster;
  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;

  const prepareWorkspace = prepareThreadWorkspace({
    git,
    gitStatusBroadcaster,
    projectSetupScriptRunner,
  });

  const forkThread: ThreadForkDispatcherShape["forkThread"] = (input) =>
    Effect.gen(function* () {
      const sourceThread = yield* projectionSnapshotQuery.getThreadShellById(input.sourceThreadId);
      if (Option.isNone(sourceThread)) {
        return yield* new OrchestrationForkThreadError({
          message: "The source thread was not found.",
        });
      }

      const sourceProject = yield* projectionSnapshotQuery.getProjectShellById(
        sourceThread.value.projectId,
      );
      if (Option.isNone(sourceProject)) {
        return yield* new OrchestrationForkThreadError({
          message: "The source project was not found.",
        });
      }

      if (input.mode === "worktree" && !input.baseBranch) {
        return yield* new OrchestrationForkThreadError({
          message: "Worktree forks require a base branch.",
        });
      }

      const childThreadId = ThreadId.make(crypto.randomUUID());
      const forkedAt = new Date().toISOString();
      const defaultTitle = `Fork of ${sourceThread.value.title}`;
      const materialized = yield* materializer.materialize({
        sourceThreadId: input.sourceThreadId,
        sourceUserMessageId: input.sourceUserMessageId,
      });

      const workspace = yield* prepareWorkspace({
        threadId: childThreadId,
        projectId: sourceThread.value.projectId,
        projectCwd: sourceProject.value.workspaceRoot,
        currentBranch: null,
        currentWorktreePath: null,
        ...(input.mode === "worktree" && input.baseBranch
          ? {
              prepareWorktree: {
                projectCwd: sourceProject.value.workspaceRoot,
                baseBranch: input.baseBranch,
                branch: buildTemporaryWorktreeBranchName(),
              },
            }
          : {}),
        runSetupScript: input.mode === "worktree",
        setupFailureMode: "fail-request",
        cleanupOnFailure: true,
      }).pipe(
        Effect.mapError((cause) =>
          toForkThreadError(cause, "Failed to prepare the fork workspace."),
        ),
      );

      const combinedRows = sortForkRows([
        ...materialized.importedMessages.map((source) => ({ kind: "message" as const, source })),
        ...materialized.importedProposedPlans.map((source) => ({ kind: "plan" as const, source })),
      ]);

      const baseTimeMs = Date.parse(forkedAt);
      const clonedMessages = new Map<string, OrchestrationMessage>();
      const clonedPlans = new Map<string, OrchestrationProposedPlan>();
      let importedUntilAt = forkedAt;

      for (const [index, row] of combinedRows.entries()) {
        const syntheticTimestamp = timestampAt(baseTimeMs, index + 1);
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
                    }),
                  { concurrency: 1 },
                ).pipe(
                  Effect.mapError((cause) =>
                    toForkThreadError(cause, "Failed to clone imported attachments."),
                  ),
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

      const cleanupCreatedThread = () =>
        projectionSnapshotQuery.getThreadShellById(childThreadId).pipe(
          Effect.flatMap((thread) =>
            Option.isNone(thread)
              ? Effect.void
              : orchestrationEngine
                  .dispatch({
                    type: "thread.delete",
                    commandId: serverCommandId("fork-thread-delete"),
                    threadId: childThreadId,
                  })
                  .pipe(Effect.ignoreCause({ log: true }), Effect.asVoid),
          ),
          Effect.ignoreCause({ log: true }),
        );

      yield* orchestrationEngine
        .dispatch({
          type: "thread.fork",
          commandId: serverCommandId("thread-fork"),
          threadId: childThreadId,
          projectId: sourceThread.value.projectId,
          title: defaultTitle,
          modelSelection: sourceThread.value.modelSelection,
          runtimeMode: sourceThread.value.runtimeMode,
          interactionMode: sourceThread.value.interactionMode,
          branch: input.mode === "worktree" ? workspace.branch : null,
          worktreePath: input.mode === "worktree" ? workspace.worktreePath : null,
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
          Effect.tapError(() =>
            workspace.cleanup.pipe(
              Effect.flatMap(() => cleanupCreatedThread()),
              Effect.ignoreCause({ log: true }),
            ),
          ),
        );

      const threadShell = yield* projectionSnapshotQuery.getThreadShellById(childThreadId).pipe(
        Effect.mapError((cause) => toForkThreadError(cause, "Failed to load the forked thread.")),
        Effect.flatMap((thread) =>
          Option.match(thread, {
            onNone: () =>
              Effect.fail(
                new OrchestrationForkThreadError({
                  message: "The forked thread was created but could not be loaded.",
                }),
              ),
            onSome: (loadedThread) =>
              Effect.succeed({
                thread: loadedThread,
              } satisfies OrchestrationForkThreadResult),
          }),
        ),
      );

      return threadShell;
    }).pipe(Effect.mapError((cause) => toForkThreadError(cause, "Failed to fork thread.")));

  return {
    forkThread,
  } satisfies ThreadForkDispatcherShape;
});

export const ThreadForkDispatcherLive = Layer.effect(
  ThreadForkDispatcher,
  makeThreadForkDispatcher,
);
