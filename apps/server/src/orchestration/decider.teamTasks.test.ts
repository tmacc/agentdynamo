import {
  CommandId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
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
const codexProvider = ProviderDriverKind.make("codex");
const codexInstance = ProviderInstanceId.make("codex");

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
      instanceId: codexInstance,
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
      provider: codexProvider,
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

function dynamoTask(overrides: Partial<OrchestrationTeamTask> = {}): OrchestrationTeamTask {
  return {
    id: TeamTaskId.make("team-task:dynamo:abc123"),
    parentThreadId: ThreadId.make("thread-parent"),
    childThreadId: ThreadId.make("thread-child"),
    title: "Dynamo child",
    task: "Implement a child task",
    roleLabel: "Worker",
    kind: "coding",
    modelSelection: {
      instanceId: codexInstance,
      model: "gpt-5.5",
    },
    modelSelectionMode: "coordinator-selected",
    modelSelectionReason: "Selected for test.",
    workspaceMode: "shared",
    resolvedWorkspaceMode: "shared",
    setupMode: "skip",
    resolvedSetupMode: "skip",
    source: "dynamo",
    childThreadMaterialized: true,
    nativeProviderRef: null,
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
            instanceId: codexInstance,
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

async function readModelWithTeamTask(task: OrchestrationTeamTask) {
  let readModel = await readModelWithParentThread();
  readModel = await Effect.runPromise(
    projectEvent(
      readModel,
      makeEvent({
        sequence: 2,
        type: "thread.team-task-created",
        payload: {
          parentThreadId: ThreadId.make("thread-parent"),
          teamTask: task,
        },
      }),
    ),
  );
  if (task.childThreadMaterialized) {
    readModel = await Effect.runPromise(
      projectEvent(
        readModel,
        makeEvent({
          sequence: 3,
          type: "thread.created",
          payload: {
            threadId: task.childThreadId,
            projectId: ProjectId.make("project-1"),
            title: "Child",
            modelSelection: task.modelSelection,
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
  return readModel;
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

  it("rejects follow-up messages for native provider tasks", async () => {
    const readModel = await readModelWithTeamTask(nativeTask());
    const result = await Effect.runPromiseExit(
      decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.team-task.send-message",
          commandId: CommandId.make("cmd-native-message"),
          parentThreadId: ThreadId.make("thread-parent"),
          taskId: TeamTaskId.make("team-task:native:codex:abc123"),
          message: "Please continue.",
          createdAt: now,
        },
      }),
    );

    expect(Exit.isFailure(result)).toBe(true);
  });

  it("rejects close requests for non-materialized Dynamo tasks", async () => {
    const task = dynamoTask({
      childThreadMaterialized: false,
    });
    const readModel = await readModelWithTeamTask(task);
    const result = await Effect.runPromiseExit(
      decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.team-task.close",
          commandId: CommandId.make("cmd-close-non-materialized"),
          parentThreadId: ThreadId.make("thread-parent"),
          taskId: task.id,
          reason: "Stop.",
          createdAt: now,
        },
      }),
    );

    expect(Exit.isFailure(result)).toBe(true);
  });

  it("rejects follow-up messages when the materialized child thread is missing", async () => {
    const readModel = await readModelWithTeamTask(
      dynamoTask({
        childThreadMaterialized: false,
      }),
    );
    const task = dynamoTask();
    const nextReadModel = {
      ...readModel,
      threads: readModel.threads.map((thread) =>
        thread.id === ThreadId.make("thread-parent")
          ? Object.assign({}, thread, { teamTasks: [task] })
          : thread,
      ),
    };
    const result = await Effect.runPromiseExit(
      decideOrchestrationCommand({
        readModel: nextReadModel,
        command: {
          type: "thread.team-task.send-message",
          commandId: CommandId.make("cmd-message-missing-child"),
          parentThreadId: ThreadId.make("thread-parent"),
          taskId: task.id,
          message: "Are you there?",
          createdAt: now,
        },
      }),
    );

    expect(Exit.isFailure(result)).toBe(true);
  });

  it("rejects direct Dynamo spawns when team agents are disabled", async () => {
    const readModel = await readModelWithParentThread();
    const task = dynamoTask({ status: "queued", startedAt: null });
    const result = await Effect.runPromiseExit(
      decideOrchestrationCommand({
        readModel,
        teamAgents: { enabled: false, maxActiveChildren: 3 },
        command: {
          type: "thread.team-task.spawn",
          commandId: CommandId.make("cmd-spawn-disabled"),
          teamTask: task,
          createdAt: now,
        },
      }),
    );

    expect(Exit.isFailure(result)).toBe(true);
  });

  it("rejects direct Dynamo spawns at the active child limit including native tasks", async () => {
    const readModel = await readModelWithTeamTask(nativeTask({ status: "running" }));
    const task = dynamoTask({ id: TeamTaskId.make("team-task:dynamo:limit"), status: "queued" });
    const result = await Effect.runPromiseExit(
      decideOrchestrationCommand({
        readModel,
        teamAgents: { enabled: true, maxActiveChildren: 1 },
        command: {
          type: "thread.team-task.spawn",
          commandId: CommandId.make("cmd-spawn-limit"),
          teamTask: task,
          createdAt: now,
        },
      }),
    );

    expect(Exit.isFailure(result)).toBe(true);
  });

  it("preserves final native task metadata when a late active upsert arrives", async () => {
    const completedAt = "2026-01-01T00:02:00.000Z";
    const readModel = await readModelWithTeamTask(
      nativeTask({
        status: "completed",
        latestSummary: "Finished native work.",
        completedAt,
        updatedAt: completedAt,
      }),
    );
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.team-task.upsert-native",
          commandId: CommandId.make("cmd-native-late-active"),
          parentThreadId: ThreadId.make("thread-parent"),
          teamTask: nativeTask({
            status: "running",
            latestSummary: "Still running.",
            completedAt: null,
            updatedAt: "2026-01-01T00:03:00.000Z",
          }),
          createdAt: "2026-01-01T00:03:00.000Z",
        },
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("thread.team-task-status-changed");
    expect(events[0]?.payload).toMatchObject({
      status: "completed",
      completedAt,
    });
  });

  it("allows same-final native upserts to fill missing final metadata", async () => {
    const completedAt = "2026-01-01T00:02:00.000Z";
    const readModel = await readModelWithTeamTask(
      nativeTask({
        status: "completed",
        completedAt: null,
        latestSummary: null,
        updatedAt: completedAt,
      }),
    );
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.team-task.upsert-native",
          commandId: CommandId.make("cmd-native-final-fill"),
          parentThreadId: ThreadId.make("thread-parent"),
          teamTask: nativeTask({
            status: "completed",
            completedAt,
            latestSummary: "Finished native work.",
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
    expect(events[0]?.payload).toMatchObject({
      status: "completed",
      completedAt,
    });
  });
});
