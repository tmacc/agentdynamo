import { describe, expect, it } from "vitest";
import type { OrchestrationEvent } from "@t3tools/contracts";

import {
  coalesceOrchestrationUiEvents,
  shouldApplyProjectionEvent,
  shouldApplyProjectionSnapshot,
  shouldApplyTerminalEvent,
} from "./service";

function makeMessageEvent(input: {
  sequence: number;
  messageId: string;
  text: string;
  streaming: boolean;
  renderMode?: "markdown" | "preformatted";
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: `event-${input.sequence}`,
    type: "thread.message-sent",
    aggregateKind: "thread",
    aggregateId: "thread-1",
    occurredAt: `2026-05-07T00:00:0${input.sequence}.000Z`,
    commandId: `cmd-${input.sequence}`,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId: "thread-1",
      messageId: input.messageId,
      role: "assistant",
      text: input.text,
      ...(input.renderMode !== undefined ? { renderMode: input.renderMode } : {}),
      turnId: "turn-1",
      streaming: input.streaming,
      createdAt: `2026-05-07T00:00:0${input.sequence}.000Z`,
      updatedAt: `2026-05-07T00:00:0${input.sequence}.000Z`,
    },
  } as OrchestrationEvent;
}

describe("shouldApplyTerminalEvent", () => {
  it("applies terminal events for draft-only threads", () => {
    expect(
      shouldApplyTerminalEvent({
        serverThreadArchivedAt: undefined,
        hasDraftThread: true,
      }),
    ).toBe(true);
  });

  it("drops terminal events for unknown threads", () => {
    expect(
      shouldApplyTerminalEvent({
        serverThreadArchivedAt: undefined,
        hasDraftThread: false,
      }),
    ).toBe(false);
  });

  it("drops terminal events for archived server threads even if a draft exists", () => {
    expect(
      shouldApplyTerminalEvent({
        serverThreadArchivedAt: "2026-04-09T00:00:00.000Z",
        hasDraftThread: true,
      }),
    ).toBe(false);
  });

  it("applies terminal events for active server threads", () => {
    expect(
      shouldApplyTerminalEvent({
        serverThreadArchivedAt: null,
        hasDraftThread: false,
      }),
    ).toBe(true);
  });
});

describe("shouldApplyProjectionSnapshot", () => {
  it("accepts the first snapshot for an environment", () => {
    expect(
      shouldApplyProjectionSnapshot({
        current: null,
        next: {
          snapshotSequence: 1,
          updatedAt: "2026-04-22T10:00:00.000Z",
        },
      }),
    ).toBe(true);
  });

  it("drops snapshots with an older sequence", () => {
    expect(
      shouldApplyProjectionSnapshot({
        current: {
          sequence: 5,
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
        next: {
          snapshotSequence: 4,
          updatedAt: "2026-04-22T10:06:00.000Z",
        },
      }),
    ).toBe(false);
  });

  it("drops snapshots with the same sequence and older timestamp", () => {
    expect(
      shouldApplyProjectionSnapshot({
        current: {
          sequence: 5,
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
        next: {
          snapshotSequence: 5,
          updatedAt: "2026-04-22T10:04:59.000Z",
        },
      }),
    ).toBe(false);
  });

  it("accepts snapshots with the same sequence and a newer timestamp", () => {
    expect(
      shouldApplyProjectionSnapshot({
        current: {
          sequence: 5,
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
        next: {
          snapshotSequence: 5,
          updatedAt: "2026-04-22T10:05:01.000Z",
        },
      }),
    ).toBe(true);
  });
});

describe("shouldApplyProjectionEvent", () => {
  it("accepts the first event for an environment", () => {
    expect(
      shouldApplyProjectionEvent({
        current: null,
        sequence: 1,
      }),
    ).toBe(true);
  });

  it("drops stale or duplicate events", () => {
    expect(
      shouldApplyProjectionEvent({
        current: {
          sequence: 5,
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
        sequence: 5,
      }),
    ).toBe(false);
    expect(
      shouldApplyProjectionEvent({
        current: {
          sequence: 5,
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
        sequence: 4,
      }),
    ).toBe(false);
  });

  it("accepts newer events", () => {
    expect(
      shouldApplyProjectionEvent({
        current: {
          sequence: 5,
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
        sequence: 6,
      }),
    ).toBe(true);
  });
});

describe("coalesceOrchestrationUiEvents", () => {
  it("preserves previous render mode when a later coalesced message omits it", () => {
    const events = coalesceOrchestrationUiEvents([
      makeMessageEvent({
        sequence: 1,
        messageId: "assistant:msg-1",
        text: "A",
        streaming: true,
        renderMode: "preformatted",
      }),
      makeMessageEvent({
        sequence: 2,
        messageId: "assistant:msg-1",
        text: "B",
        streaming: true,
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      text: "AB",
      renderMode: "preformatted",
    });
  });

  it("lets a later explicit render mode win when coalescing", () => {
    const events = coalesceOrchestrationUiEvents([
      makeMessageEvent({
        sequence: 1,
        messageId: "assistant:msg-1",
        text: "A",
        streaming: true,
        renderMode: "preformatted",
      }),
      makeMessageEvent({
        sequence: 2,
        messageId: "assistant:msg-1",
        text: "B",
        streaming: true,
        renderMode: "markdown",
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      text: "AB",
      renderMode: "markdown",
    });
  });

  it("does not coalesce message events for different messages", () => {
    const events = coalesceOrchestrationUiEvents([
      makeMessageEvent({
        sequence: 1,
        messageId: "assistant:msg-1",
        text: "A",
        streaming: true,
        renderMode: "preformatted",
      }),
      makeMessageEvent({
        sequence: 2,
        messageId: "assistant:msg-2",
        text: "B",
        streaming: true,
      }),
    ]);

    expect(events).toHaveLength(2);
  });
});
