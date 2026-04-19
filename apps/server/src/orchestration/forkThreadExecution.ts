import {
  OrchestrationForkThreadError,
  type OrchestrationForkThreadInput,
  type OrchestrationForkThreadResult,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";

import type { ServerRuntimeStartupShape } from "../serverRuntimeStartup.ts";
import type { ThreadForkDispatcherShape } from "./Services/ThreadForkDispatcher.ts";

function normalizeForkThreadError(
  cause: unknown,
  fallbackMessage: string,
): OrchestrationForkThreadError {
  return Schema.is(OrchestrationForkThreadError)(cause)
    ? cause
    : new OrchestrationForkThreadError({
        message: fallbackMessage,
        cause,
      });
}

export const enqueueAndExecuteForkThread = (input: {
  readonly startup: ServerRuntimeStartupShape;
  readonly threadForkDispatcher: ThreadForkDispatcherShape;
  readonly forkInput: OrchestrationForkThreadInput;
}): Effect.Effect<OrchestrationForkThreadResult, OrchestrationForkThreadError> =>
  input.startup
    .enqueueCommand(
      input.threadForkDispatcher
        .forkThread(input.forkInput)
        .pipe(
          Effect.mapError((cause) => normalizeForkThreadError(cause, "Failed to fork thread.")),
        ),
    )
    .pipe(Effect.mapError((cause) => normalizeForkThreadError(cause, "Failed to fork thread.")));
