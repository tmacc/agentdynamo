import { scopedProjectKey } from "@t3tools/client-runtime";
import type {
  DesktopStorageMutationResult,
  DesktopStorageReadResult,
  ScopedProjectRef,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createDebouncedStorage, createMemoryStorage } from "./lib/storage";
import type { DebouncedStorage, StateStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";

export const SAVED_PROMPTS_STORAGE_KEY = "dynamo:saved-prompts:v1";
const SAVED_PROMPTS_STORAGE_VERSION = 1;
const SAVED_PROMPTS_PERSIST_DEBOUNCE_MS = 300;
const SAVED_PROMPT_MAX_TITLE_LENGTH = 80;

type SavedPromptStorage = StateStorage | DebouncedStorage;
export type SavedPromptStorageClassification =
  | { status: "valid" }
  | { status: "invalid-json"; message: string }
  | { status: "invalid-shape"; message: string }
  | { status: "unsupported-version"; message: string };

type DesktopSavedPromptWriteBlock =
  | { kind: "read-error"; message: string }
  | { kind: "unpreserved-corrupt"; message: string }
  | { kind: "schema-invalid"; message: string }
  | { kind: "unsupported-version"; message: string };

let resetSavedPromptStorageTrustForTests: (() => void) | null = null;

function createBrowserSavedPromptStorage(): DebouncedStorage {
  return createDebouncedStorage(
    typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
    SAVED_PROMPTS_PERSIST_DEBOUNCE_MS,
  );
}

function hasSavedPromptDesktopStorage(
  bridge: Window["desktopBridge"] | undefined,
): bridge is NonNullable<Window["desktopBridge"]> {
  return (
    !!bridge &&
    typeof bridge.getSavedPromptStorage === "function" &&
    typeof bridge.setSavedPromptStorage === "function" &&
    typeof bridge.removeSavedPromptStorage === "function"
  );
}

function warnSavedPromptStorage(message: string, detail?: Record<string, string>): void {
  console.warn("[savedPrompts] desktop persistence degraded:", message, detail ?? {});
}

function readBrowserSavedPromptStorageItem(name: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(name) : null;
  } catch {
    return null;
  }
}

function mutationErrorMessage(result: DesktopStorageMutationResult): string | null {
  return result.status === "error" ? result.message : null;
}

