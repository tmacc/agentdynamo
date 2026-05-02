import type { EnvironmentId, OrchestrationThreadActivity, ThreadId } from "@t3tools/contracts";
import type {
  ProjectIntelligenceSurfaceId,
  ProjectIntelligenceSurfaceSummary,
} from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon, LayersIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import {
  deriveContextCompactionStats,
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
} from "~/lib/contextWindow";
import {
  projectSurfaceOverridesQueryOptions,
  useSetSurfaceEnabledMutation,
} from "../../../lib/projectIntelligenceReactQuery";
import {
  categorizeForInspector,
  getSurfaceKindLabel,
  INSPECTOR_CATEGORY_COLOR_VAR,
  INSPECTOR_CATEGORY_LABELS,
  INSPECTOR_SURFACE_CATEGORY_ORDER,
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

function emptyInspectorTokens(): Record<InspectorCategoryId, number> {
  return {
    system: 0,
    skills: 0,
    agents: 0,
    memory: 0,
    mcp: 0,
    "thread-compacted": 0,
    "thread-live": 0,
  };
}

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
  /** Opens the project-level context manager dock from thread view. */
  readonly onOpenProjectContext?: () => void;
  /** Thread activities used to show live/compacted context accounting. */
  readonly threadActivities?: ReadonlyArray<OrchestrationThreadActivity>;
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
  onOpenProjectContext,
  threadActivities,
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
      "thread-compacted": [],
      "thread-live": [],
    };
    for (const surface of inspectorSurfaces) {
      const cat = categorizeForInspector(surface);
      if (cat) out[cat].push(surface);
    }
    for (const cat of INSPECTOR_SURFACE_CATEGORY_ORDER) {
      out[cat] = out[cat].toSorted((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      );
    }
    return out;
  }, [inspectorSurfaces]);

  // Compute tokens per category from currently-enabled surfaces.
  const preloadTokensPerCategory = useMemo(() => {
    const tokens = emptyInspectorTokens();
    for (const surface of inspectorSurfaces) {
      const cat = categorizeForInspector(surface);
      if (!cat) continue;
      if (!surface.enabled) continue;
      tokens[cat] += surface.approxTokenCount ?? 0;
    }
    return tokens;
  }, [inspectorSurfaces]);

  const preloadTokens = useMemo(
    () =>
      INSPECTOR_SURFACE_CATEGORY_ORDER.reduce((sum, cat) => sum + preloadTokensPerCategory[cat], 0),
    [preloadTokensPerCategory],
  );

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

  const latestContextWindow = useMemo(
    () => deriveLatestContextWindowSnapshot(threadActivities ?? []),
    [threadActivities],
  );
  const compactionStats = useMemo(
    () => deriveContextCompactionStats(threadActivities ?? []),
    [threadActivities],
  );

  const threadRuntimeTokens = useMemo(() => {
    if (viewMode !== "thread" || !latestContextWindow) {
      return {
        runtimeTokens: 0,
        compactedTokens: null as number | null,
        liveTokens: 0,
      };
    }

    const runtimeTokens = Math.max(0, latestContextWindow.usedTokens - preloadTokens);
    const compactedTokens =
      compactionStats.estimatedCompactedTokens !== null
        ? Math.min(runtimeTokens, compactionStats.estimatedCompactedTokens)
        : null;
    const liveTokens =
      compactedTokens !== null ? Math.max(0, runtimeTokens - compactedTokens) : runtimeTokens;

    return { runtimeTokens, compactedTokens, liveTokens };
  }, [compactionStats.estimatedCompactedTokens, latestContextWindow, preloadTokens, viewMode]);

  const tokensPerCategory = useMemo(() => {
    const tokens = { ...preloadTokensPerCategory };
    if (viewMode === "thread" && latestContextWindow) {
      tokens["thread-compacted"] = threadRuntimeTokens.compactedTokens ?? 0;
      tokens["thread-live"] = threadRuntimeTokens.liveTokens;
    }
    return tokens;
  }, [latestContextWindow, preloadTokensPerCategory, threadRuntimeTokens, viewMode]);

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
                {...(onPickModel ? { onClick: onPickModel } : { readOnly: true })}
              />
            ) : null}
          </div>
        </div>

        <div className="mt-3">
          <ContextInspectorDotGrid tokensPerCategory={tokensPerCategory} maxTokens={maxTokens} />
        </div>

        {viewMode === "thread" && latestContextWindow ? (
          <ContextGraphBreakdown
            preloadTokens={preloadTokens}
            runtimeTokens={threadRuntimeTokens.runtimeTokens}
            liveTokens={threadRuntimeTokens.liveTokens}
            compactedTokens={threadRuntimeTokens.compactedTokens}
            totalProcessedTokens={latestContextWindow.totalProcessedTokens ?? null}
            compactionCount={compactionStats.compactionCount}
            estimatedCompactedDeltaTokens={compactionStats.estimatedCompactedDeltaTokens}
          />
        ) : null}

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
        <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/40 p-3">
          <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground/80">
            Project defaults are read-only from a thread. The graph includes provider-reported live
            thread context when available.
          </p>
          <button
            type="button"
            onClick={onOpenProjectContext}
            disabled={!onOpenProjectContext}
            className={cn(
              "inline-flex w-fit items-center gap-1.5 rounded border border-border/60 bg-background px-2 py-1",
              "font-mono text-[10px] uppercase tracking-[0.12em] text-foreground/80",
              "transition-colors hover:bg-muted/40 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--inspector-accent-line)]",
              !onOpenProjectContext && "cursor-not-allowed opacity-50 hover:bg-background",
            )}
          >
            Manage Project Defaults
            <LayersIcon className="size-2.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/* Category accordion */}
      <div className="rounded-lg border border-border/60 bg-card/40">
        {INSPECTOR_SURFACE_CATEGORY_ORDER.map((catId) => (
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

function formatSignedTokens(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "-"}${formatContextWindowTokens(Math.abs(value))}`;
}

function ContextGraphBreakdown(props: {
  readonly preloadTokens: number;
  readonly runtimeTokens: number;
  readonly liveTokens: number;
  readonly totalProcessedTokens: number | null;
  readonly compactionCount: number;
  readonly compactedTokens: number | null;
  readonly estimatedCompactedDeltaTokens: number | null;
}) {
  const compactedDisplay =
    props.compactedTokens !== null ? `~${formatContextWindowTokens(props.compactedTokens)}` : "n/a";

  return (
    <div className="mt-3 border-t border-border/40 pt-2">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
        <ContextGraphMetric
          label="Project preload"
          value={formatContextWindowTokens(props.preloadTokens)}
        />
        <ContextGraphMetric
          categoryId="thread-live"
          label={INSPECTOR_CATEGORY_LABELS["thread-live"]}
          value={formatContextWindowTokens(props.liveTokens)}
        />
        <ContextGraphMetric
          categoryId="thread-compacted"
          label={INSPECTOR_CATEGORY_LABELS["thread-compacted"]}
          value={compactedDisplay}
          detail={
            props.estimatedCompactedDeltaTokens !== null
              ? formatSignedTokens(props.estimatedCompactedDeltaTokens)
              : undefined
          }
        />
        <ContextGraphMetric
          label="Thread runtime"
          value={formatContextWindowTokens(props.runtimeTokens)}
        />
        <ContextGraphMetric
          label="Total processed"
          value={
            props.totalProcessedTokens !== null
              ? formatContextWindowTokens(props.totalProcessedTokens)
              : "n/a"
          }
        />
        <ContextGraphMetric label="Compactions" value={String(props.compactionCount)} />
      </div>
      {props.compactedTokens !== null ? (
        <p className="mt-2 font-mono text-[10px] leading-snug text-muted-foreground/65">
          Compacted retained is estimated from runtime compaction markers and the lowest observed
          post-compaction window usage; providers do not report summary token counts separately.
        </p>
      ) : null}
    </div>
  );
}

function ContextGraphMetric(props: {
  readonly categoryId?: InspectorCategoryId | undefined;
  readonly label: string;
  readonly value: string;
  readonly detail?: string | undefined;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/70">
        {props.categoryId ? (
          <span
            className="size-1.5 shrink-0 rounded-[1px]"
            style={{ backgroundColor: INSPECTOR_CATEGORY_COLOR_VAR[props.categoryId] }}
            aria-hidden="true"
          />
        ) : null}
        {props.label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1 font-mono text-[12px] text-foreground tabular-nums">
        <span>{props.value}</span>
        {props.detail ? (
          <span className="text-[10px] text-muted-foreground">{props.detail}</span>
        ) : null}
      </div>
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
