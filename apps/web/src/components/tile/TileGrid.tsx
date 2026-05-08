import { type ReactNode } from "react";
import { cn } from "../../lib/utils";

const LAYOUT_CLASS_BY_COUNT: Readonly<Record<number, string>> = {
  1: "grid-cols-1 grid-rows-1",
  2: "grid-cols-2 grid-rows-1",
  3: "grid-cols-3 grid-rows-1",
  4: "grid-cols-2 grid-rows-2",
};

const FALLBACK_LAYOUT_CLASS = "grid-cols-3 auto-rows-fr";

export function TileGrid({
  count,
  className,
  children,
}: {
  count: number;
  className?: string;
  children: ReactNode;
}) {
  const layoutClass = LAYOUT_CLASS_BY_COUNT[count] ?? FALLBACK_LAYOUT_CLASS;
  return (
    <div
      role="group"
      aria-label="Open thread tiles"
      className={cn("grid h-full min-h-0 w-full gap-2 p-2", layoutClass, className)}
    >
      {children}
    </div>
  );
}
