import {
  type MessageId,
  type OrchestrationEvent,
  OrchestrationForkThreadError,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
} from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";

import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import {
  ThreadForkMaterializer,
  type ThreadForkMaterialization,
  type ThreadForkMaterializerShape,
} from "../Services/ThreadForkMaterializer.ts";

function toForkThreadError(message: string, cause?: unknown): OrchestrationForkThreadError {
  return new OrchestrationForkThreadError({
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function sortMessages(
  messages: ReadonlyArray<OrchestrationMessage>,
): ReadonlyArray<OrchestrationMessage> {
  return [...messages].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

function sortPlans(
  plans: ReadonlyArray<OrchestrationProposedPlan>,
): ReadonlyArray<OrchestrationProposedPlan> {
  return [...plans].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      String(left.id).localeCompare(String(right.id)),
  );
}

function applyMessageEvent(
  state: Map<MessageId, OrchestrationMessage>,
  event: Extract<OrchestrationEvent, { type: "thread.message-sent" }>,
): void {
  const existing = state.get(event.payload.messageId);
  const nextText =
    existing === undefined
      ? event.payload.text
      : event.payload.streaming
        ? `${existing.text}${event.payload.text}`
        : event.payload.text.length === 0
          ? existing.text
          : event.payload.text;
  state.set(event.payload.messageId, {
    id: event.payload.messageId,
    role: event.payload.role,
    text: nextText,
    ...(event.payload.attachments !== undefined
      ? { attachments: event.payload.attachments }
      : existing?.attachments !== undefined
        ? { attachments: existing.attachments }
        : {}),
    turnId: event.payload.turnId,
    streaming: event.payload.streaming,
    createdAt: existing?.createdAt ?? event.payload.createdAt,
    updatedAt: event.payload.updatedAt,
  });
}

function applyPlanEvent(
  state: Map<string, OrchestrationProposedPlan>,
  event: Extract<OrchestrationEvent, { type: "thread.proposed-plan-upserted" }>,
): void {
  state.set(event.payload.proposedPlan.id, event.payload.proposedPlan);
}

const makeThreadForkMaterializer = Effect.gen(function* () {
  const eventStore = yield* OrchestrationEventStore;

  const materialize: ThreadForkMaterializerShape["materialize"] = (input) =>
    Effect.gen(function* () {
      const sourceEvents = yield* eventStore
        .readStream({
          aggregateKind: "thread",
          streamId: input.sourceThreadId,
        })
        .pipe(
          Stream.runCollect,
          Effect.mapError((cause) =>
            toForkThreadError("Failed to read the source thread history.", cause),
          ),
        );

      const messages = new Map<MessageId, OrchestrationMessage>();
      const plans = new Map<string, OrchestrationProposedPlan>();

      for (const event of sourceEvents) {
        switch (event.type) {
          case "thread.message-sent":
            applyMessageEvent(messages, event);
            break;
          case "thread.proposed-plan-upserted":
            applyPlanEvent(plans, event);
            break;
          default:
            break;
        }
      }

      const sortedMessages = sortMessages([...messages.values()]);
      const selectedMessageIndex = sortedMessages.findIndex(
        (message) => message.id === input.sourceUserMessageId,
      );
      if (selectedMessageIndex < 0) {
        return yield* toForkThreadError("The selected message was not found on the source thread.");
      }

      const selectedMessage = sortedMessages[selectedMessageIndex];
      if (!selectedMessage || selectedMessage.role !== "user") {
        return yield* toForkThreadError("Thread forks can only target a settled user message.");
      }

      const nextUserMessage = sortedMessages
        .slice(selectedMessageIndex + 1)
        .find((message) => message.role === "user");
      const importedMessages = sortedMessages.filter((message, index) => {
        if (index <= selectedMessageIndex) {
          return true;
        }
        if (!nextUserMessage) {
          return true;
        }
        return (
          message.createdAt.localeCompare(nextUserMessage.createdAt) < 0 ||
          (message.createdAt === nextUserMessage.createdAt && message.id < nextUserMessage.id)
        );
      });

      const responseBlock = importedMessages.slice(selectedMessageIndex + 1);
      const assistantMessages = responseBlock.filter((message) => message.role === "assistant");
      if (assistantMessages.length === 0) {
        return yield* toForkThreadError(
          "The selected user message does not have a settled assistant response.",
        );
      }
      if (assistantMessages.some((message) => message.streaming)) {
        return yield* toForkThreadError(
          "The selected user message does not have a settled assistant response.",
        );
      }

      const importedProposedPlans = sortPlans([...plans.values()]).filter((plan) =>
        nextUserMessage ? plan.createdAt.localeCompare(nextUserMessage.createdAt) < 0 : true,
      );

      return {
        importedMessages,
        importedProposedPlans,
      } satisfies ThreadForkMaterialization;
    });

  return {
    materialize,
  } satisfies ThreadForkMaterializerShape;
});

export const ThreadForkMaterializerLive = Layer.effect(
  ThreadForkMaterializer,
  makeThreadForkMaterializer,
);
