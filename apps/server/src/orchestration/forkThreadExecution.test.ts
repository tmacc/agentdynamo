import { MessageId, OrchestrationForkThreadError, ThreadId } from "@t3tools/contracts";
import { Deferred, Effect } from "effect";
import { describe, expect, it } from "vitest";

import { enqueueAndExecuteForkThread } from "./forkThreadExecution.ts";

describe("enqueueAndExecuteForkThread", () => {
  it("waits behind the startup gate before invoking the dispatcher", async () => {
    const forkGate = await Effect.runPromise(Deferred.make<void, never>());
    let dispatcherCalls = 0;

    const forkPromise = Effect.runPromise(
      enqueueAndExecuteForkThread({
        startup: {
          awaitCommandReady: Effect.void,
          markHttpListening: Effect.void,
          enqueueCommand: (effect) => Deferred.await(forkGate).pipe(Effect.andThen(effect)),
        },
        threadForkDispatcher: {
          forkThread: () =>
            Effect.sync(() => {
              dispatcherCalls += 1;
              return {
                thread: {
                  id: ThreadId.make("thread-forked"),
                },
              } as never;
            }),
        },
        forkInput: {
          sourceThreadId: ThreadId.make("thread-source"),
          sourceUserMessageId: MessageId.make("message-source"),
          mode: "local",
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(dispatcherCalls).toBe(0);

    await Effect.runPromise(Deferred.succeed(forkGate, undefined).pipe(Effect.orDie));
    const result = await forkPromise;

    expect(dispatcherCalls).toBe(1);
    expect(result.thread.id).toBe("thread-forked");
  });

  it("normalizes raw dispatcher failures into OrchestrationForkThreadError", async () => {
    await expect(
      Effect.runPromise(
        enqueueAndExecuteForkThread({
          startup: {
            awaitCommandReady: Effect.void,
            markHttpListening: Effect.void,
            enqueueCommand: (effect) => effect,
          },
          threadForkDispatcher: {
            forkThread: () => Effect.fail(new Error("boom") as never),
          },
          forkInput: {
            sourceThreadId: ThreadId.make("thread-source"),
            sourceUserMessageId: MessageId.make("message-source"),
            mode: "local",
          },
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationForkThreadError",
      message: "Failed to fork thread.",
    } satisfies Partial<OrchestrationForkThreadError>);
  });
});
