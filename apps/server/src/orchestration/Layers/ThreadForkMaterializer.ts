import {
  type MessageId,
  OrchestrationForkThreadError,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  ThreadId,
  ThreadMessageSentPayload,
  ThreadProposedPlanUpsertedPayload,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

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
  payload: Schema.Schema.Type<typeof ThreadMessageSentPayload>,
): void {
  const existing = state.get(payload.messageId);
  const nextText =
    existing === undefined
      ? payload.text
      : payload.streaming
        ? `${existing.text}${payload.text}`
        : payload.text.length === 0
          ? existing.text
          : payload.text;

  state.set(payload.messageId, {
    id: payload.messageId,
    role: payload.role,
    text: nextText,
    ...(payload.attachments !== undefined
      ? { attachments: payload.attachments }
      : existing?.attachments !== undefined
        ? { attachments: existing.attachments }
        : {}),
    turnId: payload.turnId,
    streaming: payload.streaming,
    createdAt: existing?.createdAt ?? payload.createdAt,
    updatedAt: payload.updatedAt,
  });
}

function applyPlanEvent(
  state: Map<string, OrchestrationProposedPlan>,
  payload: Schema.Schema.Type<typeof ThreadProposedPlanUpsertedPayload>,
): void {
  state.set(payload.proposedPlan.id, payload.proposedPlan);
}

const SourceThreadHistoryRow = Schema.Struct({
  sequence: Schema.Number,
  type: Schema.Literals(["thread.message-sent", "thread.proposed-plan-upserted"]),
  payload: Schema.fromJsonString(Schema.Unknown),
});

const SourceThreadHistoryRequest = Schema.Struct({
  sourceThreadId: ThreadId,
});

const makeThreadForkMaterializer = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listSourceThreadHistoryRows = SqlSchema.findAll({
    Request: SourceThreadHistoryRequest,
    Result: SourceThreadHistoryRow,
    execute: (request) =>
      sql`
        SELECT
          sequence,
          event_type AS "type",
          payload_json AS "payload"
        FROM orchestration_events
        WHERE aggregate_kind = 'thread'
          AND stream_id = ${request.sourceThreadId}
          AND event_type IN ('thread.message-sent', 'thread.proposed-plan-upserted')
        ORDER BY sequence ASC
      `,
  });

  const decodeMessagePayload = Schema.decodeUnknownEffect(ThreadMessageSentPayload);
  const decodeProposedPlanPayload = Schema.decodeUnknownEffect(ThreadProposedPlanUpsertedPayload);

  const materialize: ThreadForkMaterializerShape["materialize"] = (input) =>
    Effect.gen(function* () {
      const sourceRows = yield* listSourceThreadHistoryRows({
        sourceThreadId: input.sourceThreadId,
      }).pipe(
        Effect.mapError((cause) =>
          toForkThreadError("Failed to read the source thread history.", cause),
        ),
      );

      const messages = new Map<MessageId, OrchestrationMessage>();
      const plans = new Map<string, OrchestrationProposedPlan>();

      for (const row of sourceRows) {
        switch (row.type) {
          case "thread.message-sent": {
            const payload = yield* decodeMessagePayload(row.payload).pipe(
              Effect.mapError((cause) =>
                toForkThreadError("Failed to read the source thread history.", cause),
              ),
            );
            applyMessageEvent(messages, payload);
            break;
          }
          case "thread.proposed-plan-upserted": {
            const payload = yield* decodeProposedPlanPayload(row.payload).pipe(
              Effect.mapError((cause) =>
                toForkThreadError("Failed to read the source thread history.", cause),
              ),
            );
            applyPlanEvent(plans, payload);
            break;
          }
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
      if (
        assistantMessages.length === 0 ||
        assistantMessages.some((message) => message.streaming)
      ) {
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
