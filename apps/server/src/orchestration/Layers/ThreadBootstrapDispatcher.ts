import { Cause, Effect, Layer, Schema } from "effect";
import {
  CommandId,
  EventId,
  OrchestrationDispatchCommandError,
  type OrchestrationCommand,
} from "@t3tools/contracts";

import { GitCore } from "../../git/Services/GitCore.ts";
import { GitStatusBroadcaster } from "../../git/Services/GitStatusBroadcaster.ts";
import { ProjectSetupScriptRunner } from "../../project/Services/ProjectSetupScriptRunner.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ThreadBootstrapDispatcher,
  type ThreadBootstrapDispatcherShape,
} from "../Services/ThreadBootstrapDispatcher.ts";
import { prepareThreadWorkspace } from "../threadWorkspaceBootstrap.ts";

const serverCommandId = (tag: string): CommandId =>
  CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

function toDispatchCommandError(cause: unknown, fallbackMessage: string) {
  return Schema.is(OrchestrationDispatchCommandError)(cause)
    ? cause
    : new OrchestrationDispatchCommandError({
        message: cause instanceof Error ? cause.message : fallbackMessage,
        cause,
      });
}

function toBootstrapDispatchCommandCauseError(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause);
  return Schema.is(OrchestrationDispatchCommandError)(error)
    ? error
    : new OrchestrationDispatchCommandError({
        message: error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
        cause,
      });
}

