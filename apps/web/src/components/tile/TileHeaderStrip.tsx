import type { ScopedThreadRef } from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { useCallback, type MouseEvent } from "react";

import { cn } from "../../lib/utils";
import { selectSidebarThreadSummaryByRef, useStore } from "../../store";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";

export function TileHeaderStrip({
  threadRef,
  isFocused,
  indexHint,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  isFocused: boolean;
  indexHint: number;
  onClose: () => void;
}) {
  const summary = useStore((state) => selectSidebarThreadSummaryByRef(state, threadRef));
  const pill = summary ? resolveThreadStatusPill({ thread: summary }) : null;
  const title = summary?.title?.trim() || "Untitled thread";

  const handleCloseClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );

  return (
    <div
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 border-b px-2 text-xs",
        isFocused
          ? "border-primary/35 bg-primary/8 text-foreground"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-sm font-mono text-[10px]",
          isFocused
            ? "bg-primary/22 text-primary-foreground/95 dark:text-primary-foreground"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {indexHint}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      {pill ? (
        <span className={cn("flex shrink-0 items-center gap-1", pill.colorClass)}>
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              pill.dotClass,
              pill.pulse && "animate-pulse",
            )}
            aria-hidden
          />
          <span className="whitespace-nowrap">{pill.label}</span>
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Close tile"
        onClick={handleCloseClick}
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}
