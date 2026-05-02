import type { ProjectIntelligenceSurfaceSummary } from "@t3tools/contracts";
import { ChevronRightIcon, LockIcon, PlusIcon } from "lucide-react";
import { useId, type KeyboardEvent } from "react";

import { cn } from "~/lib/utils";
import {
  INSPECTOR_CATEGORY_COLOR_VAR,
  INSPECTOR_CATEGORY_LABELS,
  type InspectorCategoryId,
} from "../../projectIntelligencePresentation";

function formatTokens(n: number): string {
  const r = Math.round(n);
  if (r >= 1_000_000) return `${(r / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (r >= 100_000) return `${(r / 1000).toFixed(0)}K`;
  if (r >= 1000) return `${(r / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(r);
}

function formatPct(p: number): string {
  if (p < 0.1) return "<0.1%";
  if (p < 10) return `${p.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(p)}%`;
}

export interface ContextInspectorCategoryProps {
  readonly categoryId: InspectorCategoryId;
  readonly surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  readonly tokens: number;
  readonly maxTokens: number;
  readonly open: boolean;
  readonly onToggleOpen: () => void;
  readonly onSetSurfaceEnabled: (
    surface: ProjectIntelligenceSurfaceSummary,
    enabled: boolean | null,
  ) => void;
  /** True when the toggle is read-only from this view (thread view). */
  readonly readOnly?: boolean;
  readonly onAddThreadOverride?: (surface: ProjectIntelligenceSurfaceSummary) => void;
  readonly threadAdditionIds?: ReadonlySet<string>;
  /** Surface IDs the user has chosen to disable via override (vs disabled-by-discovery). */
  readonly userDisabledIds?: ReadonlySet<string>;
  /** Item ids whose mutation is in flight, for spinner/disable. */
  readonly pendingIds?: ReadonlySet<string>;
}

export function ContextInspectorCategory({
  categoryId,
  surfaces,
  tokens,
  maxTokens,
  open,
  onToggleOpen,
  onSetSurfaceEnabled,
  readOnly = false,
  onAddThreadOverride,
  threadAdditionIds,
  userDisabledIds,
  pendingIds,
}: ContextInspectorCategoryProps) {
  const headingId = useId();
  const panelId = useId();
  const pct = (tokens / maxTokens) * 100;
  const enabledCount = surfaces.filter((s) => s.enabled).length;
  const allEnabledLockedOrEmpty = surfaces.every((s) => s.activation === "always-loaded");
  const totalCount = surfaces.length;

  return (
    <div className="border-t border-border/40 last:border-b">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        aria-controls={panelId}
        id={headingId}
        className={cn(
          "grid w-full grid-cols-[8px_1fr_auto_auto_12px] items-center gap-2.5 px-0.5 py-2",
          "text-left font-mono text-[10.5px] tracking-[0.02em]",
          "text-muted-foreground transition-colors hover:text-foreground",
          "focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--inspector-accent-line)]",
        )}
      >
        <span
          className="size-2 rounded-[1px]"
          style={{ backgroundColor: INSPECTOR_CATEGORY_COLOR_VAR[categoryId] }}
          aria-hidden="true"
        />
        <span className="truncate font-medium text-foreground">
          {INSPECTOR_CATEGORY_LABELS[categoryId]}
          <span className="ml-1.5 font-normal text-muted-foreground/70">
            {enabledCount}/{totalCount}
          </span>
        </span>
        <span className="min-w-[52px] text-right tabular-nums text-muted-foreground/80">
          {formatTokens(tokens)}
        </span>
        <span className="min-w-[44px] text-right tabular-nums text-muted-foreground">
          {formatPct(pct)}
        </span>
        <ChevronRightIcon
          className={cn(
            "size-3 text-muted-foreground/60 transition-transform duration-200",
            open && "rotate-90 text-foreground/80",
          )}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          id={panelId}
          role="group"
          aria-labelledby={headingId}
          className="ml-[18px] flex flex-col border-l border-dashed border-border/40 pb-2"
        >
          {totalCount === 0 ? (
            <div className="px-3 py-3 font-mono text-[10.5px] text-muted-foreground">
              No {INSPECTOR_CATEGORY_LABELS[categoryId].toLowerCase()} discovered for this project.
            </div>
          ) : null}
          {surfaces.map((surface) => {
            const userDisabled = userDisabledIds?.has(surface.id) ?? false;
            // Thread view: read-only on disabling. The "off" state is whether the project default
            // currently has this surface disabled. Additive: thread can re-enable by adding.
            const isLocked = surface.activation === "always-loaded" || surface.scope === "system";
            const off = !surface.enabled;
            const isThreadAddition = threadAdditionIds?.has(surface.id) ?? false;
            const pending = pendingIds?.has(surface.id) ?? false;

            const handleClick = () => {
              if (pending) return;
              if (isLocked) return;
              if (readOnly) {
                if (off && onAddThreadOverride) onAddThreadOverride(surface);
                return;
              }
              // Project view: clicking flips. If currently user-disabled → clear (revert),
              // else if currently enabled → set false (disable), else → set true (enable).
              if (userDisabled) {
                onSetSurfaceEnabled(surface, null);
              } else if (off) {
                onSetSurfaceEnabled(surface, null);
              } else {
                onSetSurfaceEnabled(surface, false);
              }
            };

            const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                handleClick();
              }
            };

            return (
              <div
                key={surface.id}
                role={isLocked ? undefined : "switch"}
                aria-checked={isLocked ? undefined : !off}
                aria-disabled={pending || undefined}
                tabIndex={isLocked ? -1 : 0}
                onClick={handleClick}
                onKeyDown={handleKey}
                className={cn(
                  "grid grid-cols-[14px_1fr_auto] items-center gap-2 rounded px-2 py-1.5",
                  "font-mono text-[10.5px] text-muted-foreground",
                  isLocked
                    ? "cursor-default"
                    : "cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40",
                  pending && "opacity-50",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--inspector-accent-line)]",
                )}
                title={surface.path}
              >
                {/* Indicator: filled / hollow circle, or lock glyph */}
                <span aria-hidden="true" className="flex items-center justify-center">
                  {isLocked ? (
                    <LockIcon className="size-2.5 text-muted-foreground/60" />
                  ) : (
                    <span
                      className={cn(
                        "block size-2.5 rounded-full border transition-colors",
                        off ? "border-muted-foreground/30 bg-transparent" : "border-transparent",
                      )}
                      style={{
                        backgroundColor: off
                          ? "transparent"
                          : INSPECTOR_CATEGORY_COLOR_VAR[categoryId],
                      }}
                    />
                  )}
                </span>
                <span
                  className={cn(
                    "truncate text-foreground/90",
                    off &&
                      "text-muted-foreground line-through decoration-[color:var(--inspector-accent-line)]",
                    isLocked && "text-muted-foreground",
                  )}
                >
                  {surface.label}
                </span>
                <span className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground/80">
                  {readOnly && off && onAddThreadOverride ? (
                    <span
                      className={cn(
                        "rounded border px-1 py-px text-[8.5px] uppercase tracking-[0.12em]",
                        isThreadAddition ? "font-semibold" : "border-transparent bg-muted/40",
                      )}
                      style={
                        isThreadAddition
                          ? {
                              color: "var(--inspector-accent)",
                              borderColor: "var(--inspector-accent-line)",
                              backgroundColor: "var(--inspector-accent-soft)",
                            }
                          : undefined
                      }
                    >
                      {isThreadAddition ? (
                        "ADDED"
                      ) : (
                        <span className="inline-flex items-center gap-0.5">
                          <PlusIcon className="size-2.5" />
                          ADD
                        </span>
                      )}
                    </span>
                  ) : null}
                  {typeof surface.approxTokenCount === "number" ? (
                    <span className="tabular-nums">{formatTokens(surface.approxTokenCount)}</span>
                  ) : (
                    <span className="opacity-50">—</span>
                  )}
                </span>
              </div>
            );
          })}

          {/* Bulk actions live only in the project (read/write) view. */}
          {!readOnly && totalCount > 1 && !allEnabledLockedOrEmpty ? (
            <div className="flex flex-wrap gap-1.5 px-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  for (const s of surfaces) {
                    if (s.activation === "always-loaded" || s.scope === "system") continue;
                    if (s.enabled) onSetSurfaceEnabled(s, false);
                  }
                }}
                className={cn(
                  "rounded border border-border/60 bg-transparent px-1.5 py-0.5",
                  "font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground",
                  "transition-colors hover:bg-muted/40 hover:text-foreground",
                )}
              >
                Disable all
              </button>
              <button
                type="button"
                onClick={() => {
                  for (const s of surfaces) {
                    if (s.activation === "always-loaded" || s.scope === "system") continue;
                    if (!s.enabled) onSetSurfaceEnabled(s, null);
                  }
                }}
                className={cn(
                  "rounded border border-border/60 bg-transparent px-1.5 py-0.5",
                  "font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground",
                  "transition-colors hover:bg-muted/40 hover:text-foreground",
                )}
              >
                Enable all
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
