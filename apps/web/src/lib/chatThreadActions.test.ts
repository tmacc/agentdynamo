import { scopeProjectRef } from "@t3tools/client-runtime";
import { EnvironmentId, ProjectId, type FeatureCard } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";
import { DraftId } from "../composerDraftStore";
import {
  resolveThreadActionProjectRef,
  startSeededThreadForCard,
  startNewLocalThreadFromContext,
  startNewThreadFromContext,
  type ChatThreadActionContext,
} from "./chatThreadActions";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");
const FALLBACK_PROJECT_ID = ProjectId.make("project-2");
const CARD_ID = "card-1" as FeatureCard["id"];

function createCard(overrides: Partial<FeatureCard> = {}): FeatureCard {
  return {
    id: CARD_ID,
    projectId: PROJECT_ID,
    title: "Implement board workflow",
    description: null,
    seededPrompt: null,
    column: "planned",
    sortOrder: 1,
    linkedThreadId: null,
    linkedProposedPlanId: null,
    createdAt: "2026-05-01T00:00:00.000Z" as FeatureCard["createdAt"],
    updatedAt: "2026-05-01T00:00:00.000Z" as FeatureCard["updatedAt"],
    archivedAt: null,
    ...overrides,
  };
}

function createContext(overrides: Partial<ChatThreadActionContext> = {}): ChatThreadActionContext {
  return {
    activeDraftThread: null,
    activeThread: undefined,
    defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, FALLBACK_PROJECT_ID),
    defaultThreadEnvMode: "local",
    handleNewThread: async () => {},
    ...overrides,
  };
}

describe("chatThreadActions", () => {
  it("prefers the active draft thread project when resolving thread actions", () => {
    const projectRef = resolveThreadActionProjectRef(
      createContext({
        activeDraftThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "feature/refactor",
          worktreePath: "/tmp/worktree",
          envMode: "worktree",
        },
      }),
    );

    expect(projectRef).toEqual(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("falls back to the default project ref when there is no active thread context", () => {
    const projectRef = resolveThreadActionProjectRef(
      createContext({
        defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
      }),
    );

    expect(projectRef).toEqual(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("starts a contextual new thread from the active draft thread", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewThreadFromContext(
      createContext({
        activeDraftThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "feature/refactor",
          worktreePath: "/tmp/worktree",
          envMode: "worktree",
        },
        handleNewThread,
      }),
    );

    expect(didStart).toBe(true);
    expect(handleNewThread).toHaveBeenCalledWith(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), {
      branch: "feature/refactor",
      worktreePath: "/tmp/worktree",
      envMode: "worktree",
    });
  });

  it("starts a local thread with the configured default env mode", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewLocalThreadFromContext(
      createContext({
        defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
        defaultThreadEnvMode: "worktree",
        handleNewThread,
      }),
    );

    expect(didStart).toBe(true);
    expect(handleNewThread).toHaveBeenCalledWith(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), {
      envMode: "worktree",
    });
  });

  it("does not start a thread when there is no project context", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewThreadFromContext(
      createContext({
        defaultProjectRef: null,
        handleNewThread,
      }),
    );

    expect(didStart).toBe(false);
    expect(handleNewThread).not.toHaveBeenCalled();
  });

  it("starts seeded board threads in plan mode with a fresh main worktree", async () => {
    const createFreshDraftThread = vi.fn<
      NonNullable<ChatThreadActionContext["createFreshDraftThread"]>
    >(async () => DraftId.make("draft-1"));

    await startSeededThreadForCard({
      card: createCard(),
      context: createContext({
        activeDraftThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "feature/draft-context",
          worktreePath: "/tmp/draft-context",
          envMode: "worktree",
        },
        activeThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "feature/thread-context",
          worktreePath: "/tmp/thread-context",
        },
        createFreshDraftThread,
        defaultThreadEnvMode: "local",
      }),
      environmentId: ENVIRONMENT_ID,
    });

    await startSeededThreadForCard({
      card: createCard(),
      context: createContext({
        activeDraftThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: FALLBACK_PROJECT_ID,
          branch: "feature/other-draft-context",
          worktreePath: "/tmp/other-draft-context",
          envMode: "worktree",
        },
        activeThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: FALLBACK_PROJECT_ID,
          branch: "feature/other-thread-context",
          worktreePath: "/tmp/other-thread-context",
        },
        createFreshDraftThread,
        defaultThreadEnvMode: "local",
      }),
      environmentId: ENVIRONMENT_ID,
    });

    const expectedOptions = {
      envMode: "worktree",
      branch: "main",
      worktreePath: null,
      interactionMode: "plan",
    };
    expect(createFreshDraftThread).toHaveBeenNthCalledWith(
      1,
      scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
      expectedOptions,
    );
    expect(createFreshDraftThread).toHaveBeenNthCalledWith(
      2,
      scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
      expectedOptions,
    );
  });
});
