import {
  ContextHandoffId,
  MessageId,
  OrchestrationProposedPlanId,
  ThreadId,
  TurnId,
  type OrchestrationMessage,
  type OrchestrationThreadContextHandoff,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { renderContextHandoff, type ContextHandoffRenderableThread } from "./contextHandoff.ts";

const threadId = ThreadId.make("thread-context-handoff");
const sourceThreadId = ThreadId.make("source-thread-context-handoff");
const liveMessageId = MessageId.make("live-message");

function message(input: {
  readonly id: string;
  readonly role: OrchestrationMessage["role"];
  readonly text: string;
  readonly createdAt: string;
  readonly attachments?: OrchestrationMessage["attachments"];
}): OrchestrationMessage {
  return {
    id: MessageId.make(input.id),
    role: input.role,
    text: input.text,
    ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
    turnId: null,
    streaming: false,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

function makeHandoff(
  overrides: Partial<OrchestrationThreadContextHandoff> = {},
): OrchestrationThreadContextHandoff {
  return {
    id: ContextHandoffId.make("handoff-context-test"),
    threadId,
    reason: "fork",
    sourceThreadId,
    sourceThreadTitle: "Source thread",
    sourceUserMessageId: MessageId.make("source-user-message"),
    targetProvider: "codex",
    importedUntilAt: "2026-01-01T00:00:03.000Z",
    createdAt: "2026-01-01T00:00:04.000Z",
    status: "pending",
    ...overrides,
  };
}

function makeThread(
  overrides: Partial<ContextHandoffRenderableThread> = {},
): ContextHandoffRenderableThread {
  return {
    id: threadId,
    title: "Fork of Source thread",
    branch: "feature/handoff",
    worktreePath: "/tmp/t3/handoff",
    messages: [
      message({
        id: "imported-user",
        role: "user",
        text: "Please build the feature.",
        createdAt: "2026-01-01T00:00:01.000Z",
        attachments: [
          {
            type: "image",
            id: "screenshot_1",
            name: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 1200,
          },
        ],
      }),
      message({
        id: "imported-assistant",
        role: "assistant",
        text: "I will inspect the repo and draft a plan.",
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
      message({
        id: liveMessageId,
        role: "user",
        text: "Continue now.",
        createdAt: "2026-01-01T00:00:05.000Z",
      }),
    ],
    proposedPlans: [
      {
        id: OrchestrationProposedPlanId.make("plan-imported"),
        turnId: TurnId.make("turn-imported"),
        planMarkdown: "1. Add contracts\n2. Add renderer",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-01-01T00:00:02.500Z",
        updatedAt: "2026-01-01T00:00:02.500Z",
      },
    ],
    activities: [],
    forkOrigin: {
      sourceThreadId,
      sourceThreadTitle: "Source thread",
      sourceUserMessageId: MessageId.make("source-user-message"),
      importedUntilAt: "2026-01-01T00:00:03.000Z",
      forkedAt: "2026-01-01T00:00:04.000Z",
    },
    contextHandoffs: [makeHandoff()],
    ...overrides,
  };
}

describe("renderContextHandoff", () => {
  it("renders transcript, proposed plans, attachment metadata, and live message", () => {
    const liveMessage = makeThread().messages.find((entry) => entry.id === liveMessageId)!;
    const result = renderContextHandoff({
      thread: makeThread(),
      handoff: makeHandoff(),
      liveMessage,
      targetProvider: "codex",
      maxInputChars: 20_000,
      reserveChars: 500,
    });

    expect(result).toBeDefined();
    expect(result?.input).toContain("Context handoff");
    expect(result?.input).toContain("Source thread: Source thread");
    expect(result?.input).toContain("Please build the feature.");
    expect(result?.input).toContain("1. Add contracts");
    expect(result?.input).toContain("screenshot.png (image/png, 1200 bytes)");
    expect(result?.input).toContain("New live user message:\nContinue now.");
    expect(result?.stats).toMatchObject({
      includedMessageCount: 2,
      includedProposedPlanCount: 1,
      includedAttachmentCount: 1,
      omittedItemCount: 0,
      truncated: false,
    });
  });

  it("omits oldest imported rows under budget and reports the omission", () => {
    const thread = makeThread({
      messages: [
        message({
          id: "oldest-imported-user",
          role: "user",
          text: "Oldest imported context ".repeat(20),
          createdAt: "2026-01-01T00:00:00.100Z",
        }),
        ...makeThread().messages,
      ],
    });
    const liveMessage = thread.messages.find((entry) => entry.id === liveMessageId)!;
    const result = renderContextHandoff({
      thread,
      handoff: makeHandoff(),
      liveMessage,
      targetProvider: "codex",
      maxInputChars: 1_050,
      reserveChars: 0,
    });

    expect(result).toBeDefined();
    expect(result?.input).toContain("Older imported context omitted");
    expect(result?.input).toContain("Continue now.");
    expect(result?.stats.omittedItemCount).toBeGreaterThan(0);
    expect(result?.stats.truncated).toBe(true);
  });

  it("falls back to the live message when the budget is too small", () => {
    const liveMessage = makeThread().messages.find((entry) => entry.id === liveMessageId)!;
    const result = renderContextHandoff({
      thread: makeThread(),
      handoff: makeHandoff(),
      liveMessage,
      targetProvider: "codex",
      maxInputChars: 20,
      reserveChars: 0,
    });

    expect(result).toEqual({
      input: "Continue now.",
      stats: {
        includedMessageCount: 0,
        includedProposedPlanCount: 0,
        includedAttachmentCount: 0,
        omittedItemCount: 3,
        truncated: true,
        inputCharCount: "Continue now.".length,
      },
    });
  });

  it("does not render delivered handoffs", () => {
    const liveMessage = makeThread().messages.find((entry) => entry.id === liveMessageId)!;

    expect(
      renderContextHandoff({
        thread: makeThread(),
        handoff: makeHandoff({
          status: "delivered",
          deliveredAt: "2026-01-01T00:00:06.000Z",
          deliveredProvider: "codex",
          deliveredTurnId: TurnId.make("turn-delivered"),
          deliveredLiveMessageId: liveMessageId,
        }),
        liveMessage,
        targetProvider: "codex",
        maxInputChars: 20_000,
        reserveChars: 500,
      }),
    ).toBeUndefined();
  });
});
