import { CommandId, EventId, ProjectId, ThreadId, type FeatureCard } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { Effect, Option } from "effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";
import { ProjectionBoardCardRepository } from "../persistence/Services/ProjectionBoardCards.ts";
import type { ProjectionBoardCardRepositoryShape } from "../persistence/Services/ProjectionBoardCards.ts";

const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

function createBoardCardRepositoryStub(
  overrides: Partial<ProjectionBoardCardRepositoryShape> = {},
): ProjectionBoardCardRepositoryShape {
  return {
    upsert: () => Effect.void,
    getById: () => Effect.succeed(Option.none()),
    getByLinkedThreadId: () => Effect.succeed(Option.none()),
    listByProject: () => Effect.succeed([]),
    deleteById: () => Effect.void,
    ...overrides,
  };
}

async function createBoardReadModel(now: string) {
  const initial = createEmptyReadModel(now);
  const withProjectA = await Effect.runPromise(
    projectEvent(initial, {
      sequence: 1,
      eventId: asEventId("evt-project-a"),
      aggregateKind: "project",
      aggregateId: asProjectId("project-a"),
      type: "project.created",
      occurredAt: now,
      commandId: CommandId.make("cmd-project-a"),
      causationEventId: null,
      correlationId: CommandId.make("cmd-project-a"),
      metadata: {},
      payload: {
        projectId: asProjectId("project-a"),
        title: "Project A",
        workspaceRoot: "/tmp/project-a",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  const withProjects = await Effect.runPromise(
    projectEvent(withProjectA, {
      sequence: 2,
      eventId: asEventId("evt-project-b"),
      aggregateKind: "project",
      aggregateId: asProjectId("project-b"),
      type: "project.created",
      occurredAt: now,
      commandId: CommandId.make("cmd-project-b"),
      causationEventId: null,
      correlationId: CommandId.make("cmd-project-b"),
      metadata: {},
      payload: {
        projectId: asProjectId("project-b"),
        title: "Project B",
        workspaceRoot: "/tmp/project-b",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  const withThreadA = await Effect.runPromise(
    projectEvent(withProjects, {
      sequence: 3,
      eventId: asEventId("evt-thread-a"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-a"),
      type: "thread.created",
      occurredAt: now,
      commandId: CommandId.make("cmd-thread-a"),
      causationEventId: null,
      correlationId: CommandId.make("cmd-thread-a"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-a"),
        projectId: asProjectId("project-a"),
        title: "Thread A",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  return Effect.runPromise(
    projectEvent(withThreadA, {
      sequence: 4,
      eventId: asEventId("evt-thread-b"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-b"),
      type: "thread.created",
      occurredAt: now,
      commandId: CommandId.make("cmd-thread-b"),
      causationEventId: null,
      correlationId: CommandId.make("cmd-thread-b"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-b"),
        projectId: asProjectId("project-b"),
        title: "Thread B",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
}

function makeCard(overrides: Partial<FeatureCard> = {}): FeatureCard {
  return {
    id: "card-1" as FeatureCard["id"],
    projectId: asProjectId("project-a"),
    title: "Card" as FeatureCard["title"],
    description: null,
    seededPrompt: null,
    column: "planned",
    sortOrder: 0,
    linkedThreadId: null,
    linkedProposedPlanId: null,
    createdAt: "2026-04-18T00:00:00.000Z" as FeatureCard["createdAt"],
    updatedAt: "2026-04-18T00:00:00.000Z" as FeatureCard["updatedAt"],
    archivedAt: null,
    ...overrides,
  };
}

describe("decider board invariants", () => {
  it("rejects board.card.create when the linked thread belongs to another project", async () => {
    const now = new Date().toISOString();
    const readModel = await createBoardReadModel(now);

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "board.card.create",
            commandId: CommandId.make("cmd-board-create"),
            cardId: "card-a" as FeatureCard["id"],
            projectId: asProjectId("project-a"),
            title: "Card" as FeatureCard["title"],
            description: null,
            seededPrompt: null,
            column: "planned",
            sortOrder: 0,
            linkedThreadId: asThreadId("thread-b"),
            linkedProposedPlanId: null,
            createdAt: now as FeatureCard["createdAt"],
          },
          readModel,
        }).pipe(
          Effect.provideService(ProjectionBoardCardRepository, createBoardCardRepositoryStub()),
        ),
      ),
    ).rejects.toThrow("does not belong to project 'project-a'");
  });

  it("rejects board.card.linkThread when the card does not exist", async () => {
    const now = new Date().toISOString();
    const readModel = await createBoardReadModel(now);

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "board.card.linkThread",
            commandId: CommandId.make("cmd-board-link"),
            cardId: "missing-card" as FeatureCard["id"],
            projectId: asProjectId("project-a"),
            threadId: asThreadId("thread-a"),
            updatedAt: now as FeatureCard["updatedAt"],
          },
          readModel,
        }).pipe(
          Effect.provideService(ProjectionBoardCardRepository, createBoardCardRepositoryStub()),
        ),
      ),
    ).rejects.toThrow("Board card 'missing-card' does not exist");
  });

  it("rejects board.card.linkThread when another card already links the thread", async () => {
    const now = new Date().toISOString();
    const readModel = await createBoardReadModel(now);

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "board.card.linkThread",
            commandId: CommandId.make("cmd-board-link-dup"),
            cardId: "card-a" as FeatureCard["id"],
            projectId: asProjectId("project-a"),
            threadId: asThreadId("thread-a"),
            updatedAt: now as FeatureCard["updatedAt"],
          },
          readModel,
        }).pipe(
          Effect.provideService(
            ProjectionBoardCardRepository,
            createBoardCardRepositoryStub({
              getById: () => Effect.succeed(Option.some(makeCard())),
              getByLinkedThreadId: () =>
                Effect.succeed(
                  Option.some(
                    makeCard({
                      id: "card-other" as FeatureCard["id"],
                      linkedThreadId: asThreadId("thread-a"),
                    }),
                  ),
                ),
            }),
          ),
        ),
      ),
    ).rejects.toThrow("already linked to board card 'card-other'");
  });
});
