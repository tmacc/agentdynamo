import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { Cause, Effect, Layer, Stream } from "effect";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { BrowserMcpAccess } from "../../browser/Services/BrowserMcpAccess.ts";
import { TeamCoordinatorAccess } from "../../team/Services/TeamCoordinatorAccess.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ThreadDeletionReactor,
  type ThreadDeletionReactorShape,
} from "../Services/ThreadDeletionReactor.ts";

type ThreadDeletedEvent = Extract<OrchestrationEvent, { type: "thread.deleted" }>;
type TeamCoordinatorGrantRevocationEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.deleted"
      | "thread.archived"
      | "thread.session-stop-requested"
      | "thread.session-set";
  }
>;

export const logCleanupCauseUnlessInterrupted = <R, E>({
  effect,
  message,
  threadId,
}: {
  readonly effect: Effect.Effect<void, E, R>;
  readonly message: string;
  readonly threadId: ThreadDeletedEvent["payload"]["threadId"];
}): Effect.Effect<void, E, R> =>
  effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }
      return Effect.logDebug(message, {
        threadId,
        cause: Cause.pretty(cause),
      });
    }),
  );

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const browserMcpAccess = yield* BrowserMcpAccess;
  const teamCoordinatorAccess = yield* TeamCoordinatorAccess;
  const terminalManager = yield* TerminalManager;

  const stopProviderSession = (threadId: ThreadDeletedEvent["payload"]["threadId"]) =>
    logCleanupCauseUnlessInterrupted({
      effect: providerService.stopSession({ threadId }),
      message: "thread deletion cleanup skipped provider session stop",
      threadId,
    });

  const closeThreadTerminals = (threadId: ThreadDeletedEvent["payload"]["threadId"]) =>
    logCleanupCauseUnlessInterrupted({
      effect: terminalManager.close({ threadId, deleteHistory: true }),
      message: "thread deletion cleanup skipped terminal close",
      threadId,
    });

  const revokeTeamCoordinatorGrants = (threadId: ThreadDeletedEvent["payload"]["threadId"]) =>
    logCleanupCauseUnlessInterrupted({
      effect: teamCoordinatorAccess.revokeForThread({ parentThreadId: threadId }),
      message: "thread cleanup skipped team coordinator grant revocation",
      threadId,
    });

  const revokeBrowserMcpGrants = (threadId: ThreadDeletedEvent["payload"]["threadId"]) =>
    logCleanupCauseUnlessInterrupted({
      effect: browserMcpAccess.revokeForThread({ threadId }),
      message: "thread cleanup skipped browser MCP grant revocation",
      threadId,
    });

  const processThreadLifecycleEvent = Effect.fn("processThreadLifecycleEvent")(function* (
    event: TeamCoordinatorGrantRevocationEvent,
  ) {
    const threadId = event.payload.threadId;
    yield* revokeTeamCoordinatorGrants(threadId);
    yield* revokeBrowserMcpGrants(threadId);
    if (event.type === "thread.deleted") {
      yield* stopProviderSession(threadId);
      yield* closeThreadTerminals(threadId);
    }
  });

  const processThreadLifecycleEventSafely = (event: TeamCoordinatorGrantRevocationEvent) =>
    processThreadLifecycleEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("thread deletion reactor failed to process event", {
          eventType: event.type,
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processThreadLifecycleEventSafely);

  const start: ThreadDeletionReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.deleted" &&
          event.type !== "thread.archived" &&
          event.type !== "thread.session-stop-requested" &&
          (event.type !== "thread.session-set" || event.payload.session.status !== "stopped")
        ) {
          return Effect.void;
        }
        return worker.enqueue(event);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ThreadDeletionReactorShape;
});

export const ThreadDeletionReactorLive = Layer.effect(ThreadDeletionReactor, make);
