import { describe, expect, it } from "vitest";
import { EventId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  computeStableMessagesTimelineRows,
  computeMessageDurationStart,
  deriveMessagesTimelineRows,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
} from "./MessagesTimeline.logic";
import { deriveTeamTaskLaunchGroups } from "./teamTaskTimeline";

function makeTeamTaskView(input: {
  id: string;
  title: string;
  createdAt: string;
  status?: "queued" | "starting" | "running" | "waiting" | "completed" | "failed" | "cancelled";
}) {
  return {
    task: {
      id: input.id as never,
      parentThreadId: "thread-parent" as never,
      childThreadId: `thread-child:${input.id}` as never,
      title: input.title,
      roleLabel: input.title,
      modelSelection: { provider: "codex" as const, model: "gpt-5.4-mini" },
      workspaceMode: "worktree" as const,
      status: input.status ?? "queued",
      latestSummary: null,
      errorText: null,
      createdAt: input.createdAt,
      startedAt: null,
      completedAt: null,
      updatedAt: input.createdAt,
    },
    diffSummary: null,
    elapsed: null,
  };
}

function makeActivity(input: {
  id: string;
  kind: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(input.id),
    tone: input.kind.includes("failed") ? "error" : "info",
    kind: input.kind,
    summary: input.kind,
    payload: input.payload ?? {},
    turnId: null,
    createdAt: input.createdAt,
  };
}

describe("computeMessageDurationStart", () => {
  it("returns message createdAt when there is no preceding user message", () => {
    const result = computeMessageDurationStart([
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:05Z",
        completedAt: "2026-01-01T00:00:10Z",
      },
    ]);
    expect(result).toEqual(new Map([["a1", "2026-01-01T00:00:05Z"]]));
  });

  it("uses the user message createdAt for the first assistant response", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("uses the previous assistant completedAt for subsequent assistant responses", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        completedAt: "2026-01-01T00:00:55Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:30Z"],
      ]),
    );
  });

  it("does not advance the boundary for a streaming message without completedAt", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      { id: "a1", role: "assistant", createdAt: "2026-01-01T00:00:30Z" },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        completedAt: "2026-01-01T00:00:55Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("resets the boundary on a new user message", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
      { id: "u2", role: "user", createdAt: "2026-01-01T00:01:00Z" },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:01:20Z",
        completedAt: "2026-01-01T00:01:20Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["u2", "2026-01-01T00:01:00Z"],
        ["a2", "2026-01-01T00:01:00Z"],
      ]),
    );
  });

  it("handles system messages without affecting the boundary", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      { id: "s1", role: "system", createdAt: "2026-01-01T00:00:01Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["s1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("returns empty map for empty input", () => {
    expect(computeMessageDurationStart([])).toEqual(new Map());
  });
});

describe("normalizeCompactToolLabel", () => {
  it("removes trailing completion wording from command labels", () => {
    expect(normalizeCompactToolLabel("Ran command complete")).toBe("Ran command");
  });

  it("removes trailing completion wording from other labels", () => {
    expect(normalizeCompactToolLabel("Read file completed")).toBe("Read file");
  });
});

describe("resolveAssistantMessageCopyState", () => {
  it("returns enabled copy state for completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Ship it",
        streaming: false,
      }),
    ).toEqual({
      text: "Ship it",
      visible: true,
    });
  });

  it("hides copy while an assistant message is still streaming", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Still streaming",
        streaming: true,
      }),
    ).toEqual({
      text: "Still streaming",
      visible: false,
    });
  });

  it("hides copy for empty completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "   ",
        streaming: false,
      }),
    ).toEqual({
      text: null,
      visible: false,
    });
  });

  it("hides copy for non-terminal assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: false,
        text: "Interim thought",
        streaming: false,
      }),
    ).toEqual({
      text: "Interim thought",
      visible: false,
    });
  });
});

