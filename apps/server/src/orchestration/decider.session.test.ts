import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type OrchestrationSessionStatus,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);

async function seedReadModel(): Promise<OrchestrationReadModel> {
  const now = "2026-04-30T12:00:00.000Z";
  const withProject = await Effect.runPromise(
    projectEvent(createEmptyReadModel(now), {
      sequence: 1,
      eventId: asEventId("evt-project-created"),
      aggregateKind: "project",
      aggregateId: asProjectId("project-session"),
      type: "project.created",
      occurredAt: now,
      commandId: asCommandId("cmd-project-created"),
      causationEventId: null,
      correlationId: asCommandId("cmd-project-created"),
      metadata: {},
      payload: {
        projectId: asProjectId("project-session"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  return Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: asEventId("evt-thread-created"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-session"),
      type: "thread.created",
      occurredAt: now,
      commandId: asCommandId("cmd-thread-created"),
      causationEventId: null,
      correlationId: asCommandId("cmd-thread-created"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-session"),
        projectId: asProjectId("project-session"),
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
}

describe("decider session lifecycle", () => {
  it.each<OrchestrationSessionStatus>(["idle", "ready", "interrupted", "stopped", "error"])(
    "normalizes %s session active turn before persisting",
    async (status) => {
      const readModel = await seedReadModel();
      const event = await Effect.runPromise(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.session.set",
            commandId: asCommandId(`cmd-session-${status}`),
            threadId: asThreadId("thread-session"),
            session: {
              threadId: asThreadId("thread-session"),
              status,
              providerName: "codex",
              runtimeMode: "approval-required",
              activeTurnId: asTurnId("turn-stale"),
              lastError: null,
              updatedAt: "2026-04-30T12:01:00.000Z",
            },
            createdAt: "2026-04-30T12:01:00.000Z",
          },
        }),
      );

      expect(Array.isArray(event)).toBe(false);
      expect(event).toEqual(
        expect.objectContaining({
          type: "thread.session-set",
          payload: expect.objectContaining({
            session: expect.objectContaining({
              status,
              activeTurnId: null,
            }),
          }),
        }),
      );
    },
  );

  it.each<OrchestrationSessionStatus>(["starting", "running", "recovering"])(
    "preserves active turn for %s session",
    async (status) => {
      const readModel = await seedReadModel();
      const event = await Effect.runPromise(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.session.set",
            commandId: asCommandId(`cmd-session-${status}`),
            threadId: asThreadId("thread-session"),
            session: {
              threadId: asThreadId("thread-session"),
              status,
              providerName: "codex",
              runtimeMode: "approval-required",
              activeTurnId: asTurnId("turn-active"),
              lastError: null,
              updatedAt: "2026-04-30T12:01:00.000Z",
            },
            createdAt: "2026-04-30T12:01:00.000Z",
          },
        }),
      );

      expect(event).toEqual(
        expect.objectContaining({
          type: "thread.session-set",
          payload: expect.objectContaining({
            session: expect.objectContaining({
              status,
              activeTurnId: asTurnId("turn-active"),
            }),
          }),
        }),
      );
    },
  );
});
