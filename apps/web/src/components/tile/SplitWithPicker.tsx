import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { LayoutGridIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useShallow } from "zustand/react/shallow";

import { selectSidebarThreadsAcrossEnvironments, useStore } from "../../store";
import { useTileViewStore } from "../../tileViewStore";
import { serializeTileRouteSearch } from "../../tileRouteSearch";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ScrollArea } from "../ui/scroll-area";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { cn } from "../../lib/utils";

interface SplitWithPickerProps {
  currentThreadRef?: ScopedThreadRef | null;
  trigger?: ReactElement;
}

export function SplitWithPicker({ currentThreadRef, trigger }: SplitWithPickerProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const allThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const tiles = useTileViewStore((state) => state.tiles);
  const storePickerOpen = useTileViewStore((state) => state.splitPickerOpen);
  const closeStorePicker = useTileViewStore((state) => state.closeSplitPicker);

  // When a global trigger (e.g. the Cmd+\ shortcut) requests the picker, open it
  // here. Only one mount of SplitWithPicker should be present per route mode so
  // we don't get duplicate openings.
  useEffect(() => {
    if (storePickerOpen && !open) {
      setOpen(true);
    }
  }, [storePickerOpen, open]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next && storePickerOpen) closeStorePicker();
    },
    [storePickerOpen, closeStorePicker],
  );

  const tiledKeys = useMemo(
    () => new Set(tiles.map((entry) => scopedThreadKey(entry.target.threadRef))),
    [tiles],
  );

  const currentKey = currentThreadRef ? scopedThreadKey(currentThreadRef) : null;

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allThreads
      .filter((thread) => {
        if (thread.archivedAt) return false;
        if (!q) return true;
        const title = (thread.title ?? "").toLowerCase();
        return title.includes(q);
      })
      .slice(0, 100);
  }, [allThreads, query]);

  const handleSelect = useCallback(
    (threadRef: ScopedThreadRef) => {
      const targets: Array<{ kind: "server"; threadRef: ScopedThreadRef }> = [];
      if (currentThreadRef) {
        targets.push({ kind: "server", threadRef: currentThreadRef });
      }
      const selectedTarget = { kind: "server" as const, threadRef };
      targets.push(selectedTarget);
      useTileViewStore.getState().openTilesFocusedOn(targets, selectedTarget);
      const stateAfter = useTileViewStore.getState();
      const serialized = serializeTileRouteSearch({
        tiles: stateAfter.tiles.map((entry) => entry.target.threadRef),
        focusedIndex: stateAfter.focusedIndex,
      });
      setOpen(false);
      setQuery("");
      closeStorePicker();
      void navigate({ to: "/tiled", search: serialized }).catch(() => undefined);
    },
    [currentThreadRef, navigate, closeStorePicker],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          trigger ?? (
            <Button size="icon-xs" variant="outline" aria-label="Split with thread">
              <LayoutGridIcon className="size-3.5" />
            </Button>
          )
        }
      />
      <PopoverPopup className="w-80 p-0" align="end">
        <div className="flex flex-col">
          <div className="border-b border-border p-2">
            <Input
              type="text"
              autoFocus
              placeholder="Search threads…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const first = filteredThreads.find((thread) => {
                    const ref = {
                      environmentId: thread.environmentId,
                      threadId: thread.id,
                    };
                    const key = scopedThreadKey(ref);
                    return key !== currentKey;
                  });
                  if (first) {
                    event.preventDefault();
                    handleSelect({
                      environmentId: first.environmentId,
                      threadId: first.id,
                    });
                  }
                }
              }}
              className="h-8 text-sm"
            />
          </div>
          <ScrollArea className="max-h-72">
            <div className="flex flex-col p-1">
              {filteredThreads.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">No threads found.</div>
              ) : (
                filteredThreads.map((thread) => {
                  const ref: ScopedThreadRef = {
                    environmentId: thread.environmentId,
                    threadId: thread.id,
                  };
                  const key = scopedThreadKey(ref);
                  const alreadyTiled = tiledKeys.has(key);
                  const isCurrent = key === currentKey;
                  const pill = resolveThreadStatusPill({ thread });
                  return (
                    <button
                      type="button"
                      key={key}
                      disabled={isCurrent}
                      onClick={() => handleSelect(ref)}
                      className={cn(
                        "flex h-8 items-center gap-2 rounded-sm px-2 text-left text-sm",
                        isCurrent
                          ? "cursor-not-allowed text-muted-foreground/60"
                          : "cursor-pointer hover:bg-accent",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {thread.title?.trim() || "Untitled thread"}
                      </span>
                      {pill ? (
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            pill.dotClass,
                            pill.pulse && "animate-pulse",
                          )}
                          aria-hidden
                        />
                      ) : null}
                      {alreadyTiled ? (
                        <span className="shrink-0 text-xs text-muted-foreground">Focus tile</span>
                      ) : isCurrent ? (
                        <span className="shrink-0 text-xs text-muted-foreground">Current</span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
