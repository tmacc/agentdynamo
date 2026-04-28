import { Effect, Layer } from "effect";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  OrchestrationSubscriptionService,
  type OrchestrationSubscriptionServiceShape,
} from "../Services/OrchestrationSubscriptionService.ts";
import { replaySafeOrchestrationStream } from "../subscriptions.ts";

const makeOrchestrationSubscriptionService = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;

  const replaySafeStream: OrchestrationSubscriptionServiceShape["replaySafeStream"] = (input) =>
    replaySafeOrchestrationStream(orchestrationEngine, input);

  return {
    replaySafeStream,
  } satisfies OrchestrationSubscriptionServiceShape;
});

export const OrchestrationSubscriptionServiceLive = Layer.effect(
  OrchestrationSubscriptionService,
  makeOrchestrationSubscriptionService,
);
