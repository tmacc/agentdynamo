import { MessageId, type OrchestrationReadModel } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildProviderSwitchHandoff } from "./providerSwitchHandoff.ts";

const asMessageId = (value: string): MessageId => MessageId.make(value);

function makeThread(): OrchestrationReadModel["threads"][number] {
  return {
    id: "thread-1",
    title: "Switch Thread",
    branch: "feature/switch",
    worktreePath: "/tmp/switch-thread",
    messages: [
      {
        id: asMessageId("message-1"),
        role: "user",
        text: "Context group A",
        attachments: [],
        createdAt: "2026-04-19T12:00:00.000Z",
      },
      {
        id: asMessageId("message-2"),
        role: "assistant",
        text: "Reply group A",
        attachments: [],
        createdAt: "2026-04-19T12:01:00.000Z",
      },
      {
        id: asMessageId("message-3"),
        role: "user",
        text: "Context group B",
        attachments: [],
        createdAt: "2026-04-19T12:02:00.000Z",
      },
    ],
    checkpoints: [
      {
        turnId: "turn-1",
        status: "completed",
        completedAt: "2026-04-19T12:03:00.000Z",
        files: [],
      },
    ],
  } as unknown as OrchestrationReadModel["threads"][number];
}

describe("buildProviderSwitchHandoff", () => {
  it("uses full mode when no incremental sync state is provided", () => {
    const handoff = buildProviderSwitchHandoff({
      thread: makeThread(),
      fromProvider: "codex",
      toProvider: "claudeAgent",
      currentMessageId: asMessageId("message-3"),
    });

    expect(handoff.mode).toBe("full");
    expect(handoff.text).toContain("Provider switch handoff for an existing thread.");
    expect(handoff.text).toContain("Context group A");
  });

  it("uses delta mode when the sync markers are valid", () => {
    const handoff = buildProviderSwitchHandoff({
      thread: makeThread(),
      fromProvider: "codex",
      toProvider: "claudeAgent",
      currentMessageId: asMessageId("message-3"),
      incrementalSyncState: {
        latestMessageId: "message-1",
        latestCheckpointTurnId: null,
        latestTurnId: null,
        branch: "feature/switch",
        worktreePath: "/tmp/switch-thread",
        syncedAt: "2026-04-19T12:00:30.000Z",
      },
    });

    expect(handoff.mode).toBe("delta");
    expect(handoff.text).toContain("Incremental provider switch catch-up for an existing thread.");
    expect(handoff.text).toContain("Reply group A");
    expect(handoff.text).not.toContain("Context group A");
  });

  it("falls back to full mode when the message marker is missing", () => {
    const handoff = buildProviderSwitchHandoff({
      thread: makeThread(),
      fromProvider: "codex",
      toProvider: "claudeAgent",
      currentMessageId: asMessageId("message-3"),
      incrementalSyncState: {
        latestMessageId: "missing-message",
        latestCheckpointTurnId: null,
        latestTurnId: null,
        branch: "feature/switch",
        worktreePath: "/tmp/switch-thread",
        syncedAt: "2026-04-19T12:00:30.000Z",
      },
    });

    expect(handoff.mode).toBe("full");
    expect(handoff.fallbackReason).toBe("message-marker-missing");
  });

  it("falls back to full mode when the checkpoint marker is missing", () => {
    const handoff = buildProviderSwitchHandoff({
      thread: makeThread(),
      fromProvider: "codex",
      toProvider: "claudeAgent",
      currentMessageId: asMessageId("message-3"),
      incrementalSyncState: {
        latestMessageId: "message-1",
        latestCheckpointTurnId: "missing-turn",
        latestTurnId: null,
        branch: "feature/switch",
        worktreePath: "/tmp/switch-thread",
        syncedAt: "2026-04-19T12:00:30.000Z",
      },
    });

    expect(handoff.mode).toBe("full");
    expect(handoff.fallbackReason).toBe("checkpoint-marker-missing");
  });

  it("falls back to full mode when the branch differs", () => {
    const handoff = buildProviderSwitchHandoff({
      thread: makeThread(),
      fromProvider: "codex",
      toProvider: "claudeAgent",
      currentMessageId: asMessageId("message-3"),
      incrementalSyncState: {
        latestMessageId: "message-1",
        latestCheckpointTurnId: null,
        latestTurnId: null,
        branch: "feature/other",
        worktreePath: "/tmp/switch-thread",
        syncedAt: "2026-04-19T12:00:30.000Z",
      },
    });

    expect(handoff.mode).toBe("full");
    expect(handoff.fallbackReason).toBe("branch-mismatch");
  });

  it("falls back to full mode when the worktree differs", () => {
    const handoff = buildProviderSwitchHandoff({
      thread: makeThread(),
      fromProvider: "codex",
      toProvider: "claudeAgent",
      currentMessageId: asMessageId("message-3"),
      incrementalSyncState: {
        latestMessageId: "message-1",
        latestCheckpointTurnId: null,
        latestTurnId: null,
        branch: "feature/switch",
        worktreePath: "/tmp/other-worktree",
        syncedAt: "2026-04-19T12:00:30.000Z",
      },
    });

    expect(handoff.mode).toBe("full");
    expect(handoff.fallbackReason).toBe("worktree-mismatch");
  });
});