describe("deriveMessagesTimelineRows", () => {
  it("only enables assistant copy for the terminal assistant message in a turn", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-1-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Write a poem",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "I should ground this first.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            completedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Here is the poem.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            completedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: "assistant-final-entry",
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      userMessageSwitchInfoByMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows).toHaveLength(2);
    expect(assistantRows[0]?.showAssistantCopyButton).toBe(false);
    expect(assistantRows[1]?.showAssistantCopyButton).toBe(true);
    expect(assistantRows[1]?.showCompletionDivider).toBe(true);
  });

  it("projects assistant diff summaries and user revert counts onto the affected rows", () => {
    const assistantTurnDiffSummary = {
      turnId: "turn-1" as never,
      completedAt: "2026-01-01T00:00:30Z",
      assistantMessageId: "assistant-1" as never,
      checkpointTurnCount: 2,
      files: [{ path: "src/index.ts", additions: 3, deletions: 1 }],
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Do the thing",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-1" as never,
            role: "assistant",
            text: "Done",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            completedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map([
        ["assistant-1" as never, assistantTurnDiffSummary],
      ]),
      revertTurnCountByUserMessageId: new Map([["user-1" as never, 1]]),
      userMessageSwitchInfoByMessageId: new Map(),
    });

    const userRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "user",
    );
    const assistantRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(userRow?.revertTurnCount).toBe(1);
    expect(assistantRow?.assistantTurnDiffSummary).toBe(assistantTurnDiffSummary);
  });

  it("projects provider switch metadata onto the affected user message row", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Continue in Claude",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      userMessageSwitchInfoByMessageId: new Map([
        [
          "user-1" as never,
          {
            fromProvider: "codex",
            toProvider: "claudeAgent",
            toModel: "claude-opus-4-6",
          },
        ],
      ]),
    });

    const userRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "user",
    );

    expect(userRow?.userMessageSwitchInfo).toEqual({
      fromProvider: "codex",
      toProvider: "claudeAgent",
      toModel: "claude-opus-4-6",
    });
  });

  it("shows the fork button only for user messages with a settled assistant response block", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-settled-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-settled" as never,
            role: "user",
            text: "Settled prompt",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-settled-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:05Z",
          message: {
            id: "assistant-settled" as never,
            role: "assistant",
            text: "Done",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:05Z",
            completedAt: "2026-01-01T00:00:06Z",
            streaming: false,
          },
        },
        {
          id: "user-streaming-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "user-streaming" as never,
            role: "user",
            text: "Streaming prompt",
            turnId: null,
            createdAt: "2026-01-01T00:00:10Z",
            streaming: false,
          },
        },
        {
          id: "assistant-streaming-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:15Z",
          message: {
            id: "assistant-streaming" as never,
            role: "assistant",
            text: "Still going",
            turnId: "turn-2" as never,
            createdAt: "2026-01-01T00:00:15Z",
            streaming: true,
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      userMessageSwitchInfoByMessageId: new Map(),
    });

    const settledUserRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.id === ("user-settled" as never),
    );
    const streamingUserRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.id === ("user-streaming" as never),
    );

    expect(settledUserRow?.showForkButton).toBe(true);
    expect(streamingUserRow?.showForkButton).toBe(false);
  });

  it("inserts the fork separator after imported rows and before post-fork rows", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "imported-user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:01.000Z",
          message: {
            id: "imported-user" as never,
            role: "user",
            text: "Imported question",
            turnId: null,
            createdAt: "2026-01-01T00:00:01.000Z",
            streaming: false,
          },
        },
        {
          id: "post-fork-user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:03.000Z",
          message: {
            id: "post-fork-user" as never,
            role: "user",
            text: "New question",
            turnId: null,
            createdAt: "2026-01-01T00:00:03.000Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      userMessageSwitchInfoByMessageId: new Map(),
      forkOrigin: {
        sourceThreadId: "thread-source" as never,
        sourceThreadTitle: "Parent thread",
        sourceUserMessageId: "message-source" as never,
        importedUntilAt: "2026-01-01T00:00:02.000Z",
        forkedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(rows.map((row) => row.kind)).toEqual(["message", "fork-separator", "message"]);
    expect(rows[1]).toEqual({
      kind: "fork-separator",
      id: "fork-separator:2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:02.000Z",
      sourceThreadId: "thread-source",
      sourceThreadTitle: "Parent thread",
    });
  });

  it("appends the fork separator when there are no post-fork rows yet", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "imported-user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:01.000Z",
          message: {
            id: "imported-user" as never,
            role: "user",
            text: "Imported question",
            turnId: null,
            createdAt: "2026-01-01T00:00:01.000Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      userMessageSwitchInfoByMessageId: new Map(),
      forkOrigin: {
        sourceThreadId: "thread-source" as never,
        sourceThreadTitle: "Parent thread",
        sourceUserMessageId: "message-source" as never,
        importedUntilAt: "2026-01-01T00:00:02.000Z",
        forkedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(rows.at(-1)?.kind).toBe("fork-separator");
  });

  it("keeps an immediate post-fork message after the separator when imported rows are backdated", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "imported-user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00.998Z",
          message: {
            id: "imported-user" as never,
            role: "user",
            text: "Imported question",
            turnId: null,
            createdAt: "2026-01-01T00:00:00.998Z",
            streaming: false,
          },
        },
        {
          id: "post-fork-user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:01.000Z",
          message: {
            id: "post-fork-user" as never,
            role: "user",
            text: "New question",
            turnId: null,
            createdAt: "2026-01-01T00:00:01.000Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      userMessageSwitchInfoByMessageId: new Map(),
      forkOrigin: {
        sourceThreadId: "thread-source" as never,
        sourceThreadTitle: "Parent thread",
        sourceUserMessageId: "message-source" as never,
        importedUntilAt: "2026-01-01T00:00:00.999Z",
        forkedAt: "2026-01-01T00:00:01.000Z",
      },
    });

    expect(rows.map((row) => row.kind)).toEqual(["message", "fork-separator", "message"]);
    expect(rows[2]).toMatchObject({
      kind: "message",
      createdAt: "2026-01-01T00:00:01.000Z",
    });
  });

  it("inserts anchored team task groups in chronological order instead of appending them", () => {
    const reviewer = makeTeamTaskView({
      id: "task-reviewer",
      title: "Reviewer",
      createdAt: "2026-01-01T00:00:10.000Z",
    });
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00.000Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Launch a reviewer",
            turnId: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            streaming: false,
          },
        },
        {
          id: "work-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:20.000Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:20.000Z",
            label: "thinking",
            tone: "thinking",
          },
        },
        {
          id: "assistant-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:30.000Z",
          message: {
            id: "assistant-1" as never,
            role: "assistant",
            text: "Reviewer launched.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:30.000Z",
            completedAt: "2026-01-01T00:00:31.000Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      userMessageSwitchInfoByMessageId: new Map(),
      teamTaskLaunchGroups: [
        {
          id: "activity-spawn-1",
          createdAt: "2026-01-01T00:00:10.000Z",
          tasks: [reviewer],
        },
      ],
    });

    expect(rows.map((row) => row.kind)).toEqual(["message", "team-task-group", "work", "message"]);
  });

  it("keeps fork separators ordered relative to anchored team task groups", () => {
    const reviewer = makeTeamTaskView({
      id: "task-reviewer",
      title: "Reviewer",
      createdAt: "2026-01-01T00:00:03.000Z",
    });
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "imported-user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:01.000Z",
          message: {
            id: "imported-user" as never,
            role: "user",
            text: "Imported question",
            turnId: null,
            createdAt: "2026-01-01T00:00:01.000Z",
            streaming: false,
          },
        },
        {
          id: "post-fork-user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:04.000Z",
          message: {
            id: "post-fork-user" as never,
            role: "user",
            text: "New question",
            turnId: null,
            createdAt: "2026-01-01T00:00:04.000Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      userMessageSwitchInfoByMessageId: new Map(),
      teamTaskLaunchGroups: [
        {
          id: "activity-spawn-1",
          createdAt: "2026-01-01T00:00:03.000Z",
          tasks: [reviewer],
        },
      ],
      forkOrigin: {
        sourceThreadId: "thread-source" as never,
        sourceThreadTitle: "Parent thread",
        sourceUserMessageId: "message-source" as never,
        importedUntilAt: "2026-01-01T00:00:02.000Z",
        forkedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(rows.map((row) => row.kind)).toEqual([
      "message",
      "fork-separator",
      "team-task-group",
      "message",
    ]);
  });
});

