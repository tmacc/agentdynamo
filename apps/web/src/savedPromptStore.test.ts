import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import {
  EnvironmentId,
  ProjectId,
  type DesktopStorageMutationResult,
  type DesktopStorageReadResult,
} from "@t3tools/contracts";
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

type TestWindow = Window &
  typeof globalThis & {
    __listeners: Map<string, EventListener[]>;
  };

function createPersistedSnippetDocument(input: {
  id?: string;
  title: string;
  body: string;
  scope?: "project" | "global";
  projectKey?: string | null;
}): string {
  const id = input.id ?? "snippet-1";
  return JSON.stringify({
    version: 1,
    state: {
      snippetsById: {
        [id]: {
          id,
          title: input.title,
          body: input.body,
          scope: input.scope ?? "global",
          projectKey: input.projectKey ?? null,
          createdAt: "2026-04-19T12:00:00.000Z",
          updatedAt: "2026-04-19T12:00:00.000Z",
          lastUsedAt: null,
        },
      },
    },
  });
}

function createEmptyPersistedSnippetDocument(version = 1): string {
  return JSON.stringify({
    version,
    state: {
      snippetsById: {},
    },
  });
}

function getTestWindow(): TestWindow {
  const localStorage = createLocalStorageStub();
  const listeners = new Map<string, EventListener[]>();
  const testWindow = {
    __listeners: listeners,
    addEventListener: (type: string, listener: EventListener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    localStorage,
  } as unknown as TestWindow;
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("localStorage", localStorage);
  return testWindow;
}

function dispatchTestWindowEvent(testWindow: TestWindow, type: string): void {
  for (const listener of testWindow.__listeners.get(type) ?? []) {
    listener(new Event(type));
  }
}

function installSavedPromptDesktopBridge(
  testWindow: TestWindow,
  storageRef: { value: string | null },
  options: {
    readResult?: DesktopStorageReadResult | (() => DesktopStorageReadResult);
    setResult?: DesktopStorageMutationResult;
    removeResult?: DesktopStorageMutationResult;
    setThrows?: boolean;
  } = {},
): {
  getSavedPromptStorage: ReturnType<typeof vi.fn>;
  setSavedPromptStorage: ReturnType<typeof vi.fn>;
  removeSavedPromptStorage: ReturnType<typeof vi.fn>;
} {
  const getSavedPromptStorage = vi.fn(() => {
    if (typeof options.readResult === "function") {
      return options.readResult();
    }
    return (
      options.readResult ??
      (storageRef.value === null
        ? { status: "missing" as const }
        : { status: "ok" as const, value: storageRef.value })
    );
  });
  const setSavedPromptStorage = vi.fn((value: string) => {
    if (options.setThrows) {
      throw new Error("write failed");
    }
    if (options.setResult?.status === "error") {
      return options.setResult;
    }
    storageRef.value = value;
    return options.setResult ?? { status: "ok" as const };
  });
  const removeSavedPromptStorage = vi.fn(() => {
    if (options.removeResult?.status === "error") {
      return options.removeResult;
    }
    storageRef.value = null;
    return options.removeResult ?? { status: "ok" as const };
  });

  Object.assign(testWindow, {
    desktopBridge: {
      getSavedPromptStorage,
      setSavedPromptStorage,
      removeSavedPromptStorage,
    },
  } satisfies { desktopBridge: Partial<NonNullable<Window["desktopBridge"]>> });
  return {
    getSavedPromptStorage,
    setSavedPromptStorage,
    removeSavedPromptStorage,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("savedPromptStore", () => {
  it("classifies saved prompt storage documents without leaking document contents", async () => {
    const { classifySavedPromptStorageDocument } = await import("./savedPromptStore");
    const sentinel = "SENTINEL_PROMPT_BODY_SHOULD_NOT_LEAK";

    expect(
      classifySavedPromptStorageDocument(
        createPersistedSnippetDocument({
          title: "Valid",
          body: "Valid body",
        }),
      ),
    ).toEqual({ status: "valid" });
    expect(classifySavedPromptStorageDocument("{not-json")).toEqual({
      status: "invalid-json",
      message: expect.any(String),
    });
    expect(classifySavedPromptStorageDocument("{}")).toEqual({
      status: "invalid-shape",
      message: expect.any(String),
    });
    expect(classifySavedPromptStorageDocument("null")).toEqual({
      status: "invalid-shape",
      message: expect.any(String),
    });
    expect(classifySavedPromptStorageDocument(createEmptyPersistedSnippetDocument(99))).toEqual({
      status: "unsupported-version",
      message: expect.any(String),
    });

    for (const result of [
      classifySavedPromptStorageDocument("{not-json"),
      classifySavedPromptStorageDocument(
        JSON.stringify({
          version: 1,
          state: {
            snippetsById: {
              "snippet-1": {
                body: sentinel,
              },
            },
          },
        }),
      ),
    ]) {
      if ("message" in result) {
        expect(result.message).not.toContain(sentinel);
      }
    }
  });

  it("hydrates persisted snippets from localStorage", async () => {
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "dynamo:saved-prompts:v1",
      createPersistedSnippetDocument({
        title: "Review diff",
        body: "Review the diff carefully",
        scope: "project",
        projectKey: scopedProjectKey(PROJECT_REF),
      }),
    );

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();

    expect(useSavedPromptStore.getState().snippetsById["snippet-1"]).toMatchObject({
      title: "Review diff",
      projectKey: scopedProjectKey(PROJECT_REF),
    });
  });

  it("uses desktop bridge storage instead of origin-scoped localStorage when available", async () => {
    vi.useFakeTimers();
    const initialDesktopValue = JSON.stringify({ version: 1, state: { snippetsById: {} } });
    const storageRef = { value: initialDesktopValue as string | null };
    let testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "dynamo:saved-prompts:v1",
      createPersistedSnippetDocument({
        title: "Origin prompt",
        body: "Ignore when desktop storage exists",
      }),
    );
    installSavedPromptDesktopBridge(testWindow, storageRef);

    let { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();
    const created = useSavedPromptStore.getState().createSnippet({
      title: "Desktop prompt",
      body: "Persist through the desktop bridge",
      scope: "global",
    });

    expect(created.status).toBe("created");
    expect(storageRef.value).toBe(initialDesktopValue);

    vi.advanceTimersByTime(300);
    expect(storageRef.value).toContain("Desktop prompt");
    expect(testWindow.localStorage.getItem("dynamo:saved-prompts:v1")).toContain("Origin prompt");

    vi.resetModules();
    vi.useRealTimers();
    testWindow = getTestWindow();
    installSavedPromptDesktopBridge(testWindow, storageRef);

    ({ useSavedPromptStore } = await import("./savedPromptStore"));
    await useSavedPromptStore.persist.rehydrate();

    expect(Object.values(useSavedPromptStore.getState().snippetsById)).toEqual([
      expect.objectContaining({
        title: "Desktop prompt",
        body: "Persist through the desktop bridge",
      }),
    ]);
  });

  it("falls back to browser storage when a stale desktop bridge lacks saved prompt methods", async () => {
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "dynamo:saved-prompts:v1",
      createPersistedSnippetDocument({
        title: "Browser fallback",
        body: "Use browser storage",
      }),
    );
    Object.assign(testWindow, {
      desktopBridge: {},
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();

    expect(Object.values(useSavedPromptStore.getState().snippetsById)).toEqual([
      expect.objectContaining({ title: "Browser fallback" }),
    ]);
  });

  it("migrates current-origin localStorage only when desktop storage is missing", async () => {
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "dynamo:saved-prompts:v1",
      createPersistedSnippetDocument({
        title: "Migrated prompt",
        body: "Copy me once",
      }),
    );
    installSavedPromptDesktopBridge(testWindow, storageRef);

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();

    expect(Object.values(useSavedPromptStore.getState().snippetsById)).toEqual([
      expect.objectContaining({ title: "Migrated prompt" }),
    ]);
    expect(storageRef.value).toContain("Migrated prompt");
  });

  it("hydrates localStorage when missing-desktop migration write fails", async () => {
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "dynamo:saved-prompts:v1",
      createPersistedSnippetDocument({
        title: "Fallback despite write failure",
        body: "Keep visible",
      }),
    );
    installSavedPromptDesktopBridge(testWindow, storageRef, {
      setResult: { status: "error", message: "disk full" },
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();

    expect(Object.values(useSavedPromptStore.getState().snippetsById)).toEqual([
      expect.objectContaining({ title: "Fallback despite write failure" }),
    ]);
    expect(storageRef.value).toBeNull();
  });

  it("does not migrate stale localStorage when desktop storage is corrupt", async () => {
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "dynamo:saved-prompts:v1",
      createPersistedSnippetDocument({
        title: "Stale prompt",
        body: "Do not restore",
      }),
    );
    installSavedPromptDesktopBridge(testWindow, storageRef, {
      readResult: {
        status: "corrupt",
        message: "Unexpected token",
        backupPath: "/tmp/saved-prompts.corrupt.json",
      },
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();

    expect(useSavedPromptStore.getState().snippetsById).toEqual({});
    expect(storageRef.value).toBeNull();
  });

  it("does not migrate stale localStorage when desktop storage has a read error", async () => {
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "dynamo:saved-prompts:v1",
      createPersistedSnippetDocument({
        title: "Stale prompt",
        body: "Do not restore",
      }),
    );
    installSavedPromptDesktopBridge(testWindow, storageRef, {
      readResult: { status: "error", message: "EACCES" },
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();

    expect(useSavedPromptStore.getState().snippetsById).toEqual({});
    expect(storageRef.value).toBeNull();
  });

  it("blocks desktop writes after a desktop read error", async () => {
    vi.useFakeTimers();
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "dynamo:saved-prompts:v1",
      createPersistedSnippetDocument({
        title: "Stale prompt",
        body: "Do not restore or overwrite",
      }),
    );
    const bridge = installSavedPromptDesktopBridge(testWindow, storageRef, {
      readResult: { status: "error", message: "EACCES" },
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();
    const created = useSavedPromptStore.getState().createSnippet({
      title: "In memory only",
      body: "Do not persist over unread desktop data",
      scope: "global",
    });

    expect(created.status).toBe("created");
    vi.advanceTimersByTime(300);
    expect(bridge.setSavedPromptStorage).not.toHaveBeenCalled();
    expect(storageRef.value).toBeNull();
  });

  it("blocks desktop removes after a desktop read error", async () => {
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    const bridge = installSavedPromptDesktopBridge(testWindow, storageRef, {
      readResult: { status: "error", message: "EACCES" },
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();
    void useSavedPromptStore.persist.clearStorage();

    expect(bridge.removeSavedPromptStorage).not.toHaveBeenCalled();
  });

  it("blocks desktop writes when corrupt desktop storage was not preserved", async () => {
    vi.useFakeTimers();
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    const bridge = installSavedPromptDesktopBridge(testWindow, storageRef, {
      readResult: { status: "corrupt", message: "Unexpected token" },
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();
    useSavedPromptStore.getState().createSnippet({
      title: "Blocked after corrupt read",
      body: "Do not overwrite unpreserved corrupt file",
      scope: "global",
    });

    vi.advanceTimersByTime(300);
    expect(bridge.setSavedPromptStorage).not.toHaveBeenCalled();
  });

  it("permits fresh desktop writes when corrupt desktop storage was preserved", async () => {
    vi.useFakeTimers();
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    const bridge = installSavedPromptDesktopBridge(testWindow, storageRef, {
      readResult: {
        status: "corrupt",
        message: "Unexpected token",
        backupPath: "/tmp/saved-prompts.corrupt.json",
      },
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();
    useSavedPromptStore.getState().createSnippet({
      title: "Fresh prompt",
      body: "Corrupt file was already preserved",
      scope: "global",
    });

    vi.advanceTimersByTime(300);
    expect(bridge.setSavedPromptStorage).toHaveBeenCalledOnce();
    expect(storageRef.value).toContain("Fresh prompt");
  });

  it("blocks desktop writes for schema-invalid desktop storage", async () => {
    vi.useFakeTimers();
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "dynamo:saved-prompts:v1",
      createPersistedSnippetDocument({
        title: "Stale prompt",
        body: "Do not migrate",
      }),
    );
    const bridge = installSavedPromptDesktopBridge(testWindow, storageRef, {
      readResult: { status: "ok", value: "{}" },
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();
    useSavedPromptStore.getState().createSnippet({
      title: "Blocked schema",
      body: "Do not overwrite invalid desktop shape",
      scope: "global",
    });

    vi.advanceTimersByTime(300);
    expect(useSavedPromptStore.getState().snippetsById).not.toEqual({});
    expect(bridge.setSavedPromptStorage).not.toHaveBeenCalled();
    expect(storageRef.value).toBeNull();
  });

  it("blocks desktop writes for unsupported saved prompt storage versions", async () => {
    vi.useFakeTimers();
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    const bridge = installSavedPromptDesktopBridge(testWindow, storageRef, {
      readResult: { status: "ok", value: createEmptyPersistedSnippetDocument(99) },
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();
    useSavedPromptStore.getState().createSnippet({
      title: "Blocked version",
      body: "Do not downgrade a future storage version",
      scope: "global",
    });

    vi.advanceTimersByTime(300);
    expect(bridge.setSavedPromptStorage).not.toHaveBeenCalled();
  });

  it("does not migrate schema-invalid localStorage when desktop storage is missing", async () => {
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem("dynamo:saved-prompts:v1", "{}");
    const bridge = installSavedPromptDesktopBridge(testWindow, storageRef);

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();

    expect(useSavedPromptStore.getState().snippetsById).toEqual({});
    expect(bridge.setSavedPromptStorage).not.toHaveBeenCalled();
    expect(storageRef.value).toBeNull();
  });

  it("clears a desktop write block when a later read returns valid desktop storage", async () => {
    vi.useFakeTimers();
    const storageRef = { value: createEmptyPersistedSnippetDocument() as string | null };
    const testWindow = getTestWindow();
    let readResult: DesktopStorageReadResult = { status: "error", message: "EACCES" };
    const bridge = installSavedPromptDesktopBridge(testWindow, storageRef, {
      readResult: () => readResult,
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();
    useSavedPromptStore.getState().createSnippet({
      title: "Blocked first",
      body: "This write should be blocked",
      scope: "global",
    });
    vi.advanceTimersByTime(300);
    expect(bridge.setSavedPromptStorage).not.toHaveBeenCalled();

    readResult = { status: "ok", value: createEmptyPersistedSnippetDocument() };
    await useSavedPromptStore.persist.rehydrate();
    useSavedPromptStore.getState().createSnippet({
      title: "Allowed after valid read",
      body: "This write should persist",
      scope: "global",
    });
    vi.advanceTimersByTime(300);

    expect(bridge.setSavedPromptStorage).toHaveBeenCalledOnce();
    expect(storageRef.value).toContain("Allowed after valid read");
  });

  it("does not include prompt bodies in desktop persistence warnings", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sentinel = "SENTINEL_PROMPT_BODY_SHOULD_NOT_LEAK";
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "dynamo:saved-prompts:v1",
      createPersistedSnippetDocument({
        title: "Stale prompt",
        body: sentinel,
      }),
    );
    installSavedPromptDesktopBridge(testWindow, storageRef, {
      readResult: { status: "error", message: "EACCES" },
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();
    useSavedPromptStore.getState().createSnippet({
      title: "New prompt",
      body: sentinel,
      scope: "global",
    });
    vi.advanceTimersByTime(300);

    const warningText = warnSpy.mock.calls.map((args) => JSON.stringify(args)).join("\n");
    expect(warningText).not.toContain(sentinel);
  });

  it("keeps blocked desktop writes idempotent under unload flush", async () => {
    vi.useFakeTimers();
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    const bridge = installSavedPromptDesktopBridge(testWindow, storageRef, {
      readResult: { status: "error", message: "EACCES" },
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();
    useSavedPromptStore.getState().createSnippet({
      title: "Blocked flush",
      body: "Unload flush should no-op",
      scope: "global",
    });

    dispatchTestWindowEvent(testWindow, "beforeunload");
    vi.advanceTimersByTime(300);

    expect(bridge.setSavedPromptStorage).not.toHaveBeenCalled();
    expect(storageRef.value).toBeNull();
  });

  it("flushes debounced desktop writes on beforeunload and pagehide", async () => {
    vi.useFakeTimers();
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    installSavedPromptDesktopBridge(testWindow, storageRef);

    let { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();
    useSavedPromptStore.getState().createSnippet({
      title: "Before unload",
      body: "Flush me",
      scope: "global",
    });
    expect(storageRef.value).toBeNull();

    dispatchTestWindowEvent(testWindow, "beforeunload");
    expect(storageRef.value).toContain("Before unload");

    vi.resetModules();
    vi.useFakeTimers();
    storageRef.value = null;
    const nextWindow = getTestWindow();
    installSavedPromptDesktopBridge(nextWindow, storageRef);

    ({ useSavedPromptStore } = await import("./savedPromptStore"));
    await useSavedPromptStore.persist.rehydrate();
    useSavedPromptStore.getState().createSnippet({
      title: "Page hide",
      body: "Flush me too",
      scope: "global",
    });
    expect(storageRef.value).toBeNull();

    dispatchTestWindowEvent(nextWindow, "pagehide");
    expect(storageRef.value).toContain("Page hide");
  });

  it("keeps store actions in memory when desktop mutations fail", async () => {
    vi.useFakeTimers();
    const storageRef = { value: null as string | null };
    const testWindow = getTestWindow();
    installSavedPromptDesktopBridge(testWindow, storageRef, {
      setResult: { status: "error", message: "disk full" },
      removeResult: { status: "error", message: "locked" },
    });

    const { useSavedPromptStore } = await import("./savedPromptStore");
    await useSavedPromptStore.persist.rehydrate();
    const created = useSavedPromptStore.getState().createSnippet({
      title: "In memory",
      body: "Persistence can fail",
      scope: "global",
    });
    if (created.status !== "created") {
      throw new Error("Expected snippet to be created.");
    }

    expect(() => {
      useSavedPromptStore.getState().renameSnippet(created.snippet.id, "Renamed");
      useSavedPromptStore.getState().markSnippetUsed(created.snippet.id);
      useSavedPromptStore.getState().deleteSnippet(created.snippet.id);
      vi.advanceTimersByTime(300);
    }).not.toThrow();
    expect(useSavedPromptStore.getState().snippetsById).toEqual({});
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
