import type { OrchestrationEvent } from "@t3tools/contracts";
import { Context, Option } from "effect";
import type { Effect, Scope, Stream } from "effect";

import type { OrchestrationEventStoreError } from "../../persistence/Errors.ts";

export interface ReplaySafeSubscriptionInput<Snapshot, Item, E, R> {
  readonly subscriptionName: string;
  readonly loadSnapshot: Effect.Effect<
    { readonly snapshot: Snapshot; readonly snapshotSequence: number },
    E,
    R
  >;
  readonly snapshotItem: (snapshot: Snapshot) => Item;
  readonly mapEvent: (event: OrchestrationEvent) => Effect.Effect<Option.Option<Item>, E, R>;
  readonly mapReplayError: (error: OrchestrationEventStoreError) => E;
}

export interface OrchestrationSubscriptionServiceShape {
  readonly replaySafeStream: <Snapshot, Item, E, R>(
    input: ReplaySafeSubscriptionInput<Snapshot, Item, E, R>,
  ) => Stream.Stream<Item, E, R | Scope.Scope>;
}

export class OrchestrationSubscriptionService extends Context.Service<
  OrchestrationSubscriptionService,
  OrchestrationSubscriptionServiceShape
>()("t3/orchestration/Services/OrchestrationSubscriptionService") {}
