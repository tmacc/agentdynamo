import type { OrchestrationEvent } from "@t3tools/contracts";
import { Effect, Option, Queue, Ref, Stream } from "effect";

import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import type { ReplaySafeSubscriptionInput } from "./Services/OrchestrationSubscriptionService.ts";

const REPLAY_WARNING_THRESHOLD = 500;

export function replaySafeOrchestrationStream<Snapshot, Item, E, R>(
  orchestrationEngine: OrchestrationEngineShape,
  input: ReplaySafeSubscriptionInput<Snapshot, Item, E, R>,
) {
  return Stream.unwrap(
    Effect.gen(function* () {
      const liveQueue = yield* Queue.unbounded<OrchestrationEvent>();
      yield* orchestrationEngine.streamDomainEvents.pipe(
        Stream.runForEach((event) => Queue.offer(liveQueue, event)),
        Effect.forkScoped,
      );

      const { snapshot, snapshotSequence } = yield* input.loadSnapshot;
      const lastEmittedSequence = yield* Ref.make(snapshotSequence);

      const toSubscriptionItem = (event: OrchestrationEvent) =>
        input
          .mapEvent(event)
          .pipe(
            Effect.flatMap((item) =>
              Option.isNone(item)
                ? Effect.succeed(Option.none())
                : Ref.modify(lastEmittedSequence, (lastSequence) =>
                    event.sequence > lastSequence
                      ? [item, event.sequence]
                      : [Option.none<unknown>(), lastSequence],
                  ),
            ),
          );

      const replayEvents = yield* orchestrationEngine
        .readEvents(snapshotSequence)
        .pipe(Stream.mapError(input.mapReplayError), Stream.runCollect);
      const replayCount = replayEvents.length;
      if (replayCount > REPLAY_WARNING_THRESHOLD) {
        yield* Effect.logWarning("orchestration.subscription.large-replay", {
          subscriptionName: input.subscriptionName,
          snapshotSequence,
          replayCount,
          latestSequence:
            replayEvents.length === 0
              ? snapshotSequence
              : replayEvents[replayEvents.length - 1]?.sequence,
        });
      }

      const mapEvents = <E2, R2>(
        stream: Stream.Stream<OrchestrationEvent, E2, R2>,
      ): Stream.Stream<unknown, E2, R2> =>
        stream.pipe(
          Stream.mapEffect(toSubscriptionItem),
          Stream.flatMap((event) =>
            Option.isSome(event) ? Stream.succeed(event.value) : Stream.empty,
          ),
        ) as Stream.Stream<unknown, E2, R2>;

      return Stream.concat(
        Stream.make(input.snapshotItem(snapshot)),
        Stream.concat(
          mapEvents(Stream.fromIterable(replayEvents)),
          mapEvents(Stream.fromQueue(liveQueue)),
        ),
      );
    }) as any,
  ) as any;
}
