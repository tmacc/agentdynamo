import type { ScopedThreadRef } from "@t3tools/contracts";
import { type KeyboardEvent, type MouseEvent, useCallback, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { selectSidebarThreadSummaryByRef, useStore } from "../../store";
import type { TileEntry } from "../../tileViewStore";
import { TileHeaderStrip } from "./TileHeaderStrip";

export function TilePane({
  tile,
  index,
  isFocused,
  onFocus,
  onClose,
  children,
}: {
  tile: TileEntry;
  index: number;
  isFocused: boolean;
  onFocus: (index: number) => void;
  onClose: (index: number) => void;
  children: ReactNode;
}) {
  const threadRef: ScopedThreadRef = tile.target.threadRef;
  const summary = useStore((state) => selectSidebarThreadSummaryByRef(state, threadRef));
  const title = summary?.title?.trim() || "Untitled thread";

  const handleMouseDown = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      // Don't override clicks on links/buttons inside the message body
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("a, button, [role='button']")
      ) {
        return;
      }
      if (!isFocused) onFocus(index);
    },
    [index, isFocused, onFocus],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!isFocused) onFocus(index);
      }
    },
    [index, isFocused, onFocus],
  );

  const handleHeaderClose = useCallback(() => {
    onClose(index);
  }, [index, onClose]);

  return (
    <section
      tabIndex={0}
      role="group"
      aria-label={`Tile ${index + 1}: ${title}`}
      aria-current={isFocused ? "true" : undefined}
      className={cn(
        // Constant 1px border avoids layout shift on focus change.
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background",
        "transition-shadow transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isFocused ? "ring-1 ring-primary/70 shadow-md" : "ring-0 hover:ring-1 hover:ring-border",
      )}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      data-tile-index={index}
      data-tile-focused={isFocused ? "true" : "false"}
    >
      <TileHeaderStrip
        threadRef={threadRef}
        isFocused={isFocused}
        indexHint={index + 1}
        onClose={handleHeaderClose}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  );
}
