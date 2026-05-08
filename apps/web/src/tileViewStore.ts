/**
 * Zustand store for tiled multi-thread view state.
 *
 * The URL is the source of truth: this store hydrates from the URL via
 * `setFromUrl()` and consumers re-serialize back to the URL after mutations.
 * The store itself is non-persisted.
 */
import { scopedThreadKey } from "@t3tools/client-runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

export type TileTarget = { kind: "server"; threadRef: ScopedThreadRef };

export interface TileEntry {
  /** Stable id for React keys; survives reorder. */
  id: string;
  target: TileTarget;
}

export type SplitPickerAnchor = "header" | "shortcut" | "sidebar";

export interface TileViewState {
  tiles: readonly TileEntry[];
  focusedIndex: number;
  splitPickerOpen: boolean;
  splitPickerAnchor: SplitPickerAnchor | null;
}

export interface TileViewStore extends TileViewState {
  setFromUrl: (tiles: readonly ScopedThreadRef[], focusedIndex: number) => void;
  openTiles: (targets: readonly TileTarget[], focusedIndex?: number) => void;
  openTilesFocusedOn: (targets: readonly TileTarget[], focusTarget: TileTarget) => void;
  replaceFocused: (target: TileTarget) => void;
  closeTile: (index: number) => TileEntry | null;
  cycleFocus: (direction: 1 | -1) => void;
  focusByIndex: (index: number) => void;
  exitTileMode: () => void;
  openSplitPicker: (anchor: SplitPickerAnchor) => void;
  closeSplitPicker: () => void;
}

let nextEntryCounter = 0;
function nextEntryId(): string {
  nextEntryCounter += 1;
  return `tile_${Date.now().toString(36)}_${nextEntryCounter.toString(36)}`;
}

function targetKey(target: TileTarget): string {
  return scopedThreadKey(target.threadRef);
}

function clampFocus(focusedIndex: number, length: number): number {
  if (length <= 0) return 0;
  if (focusedIndex < 0) return 0;
  if (focusedIndex >= length) return length - 1;
  return focusedIndex;
}

function tilesEqualByKey(
  current: readonly TileEntry[],
  incoming: readonly ScopedThreadRef[],
): boolean {
  if (current.length !== incoming.length) return false;
  for (let i = 0; i < current.length; i += 1) {
    const currentEntry = current[i];
    const incomingRef = incoming[i];
    if (!currentEntry || !incomingRef) return false;
    if (scopedThreadKey(currentEntry.target.threadRef) !== scopedThreadKey(incomingRef)) {
      return false;
    }
  }
  return true;
}

