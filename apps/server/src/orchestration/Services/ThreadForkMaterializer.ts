import type {
  MessageId,
  OrchestrationForkThreadError,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  ThreadId,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface ThreadForkMaterialization {
  readonly importedMessages: ReadonlyArray<OrchestrationMessage>;
  readonly importedProposedPlans: ReadonlyArray<OrchestrationProposedPlan>;
}

export interface ThreadForkMaterializerShape {
  readonly materialize: (input: {
    readonly sourceThreadId: ThreadId;
    readonly sourceUserMessageId: MessageId;
  }) => Effect.Effect<ThreadForkMaterialization, OrchestrationForkThreadError>;
}

export class ThreadForkMaterializer extends Context.Service<
  ThreadForkMaterializer,
  ThreadForkMaterializerShape
>()("t3/orchestration/Services/ThreadForkMaterializer") {}
