import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type {
  ProjectIntelligenceSurfaceId,
  ProjectIntelligenceSurfaceSummary,
} from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import {
  projectSurfaceOverridesQueryOptions,
  useSetSurfaceEnabledMutation,
} from "../../../lib/projectIntelligenceReactQuery";
import {
  categorizeForInspector,
  getSurfaceKindLabel,
  INSPECTOR_CATEGORY_ORDER,
  isCapabilitySurface,
  isInspectorSurface,
  type InspectorCategoryId,
} from "../../../projectIntelligencePresentation";
import {
  selectThreadContextAdditions,
  useThreadContextOverridesStore,
} from "../../../stores/threadContextOverridesStore";
import { ContextInspectorCategory } from "../ContextInspectorCategory";
import { ContextInspectorDotGrid } from "../ContextInspectorDotGrid";
import {
  ContextInspectorModelPill,
  type ContextInspectorModelPillProps,
} from "../ContextInspectorModelPill";
import { ContextInspectorSavingsPill } from "../ContextInspectorSavingsPill";

const DEFAULT_MAX_TOKENS = 200_000;

function formatTokens(n: number): string {
  const r = Math.round(n);
  if (r >= 1_000_000) return `${(r / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (r >= 100_000) return `${(r / 1000).toFixed(0)}K`;
  if (r >= 1000) return `${(r / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(r);
}

export interface ContextInspectorSectionProps {
  readonly environmentId: EnvironmentId | null;
  readonly projectCwd: string;
  readonly viewMode: "project" | "thread";
  readonly threadId?: ThreadId | null;
  readonly surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  /** Numeric context-window max used for the headline percentage. */
  readonly maxTokens?: number;
  /** Active model descriptor for the model pill. Omit to hide the pill. */
  readonly activeModel?: Pick<ContextInspectorModelPillProps, "providerLabel" | "modelLabel">;
  /** Optional click handler to swap the active model (project-view picker). */
  readonly onPickModel?: () => void;
}

export function ContextInspectorSection({
  environmentId,
  projectCwd,
  viewMode,
  threadId,
  surfaces,
  maxTokens = DEFAULT_MAX_TOKENS,
  activeModel,
  onPickModel,
}: ContextInspectorSectionProps) {
  const overridesQuery = useQuery(
    projectSurfaceOverridesQueryOptions({ environmentId, projectCwd }),
  );
  const overridesData = overridesQuery.data?.enabledOverrides;
  const userDisabledIds = useMemo(() => {
    const set = new Set<string>();
    if (overridesData) {
      for (const [id, enabled] of Object.entries(overridesData)) {
        if (enabled === false) set.add(id);
      }
    }
    return set;
  }, [overridesData]);

  const setEnabledMutation = useSetSurfaceEnabledMutation();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  const inspectorSurfaces = useMemo(() => surfaces.filter(isInspectorSurface), [surfaces]);

  const grouped = useMemo(() => {
    const out: Record<InspectorCategoryId, ProjectIntelligenceSurfaceSummary[]> = {
      system: [],
      skills: [],
      agents: [],
      memory: [],
      mcp: [],
    };
    for (const surface of inspectorSurfaces) {
      const cat = categorizeForInspector(surface);
      if (cat) out[cat].push(surface);
    }
    for (const cat of INSPECTOR_CATEGORY_ORDER) {
      out[cat] = out[cat].toSorted((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      );
    }
    return out;
  }, [inspectorSurfaces]);

  // Compute tokens per category from currently-enabled surfaces.
  const tokensPerCategory = useMemo(() => {
    const tokens: Record<InspectorCategoryId, number> = {
      system: 0,
      skills: 0,
      agents: 0,
      memory: 0,
      mcp: 0,
    };
    for (const surface of inspectorSurfaces) {
      const cat = categorizeForInspector(surface);
      if (!cat) continue;
      if (!surface.enabled) continue;
      tokens[cat] += surface.approxTokenCount ?? 0;
    }
    return tokens;
  }, [inspectorSurfaces]);

  // Capabilities (slash-commands, hooks, plugins) — read-only flat list shown
  // below the inspector accordion. Folded in here from the old "Tools" tab.
  const capabilities = useMemo(() => surfaces.filter(isCapabilitySurface), [surfaces]);

  // Savings: tokens that *would* be loaded if every surface were on its discovery
  // default minus what's currently loaded after overrides. We approximate the
  // discovery default as: locked-on items always count; user-disabled items add
  // back in. (This keeps the math local to the inspector — the server's
  // `applySurfaceOverrides` is the source of truth for actual `enabled`.)
  const savingsTokens = useMemo(() => {
    let saved = 0;
    for (const surface of inspectorSurfaces) {
      if (userDisabledIds.has(surface.id)) saved += surface.approxTokenCount ?? 0;
    }
    return saved;
  }, [inspectorSurfaces, userDisabledIds]);
  const savingsCount = userDisabledIds.size;

  const totalTokens = useMemo(
    () => Object.values(tokensPerCategory).reduce((a, b) => a + b, 0),
    [tokensPerCategory],
  );
  const totalPct = (totalTokens / maxTokens) * 100;

  // Accordion open state — start with "skills" open (the most actionable
  // category for users hunting reclaimable tokens), others collapsed.
  const [openCats, setOpenCats] = useState<ReadonlySet<InspectorCategoryId>>(
    () => new Set<InspectorCategoryId>(["skills"]),
  );
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const toggleCat = useCallback((id: InspectorCategoryId) => {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onSetSurfaceEnabled = useCallback(
    (surface: ProjectIntelligenceSurfaceSummary, enabled: boolean | null) => {
      if (!environmentId) return;
      setPendingIds((prev) => new Set(prev).add(surface.id));
      setEnabledMutation.mutate(
        {
          environmentId,
          projectCwd,
          surfaceId: surface.id,
          enabled,
        },
        {
          onSettled: () => {
            setPendingIds((prev) => {
              const next = new Set(prev);
              next.delete(surface.id);
              return next;
            });
          },
        },
      );
    },
    [environmentId, projectCwd, setEnabledMutation],
  );

  const onRevert = useCallback(() => {
    if (!environmentId) return;
    for (const surfaceId of userDisabledIds) {
      setPendingIds((prev) => new Set(prev).add(surfaceId));
      setEnabledMutation.mutate(
        {
          environmentId,
          projectCwd,
          surfaceId: surfaceId as ProjectIntelligenceSurfaceId,
          enabled: null,
        },
        {
          onSettled: () => {
            setPendingIds((prev) => {
              const next = new Set(prev);
              next.delete(surfaceId);
              return next;
            });
          },
        },
      );
    }
  }, [environmentId, projectCwd, setEnabledMutation, userDisabledIds]);

  // Thread additions (only meaningful in thread view). The selector must return
  // a stable reference per render — building a fresh Set inside the selector
  // would cause useSyncExternalStore to flag a snapshot change every render and
  // loop infinitely. Select the underlying array (stable in the store) then
  // memoize the Set view.
  const threadAdditionsArray = useThreadContextOverridesStore((state) =>
    selectThreadContextAdditions(state, threadId ?? null),
  );
  const threadAdditionIds = useMemo<ReadonlySet<string>>(
    () => new Set(threadAdditionsArray),
    [threadAdditionsArray],
  );
  const addThreadContextSurface = useThreadContextOverridesStore(
    (state) => state.addThreadContextSurface,
  );
  const onAddThreadOverride = useCallback(
    (surface: ProjectIntelligenceSurfaceSummary) => {
      if (!threadId) return;
      addThreadContextSurface(threadId, surface.id);
    },
    [addThreadContextSurface, threadId],
  );

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Headline */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Context
          </span>
          <span className="font-mono text-[10.5px] text-muted-foreground/70">
            {viewMode === "thread" ? "thread" : "project default"}
          </span>
        </div>
        <div className="mt-1 flex flex-col items-start gap-1.5">
          <span
            className={cn(
              "font-mono text-[40px] font-bold leading-none tracking-[-0.045em] tabular-nums",
              "text-foreground transition-colors",
            )}
          >
            {Math.round(totalPct)}
            <span className="ml-0.5 text-[14px] font-medium text-muted-foreground/60">%</span>
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
              {formatTokens(totalTokens)}
              <span className="mx-1.5 text-muted-foreground/40">/</span>
              <span className="text-muted-foreground/70">{formatTokens(maxTokens)}</span>
            </span>
            {activeModel ? (
              <ContextInspectorModelPill
                providerLabel={activeModel.providerLabel}
                modelLabel={activeModel.modelLabel}
                maxTokens={maxTokens}
                {...(viewMode === "project" && onPickModel
                  ? { onClick: onPickModel }
                  : { readOnly: true })}
              />
            ) : null}
          </div>
        </div>

        <div className="mt-3">
          <ContextInspectorDotGrid tokensPerCategory={tokensPerCategory} maxTokens={maxTokens} />
        </div>

        {viewMode === "project" ? (
          <div className="mt-3">
            <ContextInspectorSavingsPill
              savedTokens={savingsTokens}
              disabledCount={savingsCount}
              maxTokens={maxTokens}
              onRevert={onRevert}
            />
          </div>
        ) : null}
      </div>

      {/* Read-only banner for thread view */}
      {viewMode === "thread" ? (
        <p className="px-1 font-mono text-[10.5px] text-muted-foreground/80">
          Project defaults shown below are read-only here. Use{" "}
          <span className="text-foreground/80">Add for this thread</span> to layer extras for the
          current conversation, or open the Project Context Manager to edit defaults.
        </p>
      ) : null}

      {/* Category accordion */}
      <div className="rounded-lg border border-border/60 bg-card/40">
        {INSPECTOR_CATEGORY_ORDER.map((catId) => (
          <ContextInspectorCategory
            key={catId}
            categoryId={catId}
            surfaces={grouped[catId]}
            tokens={tokensPerCategory[catId]}
            maxTokens={maxTokens}
            open={openCats.has(catId)}
            onToggleOpen={() => toggleCat(catId)}
            onSetSurfaceEnabled={onSetSurfaceEnabled}
            readOnly={viewMode === "thread"}
            {...(viewMode === "thread" && threadId
              ? {
                  onAddThreadOverride,
                  threadAdditionIds,
                }
              : {})}
            userDisabledIds={userDisabledIds}
            pendingIds={pendingIds}
          />
        ))}
      </div>

      {/* Capabilities (read-only) — slash commands, hooks, plugins. Not part
          of the persistent context budget but listed here so users see the
          full capability set without a separate "Tools" tab. */}
      {capabilities.length > 0 ? (
        <CapabilitiesBlock
          capabilities={capabilities}
          open={capabilitiesOpen}
          onToggleOpen={() => setCapabilitiesOpen((prev) => !prev)}
        />
      ) : null}

      {/* v1 disclosure: enforcement is deferred. */}
      <p className="px-1 font-mono text-[10px] text-muted-foreground/60">
        Note: in v1, toggles are saved per-project but provider adapters do not yet enforce them.
        Treat this as preview; provider-side enforcement lands in v1.1.
      </p>
    </div>
  );
}

interface CapabilitiesBlockProps {
  readonly capabilities: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  readonly open: boolean;
  readonly onToggleOpen: () => void;
}

function CapabilitiesBlock({ capabilities, open, onToggleOpen }: CapabilitiesBlockProps) {
  // Group by kind so users see "Slash commands · 12 / Hooks · 3 / Plugins · 1"
  // and can scan within each.
  const grouped = useMemo(() => {
    const out = new Map<string, ProjectIntelligenceSurfaceSummary[]>();
    for (const surface of capabilities) {
      const key = surface.kind;
      const arr = out.get(key) ?? [];
      arr.push(surface);
      out.set(key, arr);
    }
    for (const arr of out.values()) {
      arr.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    }
    return out;
  }, [capabilities]);

  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-2 px-3 py-2",
          "font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-foreground",
          "focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--inspector-accent-line)]",
        )}
      >
        <span className="font-medium text-foreground">
          Capabilities
          <span className="ml-1.5 font-normal text-muted-foreground/70">{capabilities.length}</span>
        </span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
          {open ? "hide" : "show"}
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-border/40 px-3 py-2">
          {Array.from(grouped.entries()).map(([kind, items]) => (
            <div key={kind}>
              <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/70">
                {getSurfaceKindLabel(kind as ProjectIntelligenceSurfaceSummary["kind"])}
                <span className="ml-1 text-muted-foreground/50">{items.length}</span>
              </div>
              <ul className="flex flex-col gap-px">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded px-1 py-1 font-mono text-[10.5px] text-foreground/80"
                  >
                    <span className="truncate" title={item.path}>
                      {item.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground/70">
                      {item.openPath ? (
                        <ExternalLinkIcon
                          className="size-2.5 text-muted-foreground/50"
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="font-mono text-[10px] text-muted-foreground/60">
            Provider-managed; not user-toggleable here.
          </p>
        </div>
      ) : null}
    </div>
  );
}
