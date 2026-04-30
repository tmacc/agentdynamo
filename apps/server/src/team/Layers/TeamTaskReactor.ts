import { createHash } from "node:crypto";

import {
  CommandId,
  type OrchestrationTeamTask,
  type OrchestrationThreadActivity,
  type ThreadId,
} from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { TeamTaskReactor, type TeamTaskReactorShape } from "../Services/TeamTaskReactor.ts";

const commandId = (tag: string): CommandId =>
  CommandId.make(`server:${tag}:${crypto.randomUUID()}`);
const deterministicCommandId = (tag: string): CommandId => CommandId.make(`recovery:${tag}`);
const stableSummaryHash = (summary: string): string =>
  createHash("sha256").update(summary).digest("hex").slice(0, 16);

function latestAssistantSummary(thread: {
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly text: string;
    readonly streaming: boolean;
  }>;
}): string | null {
  const message = thread.messages
    .toReversed()
    .find((entry) => entry.role === "assistant" && !entry.streaming);
  const trimmed = message?.text.trim();
  if (!trimmed) return null;
  return trimmed.length > 2_000 ? `${trimmed.slice(0, 2_000)}...` : trimmed;
}

function isFinal(status: OrchestrationTeamTask["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function hasPendingProviderInteraction(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): boolean {
  const pendingApprovals = new Set<string>();
  const pendingUserInputs = new Set<string>();

  for (const activity of activities) {
    const payload =
      activity.payload !== null &&
      typeof activity.payload === "object" &&
      !Array.isArray(activity.payload)
        ? (activity.payload as Record<string, unknown>)
        : {};
    const requestId = typeof payload.requestId === "string" ? payload.requestId : null;
    if (!requestId) continue;

    if (activity.kind === "approval.requested") {
      pendingApprovals.add(requestId);
    } else if (
      activity.kind === "approval.resolved" ||
      activity.kind === "provider.approval.respond.failed"
    ) {
      pendingApprovals.delete(requestId);
    } else if (activity.kind === "user-input.requested") {
      pendingUserInputs.add(requestId);
    } else if (
      activity.kind === "user-input.resolved" ||
      activity.kind === "provider.user-input.respond.failed"
    ) {
      pendingUserInputs.delete(requestId);
    }
  }

  return pendingApprovals.size > 0 || pendingUserInputs.size > 0;
}

function deriveStatus(input: {
  readonly task: OrchestrationTeamTask;
  readonly childThread: {
    readonly latestTurn: { readonly state: string } | null;
    readonly session: { readonly status: string; readonly lastError: string | null } | null;
    readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  };
}): OrchestrationTeamTask["status"] {
  if (isFinal(input.task.status)) return input.task.status;
  if (hasPendingProviderInteraction(input.childThread.activities)) return "waiting";
  if (
    input.childThread.latestTurn?.state === "error" ||
    input.childThread.session?.status === "error"
  )
    return "failed";
  if (
    input.childThread.latestTurn?.state === "interrupted" ||
    input.childThread.session?.status === "stopped"
  ) {
    return "cancelled";
  }
  if (input.childThread.session?.status === "starting") return "starting";
  if (
    input.childThread.latestTurn?.state === "running" ||
    input.childThread.session?.status === "running" ||
    input.childThread.session?.status === "recovering"
  )
    return "running";
  if (input.childThread.latestTurn?.state === "completed") return "completed";
  return input.task.status;
}

const makeTeamTaskReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;

  const syncChild = Effect.fn("team.syncChild")(function* (
    childThreadId: ThreadId,
    options?: { readonly deterministic?: boolean },
  ) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const childThread = readModel.threads.find((thread) => thread.id === childThreadId);
    if (!childThread?.teamParent) return;
    const parentThread = readModel.threads.find(
      (thread) => thread.id === childThread.teamParent?.parentThreadId,
    );
    const task = parentThread?.teamTasks?.find(
      (entry) => entry.id === childThread.teamParent?.taskId,
    );
    if (!parentThread || !task) return;
    if (task.source !== "dynamo" || !task.childThreadMaterialized) return;

    const nextStatus = deriveStatus({ task, childThread });
    const nextSummary = latestAssistantSummary(childThread);
    const createdAt = new Date().toISOString();
    const makeCommandId = (tag: string) =>
      options?.deterministic
        ? deterministicCommandId(`team-task:${parentThread.id}:${task.id}:${tag}`)
        : commandId(tag);
    if (nextSummary !== null && nextSummary !== task.latestSummary) {
      yield* orchestrationEngine.dispatch({
        type: "thread.team-task.update-summary",
        commandId: makeCommandId(`summary:${stableSummaryHash(nextSummary)}`),
        parentThreadId: parentThread.id,
        taskId: task.id,
        latestSummary: nextSummary,
        createdAt,
      });
    }
    if (nextStatus === task.status) return;
    const base = {
      commandId: makeCommandId(`status:${nextStatus}`),
      parentThreadId: parentThread.id,
      taskId: task.id,
      createdAt,
    };
    switch (nextStatus) {
      case "starting":
        yield* orchestrationEngine.dispatch({ type: "thread.team-task.mark-starting", ...base });
        return;
      case "running":
        yield* orchestrationEngine.dispatch({ type: "thread.team-task.mark-running", ...base });
        return;
      case "waiting":
        yield* orchestrationEngine.dispatch({ type: "thread.team-task.mark-waiting", ...base });
        return;
      case "completed":
        yield* orchestrationEngine.dispatch({
          type: "thread.team-task.mark-completed",
          ...base,
          ...(nextSummary !== null ? { latestSummary: nextSummary } : {}),
        });
        return;
      case "failed":
        yield* orchestrationEngine.dispatch({
          type: "thread.team-task.mark-failed",
          ...base,
          detail: childThread.session?.lastError ?? "Child provider turn failed.",
        });
        return;
      case "cancelled":
        yield* orchestrationEngine.dispatch({
          type: "thread.team-task.mark-cancelled",
          ...base,
          reason: "Child session stopped.",
        });
        return;
      case "queued":
        return;
    }
  });

  const syncAll: TeamTaskReactorShape["syncAll"] = () =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const childThreadIds = readModel.threads
        .filter((thread) => thread.teamParent !== null)
        .map((thread) => thread.id);
      yield* Effect.forEach(
        childThreadIds,
        (childThreadId) => syncChild(childThreadId, { deterministic: true }),
        { concurrency: 1, discard: true },
      );
    }).pipe(
      Effect.catchCause((cause) => Effect.logWarning("team.task.sync-all-failed", { cause })),
    );

  const start = Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
    switch (event.type) {
      case "thread.session-set":
      case "thread.activity-appended":
      case "thread.message-sent":
      case "thread.turn-start-requested":
      case "thread.turn-completed":
      case "thread.turn-diff-completed":
        return syncChild(event.payload.threadId).pipe(Effect.ignoreCause({ log: true }));
      default:
        return Effect.void;
    }
  }).pipe(Effect.forkScoped, Effect.asVoid);

  return { start, syncAll } satisfies TeamTaskReactorShape;
});

export const TeamTaskReactorLive = Layer.effect(TeamTaskReactor, makeTeamTaskReactor);
