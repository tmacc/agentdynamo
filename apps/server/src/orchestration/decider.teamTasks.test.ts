import {
  CommandId,
  EventId,
  ProjectId,
  TeamTaskId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationTeamTask,
} from "@t3tools/contracts";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-01-01T00:00:00.000Z";

function makeEvent(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: "thread",
    aggregateId: ThreadId.make("thread-parent"),
    occurredAt: now,
    commandId: CommandId.make(`cmd-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

function nativeTask(overrides: Partial<OrchestrationTeamTask> = {}): OrchestrationTeamTask {
  return {
    id: TeamTaskId.make("team-task:native:codex:abc123"),
    parentThreadId: ThreadId.make("thread-parent"),
    childThreadId: ThreadId.make("native-child:codex:abc123"),
    title: "Native subagent",
    task: "Provider-native Codex subagent",
    roleLabel: null,
    kind: "general",
    modelSelection: {
      provider: "codex",
      model: "gpt-5.5",
    },
    modelSelectionMode: "coordinator-selected",
    modelSelectionReason:
      "Provider-native subagent; exact worker runtime is managed by the provider.",
    workspaceMode: "shared",
    resolvedWorkspaceMode: "shared",
    setupMode: "skip",
    resolvedSetupMode: "skip",
    source: "native-provider",
    childThreadMaterialized: false,
    nativeProviderRef: {
      provider: "codex",
      providerItemId: "item-1",
    },
    status: "running",
    latestSummary: null,
    errorText: null,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

async function readModelWithParentThread() {
  const empty = createEmptyReadModel(now);
  return Effect.runPromise(
    projectEvent(
      empty,
      makeEvent({
        sequence: 1,
        type: "thread.created",
        payload: {
          threadId: ThreadId.make("thread-parent"),
          projectId: ProjectId.make("project-1"),
          title: "Parent",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.5",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ),
  );
}

describe("decider team tasks", () => {
  it("creates native provider task mirrors without requiring a child thread", async () => {
    const readModel = await readModelWithParentThread();
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.team-task.upsert-native",
          commandId: CommandId.make("cmd-native-upsert"),
          parentThreadId: ThreadId.make("thread-parent"),
          teamTask: nativeTask(),
          createdAt: now,
        },
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    expect(events.map((event) => event.type)).toEqual([
      "thread.team-task-created",
      "thread.team-task-started",
      "thread.activity-appended",
    ]);
  });

  it("updates native provider task summaries and final status idempotently", async () => {
    let readModel = await readModelWithParentThread();
    readModel = await Effect.runPromise(
      projectEvent(
        readModel,
        makeEvent({
          sequence: 2,
          type: "thread.team-task-created",
          payload: {
            parentThreadId: ThreadId.make("thread-parent"),
            teamTask: nativeTask(),
          },
        }),
      ),
    );

    const completedAt = "2026-01-01T00:02:00.000Z";
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.team-task.upsert-native",
          commandId: CommandId.make("cmd-native-complete"),
          parentThreadId: ThreadId.make("thread-parent"),
          teamTask: nativeTask({
            status: "completed",
            latestSummary: "Finished native work.",
            completedAt,
            updatedAt: completedAt,
          }),
          createdAt: completedAt,
        },
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    expect(events.map((event) => event.type)).toEqual([
      "thread.team-task-status-changed",
      "thread.team-task-summary-updated",
    ]);
  });

  it("rejects native upserts that claim materialized child threads", async () => {
    const readModel = await readModelWithParentThread();
    const result = await Effect.runPromiseExit(
      decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.team-task.upsert-native",
          commandId: CommandId.make("cmd-native-invalid"),
          parentThreadId: ThreadId.make("thread-parent"),
          teamTask: nativeTask({
            childThreadMaterialized: true,
          }),
          createdAt: now,
        },
      }),
    );

    expect(Exit.isFailure(result)).toBe(true);
  });
});
