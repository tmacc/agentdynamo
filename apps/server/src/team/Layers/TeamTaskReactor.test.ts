import { describe, expect, it } from "vitest";
import { EventId, ThreadId, type OrchestrationTeamTask } from "@t3tools/contracts";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import { deriveTaskStatus } from "./TeamTaskReactor.ts";

function baseTask(overrides?: Partial<OrchestrationTeamTask>): OrchestrationTeamTask {
  return {
    id: "team-task:test",
    parentThreadId: ThreadId.make("thread-parent"),
    childThreadId: ThreadId.make("thread-child"),
    title: "Child reviewer",
    roleLabel: "Reviewer",
    modelSelection: { provider: "codex", model: "gpt-5.4-mini" },
    workspaceMode: "worktree",
    status: "queued",
    latestSummary: null,
    errorText: null,
    createdAt: "2026-04-16T18:40:00.000Z",
    startedAt: null,
    completedAt: null,
    updatedAt: "2026-04-16T18:40:00.000Z",
    ...overrides,
  };
}

function activity(
  kind: string,
  createdAt: string,
  payload: Record<string, unknown>,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(`${kind}-${createdAt}`),
    tone: kind.includes("failed") ? "error" : kind.includes("approval") ? "approval" : "info",
    kind,
    summary: kind,
    payload,
    turnId: null,
    createdAt,
  };
}

describe("deriveTaskStatus", () => {
  it("does not mark a task completed just because the child session is ready", () => {
    const task = deriveTaskStatus({
      task: baseTask({ status: "running", startedAt: "2026-04-16T18:40:05.000Z" }),
      childThread: {
        latestTurn: null,
        session: { status: "ready", lastError: null },
        activities: [],
        messages: [],
      },
    });

    expect(task.status).toBe("running");
    expect(task.completedAt).toBeNull();
  });

  it("reopens a completed task when a new child turn is running", () => {
    const task = deriveTaskStatus({
      task: baseTask({
        status: "completed",
        startedAt: "2026-04-16T18:40:05.000Z",
        completedAt: "2026-04-16T18:41:00.000Z",
      }),
      childThread: {
        latestTurn: { state: "running" },
        session: { status: "running", lastError: null },
        activities: [],
        messages: [],
      },
    });

    expect(task.status).toBe("running");
    expect(task.completedAt).toBeNull();
  });

  it("uses pending approvals or user-input to move the task into waiting", () => {
    const task = deriveTaskStatus({
      task: baseTask({ status: "running", startedAt: "2026-04-16T18:40:05.000Z" }),
      childThread: {
        latestTurn: { state: "running" },
        session: { status: "running", lastError: null },
        activities: [
          activity("approval.requested", "2026-04-16T18:40:10.000Z", {
            requestId: "req-1",
            requestKind: "command",
          }),
        ],
        messages: [],
      },
    });

    expect(task.status).toBe("waiting");
    expect(task.completedAt).toBeNull();
  });

  it("marks completion only from a completed child turn and captures the latest summary", () => {
    const task = deriveTaskStatus({
      task: baseTask({ status: "running", startedAt: "2026-04-16T18:40:05.000Z" }),
      childThread: {
        latestTurn: { state: "completed" },
        session: { status: "ready", lastError: null },
        activities: [],
        messages: [{ role: "assistant", text: "Final review: found one missing test." }],
      },
    });

    expect(task.status).toBe("completed");
    expect(task.completedAt).not.toBeNull();
    expect(task.latestSummary).toBe("Final review: found one missing test.");
  });
});