const makeThreadBootstrapDispatcher = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const git = yield* GitCore;
  const gitStatusBroadcaster = yield* GitStatusBroadcaster;
  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;

  const appendSetupScriptActivity = (input: {
    readonly threadId: Extract<OrchestrationCommand, { type: "thread.turn.start" }>["threadId"];
    readonly tone: "info" | "error";
    readonly kind: string;
    readonly summary: string;
    readonly createdAt: string;
    readonly payload: unknown;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("setup-script-activity"),
      threadId: input.threadId,
      activity: {
        id: EventId.make(crypto.randomUUID()),
        tone: input.tone,
        kind: input.kind,
        summary: input.summary,
        payload: input.payload,
        turnId: null,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const dispatch: ThreadBootstrapDispatcherShape["dispatch"] = (command) =>
    Effect.gen(function* () {
      const bootstrap = command.bootstrap;
      const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
      let createdThread = false;
      let targetProjectId = bootstrap?.createThread?.projectId;
      let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
      let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;
      let targetBranch = bootstrap?.createThread?.branch ?? null;

      const cleanupCreatedThread = () =>
        createdThread
          ? orchestrationEngine
              .dispatch({
                type: "thread.delete",
                commandId: serverCommandId("bootstrap-thread-delete"),
                threadId: command.threadId,
              })
              .pipe(Effect.ignoreCause({ log: true }))
          : Effect.void;

      const recordSetupScriptLaunchFailure = (input: {
        readonly error: unknown;
        readonly requestedAt: string;
        readonly worktreePath: string;
      }) => {
        const detail =
          input.error instanceof Error ? input.error.message : "Unknown setup failure.";
        return appendSetupScriptActivity({
          threadId: command.threadId,
          kind: "setup-script.failed",
          summary: "Setup script failed to start",
          createdAt: input.requestedAt,
          payload: {
            detail,
            worktreePath: input.worktreePath,
          },
          tone: "error",
        }).pipe(
          Effect.ignoreCause({ log: false }),
          Effect.flatMap(() =>
            Effect.logWarning("bootstrap turn start failed to launch setup script", {
              threadId: command.threadId,
              worktreePath: input.worktreePath,
              detail,
            }),
          ),
        );
      };

      const recordSetupScriptStarted = (input: {
        readonly requestedAt: string;
        readonly worktreePath: string;
        readonly scriptId: string;
        readonly scriptName: string;
        readonly terminalId: string;
      }) => {
        const payload = {
          scriptId: input.scriptId,
          scriptName: input.scriptName,
          terminalId: input.terminalId,
          worktreePath: input.worktreePath,
        };
        return Effect.all([
          appendSetupScriptActivity({
            threadId: command.threadId,
            kind: "setup-script.requested",
            summary: "Starting setup script",
            createdAt: input.requestedAt,
            payload,
            tone: "info",
          }),
          appendSetupScriptActivity({
            threadId: command.threadId,
            kind: "setup-script.started",
            summary: "Setup script started",
            createdAt: new Date().toISOString(),
            payload,
            tone: "info",
          }),
        ]).pipe(
          Effect.asVoid,
          Effect.catch((error) =>
            Effect.logWarning(
              "bootstrap turn start launched setup script but failed to record setup activity",
              {
                threadId: command.threadId,
                worktreePath: input.worktreePath,
                scriptId: input.scriptId,
                terminalId: input.terminalId,
                detail: error.message,
              },
            ),
          ),
        );
      };

      const prepareWorkspace = prepareThreadWorkspace({
        git,
        gitStatusBroadcaster,
        projectSetupScriptRunner,
      });

      const bootstrapProgram = Effect.gen(function* () {
        if (bootstrap?.createThread) {
          yield* orchestrationEngine.dispatch({
            type: "thread.create",
            commandId: serverCommandId("bootstrap-thread-create"),
            threadId: command.threadId,
            projectId: bootstrap.createThread.projectId,
            title: bootstrap.createThread.title,
            modelSelection: bootstrap.createThread.modelSelection,
            runtimeMode: bootstrap.createThread.runtimeMode,
            interactionMode: bootstrap.createThread.interactionMode,
            branch: bootstrap.createThread.branch,
            worktreePath: bootstrap.createThread.worktreePath,
            createdAt: bootstrap.createThread.createdAt,
          });
          createdThread = true;
        }

        const workspace = yield* prepareWorkspace({
          threadId: command.threadId,
          ...(targetProjectId ? { projectId: targetProjectId } : {}),
          ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
          currentBranch: targetBranch,
          currentWorktreePath: targetWorktreePath,
          ...(bootstrap?.prepareWorktree
            ? {
                prepareWorktree: {
                  projectCwd: bootstrap.prepareWorktree.projectCwd,
                  baseBranch: bootstrap.prepareWorktree.baseBranch,
                  ...(bootstrap.prepareWorktree.branch
                    ? { branch: bootstrap.prepareWorktree.branch }
                    : {}),
                },
              }
            : {}),
          ...(bootstrap?.runSetupScript !== undefined
            ? { runSetupScript: bootstrap.runSetupScript }
            : {}),
          setupFailureMode: "ignore",
          cleanupOnFailure: false,
          onWorktreeCreated: ({ branch, worktreePath }) =>
            orchestrationEngine
              .dispatch({
                type: "thread.meta.update",
                commandId: serverCommandId("bootstrap-thread-meta-update"),
                threadId: command.threadId,
                branch,
                worktreePath,
              })
              .pipe(
                Effect.asVoid,
                Effect.mapError((cause) =>
                  cause instanceof Error
                    ? cause
                    : new Error("Failed to update thread metadata after worktree creation.", {
                        cause,
                      }),
                ),
              ),
          onSetupLaunchFailure: ({ error, requestedAt, worktreePath }) =>
            recordSetupScriptLaunchFailure({
              error,
              requestedAt,
              worktreePath,
            }).pipe(
              Effect.mapError((cause: unknown) =>
                cause instanceof Error
                  ? cause
                  : new Error("Failed to record setup launch failure.", { cause }),
              ),
            ),
          onSetupStarted: ({ requestedAt, worktreePath, scriptId, scriptName, terminalId }) =>
            recordSetupScriptStarted({
              requestedAt,
              worktreePath,
              scriptId,
              scriptName,
              terminalId,
            }).pipe(
              Effect.mapError((cause: unknown) =>
                cause instanceof Error
                  ? cause
                  : new Error("Failed to record setup start.", { cause }),
              ),
            ),
        });
        targetWorktreePath = workspace.worktreePath;
        targetBranch = workspace.branch;

        return yield* orchestrationEngine
          .dispatch(finalTurnStartCommand)
          .pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          );
      });

      return yield* bootstrapProgram.pipe(
        Effect.catchCause((cause) => {
          const dispatchError = toBootstrapDispatchCommandCauseError(cause);
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.fail(dispatchError);
          }
          return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
        }),
      );
    });

  return {
    dispatch,
  } satisfies ThreadBootstrapDispatcherShape;
});

export const ThreadBootstrapDispatcherLive = Layer.effect(
  ThreadBootstrapDispatcher,
  makeThreadBootstrapDispatcher,
);
