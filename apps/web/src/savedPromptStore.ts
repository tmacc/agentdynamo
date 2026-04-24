import { scopedProjectKey } from "@t3tools/client-runtime";
import type { ScopedProjectRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createDebouncedStorage, createMemoryStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";

export const SAVED_PROMPTS_STORAGE_KEY = "dynamo:saved-prompts:v1";
const SAVED_PROMPTS_STORAGE_VERSION = 1;
const SAVED_PROMPTS_PERSIST_DEBOUNCE_MS = 300;
const SAVED_PROMPT_MAX_TITLE_LENGTH = 80;

const savedPromptDebouncedStorage = createDebouncedStorage(
  typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
  SAVED_PROMPTS_PERSIST_DEBOUNCE_MS,
);

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    savedPromptDebouncedStorage.flush();
  });
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
      storage: createJSONStorage(() => savedPromptDebouncedStorage),
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
  useSavedPromptStore.setState({ snippetsById: {} });
  void useSavedPromptStore.persist.clearStorage();
}
