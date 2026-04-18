import {
  type BoardStreamEvent,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type EnvironmentApi,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const environmentApiHarness = vi.hoisted(() => ({
  apis: new Map<string, EnvironmentApi>(),
}));

const runtimeHarness = vi.hoisted(() => ({
  connections: new Map<string, { client: unknown; environmentId: string }>(),
  listeners: new Set<() => void>(),
}));

vi.mock("./environmentApi", () => ({
  createEnvironmentApi: (client: unknown) => client as EnvironmentApi,
  readEnvironmentApi: (environmentId: string) => environmentApiHarness.apis.get(environmentId),
  ensureEnvironmentApi: (environmentId: string) => {
    const api = environmentApiHarness.apis.get(environmentId);
    if (!api) {
      throw new Error(`Environment API not found for environment ${environmentId}`);
    }
    return api;
  },
}));

vi.mock("./environments/runtime", () => ({
  readEnvironmentConnection: (environmentId: string) =>
    runtimeHarness.connections.get(environmentId) ?? null,
  subscribeEnvironmentConnections: (listener: () => void) => {
    runtimeHarness.listeners.add(listener);
    return () => {
      runtimeHarness.listeners.delete(listener);
    };
  },
}));

import {
  __resetBoardStoreForTests,
  acquireBoardSubscription,
  archiveBoardCard,
  boardKey,
  useBoardStore,
} from "./boardStore";

const ENVIRONMENT_ID = EnvironmentId.make("environment-board");
const PROJECT_ID = ProjectId.make("project-board");

function createEnvironmentApiStub(
  overrides: Partial<EnvironmentApi["board"]> = {},
): EnvironmentApi {
  return {
    terminal: {} as never,
    projects: {} as never,
    filesystem: {} as never,
    git: {} as never,
    orchestration: {} as never,
    board: {
      listCards: vi.fn(async () => ({ cards: [] })),
      listDismissedGhosts: vi.fn(async () => ({ dismissed: [] })),
      subscribeProject: vi.fn(() => () => undefined),
      dispatchCommand: vi.fn(async () => ({ sequence: 1 })),
      ...overrides,
    },
  };
}

beforeEach(() => {
  __resetBoardStoreForTests();
});

afterEach(() => {
  environmentApiHarness.apis.clear();
  runtimeHarness.connections.clear();
  runtimeHarness.listeners.clear();
  __resetBoardStoreForTests();
});

describe("boardStore", () => {
  it("rolls back archived cards when archive dispatch fails", async () => {
    const api = createEnvironmentApiStub({
      dispatchCommand: vi.fn(async () => {
        throw new Error("archive failed");
      }),
    });
    environmentApiHarness.apis.set(ENVIRONMENT_ID, api);

    useBoardStore.setState({
      cardsByKey: {
        [boardKey(ENVIRONMENT_ID, PROJECT_ID)]: [
          {
            id: "card-1" as never,
            projectId: PROJECT_ID,
            title: "Card 1" as never,
            description: null,
            seededPrompt: null,
            column: "planned",
            sortOrder: 0,
            linkedThreadId: null,
            linkedProposedPlanId: null,
            createdAt: "2026-04-18T00:00:00.000Z" as never,
            updatedAt: "2026-04-18T00:00:00.000Z" as never,
            archivedAt: null,
          },
        ],
      },
    });

    await expect(
      archiveBoardCard({
        environmentId: ENVIRONMENT_ID,
        projectId: PROJECT_ID,
        cardId: "card-1" as never,
      }),
    ).rejects.toThrow("archive failed");

    expect(
      useBoardStore.getState().cardsByKey[boardKey(ENVIRONMENT_ID, PROJECT_ID)]?.[0]?.archivedAt,
    ).toBeNull();
  });

  it("attaches a board subscription after the environment connection appears", () => {
    const boardEvents: BoardStreamEvent[] = [
      {
        kind: "snapshot",
        cards: [
          {
            id: "card-1" as never,
            projectId: PROJECT_ID,
            title: "Card 1" as never,
            description: null,
            seededPrompt: null,
            column: "planned",
            sortOrder: 0,
            linkedThreadId: ThreadId.make("thread-1"),
            linkedProposedPlanId: null,
            createdAt: "2026-04-18T00:00:00.000Z" as never,
            updatedAt: "2026-04-18T00:00:00.000Z" as never,
            archivedAt: null,
          },
        ],
        dismissedGhosts: [],
        snapshotSequence: 7,
      },
    ];
    const subscribeProject = vi.fn(
      (_input: { projectId: ProjectId }, listener: (event: BoardStreamEvent) => void) => {
        for (const event of boardEvents) {
          listener(event);
        }
        return () => undefined;
      },
    );

    const release = acquireBoardSubscription(ENVIRONMENT_ID, PROJECT_ID);

    expect(useBoardStore.getState().statusByKey[boardKey(ENVIRONMENT_ID, PROJECT_ID)]).toBe(
      "error",
    );

    runtimeHarness.connections.set(ENVIRONMENT_ID, {
      environmentId: ENVIRONMENT_ID,
      client: createEnvironmentApiStub({
        subscribeProject,
      }),
    });

    for (const listener of runtimeHarness.listeners) {
      listener();
    }

    expect(subscribeProject).toHaveBeenCalledOnce();
    expect(useBoardStore.getState().statusByKey[boardKey(ENVIRONMENT_ID, PROJECT_ID)]).toBe(
      "ready",
    );
    expect(
      useBoardStore.getState().cardsByKey[boardKey(ENVIRONMENT_ID, PROJECT_ID)]?.[0]
        ?.linkedThreadId,
    ).toBe(ThreadId.make("thread-1"));

    release();
  });
});
