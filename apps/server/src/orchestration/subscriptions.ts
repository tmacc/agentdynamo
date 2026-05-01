import type { OrchestrationEvent } from "@t3tools/contracts";
import { Effect, Option, Ref, Stream } from "effect";

import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import type { ReplaySafeSubscriptionInput } from "./Services/OrchestrationSubscriptionService.ts";

const REPLAY_WARNING_THRESHOLD = 500;

export function replaySafeOrchestrationStream<Snapshot, Item, E, R>(
  orchestrationEngine: OrchestrationEngineShape,
  input: ReplaySafeSubscriptionInput<Snapshot, Item, E, R>,
) {
  return Stream.unwrap(
    Effect.gen(function* () {
      const liveSubscription = yield* orchestrationEngine.subscribeDomainEvents();

      const { snapshot, snapshotSequence } = yield* input.loadSnapshot;
      const replayToSequence = yield* orchestrationEngine
        .getLatestSequence()
        .pipe(Effect.mapError(input.mapReplayError));
      const lastEmittedSequence = yield* Ref.make(snapshotSequence);
      const replayCount = yield* Ref.make(0);
      const latestReplaySequence = yield* Ref.make(snapshotSequence);

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

      const mapEvents = <E2, R2>(
        stream: Stream.Stream<OrchestrationEvent, E2, R2>,
      ): Stream.Stream<unknown, E2, R2> =>
        stream.pipe(
          Stream.mapEffect(toSubscriptionItem),
          Stream.flatMap((event) =>
            Option.isSome(event) ? Stream.succeed(event.value) : Stream.empty,
          ),
        ) as Stream.Stream<unknown, E2, R2>;

      const replayEvents = orchestrationEngine
        .readEventsRange({
          fromSequenceExclusive: snapshotSequence,
          toSequenceInclusive: replayToSequence,
        })
        .pipe(
          Stream.mapError(input.mapReplayError),
          Stream.tap((event) =>
            Effect.gen(function* () {
              yield* Ref.update(replayCount, (count) => count + 1);
              yield* Ref.set(latestReplaySequence, event.sequence);
            }),
          ),
          Stream.onEnd(
            Effect.gen(function* () {
              const count = yield* Ref.get(replayCount);
              if (count > REPLAY_WARNING_THRESHOLD) {
                yield* Effect.logWarning("orchestration.subscription.large-replay", {
                  subscriptionName: input.subscriptionName,
                  snapshotSequence,
                  replayToSequence,
                  replayCount: count,
                  latestSequence: yield* Ref.get(latestReplaySequence),
                });
              }
            }),
          ),
        );

      return Stream.concat(
        Stream.make(input.snapshotItem(snapshot)),
        Stream.concat(
          mapEvents(replayEvents),
          mapEvents(Stream.fromSubscription(liveSubscription)),
        ),
      );
    }) as any,
  ) as any;
}
