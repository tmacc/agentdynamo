import {
  CommandId,
  NativeSubagentTraceItemId,
  type OrchestrationThread,
  type OrchestrationSessionStatus,
  type ProviderSession,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Cause, Effect, Exit, Layer } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import {
  ProviderSessionRecoveryReconciler,
  type ProviderSessionRecoveryReconcilerShape,
} from "../Services/ProviderSessionRecoveryReconciler.ts";
import { ProviderService } from "../Services/ProviderService.ts";

function readPersistedActiveTurnId(runtimePayload: unknown | null | undefined): TurnId | null {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return null;
  }
  const raw = "activeTurnId" in runtimePayload ? runtimePayload.activeTurnId : null;
  return typeof raw === "string" && raw.length > 0 ? TurnId.make(raw) : null;
}

function statusFromProviderSession(session: ProviderSession): OrchestrationSessionStatus {
  switch (session.status) {
    case "connecting":
      return "starting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
      return "ready";
  }
}

function isActiveOrchestrationStatus(status: OrchestrationSessionStatus): boolean {
  return status === "starting" || status === "running" || status === "recovering";
}

function providerNameOrNull(value: string | null): ProviderSession["provider"] | null {
  switch (value) {
    case "codex":
    case "claudeAgent":
    case "cursor":
    case "opencode":
      return value;
    default:
      return null;
  }
}

type RecoveryFailureKind =
  | "missing-resume-state"
  | "unsupported-resume"
  | "provider-error"
  | "unknown";

function recoveryFailureText(cause: Cause.Cause<unknown>): string {
  const messages = Cause.prettyErrors(cause)
    .map((error) => error.message.trim())
    .filter((message) => message.length > 0);
  if (messages.length > 0) {
    return messages.join("\n");
  }
  return Cause.pretty(cause) || "Provider recovery failed";
}

function classifyRecoveryFailure(cause: Cause.Cause<unknown>): RecoveryFailureKind {
  const detail = recoveryFailureText(cause).toLowerCase();
  if (
    detail.includes("no provider resume state is persisted") ||
    detail.includes("missing resume state")
  ) {
    return "missing-resume-state";
  }
  if (detail.includes("resume") && detail.includes("unsupported")) {
    return "unsupported-resume";
  }
  if (detail.includes("provider")) {
    return "provider-error";
  }
  return "unknown";
}

const deterministicCommandId = (value: string) => CommandId.make(value);
const isFinalTeamTaskStatus = (status: string) =>
  status === "completed" || status === "failed" || status === "cancelled";

