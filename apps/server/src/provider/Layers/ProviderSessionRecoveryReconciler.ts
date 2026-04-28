import {
  CommandId,
  NativeSubagentTraceItemId,
  type OrchestrationSessionStatus,
  type ProviderSession,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Exit, Layer } from "effect";

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
    readonly providerName: ProviderSession["provider"];
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

  const reconcileNow: ProviderSessionRecoveryReconcilerShape["reconcileNow"] = () =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const threadsById = new Map(readModel.threads.map((thread) => [thread.id, thread] as const));
      const bindings = yield* directory.listBindings();

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
          continue;
        }
        const recovered = yield* Effect.exit(
          providerService.recoverSession({ threadId: binding.threadId }),
        );

        if (Exit.isSuccess(recovered)) {
          const session = recovered.value;
          const recoveredActiveTurnId = session.activeTurnId ?? activeTurnId;
          yield* dispatchSessionSet({
            commandId: `recovery:session-final:${binding.threadId}:${
              recoveredActiveTurnId ?? "none"
            }:${statusFromProviderSession(session)}`,
            threadId: binding.threadId,
            status: statusFromProviderSession(session),
            providerName: session.provider,
            runtimeMode: session.runtimeMode,
            activeTurnId: recoveredActiveTurnId ?? null,
            lastError: session.lastError ?? null,
            now: new Date().toISOString(),
          }).pipe(Effect.ignore);
          if (recoveredActiveTurnId !== null) {
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
                    providerTurnId: String(recoveredActiveTurnId),
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

        const errorText = recovered.cause.toString() || "Provider recovery failed";
        const canResumeMissing = errorText.includes("no provider resume state is persisted");
        const finalStatus: OrchestrationSessionStatus =
          activeTurnId === null ? "error" : canResumeMissing ? "stopped" : "error";
        const turnState =
          activeTurnId === null ? null : canResumeMissing ? "interrupted" : "failed";
        const failedAt = new Date().toISOString();
        if (activeTurnId !== null && turnState !== null) {
          yield* orchestrationEngine
            .dispatch({
              type: "thread.turn.complete",
              commandId: deterministicCommandId(
                `recovery:turn-complete:${binding.threadId}:${activeTurnId}:${turnState}`,
              ),
              threadId: binding.threadId,
              turnId: activeTurnId,
              state: turnState,
              assistantMessageId: null,
              completedAt: failedAt,
              errorText,
              createdAt: failedAt,
            })
            .pipe(Effect.ignore);
          yield* Effect.forEach(
            (thread.teamTasks ?? []).filter(
              (task) =>
                task.source === "native-provider" &&
                !task.childThreadMaterialized &&
                !isFinalTeamTaskStatus(task.status),
            ),
            (task) => {
              if (turnState === "failed") {
                return orchestrationEngine.dispatch({
                  type: "thread.team-task.mark-failed",
                  commandId: deterministicCommandId(
                    `recovery:native-task-failed:${binding.threadId}:${task.id}`,
                  ),
                  parentThreadId: thread.id,
                  taskId: task.id,
                  detail: errorText,
                  createdAt: failedAt,
                });
              }
              return orchestrationEngine.dispatch({
                type: "thread.team-task.mark-cancelled",
                commandId: deterministicCommandId(
                  `recovery:native-task-cancelled:${binding.threadId}:${task.id}`,
                ),
                parentThreadId: thread.id,
                taskId: task.id,
                reason: errorText,
                createdAt: failedAt,
              });
            },
            { concurrency: 1, discard: true },
          ).pipe(Effect.ignore);
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