describe("deriveTeamTaskLaunchGroups", () => {
  it("groups consecutive spawn activities into one anchored launch block", () => {
    const reviewer = makeTeamTaskView({
      id: "task-reviewer",
      title: "Reviewer",
      createdAt: "2026-01-01T00:00:05.000Z",
    });
    const fixer = makeTeamTaskView({
      id: "task-fixer",
      title: "Fixer",
      createdAt: "2026-01-01T00:00:06.000Z",
    });

    const groups = deriveTeamTaskLaunchGroups({
      activities: [
        makeActivity({
          id: "activity-spawn-1",
          kind: "team.task.spawned",
          createdAt: "2026-01-01T00:00:05.000Z",
          payload: { taskId: "task-reviewer" },
        }),
        makeActivity({
          id: "activity-spawn-2",
          kind: "team.task.spawned",
          createdAt: "2026-01-01T00:00:06.000Z",
          payload: { taskId: "task-fixer" },
        }),
      ],
      taskViews: [reviewer, fixer],
    });

    expect(groups).toEqual([
      {
        id: "activity-spawn-1",
        createdAt: "2026-01-01T00:00:05.000Z",
        tasks: [reviewer, fixer],
      },
    ]);
  });

  it("starts a new group when a non-spawn activity appears between spawn events", () => {
    const reviewer = makeTeamTaskView({
      id: "task-reviewer",
      title: "Reviewer",
      createdAt: "2026-01-01T00:00:05.000Z",
    });
    const fixer = makeTeamTaskView({
      id: "task-fixer",
      title: "Fixer",
      createdAt: "2026-01-01T00:00:07.000Z",
    });

    const groups = deriveTeamTaskLaunchGroups({
      activities: [
        makeActivity({
          id: "activity-spawn-1",
          kind: "team.task.spawned",
          createdAt: "2026-01-01T00:00:05.000Z",
          payload: { taskId: "task-reviewer" },
        }),
        makeActivity({
          id: "activity-tool-1",
          kind: "tool.updated",
          createdAt: "2026-01-01T00:00:06.000Z",
        }),
        makeActivity({
          id: "activity-spawn-2",
          kind: "team.task.spawned",
          createdAt: "2026-01-01T00:00:07.000Z",
          payload: { taskId: "task-fixer" },
        }),
      ],
      taskViews: [reviewer, fixer],
    });

    expect(groups).toEqual([
      {
        id: "activity-spawn-1",
        createdAt: "2026-01-01T00:00:05.000Z",
        tasks: [reviewer],
      },
      {
        id: "activity-spawn-2",
        createdAt: "2026-01-01T00:00:07.000Z",
        tasks: [fixer],
      },
    ]);
  });

  it("keeps the same launch group id across task state updates", () => {
    const queuedReviewer = makeTeamTaskView({
      id: "task-reviewer",
      title: "Reviewer",
      createdAt: "2026-01-01T00:00:05.000Z",
      status: "queued",
    });
    const completedReviewer = makeTeamTaskView({
      id: "task-reviewer",
      title: "Reviewer",
      createdAt: "2026-01-01T00:00:05.000Z",
      status: "completed",
    });
    const activities = [
      makeActivity({
        id: "activity-spawn-1",
        kind: "team.task.spawned",
        createdAt: "2026-01-01T00:00:05.000Z",
        payload: { taskId: "task-reviewer" },
      }),
      makeActivity({
        id: "activity-completed-1",
        kind: "team.task.completed",
        createdAt: "2026-01-01T00:00:10.000Z",
        payload: { taskId: "task-reviewer" },
      }),
    ];

    const queuedGroups = deriveTeamTaskLaunchGroups({
      activities,
      taskViews: [queuedReviewer],
    });
    const completedGroups = deriveTeamTaskLaunchGroups({
      activities,
      taskViews: [completedReviewer],
    });

    expect(queuedGroups[0]?.id).toBe("activity-spawn-1");
    expect(completedGroups[0]?.id).toBe("activity-spawn-1");
    expect(completedGroups[0]?.tasks[0]?.task.status).toBe("completed");
  });

  it("creates a fallback group for tasks without a matching spawn activity", () => {
    const reviewer = makeTeamTaskView({
      id: "task-reviewer",
      title: "Reviewer",
      createdAt: "2026-01-01T00:00:05.000Z",
      status: "failed",
    });

    const groups = deriveTeamTaskLaunchGroups({
      activities: [
        makeActivity({
          id: "activity-completed-1",
          kind: "team.task.failed",
          createdAt: "2026-01-01T00:00:10.000Z",
          payload: { taskId: "task-reviewer" },
        }),
      ],
      taskViews: [reviewer],
    });

    expect(groups).toEqual([
      {
        id: "team-task-fallback:task-reviewer",
        createdAt: "2026-01-01T00:00:05.000Z",
        tasks: [reviewer],
      },
    ]);
  });
});