function writeDesktopSavedPromptStorage(
  bridge: NonNullable<Window["desktopBridge"]>,
  value: string,
  operation: string,
): boolean {
  try {
    const error = mutationErrorMessage(bridge.setSavedPromptStorage(value));
    if (error) {
      warnSavedPromptStorage(`${operation} failed.`, { error });
      return false;
    }
    return true;
  } catch (error) {
    warnSavedPromptStorage(`${operation} failed.`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function removeDesktopSavedPromptStorage(bridge: NonNullable<Window["desktopBridge"]>): void {
  try {
    const error = mutationErrorMessage(bridge.removeSavedPromptStorage());
    if (error) {
      warnSavedPromptStorage("Remove failed.", { error });
    }
  } catch (error) {
    warnSavedPromptStorage("Remove failed.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function readDesktopSavedPromptStorage(
  bridge: NonNullable<Window["desktopBridge"]>,
): DesktopStorageReadResult {
  try {
    return bridge.getSavedPromptStorage();
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function createSavedPromptStorage(): SavedPromptStorage {
  const bridge = typeof window !== "undefined" ? window.desktopBridge : undefined;
  if (!hasSavedPromptDesktopStorage(bridge)) {
    resetSavedPromptStorageTrustForTests = null;
    return createBrowserSavedPromptStorage();
  }

  let writeBlock: DesktopSavedPromptWriteBlock | null = null;
  const warnedWriteBlockKeys = new Set<string>();

  // Only a trusted read clears the block. Successful writes do not prove the
  // existing desktop document was safe to replace.
  const setWriteBlock = (nextBlock: DesktopSavedPromptWriteBlock): void => {
    if (writeBlock?.kind !== nextBlock.kind || writeBlock.message !== nextBlock.message) {
      warnedWriteBlockKeys.clear();
    }
    writeBlock = nextBlock;
  };

  const clearWriteBlock = (): void => {
    writeBlock = null;
    warnedWriteBlockKeys.clear();
  };

  resetSavedPromptStorageTrustForTests = clearWriteBlock;

  const isDesktopWriteBlocked = (operation: "setItem" | "removeItem"): boolean => {
    if (!writeBlock) {
      return false;
    }
    const warningKey = `${writeBlock.kind}:${operation}`;
    if (!warnedWriteBlockKeys.has(warningKey)) {
      warnedWriteBlockKeys.add(warningKey);
      warnSavedPromptStorage("Desktop saved prompt storage write blocked.", {
        operation,
        reason: writeBlock.kind,
        error: writeBlock.message,
      });
    }
    return true;
  };

  const desktopStorage: StateStorage = {
    getItem: (name) => {
      const desktopResult = readDesktopSavedPromptStorage(bridge);
      if (desktopResult.status === "ok") {
        const classification = classifySavedPromptStorageDocument(desktopResult.value);
        if (classification.status === "valid") {
          clearWriteBlock();
          return desktopResult.value;
        }

        if (classification.status === "unsupported-version") {
          setWriteBlock({ kind: "unsupported-version", message: classification.message });
          warnSavedPromptStorage("Desktop saved prompt storage version is unsupported.", {
            reason: classification.status,
            error: classification.message,
          });
          return null;
        }

        setWriteBlock({ kind: "schema-invalid", message: classification.message });
        warnSavedPromptStorage("Desktop saved prompt storage has an invalid app shape.", {
          reason: classification.status,
          error: classification.message,
        });
        return null;
      }

      if (desktopResult.status === "missing") {
        clearWriteBlock();
        const browserValue = readBrowserSavedPromptStorageItem(name);
        if (browserValue !== null) {
          const classification = classifySavedPromptStorageDocument(browserValue);
          if (classification.status === "valid") {
            writeDesktopSavedPromptStorage(bridge, browserValue, "Local saved prompt migration");
          } else {
            warnSavedPromptStorage("Skipping invalid browser saved prompt migration.", {
              reason: classification.status,
              error: classification.message,
            });
          }
        }
        return browserValue;
      }

      if (desktopResult.status === "corrupt") {
        if (desktopResult.backupPath) {
          clearWriteBlock();
          warnSavedPromptStorage("Desktop saved prompt storage is corrupt.", {
            backupPath: desktopResult.backupPath,
            error: desktopResult.message,
          });
        } else {
          setWriteBlock({ kind: "unpreserved-corrupt", message: desktopResult.message });
          warnSavedPromptStorage("Desktop saved prompt storage is corrupt and unpreserved.", {
            error: desktopResult.message,
          });
        }
        return null;
      }

      setWriteBlock({ kind: "read-error", message: desktopResult.message });
      warnSavedPromptStorage("Desktop saved prompt storage could not be read.", {
        error: desktopResult.message,
      });
      return null;
    },
    setItem: (_name, value) => {
      if (isDesktopWriteBlocked("setItem")) {
        return;
      }
      writeDesktopSavedPromptStorage(bridge, value, "Persist");
    },
    removeItem: () => {
      if (isDesktopWriteBlocked("removeItem")) {
        return;
      }
      removeDesktopSavedPromptStorage(bridge);
    },
  };

  return createDebouncedStorage(desktopStorage, SAVED_PROMPTS_PERSIST_DEBOUNCE_MS);
}

const savedPromptStorage = createSavedPromptStorage();

function flushSavedPromptStorage(): void {
  if ("flush" in savedPromptStorage) {
    savedPromptStorage.flush();
  }
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  const flush = () => {
    flushSavedPromptStorage();
  };
  window.addEventListener("beforeunload", flush);
  window.addEventListener("pagehide", flush);
}

export const SavedPromptScopeSchema = Schema.Literals(["project", "global"]);
export type SavedPromptScope = typeof SavedPromptScopeSchema.Type;

export const SavedPromptSnippetSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  scope: SavedPromptScopeSchema,
  projectKey: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
});
export type SavedPromptSnippet = typeof SavedPromptSnippetSchema.Type;

const PersistedSavedPromptStoreStateSchema = Schema.Struct({
  snippetsById: Schema.Record(Schema.String, SavedPromptSnippetSchema),
});
type PersistedSavedPromptStoreState = typeof PersistedSavedPromptStoreStateSchema.Type;

const PersistedSavedPromptStoreStorageSchema = Schema.Struct({
  version: Schema.Number,
  state: PersistedSavedPromptStoreStateSchema,
});

// Trust gate for desktop hydration/migration. The normalizer below still owns
// converting trusted persisted state into renderable in-memory state.
export function classifySavedPromptStorageDocument(raw: string): SavedPromptStorageClassification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: "invalid-json",
      message: "Saved prompt storage is not valid JSON.",
    };
  }

  let decoded: typeof PersistedSavedPromptStoreStorageSchema.Type;
  try {
    decoded = Schema.decodeUnknownSync(PersistedSavedPromptStoreStorageSchema)(parsed);
  } catch {
    return {
      status: "invalid-shape",
      message: "Saved prompt storage document has an invalid shape.",
    };
  }

  if (decoded.version !== SAVED_PROMPTS_STORAGE_VERSION) {
    return {
      status: "unsupported-version",
      message: `Saved prompt storage version ${decoded.version} is not supported.`,
    };
  }

  return { status: "valid" };
}

export interface SavedPromptSnippetGroup {
  id: SavedPromptScope;
  label: "This project" | "All projects";
  items: SavedPromptSnippet[];
}

interface CreateSavedPromptSnippetInput {
  title?: string | null;
  body: string;
  scope: SavedPromptScope;
  projectRef?: ScopedProjectRef | null;
}

type CreateSavedPromptSnippetResult =
  | {
      status: "created";
      snippet: SavedPromptSnippet;
    }
  | {
      status: "duplicate";
      snippet: SavedPromptSnippet;
    }
  | {
      status: "invalid";
    };

interface SavedPromptStoreState {
  snippetsById: Record<string, SavedPromptSnippet>;
  createSnippet: (input: CreateSavedPromptSnippetInput) => CreateSavedPromptSnippetResult;
  renameSnippet: (id: string, title: string) => SavedPromptSnippet | null;
  changeSnippetScope: (
    id: string,
    nextScope: SavedPromptScope,
    projectRef?: ScopedProjectRef | null,
  ) => SavedPromptSnippet | null;
  deleteSnippet: (id: string) => boolean;
  markSnippetUsed: (id: string) => SavedPromptSnippet | null;
  listVisibleSnippets: (
    projectRef: ScopedProjectRef | null,
    query?: string,
  ) => SavedPromptSnippetGroup[];
}

const EMPTY_SNIPPETS_BY_ID = Object.freeze({}) as Record<string, SavedPromptSnippet>;
const EMPTY_GROUPS: SavedPromptSnippetGroup[] = [];
const EMPTY_PERSISTED_STATE: PersistedSavedPromptStoreState = Object.freeze({
  snippetsById: EMPTY_SNIPPETS_BY_ID,
});

function canonicalizeSavedPromptBody(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function normalizeSavedPromptBodyForComparison(value: string): string {
  return canonicalizeSavedPromptBody(value).trim();
}

function stripLeadingMarkdownHeading(value: string): string {
  return value.replace(/^\s{0,3}#{1,6}\s+/, "");
}

function normalizeSavedPromptTitle(value: string): string {
  const trimmed = stripLeadingMarkdownHeading(value).replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) {
    return "Saved prompt";
  }
  return trimmed.slice(0, SAVED_PROMPT_MAX_TITLE_LENGTH).trimEnd();
}

export function deriveSavedPromptTitle(body: string): string {
  const firstNonEmptyLine =
    normalizeSavedPromptBodyForComparison(body)
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  return normalizeSavedPromptTitle(firstNonEmptyLine);
}

function resolveProjectKey(
  scope: SavedPromptScope,
  projectRef?: ScopedProjectRef | null,
): string | null {
  if (scope !== "project") {
    return null;
  }
  return projectRef ? scopedProjectKey(projectRef) : null;
}

function matchesSnippetQuery(snippet: SavedPromptSnippet, query: string): boolean {
  if (query.length === 0) {
    return true;
  }
  const haystack = `${snippet.title}\n${snippet.body}`.toLowerCase();
  return haystack.includes(query);
}

function snippetSortTimestamp(snippet: SavedPromptSnippet): string {
  return snippet.lastUsedAt ?? snippet.updatedAt ?? snippet.createdAt;
}

function compareSavedPromptSnippets(a: SavedPromptSnippet, b: SavedPromptSnippet): number {
  const timestampComparison = snippetSortTimestamp(b).localeCompare(snippetSortTimestamp(a));
  if (timestampComparison !== 0) {
    return timestampComparison;
  }
  return a.title.localeCompare(b.title);
}

function normalizePersistedSavedPromptStoreState(value: unknown): PersistedSavedPromptStoreState {
  try {
    return Schema.decodeUnknownSync(PersistedSavedPromptStoreStateSchema)(value);
  } catch {
    try {
      return Schema.decodeUnknownSync(PersistedSavedPromptStoreStorageSchema)(value).state;
    } catch {
      return EMPTY_PERSISTED_STATE;
    }
  }
}

export const useSavedPromptStore = create<SavedPromptStoreState>()(
  persist(
    (set, get) => ({
      snippetsById: {},
      createSnippet: (input) => {
        const body = canonicalizeSavedPromptBody(input.body);
        const comparisonBody = normalizeSavedPromptBodyForComparison(input.body);
        const projectKey = resolveProjectKey(input.scope, input.projectRef);
        if (comparisonBody.length === 0 || (input.scope === "project" && projectKey === null)) {
          return { status: "invalid" };
        }

        const title = normalizeSavedPromptTitle(
          input.title?.trim() || deriveSavedPromptTitle(body),
        );
        const duplicate = Object.values(get().snippetsById).find(
          (snippet) =>
            snippet.scope === input.scope &&
            snippet.projectKey === projectKey &&
            normalizeSavedPromptBodyForComparison(snippet.body) === comparisonBody,
        );
        if (duplicate) {
          return { status: "duplicate", snippet: duplicate };
        }

        const timestamp = new Date().toISOString();
        const snippet: SavedPromptSnippet = {
          id: randomUUID(),
          title,
          body,
          scope: input.scope,
          projectKey,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastUsedAt: null,
        };
        set((state) => ({
          snippetsById: {
            ...state.snippetsById,
            [snippet.id]: snippet,
          },
        }));
        return { status: "created", snippet };
      },
      renameSnippet: (id, title) => {
        const existing = get().snippetsById[id];
        if (!existing) {
          return null;
        }
        const nextTitle = normalizeSavedPromptTitle(title);
        if (existing.title === nextTitle) {
          return existing;
        }
        const nextSnippet: SavedPromptSnippet = {
          ...existing,
          title: nextTitle,
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({
          snippetsById: {
            ...state.snippetsById,
            [id]: nextSnippet,
          },
        }));
        return nextSnippet;
      },
      changeSnippetScope: (id, nextScope, projectRef) => {
        const existing = get().snippetsById[id];
        if (!existing) {
          return null;
        }
        const nextProjectKey = resolveProjectKey(nextScope, projectRef);
        if (nextScope === "project" && nextProjectKey === null) {
          return null;
        }
        if (existing.scope === nextScope && existing.projectKey === nextProjectKey) {
          return existing;
        }
        const nextSnippet: SavedPromptSnippet = {
          ...existing,
          scope: nextScope,
          projectKey: nextProjectKey,
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({
          snippetsById: {
            ...state.snippetsById,
            [id]: nextSnippet,
          },
        }));
        return nextSnippet;
      },
      deleteSnippet: (id) => {
        if (!get().snippetsById[id]) {
          return false;
        }
        set((state) => {
          const nextSnippetsById = { ...state.snippetsById };
          delete nextSnippetsById[id];
          return {
            snippetsById: nextSnippetsById,
          };
        });
        return true;
      },
      markSnippetUsed: (id) => {
        const existing = get().snippetsById[id];
        if (!existing) {
          return null;
        }
        const nextSnippet: SavedPromptSnippet = {
          ...existing,
          lastUsedAt: new Date().toISOString(),
        };
        set((state) => ({
          snippetsById: {
            ...state.snippetsById,
            [id]: nextSnippet,
          },
        }));
        return nextSnippet;
      },
      listVisibleSnippets: (projectRef, query = "") => {
        const normalizedQuery = query.trim().toLowerCase();
        const activeProjectKey = projectRef ? scopedProjectKey(projectRef) : null;
        const allSnippets = Object.values(get().snippetsById).filter((snippet) =>
          matchesSnippetQuery(snippet, normalizedQuery),
        );
        if (allSnippets.length === 0) {
          return EMPTY_GROUPS;
        }
        const projectItems = allSnippets
          .filter(
            (snippet) => snippet.scope === "project" && snippet.projectKey === activeProjectKey,
          )
          .toSorted(compareSavedPromptSnippets);
        const globalItems = allSnippets
          .filter((snippet) => snippet.scope === "global")
          .toSorted(compareSavedPromptSnippets);
        const groups: SavedPromptSnippetGroup[] = [];
        if (projectItems.length > 0) {
          groups.push({ id: "project", label: "This project", items: projectItems });
        }
        if (globalItems.length > 0) {
          groups.push({ id: "global", label: "All projects", items: globalItems });
        }
        return groups;
      },
    }),
    {
      name: SAVED_PROMPTS_STORAGE_KEY,
      version: SAVED_PROMPTS_STORAGE_VERSION,
      storage: createJSONStorage(() => savedPromptStorage),
      partialize: (state) => ({
        snippetsById: state.snippetsById,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedSavedPromptStoreState(persistedState),
      }),
    },
  ),
);

export function resetSavedPromptStoreForTests(): void {
  resetSavedPromptStorageTrustForTests?.();
  useSavedPromptStore.setState({ snippetsById: {} });
  void useSavedPromptStore.persist.clearStorage();
}
