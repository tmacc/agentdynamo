import { scopeProjectRef } from "@t3tools/client-runtime";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildContextualThreadOptionsForProject,
  resolveThreadActionProjectRef,
  startSeededThreadForCard,
  startNewLocalThreadFromContext,
  startNewThreadFromContext,
  type ChatThreadActionContext,
} from "./chatThreadActions";
import { useComposerDraftStore } from "../composerDraftStore";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");
const FALLBACK_PROJECT_ID = ProjectId.make("project-2");
const CARD_PROJECT_REF = scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID);

function resetComposerDraftStore() {
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
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
  beforeEach(() => {
    resetComposerDraftStore();
  });

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

  it("only reuses branch and worktree context for the same project", () => {
    expect(
      buildContextualThreadOptionsForProject(
        createContext({
          activeThread: {
            environmentId: ENVIRONMENT_ID,
            projectId: FALLBACK_PROJECT_ID,
            branch: "feature/refactor",
            worktreePath: "/tmp/worktree",
          },
          defaultThreadEnvMode: "worktree",
        }),
        CARD_PROJECT_REF,
      ),
    ).toEqual({
      envMode: "worktree",
    });

    expect(
      buildContextualThreadOptionsForProject(
        createContext({
          activeThread: {
            environmentId: ENVIRONMENT_ID,
            projectId: PROJECT_ID,
            branch: "feature/refactor",
            worktreePath: "/tmp/worktree",
          },
          defaultThreadEnvMode: "local",
        }),
        CARD_PROJECT_REF,
      ),
    ).toEqual({
      branch: "feature/refactor",
      worktreePath: "/tmp/worktree",
      envMode: "worktree",
    });
  });

  it("starts seeded board threads from a fresh draft instead of the shared project draft", async () => {
    const createFreshDraftThread = vi.fn(async () => {
      useComposerDraftStore
        .getState()
        .registerDraftSession(CARD_PROJECT_REF, "draft-card-1" as never, "logical-project-1", {
          threadId: "thread-card-1" as never,
          createdAt: "2026-04-18T00:00:00.000Z",
          envMode: "local",
        });
      return "draft-card-1" as never;
    });
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    await startSeededThreadForCard({
      environmentId: ENVIRONMENT_ID,
      card: {
        id: "card-1" as never,
        projectId: PROJECT_ID,
        title: "Ship board fixes" as never,
        description: "Do the work" as never,
        seededPrompt: null,
        column: "planned",
        sortOrder: 0,
        linkedThreadId: null,
        linkedProposedPlanId: null,
        createdAt: "2026-04-18T00:00:00.000Z" as never,
        updatedAt: "2026-04-18T00:00:00.000Z" as never,
        archivedAt: null,
      },
      context: createContext({
        createFreshDraftThread,
        handleNewThread,
      }),
    });

    expect(handleNewThread).not.toHaveBeenCalled();
    expect(createFreshDraftThread).toHaveBeenCalledOnce();
    expect(useComposerDraftStore.getState().getComposerDraft("draft-card-1" as never)?.prompt).toBe(
      "Ship board fixes\n\nDo the work",
    );
  });
});
