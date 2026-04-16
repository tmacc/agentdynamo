import {
  CommandId,
  EventId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationTeamTask,
} from "@t3tools/contracts";
import { Cause, Effect, Layer, Stream } from "effect";
import { hasPendingProviderInteraction } from "@t3tools/shared/pendingInteractions";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { latestAssistantSummary } from "../teamTaskPresentation.ts";
import { TeamTaskReactor, type TeamTaskReactorShape } from "../Services/TeamTaskReactor.ts";

const serverCommandId = (tag: string): CommandId =>
  CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

function isFinalStatus(status: OrchestrationTeamTask["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function deriveTaskStatus(input: {
  readonly task: OrchestrationTeamTask;
  readonly childThread: {
    readonly latestTurn: { readonly state: string } | null;
    readonly session: { readonly status: string; readonly lastError: string | null } | null;
    readonly activities: ReadonlyArray<unknown>;
    readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
  };
}): OrchestrationTeamTask {
  const { task, childThread } = input;
  let status = task.status;
  if (hasPendingProviderInteraction(childThread.activities as never)) {
    status = "waiting";
  } else if (childThread.latestTurn?.state === "error" || childThread.session?.status === "error") {
    status = "failed";
  } else if (
    childThread.latestTurn?.state === "interrupted" ||
    childThread.session?.status === "stopped"
  ) {
    status = "cancelled";
  } else if (childThread.session?.status === "starting") {
    status = "starting";
  } else if (
    childThread.latestTurn?.state === "running" ||
    childThread.session?.status === "running"
  ) {
    status = "running";
  } else if (childThread.latestTurn?.state === "completed") {
    status = "completed";
  }

  const now = new Date().toISOString();
  return {
    ...task,
    status,
    latestSummary: latestAssistantSummary(childThread) ?? task.latestSummary,
    errorText:
      status === "failed" ? (childThread.session?.lastError ?? task.errorText) : task.errorText,
    startedAt: task.startedAt ?? (status === "queued" ? null : now),
    completedAt: isFinalStatus(status) ? (task.completedAt ?? now) : null,
    updatedAt: now,
  };
}

const makeTeamTaskReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const lastSeenStatusByTaskId = new Map<string, OrchestrationTeamTask["status"]>();

  const appendParentActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind: string;
    readonly summary: string;
    readonly payload: unknown;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("team-task-activity"),
      threadId: input.threadId,
      activity: {
        id: EventId.make(crypto.randomUUID()),
        tone: input.kind.endsWith("failed") ? "error" : "info",
        kind: input.kind,
        summary: input.summary,
        payload: input.payload,
        turnId: null,
        createdAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    });

  const maybeSyncChildTaskState = Effect.fn("maybeSyncChildTaskState")(function* (
    threadId: ThreadId,
  ) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const childThread = readModel.threads.find((thread) => thread.id === threadId);
    if (!childThread) {
      return;
    }
    const parentThread = readModel.threads.find((thread) =>
      (thread.teamTasks ?? []).some((task) => task.childThreadId === threadId),
    );
    if (!parentThread) {
      return;
    }
    const task = (parentThread.teamTasks ?? []).find((entry) => entry.childThreadId === threadId);
    if (!task) {
      return;
    }
    const nextTask = deriveTaskStatus({ task, childThread });
    if (
      nextTask.status === task.status &&
      nextTask.latestSummary === task.latestSummary &&
      nextTask.errorText === task.errorText
    ) {
      return;
    }
    yield* orchestrationEngine.dispatch({
      type: "thread.team-task.upsert",
      commandId: serverCommandId("team-task-sync"),
      parentThreadId: parentThread.id,
      teamTask: nextTask,
      createdAt: nextTask.updatedAt,
    });
  });

  const processDomainEvent = (event: OrchestrationEvent) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.team-task-spawn-requested":
          lastSeenStatusByTaskId.set(event.payload.teamTask.id, event.payload.teamTask.status);
          yield* appendParentActivity({
            threadId: event.payload.parentThreadId,
            kind: "team.task.spawned",
            summary: `Spawned child task: ${event.payload.teamTask.title}`,
            payload: {
              taskId: event.payload.teamTask.id,
              childThreadId: event.payload.teamTask.childThreadId,
              roleLabel: event.payload.teamTask.roleLabel,
            },
          });
          return;

        case "thread.team-task-upserted": {
          const previousStatus = lastSeenStatusByTaskId.get(event.payload.teamTask.id) ?? null;
          lastSeenStatusByTaskId.set(event.payload.teamTask.id, event.payload.teamTask.status);
          if (previousStatus === event.payload.teamTask.status) {
            return;
          }
          if (event.payload.teamTask.status === "completed") {
            yield* appendParentActivity({
              threadId: event.payload.parentThreadId,
              kind: "team.task.completed",
              summary: `Child task completed: ${event.payload.teamTask.title}`,
              payload: {
                taskId: event.payload.teamTask.id,
                childThreadId: event.payload.teamTask.childThreadId,
              },
            });
            return;
          }
          if (event.payload.teamTask.status === "failed") {
            yield* appendParentActivity({
              threadId: event.payload.parentThreadId,
              kind: "team.task.failed",
              summary: `Child task failed: ${event.payload.teamTask.title}`,
              payload: {
                taskId: event.payload.teamTask.id,
                childThreadId: event.payload.teamTask.childThreadId,
                errorText: event.payload.teamTask.errorText,
              },
            });
            return;
          }
          if (event.payload.teamTask.status === "cancelled") {
            yield* appendParentActivity({
              threadId: event.payload.parentThreadId,
              kind: "team.task.cancelled",
              summary: `Child task cancelled: ${event.payload.teamTask.title}`,
              payload: {
                taskId: event.payload.teamTask.id,
                childThreadId: event.payload.teamTask.childThreadId,
              },
            });
          }
          return;
        }

        case "thread.session-set":
        case "thread.activity-appended":
        case "thread.message-sent":
        case "thread.turn-start-requested":
        case "thread.turn-diff-completed":
          yield* maybeSyncChildTaskState(event.payload.threadId);
          return;

        default:
          return;
      }
    }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("team task reactor failed to process domain event", {
          eventId: event.eventId,
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const start: TeamTaskReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, processDomainEvent),
    );
  });

  return {
    start,
  } satisfies TeamTaskReactorShape;
});

export const TeamTaskReactorLive = Layer.effect(TeamTaskReactor, makeTeamTaskReactor);