describe("computeStableMessagesTimelineRows", () => {
  it("returns the previous result when row order and content are unchanged", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      userMessageSwitchInfoByMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(rows, {
      byId: new Map(),
      result: [],
    });

    const repeated = computeStableMessagesTimelineRows(rows, initial);

    expect(repeated).toBe(initial);
    expect(repeated.result).toBe(initial.result);
  });

  it("returns a new result when row order changes without content changes", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const firstRows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      userMessageSwitchInfoByMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });

    const reordered = computeStableMessagesTimelineRows([firstRows[1]!, firstRows[0]!], initial);

    expect(reordered).not.toBe(initial);
    expect(reordered.result).toEqual([initial.result[1], initial.result[0]]);
  });

  it("reuses team-task-group rows when the launch group id and tasks reference are unchanged", () => {
    const reviewer = makeTeamTaskView({
      id: "task-reviewer",
      title: "Reviewer",
      createdAt: "2026-01-01T00:00:05.000Z",
    });
    const launchGroups = [
      {
        id: "activity-spawn-1",
        createdAt: "2026-01-01T00:00:05.000Z",
        tasks: [reviewer],
      },
    ];

    const firstRows = deriveMessagesTimelineRows({
      timelineEntries: [],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      userMessageSwitchInfoByMessageId: new Map(),
      teamTaskLaunchGroups: launchGroups,
    });

    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });

    const repeatedRows = deriveMessagesTimelineRows({
      timelineEntries: [],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
      userMessageSwitchInfoByMessageId: new Map(),
      teamTaskLaunchGroups: launchGroups,
    });
    const repeated = computeStableMessagesTimelineRows(repeatedRows, initial);

    expect(repeated).toBe(initial);
    expect(repeated.result[0]).toBe(initial.result[0]);
    expect(repeated.result[0]).toMatchObject({
      kind: "team-task-group",
      id: "activity-spawn-1",
    });
  });
});
