import type {
  OrchestrationForkThreadError,
  OrchestrationForkThreadInput,
  OrchestrationForkThreadResult,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface ThreadForkDispatcherShape {
  readonly forkThread: (
    input: OrchestrationForkThreadInput,
  ) => Effect.Effect<OrchestrationForkThreadResult, OrchestrationForkThreadError>;
}

export class ThreadForkDispatcher extends Context.Service<
  ThreadForkDispatcher,
  ThreadForkDispatcherShape
>()("t3/orchestration/Services/ThreadForkDispatcher") {}
