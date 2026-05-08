import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  selectFocusedThreadRef,
  selectFocusedTile,
  selectIsTileMode,
  type TileTarget,
  useTileViewStore,
} from "./tileViewStore";

const ENV_A = EnvironmentId.make("env-a");
const ENV_B = EnvironmentId.make("env-b");
const T1 = ThreadId.make("thread-1");
const T2 = ThreadId.make("thread-2");
const T3 = ThreadId.make("thread-3");
const T4 = ThreadId.make("thread-4");

const tile = (envId: EnvironmentId, tid: ThreadId): TileTarget => ({
  kind: "server",
  threadRef: { environmentId: envId, threadId: tid },
});

describe("tileViewStore", () => {
  beforeEach(() => {
    useTileViewStore.getState().exitTileMode();
  });

  describe("openTiles", () => {
    it("opens new tiles and focuses the first newly added", () => {
      useTileViewStore.getState().openTiles([tile(ENV_A, T1), tile(ENV_A, T2)]);

      const state = useTileViewStore.getState();
      expect(state.tiles).toHaveLength(2);
      expect(state.tiles[0]?.target.threadRef.threadId).toBe(T1);
      expect(state.tiles[1]?.target.threadRef.threadId).toBe(T2);
      expect(state.focusedIndex).toBe(0);
    });

    it("respects explicit focusedIndex", () => {
      useTileViewStore.getState().openTiles([tile(ENV_A, T1), tile(ENV_A, T2)], 1);
      expect(useTileViewStore.getState().focusedIndex).toBe(1);
    });

    it("de-duplicates by scopedThreadKey", () => {
      useTileViewStore.getState().openTiles([tile(ENV_A, T1), tile(ENV_A, T1), tile(ENV_A, T2)]);
      const state = useTileViewStore.getState();
      expect(state.tiles).toHaveLength(2);
      expect(state.tiles[0]?.target.threadRef.threadId).toBe(T1);
      expect(state.tiles[1]?.target.threadRef.threadId).toBe(T2);
    });

    it("merges with existing tiles without duplication", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2)]);
      store.openTiles([tile(ENV_A, T2), tile(ENV_A, T3)]);

      const state = useTileViewStore.getState();
      expect(state.tiles).toHaveLength(3);
      expect(state.tiles.map((t) => t.target.threadRef.threadId)).toEqual([T1, T2, T3]);
    });

    it("preserves entry ids on merge so React keys stay stable", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2)]);
      const beforeIds = useTileViewStore.getState().tiles.map((t) => t.id);
      store.openTiles([tile(ENV_A, T3)]);
      const afterTiles = useTileViewStore.getState().tiles;
      expect(afterTiles[0]?.id).toBe(beforeIds[0]);
      expect(afterTiles[1]?.id).toBe(beforeIds[1]);
      expect(afterTiles[2]?.id).not.toBe(beforeIds[0]);
    });

    it("is a no-op when targets is empty", () => {
      const before = useTileViewStore.getState();
      useTileViewStore.getState().openTiles([]);
      expect(useTileViewStore.getState()).toBe(before);
    });

    it("focuses an already-tiled thread when re-opened", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2)]);
      store.focusByIndex(0);
      // Re-open T2 — should focus existing index 1, not duplicate
      store.openTiles([tile(ENV_A, T2)], 1);

      const state = useTileViewStore.getState();
      expect(state.tiles).toHaveLength(2);
      expect(state.focusedIndex).toBe(1);
    });

    it("focuses the requested target after merging into an existing grid", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2), tile(ENV_A, T3)]);
      store.focusByIndex(2);
      store.openTilesFocusedOn([tile(ENV_A, T3), tile(ENV_B, T4)], tile(ENV_B, T4));

      const state = useTileViewStore.getState();
      expect(state.tiles.map((t) => t.target.threadRef.threadId)).toEqual([T1, T2, T3, T4]);
      expect(state.focusedIndex).toBe(3);
      expect(state.tiles[state.focusedIndex]?.target.threadRef.threadId).toBe(T4);
    });

    it("focuses an already-open target without duplicating it", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2), tile(ENV_A, T3)]);
      store.focusByIndex(2);
      store.openTilesFocusedOn([tile(ENV_A, T1)], tile(ENV_A, T1));

      const state = useTileViewStore.getState();
      expect(state.tiles.map((t) => t.target.threadRef.threadId)).toEqual([T1, T2, T3]);
      expect(state.focusedIndex).toBe(0);
    });

    it("focuses the selected target in an initial two-tile split", () => {
      const store = useTileViewStore.getState();
      store.openTilesFocusedOn([tile(ENV_A, T1), tile(ENV_A, T2)], tile(ENV_A, T2));

      const state = useTileViewStore.getState();
      expect(state.tiles.map((t) => t.target.threadRef.threadId)).toEqual([T1, T2]);
      expect(state.focusedIndex).toBe(1);
    });
  });

  describe("replaceFocused", () => {
    it("opens as first tile when no tiles exist", () => {
      useTileViewStore.getState().replaceFocused(tile(ENV_A, T1));
      const state = useTileViewStore.getState();
      expect(state.tiles).toHaveLength(1);
      expect(state.focusedIndex).toBe(0);
    });

    it("replaces the focused tile with the new target", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2)]);
      store.focusByIndex(1);
      store.replaceFocused(tile(ENV_A, T3));

      const state = useTileViewStore.getState();
      expect(state.tiles).toHaveLength(2);
      expect(state.tiles[0]?.target.threadRef.threadId).toBe(T1);
      expect(state.tiles[1]?.target.threadRef.threadId).toBe(T3);
      expect(state.focusedIndex).toBe(1);
    });

    it("focuses the existing tile when replacing with already-tiled thread", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2)]);
      store.focusByIndex(0);
      store.replaceFocused(tile(ENV_A, T2));

      const state = useTileViewStore.getState();
      expect(state.tiles).toHaveLength(2);
      expect(state.focusedIndex).toBe(1);
      // T1 not removed
      expect(state.tiles[0]?.target.threadRef.threadId).toBe(T1);
    });
  });

  describe("closeTile", () => {
    it("removes the tile at the given index", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2), tile(ENV_A, T3)]);
      const removed = store.closeTile(1);

      expect(removed?.target.threadRef.threadId).toBe(T2);
      const state = useTileViewStore.getState();
      expect(state.tiles).toHaveLength(2);
      expect(state.tiles.map((t) => t.target.threadRef.threadId)).toEqual([T1, T3]);
    });

    it("shifts focus left when closing a tile at or before focused", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2), tile(ENV_A, T3)]);
      store.focusByIndex(2); // focused on T3

      store.closeTile(0); // remove T1
      // tiles is now [T2, T3]; focused was 2, should shift to 1 (T3)
      const state = useTileViewStore.getState();
      expect(state.focusedIndex).toBe(1);
      expect(state.tiles[state.focusedIndex]?.target.threadRef.threadId).toBe(T3);
    });

    it("preserves focus when closing a tile after the focused one", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2), tile(ENV_A, T3)]);
      store.focusByIndex(0);
      store.closeTile(2);
      expect(useTileViewStore.getState().focusedIndex).toBe(0);
    });

    it("returns the entry when closing the last tile and clears state", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1)]);
      const removed = store.closeTile(0);
      expect(removed?.target.threadRef.threadId).toBe(T1);
      const state = useTileViewStore.getState();
      expect(state.tiles).toHaveLength(0);
      expect(state.focusedIndex).toBe(0);
    });

    it("returns null for out-of-bounds indices", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1)]);
      expect(store.closeTile(-1)).toBeNull();
      expect(store.closeTile(5)).toBeNull();
    });
  });

  describe("focusByIndex", () => {
    it("sets focused index when in range", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2)]);
      store.focusByIndex(1);
      expect(useTileViewStore.getState().focusedIndex).toBe(1);
    });

    it("ignores out-of-range indices", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1)]);
      store.focusByIndex(5);
      expect(useTileViewStore.getState().focusedIndex).toBe(0);
    });
  });

  describe("cycleFocus", () => {
    it("cycles forward", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2), tile(ENV_A, T3)]);
      store.focusByIndex(0);
      store.cycleFocus(1);
      expect(useTileViewStore.getState().focusedIndex).toBe(1);
      store.cycleFocus(1);
      expect(useTileViewStore.getState().focusedIndex).toBe(2);
      store.cycleFocus(1);
      expect(useTileViewStore.getState().focusedIndex).toBe(0); // wraps
    });

    it("cycles backward", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2)]);
      store.focusByIndex(0);
      store.cycleFocus(-1);
      expect(useTileViewStore.getState().focusedIndex).toBe(1); // wraps
    });

    it("is a no-op for fewer than 2 tiles", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1)]);
      store.cycleFocus(1);
      expect(useTileViewStore.getState().focusedIndex).toBe(0);
    });
  });

  describe("setFromUrl", () => {
    it("hydrates tiles and clamps focus", () => {
      useTileViewStore.getState().setFromUrl(
        [
          { environmentId: ENV_A, threadId: T1 },
          { environmentId: ENV_A, threadId: T2 },
        ],
        5,
      );
      const state = useTileViewStore.getState();
      expect(state.tiles).toHaveLength(2);
      expect(state.focusedIndex).toBe(1);
    });

    it("clears tiles when url has no threads", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1)]);
      store.setFromUrl([], 0);
      expect(useTileViewStore.getState().tiles).toHaveLength(0);
    });

    it("preserves entry ids when contents are unchanged", () => {
      const store = useTileViewStore.getState();
      store.setFromUrl(
        [
          { environmentId: ENV_A, threadId: T1 },
          { environmentId: ENV_A, threadId: T2 },
        ],
        0,
      );
      const beforeIds = useTileViewStore.getState().tiles.map((t) => t.id);
      store.setFromUrl(
        [
          { environmentId: ENV_A, threadId: T1 },
          { environmentId: ENV_A, threadId: T2 },
        ],
        1,
      );
      const afterTiles = useTileViewStore.getState().tiles;
      expect(afterTiles.map((t) => t.id)).toEqual(beforeIds);
      expect(useTileViewStore.getState().focusedIndex).toBe(1);
    });

    it("preserves entry id for matching tiles when reordering", () => {
      const store = useTileViewStore.getState();
      store.setFromUrl(
        [
          { environmentId: ENV_A, threadId: T1 },
          { environmentId: ENV_A, threadId: T2 },
        ],
        0,
      );
      const beforeIds = useTileViewStore.getState().tiles.map((t) => t.id);
      store.setFromUrl(
        [
          { environmentId: ENV_A, threadId: T2 },
          { environmentId: ENV_A, threadId: T1 },
        ],
        0,
      );
      const afterTiles = useTileViewStore.getState().tiles;
      // T2 should keep its original id (was index 1, now at index 0)
      expect(afterTiles[0]?.id).toBe(beforeIds[1]);
      expect(afterTiles[1]?.id).toBe(beforeIds[0]);
    });

    it("is idempotent when state already matches", () => {
      const store = useTileViewStore.getState();
      store.setFromUrl([{ environmentId: ENV_A, threadId: T1 }], 0);
      const before = useTileViewStore.getState();
      store.setFromUrl([{ environmentId: ENV_A, threadId: T1 }], 0);
      const after = useTileViewStore.getState();
      expect(after).toBe(before);
    });
  });

  describe("exitTileMode", () => {
    it("clears all tile state", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_A, T2)]);
      store.openSplitPicker("header");
      store.exitTileMode();

      const state = useTileViewStore.getState();
      expect(state.tiles).toHaveLength(0);
      expect(state.focusedIndex).toBe(0);
      expect(state.splitPickerOpen).toBe(false);
      expect(state.splitPickerAnchor).toBeNull();
    });
  });

  describe("split picker", () => {
    it("opens with anchor and closes", () => {
      const store = useTileViewStore.getState();
      store.openSplitPicker("header");
      expect(useTileViewStore.getState().splitPickerOpen).toBe(true);
      expect(useTileViewStore.getState().splitPickerAnchor).toBe("header");

      store.closeSplitPicker();
      expect(useTileViewStore.getState().splitPickerOpen).toBe(false);
      expect(useTileViewStore.getState().splitPickerAnchor).toBeNull();
    });

    it("openSplitPicker is a no-op for the same anchor", () => {
      const store = useTileViewStore.getState();
      store.openSplitPicker("shortcut");
      const before = useTileViewStore.getState();
      store.openSplitPicker("shortcut");
      const after = useTileViewStore.getState();
      expect(after).toBe(before);
    });
  });

  describe("selectors", () => {
    it("selectIsTileMode reflects tiles.length > 0", () => {
      expect(selectIsTileMode(useTileViewStore.getState())).toBe(false);
      useTileViewStore.getState().openTiles([tile(ENV_A, T1)]);
      expect(selectIsTileMode(useTileViewStore.getState())).toBe(true);
    });

    it("selectFocusedTile and selectFocusedThreadRef return focused entry", () => {
      const store = useTileViewStore.getState();
      store.openTiles([tile(ENV_A, T1), tile(ENV_B, T4)]);
      store.focusByIndex(1);

      const state = useTileViewStore.getState();
      expect(selectFocusedTile(state)?.target.threadRef.threadId).toBe(T4);
      expect(selectFocusedThreadRef(state)).toEqual({
        environmentId: ENV_B,
        threadId: T4,
      });
    });

    it("selectors return null when no tiles", () => {
      expect(selectFocusedTile(useTileViewStore.getState())).toBeNull();
      expect(selectFocusedThreadRef(useTileViewStore.getState())).toBeNull();
    });
  });
});