function dedupeTargets(targets: readonly TileTarget[]): TileTarget[] {
  const seen = new Set<string>();
  const result: TileTarget[] = [];
  for (const target of targets) {
    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}

function buildOpenTilesUpdate(
  state: TileViewState,
  targets: readonly TileTarget[],
  options: { focusedIndex?: number; focusTarget?: TileTarget } = {},
): Partial<TileViewState> | null {
  if (targets.length === 0) return null;

  const merged = dedupeTargets([...state.tiles.map((entry) => entry.target), ...targets]);
  const mergedRefs = merged.map((target) => target.threadRef);
  const sameTiles = tilesEqualByKey(state.tiles, mergedRefs);

  const focusTarget = options.focusTarget;
  const requestedFocus =
    focusTarget !== undefined
      ? merged.findIndex((target) => targetKey(target) === targetKey(focusTarget))
      : options.focusedIndex;

  const nextFocus =
    requestedFocus !== undefined && requestedFocus >= 0
      ? clampFocus(requestedFocus, merged.length)
      : sameTiles
        ? state.focusedIndex
        : (() => {
            // Default: focus the first newly-added tile.
            for (let i = state.tiles.length; i < merged.length; i += 1) return i;
            return state.focusedIndex;
          })();

  const clampedFocus = clampFocus(nextFocus, merged.length);

  if (sameTiles) {
    return clampedFocus === state.focusedIndex ? null : { focusedIndex: clampedFocus };
  }

  const existingByKey = new Map<string, TileEntry>();
  for (const entry of state.tiles) {
    existingByKey.set(targetKey(entry.target), entry);
  }

  const nextTiles: TileEntry[] = merged.map((target) => {
    const existing = existingByKey.get(targetKey(target));
    if (existing) return existing;
    return { id: nextEntryId(), target };
  });

  return {
    tiles: nextTiles,
    focusedIndex: clampedFocus,
  };
}

const INITIAL_STATE: TileViewState = {
  tiles: [],
  focusedIndex: 0,
  splitPickerOpen: false,
  splitPickerAnchor: null,
};

export const useTileViewStore = create<TileViewStore>((set, get) => ({
  ...INITIAL_STATE,

  setFromUrl: (incomingRefs, focusedIndex) => {
    const state = get();
    const clampedFocus = clampFocus(focusedIndex, incomingRefs.length);

    if (tilesEqualByKey(state.tiles, incomingRefs) && state.focusedIndex === clampedFocus) {
      return;
    }

    if (incomingRefs.length === 0) {
      set({ tiles: [], focusedIndex: 0 });
      return;
    }

    // Reuse existing entry ids for tiles that were already present (preserves React keys).
    const existingByKey = new Map<string, TileEntry>();
    for (const entry of state.tiles) {
      existingByKey.set(targetKey(entry.target), entry);
    }

    const nextTiles: TileEntry[] = incomingRefs.map((ref) => {
      const target: TileTarget = { kind: "server", threadRef: ref };
      const existing = existingByKey.get(scopedThreadKey(ref));
      if (existing) return existing;
      return { id: nextEntryId(), target };
    });

    set({ tiles: nextTiles, focusedIndex: clampedFocus });
  },

  openTiles: (targets, focusedIndex) => {
    const update = buildOpenTilesUpdate(
      get(),
      targets,
      focusedIndex === undefined ? {} : { focusedIndex },
    );
    if (update) set(update);
  },

  openTilesFocusedOn: (targets, focusTarget) => {
    const update = buildOpenTilesUpdate(get(), targets, { focusTarget });
    if (update) set(update);
  },

  replaceFocused: (target) => {
    const state = get();
    if (state.tiles.length === 0) {
      // Nothing to replace — open as the first tile
      set({
        tiles: [{ id: nextEntryId(), target }],
        focusedIndex: 0,
      });
      return;
    }

    // If the target is already in the tile set, focus that instead of duplicating
    const existingIndex = state.tiles.findIndex(
      (entry) => targetKey(entry.target) === targetKey(target),
    );
    if (existingIndex !== -1) {
      if (existingIndex !== state.focusedIndex) set({ focusedIndex: existingIndex });
      return;
    }

    const focused = clampFocus(state.focusedIndex, state.tiles.length);
    const nextTiles = state.tiles.slice();
    nextTiles[focused] = { id: nextEntryId(), target };
    set({ tiles: nextTiles, focusedIndex: focused });
  },

  closeTile: (index) => {
    const state = get();
    if (index < 0 || index >= state.tiles.length) return null;
    const removed = state.tiles[index] ?? null;
    const nextTiles = state.tiles.filter((_, i) => i !== index);
    const nextFocus =
      nextTiles.length === 0
        ? 0
        : clampFocus(
            state.focusedIndex >= index ? state.focusedIndex - 1 : state.focusedIndex,
            nextTiles.length,
          );
    set({ tiles: nextTiles, focusedIndex: Math.max(0, nextFocus) });
    return removed;
  },

  cycleFocus: (direction) => {
    const state = get();
    if (state.tiles.length <= 1) return;
    const next = (state.focusedIndex + direction + state.tiles.length) % state.tiles.length;
    if (next === state.focusedIndex) return;
    set({ focusedIndex: next });
  },

  focusByIndex: (index) => {
    const state = get();
    if (index < 0 || index >= state.tiles.length) return;
    if (index === state.focusedIndex) return;
    set({ focusedIndex: index });
  },

  exitTileMode: () => {
    const state = get();
    if (state.tiles.length === 0 && !state.splitPickerOpen) return;
    set({ tiles: [], focusedIndex: 0, splitPickerOpen: false, splitPickerAnchor: null });
  },

  openSplitPicker: (anchor) => {
    const state = get();
    if (state.splitPickerOpen && state.splitPickerAnchor === anchor) return;
    set({ splitPickerOpen: true, splitPickerAnchor: anchor });
  },

  closeSplitPicker: () => {
    const state = get();
    if (!state.splitPickerOpen) return;
    set({ splitPickerOpen: false, splitPickerAnchor: null });
  },
}));

/** Selector: is tile mode currently active? */
export function selectIsTileMode(state: TileViewState): boolean {
  return state.tiles.length > 0;
}

/** Selector: the currently focused tile entry, if any. */
export function selectFocusedTile(state: TileViewState): TileEntry | null {
  if (state.tiles.length === 0) return null;
  return state.tiles[state.focusedIndex] ?? null;
}

/** Selector: the currently focused thread ref, if any. */
export function selectFocusedThreadRef(state: TileViewState): ScopedThreadRef | null {
  const tile = selectFocusedTile(state);
  return tile?.target.threadRef ?? null;
}