const makeProviderSessionRecoveryReconciler = Effect.gen(function* () {
  const directory = yield* ProviderSessionDirectory;
  const providerService = yield* ProviderService;
  const orchestrationEngine = yield* OrchestrationEngineService;

  const dispatchSessionSet = (input: {
    readonly commandId: string;
    readonly threadId: ThreadId;
    readonly status: OrchestrationSessionStatus;
    readonly providerName: ProviderSession["provider"] | null;
    readonly runtimeMode: ProviderSession["runtimeMode"];
    readonly activeTurnId: TurnId | null;
    readonly lastError: string | null;
    readonly now: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.session.set",
      commandId: deterministicCommandId(input.commandId),
      threadId: input.threadId,
      session: {
        threadId: input.threadId,
        status: input.status,
        providerName: input.providerName,
        runtimeMode: input.runtimeMode,
        activeTurnId: input.activeTurnId,
        lastError: input.lastError,
        updatedAt: input.now,
      },
      createdAt: input.now,
    });

  const dispatchTurnComplete = (input: {
    readonly commandId: string;
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly state: "failed" | "interrupted";
    readonly errorText: string;
    readonly now: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.turn.complete",
      commandId: deterministicCommandId(input.commandId),
      threadId: input.threadId,
      turnId: input.turnId,
      state: input.state,
      assistantMessageId: null,
      completedAt: input.now,
      errorText: input.errorText,
      createdAt: input.now,
    });

  const settleNativeProviderTasks = (input: {
    readonly thread: OrchestrationThread;
    readonly threadId: ThreadId;
    readonly state: "failed" | "interrupted";
    readonly detail: string;
    readonly now: string;
  }) =>
    Effect.forEach(
      (input.thread.teamTasks ?? []).filter(
        (task) =>
          task.source === "native-provider" &&
          !task.childThreadMaterialized &&
          !isFinalTeamTaskStatus(task.status),
      ),
      (task) => {
        if (input.state === "failed") {
          return orchestrationEngine.dispatch({
            type: "thread.team-task.mark-failed",
            commandId: deterministicCommandId(
              `recovery:native-task-failed:${input.threadId}:${task.id}`,
            ),
            parentThreadId: input.thread.id,
            taskId: task.id,
            detail: input.detail,
            createdAt: input.now,
          });
        }
        return orchestrationEngine.dispatch({
          type: "thread.team-task.mark-cancelled",
          commandId: deterministicCommandId(
            `recovery:native-task-cancelled:${input.threadId}:${task.id}`,
          ),
          parentThreadId: input.thread.id,
          taskId: task.id,
          reason: input.detail,
          createdAt: input.now,
        });
      },
      { concurrency: 1, discard: true },
    ).pipe(Effect.ignore);

  const reconcileNow: ProviderSessionRecoveryReconcilerShape["reconcileNow"] = () =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const threadsById = new Map(readModel.threads.map((thread) => [thread.id, thread] as const));
      const bindings = yield* directory.listBindings();
      const handledThreadIds = new Set<ThreadId>();

      for (const binding of bindings) {
        const thread = threadsById.get(binding.threadId);
        if (!thread || thread.deletedAt !== null || thread.archivedAt !== null) {
          continue;
        }

        const activeTurnId =
          readPersistedActiveTurnId(binding.runtimePayload) ?? thread.session?.activeTurnId ?? null;
        const shouldRecover =
          binding.status === "starting" ||
          binding.status === "running" ||
          binding.status === "recovering" ||
          activeTurnId !== null;

        if (!shouldRecover) {
          continue;
        }
        handledThreadIds.add(binding.threadId);

        const now = new Date().toISOString();
        if (activeTurnId !== null) {
          yield* dispatchSessionSet({
            commandId: `recovery:session-recovering:${binding.threadId}:${activeTurnId}`,
            threadId: binding.threadId,
            status: "recovering",
            providerName: binding.provider,
            runtimeMode: binding.runtimeMode ?? thread.runtimeMode,
            activeTurnId,
            lastError: null,
            now,
          }).pipe(Effect.ignore);
        }

        if (!providerService.recoverSession) {
          yield* Effect.logWarning("provider.session.recovery.unavailable", {
            threadId: binding.threadId,
          });
          if (activeTurnId !== null) {
            const interruptedAt = new Date().toISOString();
            const detail = "Provider recovery is unavailable; active work was interrupted.";
            yield* dispatchTurnComplete({
              commandId: `recovery:turn-complete:${binding.threadId}:${activeTurnId}:interrupted`,
              threadId: binding.threadId,
              turnId: activeTurnId,
              state: "interrupted",
              errorText: detail,
              now: interruptedAt,
            }).pipe(Effect.ignore);
            yield* settleNativeProviderTasks({
              thread,
              threadId: binding.threadId,
              state: "interrupted",
              detail,
              now: interruptedAt,
            });
            yield* dispatchSessionSet({
              commandId: `recovery:session-final:${binding.threadId}:${activeTurnId}:stopped`,
              threadId: binding.threadId,
              status: "stopped",
              providerName: binding.provider,
              runtimeMode: binding.runtimeMode ?? thread.runtimeMode,
              activeTurnId: null,
              lastError: detail,
              now: interruptedAt,
            }).pipe(Effect.ignore);
          }
          continue;
        }
        const recovered = yield* Effect.exit(
          providerService.recoverSession({ threadId: binding.threadId }),
        );

        if (Exit.isSuccess(recovered)) {
          const session = recovered.value;
          const recoveredStatus = statusFromProviderSession(session);
          const recoveredActiveTurnId = session.activeTurnId ?? null;
          if (
            activeTurnId !== null &&
            (recoveredActiveTurnId === null || !isActiveOrchestrationStatus(recoveredStatus))
          ) {
            const settledAt = new Date().toISOString();
            const turnState = recoveredStatus === "error" ? "failed" : "interrupted";
            const detail =
              recoveredStatus === "error"
                ? (session.lastError ?? "Provider recovery failed")
                : "Provider recovery returned without an active turn; active work was interrupted.";
            yield* dispatchTurnComplete({
              commandId: `recovery:turn-complete:${binding.threadId}:${activeTurnId}:${turnState}`,
              threadId: binding.threadId,
              turnId: activeTurnId,
              state: turnState,
              errorText: detail,
              now: settledAt,
            }).pipe(Effect.ignore);
            yield* settleNativeProviderTasks({
              thread,
              threadId: binding.threadId,
              state: turnState,
              detail,
              now: settledAt,
            });
            yield* dispatchSessionSet({
              commandId: `recovery:session-final:${binding.threadId}:${activeTurnId}:${
                recoveredStatus === "error" ? "error" : "stopped"
              }`,
              threadId: binding.threadId,
              status: recoveredStatus === "error" ? "error" : "stopped",
              providerName: session.provider,
              runtimeMode: session.runtimeMode,
              activeTurnId: null,
              lastError: detail,
              now: settledAt,
            }).pipe(Effect.ignore);
            continue;
          }

          const finalActiveTurnId =
            recoveredActiveTurnId !== null && isActiveOrchestrationStatus(recoveredStatus)
              ? recoveredActiveTurnId
              : null;
          yield* dispatchSessionSet({
            commandId: `recovery:session-final:${binding.threadId}:${
              finalActiveTurnId ?? "none"
            }:${recoveredStatus}`,
            threadId: binding.threadId,
            status: recoveredStatus,
            providerName: session.provider,
            runtimeMode: session.runtimeMode,
            activeTurnId: finalActiveTurnId,
            lastError: session.lastError ?? null,
            now: new Date().toISOString(),
          }).pipe(Effect.ignore);
          if (finalActiveTurnId !== null) {
            const recoveredAt = new Date().toISOString();
            yield* Effect.forEach(
              (thread.teamTasks ?? []).filter(
                (task) =>
                  task.source === "native-provider" &&
                  !task.childThreadMaterialized &&
                  !isFinalTeamTaskStatus(task.status),
              ),
              (task) =>
                orchestrationEngine.dispatch({
                  type: "thread.team-task.native-trace.upsert-item",
                  commandId: deterministicCommandId(
                    `recovery:native-trace:${binding.threadId}:${task.id}:restart-gap`,
                  ),
                  parentThreadId: thread.id,
                  taskId: task.id,
                  item: {
                    id: NativeSubagentTraceItemId.make(`recovery:${task.id}:restart-gap`),
                    parentThreadId: thread.id,
                    taskId: task.id,
                    provider: binding.provider,
                    providerThreadId: null,
                    providerTurnId: String(finalActiveTurnId),
                    providerItemId: "restart-gap",
                    providerToolUseId: null,
                    kind: "lifecycle",
                    status: "completed",
                    title: "Recovered after restart",
                    detail:
                      "Some live provider trace events may be unavailable after the app restarted.",
                    text: null,
                    toolName: null,
                    inputSummary: null,
                    outputSummary: null,
                    sequence: Math.max(0, Date.parse(recoveredAt) || 0),
                    createdAt: recoveredAt,
                    updatedAt: recoveredAt,
                    completedAt: recoveredAt,
                  },
                  createdAt: recoveredAt,
                }),
              { concurrency: 1, discard: true },
            ).pipe(Effect.ignore);
          }
          continue;
        }

        const errorText = recoveryFailureText(recovered.cause);
        const failureKind = classifyRecoveryFailure(recovered.cause);
        const isInterruptedRecovery =
          failureKind === "missing-resume-state" || failureKind === "unsupported-resume";
        const finalStatus: OrchestrationSessionStatus =
          activeTurnId === null ? "error" : isInterruptedRecovery ? "stopped" : "error";
        const turnState =
          activeTurnId === null ? null : isInterruptedRecovery ? "interrupted" : "failed";
        const failedAt = new Date().toISOString();
        if (activeTurnId !== null && turnState !== null) {
          yield* dispatchTurnComplete({
            commandId: `recovery:turn-complete:${binding.threadId}:${activeTurnId}:${turnState}`,
            threadId: binding.threadId,
            turnId: activeTurnId,
            state: turnState,
            errorText,
            now: failedAt,
          }).pipe(Effect.ignore);
          yield* settleNativeProviderTasks({
            thread,
            threadId: binding.threadId,
            state: turnState,
            detail: errorText,
            now: failedAt,
          });
        }
        yield* dispatchSessionSet({
          commandId: `recovery:session-final:${binding.threadId}:${activeTurnId ?? "none"}:${finalStatus}`,
          threadId: binding.threadId,
          status: finalStatus,
          providerName: binding.provider,
          runtimeMode: binding.runtimeMode ?? thread.runtimeMode,
          activeTurnId: null,
          lastError: errorText,
          now: failedAt,
        }).pipe(Effect.ignore);
      }

      for (const thread of readModel.threads) {
        const session = thread.session;
        if (
          !session ||
          session.activeTurnId === null ||
          (session.status !== "ready" &&
            session.status !== "stopped" &&
            session.status !== "error") ||
          handledThreadIds.has(thread.id) ||
          thread.deletedAt !== null ||
          thread.archivedAt !== null
        ) {
          continue;
        }
        const repairedAt = new Date().toISOString();
        const detail = `Recovered invalid ${session.status} session with stale active turn; active work was interrupted.`;
        yield* dispatchTurnComplete({
          commandId: `repair:turn-complete:${thread.id}:${session.activeTurnId}:interrupted`,
          threadId: thread.id,
          turnId: session.activeTurnId,
          state: "interrupted",
          errorText: detail,
          now: repairedAt,
        }).pipe(Effect.ignore);
        yield* dispatchSessionSet({
          commandId: `repair:session-clear-active:${thread.id}:${session.activeTurnId}:${session.status}`,
          threadId: thread.id,
          status: session.status,
          providerName: providerNameOrNull(session.providerName),
          runtimeMode: session.runtimeMode,
          activeTurnId: null,
          lastError: session.lastError ?? detail,
          now: repairedAt,
        }).pipe(Effect.ignore);
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider.session.recovery.reconcile-failed", { cause }),
      ),
    );

  return {
    reconcileNow,
  } satisfies ProviderSessionRecoveryReconcilerShape;
});

export const ProviderSessionRecoveryReconcilerLive = Layer.effect(
  ProviderSessionRecoveryReconciler,
  makeProviderSessionRecoveryReconciler,
);
