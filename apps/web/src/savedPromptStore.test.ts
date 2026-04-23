import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PROJECT_ID = ProjectId.make("project-1");
const OTHER_PROJECT_ID = ProjectId.make("project-2");
const PROJECT_REF = scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID);
const OTHER_PROJECT_REF = scopeProjectRef(ENVIRONMENT_ID, OTHER_PROJECT_ID);

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function getTestWindow(): Window & typeof globalThis {
  const localStorage = createLocalStorageStub();
  const testWindow = {
    addEventListener: () => undefined,
    localStorage,
  } as unknown as Window & typeof globalThis;
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("localStorage", localStorage);
  return testWindow;
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("savedPromptStore", () => {
  it("hydrates persisted snippets from localStorage", async () => {
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "t3code:saved-prompts:v1",
      JSON.stringify({
        version: 1,
        state: {
          snippetsById: {
            "snippet-1": {
              id: "snippet-1",
              title: "Review diff",
              body: "Review the diff carefully",
              scope: "project",
              projectKey: scopedProjectKey(PROJECT_REF),
              createdAt: "2026-04-19T12:00:00.000Z",
              updatedAt: "2026-04-19T12:00:00.000Z",
              lastUsedAt: null,
            },
          },
        },
      }),
    );

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();

    expect(useSavedPromptStore.getState().snippetsById["snippet-1"]).toMatchObject({
      title: "Review diff",
      projectKey: scopedProjectKey(PROJECT_REF),
    });
  });

  it("filters visible snippets by project scope and global scope", async () => {
    getTestWindow();
    const { resetSavedPromptStoreForTests, useSavedPromptStore } =
      await import("./savedPromptStore");
    resetSavedPromptStoreForTests();

    const store = useSavedPromptStore.getState();
    store.createSnippet({
      title: "Project review",
      body: "Review this project diff",
      scope: "project",
      projectRef: PROJECT_REF,
    });
    store.createSnippet({
      title: "Other project review",
      body: "Review another project diff",
      scope: "project",
      projectRef: OTHER_PROJECT_REF,
    });
    store.createSnippet({
      title: "Global summary",
      body: "Summarize for a PM",
      scope: "global",
    });

    expect(store.listVisibleSnippets(PROJECT_REF)).toEqual([
      expect.objectContaining({
        id: "project",
        items: [expect.objectContaining({ title: "Project review" })],
      }),
      expect.objectContaining({
        id: "global",
        items: [expect.objectContaining({ title: "Global summary" })],
      }),
    ]);
    expect(store.listVisibleSnippets(OTHER_PROJECT_REF)).toEqual([
      expect.objectContaining({
        id: "project",
        items: [expect.objectContaining({ title: "Other project review" })],
      }),
      expect.objectContaining({
        id: "global",
        items: [expect.objectContaining({ title: "Global summary" })],
      }),
    ]);
  });

  it("deduplicates snippets by normalized body within the same scope", async () => {
    getTestWindow();
    const { resetSavedPromptStoreForTests, useSavedPromptStore } =
      await import("./savedPromptStore");
    resetSavedPromptStoreForTests();

    const store = useSavedPromptStore.getState();
    const firstResult = store.createSnippet({
      title: "Review prompt",
      body: "Review this diff carefully",
      scope: "project",
      projectRef: PROJECT_REF,
    });
    const duplicateResult = store.createSnippet({
      title: "Review prompt again",
      body: "  Review this diff carefully  ",
      scope: "project",
      projectRef: PROJECT_REF,
    });

    expect(firstResult.status).toBe("created");
    expect(duplicateResult).toMatchObject({
      status: "duplicate",
      snippet: expect.objectContaining({
        title: "Review prompt",
      }),
    });
    expect(Object.keys(useSavedPromptStore.getState().snippetsById)).toHaveLength(1);
  });

  it("preserves leading and trailing whitespace in the stored body", async () => {
    getTestWindow();
    const { resetSavedPromptStoreForTests, useSavedPromptStore } =
      await import("./savedPromptStore");
    resetSavedPromptStoreForTests();

    const created = useSavedPromptStore.getState().createSnippet({
      body: "\n\n# Review prompt\r\nFocus on reconnect regressions\r\n",
      scope: "global",
    });
    if (created.status !== "created") {
      throw new Error("Expected snippet to be created.");
    }

    expect(created.snippet.body).toBe("\n\n# Review prompt\nFocus on reconnect regressions\n");
  });

  it("rejects effectively empty whitespace-only bodies", async () => {
    getTestWindow();
    const { resetSavedPromptStoreForTests, useSavedPromptStore } =
      await import("./savedPromptStore");
    resetSavedPromptStoreForTests();

    expect(
      useSavedPromptStore.getState().createSnippet({
        body: "\n  \r\n\t",
        scope: "global",
      }),
    ).toEqual({ status: "invalid" });
  });

  it("derives the default title from the first non-empty line even with leading blank lines", async () => {
    getTestWindow();
    const { resetSavedPromptStoreForTests, useSavedPromptStore } =
      await import("./savedPromptStore");
    resetSavedPromptStoreForTests();

    const created = useSavedPromptStore.getState().createSnippet({
      body: "\n\n## Review prompt\nFocus on reconnect regressions",
      scope: "global",
    });
    if (created.status !== "created") {
      throw new Error("Expected snippet to be created.");
    }

    expect(created.snippet.title).toBe("Review prompt");
  });

  it("changes snippet scope between project and global", async () => {
    getTestWindow();
    const { resetSavedPromptStoreForTests, useSavedPromptStore } =
      await import("./savedPromptStore");
    resetSavedPromptStoreForTests();

    const created = useSavedPromptStore.getState().createSnippet({
      title: "Scoped prompt",
      body: "Keep this project-specific",
      scope: "global",
    });
    if (created.status !== "created") {
      throw new Error("Expected snippet to be created.");
    }

    const movedToProject = useSavedPromptStore
      .getState()
      .changeSnippetScope(created.snippet.id, "project", PROJECT_REF);
    expect(movedToProject).toMatchObject({
      scope: "project",
      projectKey: scopedProjectKey(PROJECT_REF),
    });

    const movedBackToGlobal = useSavedPromptStore
      .getState()
      .changeSnippetScope(created.snippet.id, "global", PROJECT_REF);
    expect(movedBackToGlobal).toMatchObject({
      scope: "global",
      projectKey: null,
    });
  });
});
