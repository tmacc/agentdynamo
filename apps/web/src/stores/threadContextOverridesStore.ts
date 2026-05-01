import type { ProjectIntelligenceSurfaceId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

/**
 * Per-thread additive context overrides — surfaces the user has chosen to load
 * into THIS thread on top of the project defaults.
 *
 * v1 is in-memory and per-session: closing the thread (or refreshing the page)
 * resets the additions. Subtractive overrides are intentionally NOT in v1 — they
 * would bust the prompt cache and create coherence problems mid-conversation.
 *
 * NOTE (v1): like the project-level overrides, additions are currently advisory
 * — provider adapters do not yet consult them when assembling prompts. The store
 * exists so the inspector UI can show the user's intent, ready for v1.1 wiring.
 */
interface ThreadContextOverridesState {
  readonly additionsByThread: Readonly<
    Record<ThreadId, ReadonlyArray<ProjectIntelligenceSurfaceId>>
  >;
  readonly addThreadContextSurface: (
    threadId: ThreadId,
    surfaceId: ProjectIntelligenceSurfaceId,
  ) => void;
  readonly removeThreadContextSurface: (
    threadId: ThreadId,
    surfaceId: ProjectIntelligenceSurfaceId,
  ) => void;
  readonly clearThreadContextAdditions: (threadId: ThreadId) => void;
}

export const useThreadContextOverridesStore = create<ThreadContextOverridesState>((set) => ({
  additionsByThread: {},
  addThreadContextSurface: (threadId, surfaceId) =>
    set((state) => {
      const current = state.additionsByThread[threadId] ?? [];
      if (current.includes(surfaceId)) return state;
      return {
        additionsByThread: {
          ...state.additionsByThread,
          [threadId]: [...current, surfaceId],
        },
      };
    }),
  removeThreadContextSurface: (threadId, surfaceId) =>
    set((state) => {
      const current = state.additionsByThread[threadId] ?? [];
      if (!current.includes(surfaceId)) return state;
      const next = current.filter((id) => id !== surfaceId);
      const additionsByThread = { ...state.additionsByThread };
      if (next.length === 0) {
        delete additionsByThread[threadId];
      } else {
        additionsByThread[threadId] = next;
      }
      return { additionsByThread };
    }),
  clearThreadContextAdditions: (threadId) =>
    set((state) => {
      if (!(threadId in state.additionsByThread)) return state;
      const additionsByThread = { ...state.additionsByThread };
      delete additionsByThread[threadId];
      return { additionsByThread };
    }),
}));

export const EMPTY_THREAD_ADDITIONS: ReadonlyArray<ProjectIntelligenceSurfaceId> = Object.freeze(
  [],
);

export function selectThreadContextAdditions(
  state: ThreadContextOverridesState,
  threadId: ThreadId | null,
): ReadonlyArray<ProjectIntelligenceSurfaceId> {
  if (!threadId) return EMPTY_THREAD_ADDITIONS;
  return state.additionsByThread[threadId] ?? EMPTY_THREAD_ADDITIONS;
}
