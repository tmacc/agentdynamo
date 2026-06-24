import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import { LayoutGridIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useThreadSelectionStore } from "../../threadSelectionStore";
import { useTileViewStore } from "../../tileViewStore";
import { serializeTileRouteSearch } from "../../tileRouteSearch";
import { Button } from "../ui/button";

export function SidebarMultiSelectToolbar() {
  const router = useRouter();
  const selectedKeys = useThreadSelectionStore(
    useShallow((state) => [...state.selectedThreadKeys]),
  );
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);

  const targets = useMemo(() => {
    const result: Array<{
      kind: "server";
      threadRef: NonNullable<ReturnType<typeof parseScopedThreadKey>>;
    }> = [];
    for (const key of selectedKeys) {
      const ref = parseScopedThreadKey(key);
      if (!ref) continue;
      result.push({ kind: "server", threadRef: ref });
    }
    return result;
  }, [selectedKeys]);

  const openInTileView = useCallback(() => {
    if (targets.length === 0) return;
    useTileViewStore.getState().openTiles(targets, 0);
    const stateAfter = useTileViewStore.getState();
    const serialized = serializeTileRouteSearch({
      tiles: stateAfter.tiles.map((entry) => entry.target.threadRef),
      focusedIndex: stateAfter.focusedIndex,
    });
    void router
      .navigate({ to: "/tiled", search: serialized })
      .then(() => clearSelection())
      .catch(() => undefined);
  }, [targets, clearSelection, router]);

  if (selectedKeys.length === 0) return null;

  // The sidebar's global mousedown handler clears selection unless the target
  // is inside an element marked safe — without this attribute the toolbar
  // unmounts on mousedown and the click event never fires.
  return (
    <div data-thread-selection-safe="true" className="shrink-0 border-t border-border bg-card p-2">
      <div className="flex items-center gap-1.5">
        <span className="px-1.5 text-xs text-muted-foreground">{selectedKeys.length} selected</span>
        <Button
          size="xs"
          variant="default"
          onClick={openInTileView}
          disabled={targets.length === 0}
          className="ml-auto"
        >
          <LayoutGridIcon className="size-3.5" />
          Open in tile view
        </Button>
        <Button size="xs" variant="ghost" onClick={clearSelection}>
          Clear
        </Button>
      </div>
    </div>
  );
}
