import type { OrchestrationDispatchCommandError, OrchestrationCommand } from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface ThreadBootstrapDispatcherShape {
  readonly dispatch: (
    command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;
}

export class ThreadBootstrapDispatcher extends Context.Service<
  ThreadBootstrapDispatcher,
  ThreadBootstrapDispatcherShape
>()("t3/orchestration/Services/ThreadBootstrapDispatcher") {}
