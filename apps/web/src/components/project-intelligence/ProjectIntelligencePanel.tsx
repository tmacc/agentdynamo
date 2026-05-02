import type {
  EnvironmentId,
  OrchestrationThreadActivity,
  ProjectIntelligenceHealth,
  ProjectIntelligenceOwner,
  ProjectIntelligenceProviderSummary,
  ProjectIntelligenceScope,
  ProjectIntelligenceSectionId,
  ProjectIntelligenceSurfaceId,
  ProjectIntelligenceSurfaceKind,
  ProjectIntelligenceSurfaceSummary,
  ProjectIntelligenceViewMode,
  ProjectIntelligenceWarning,
  ThreadId,
} from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  projectIntelligenceQueryKeys,
  projectIntelligenceQueryOptions,
} from "../../lib/projectIntelligenceReactQuery";
import {
  applySurfaceFilter,
  buildFilterOptions,
  isInspectorSurface,
  isRuntimeSurface,
  SECTION_DESCRIPTIONS,
  SECTION_LABELS,
  sortSurfacesByHealth,
} from "../../projectIntelligencePresentation";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";

import { ProjectIntelligenceCodeStats } from "./ProjectIntelligenceCodeStats";
import { ProjectIntelligenceEmptyState } from "./ProjectIntelligenceEmptyState";
import { ProjectIntelligenceFilters } from "./ProjectIntelligenceFilters";
import { ProjectIntelligenceHeader } from "./ProjectIntelligenceHeader";
import { ProjectIntelligenceProviderHealth } from "./ProjectIntelligenceProviderHealth";
import { ProjectIntelligenceSectionNav } from "./ProjectIntelligenceSectionNav";
import { ProjectIntelligenceSurfaceDetail } from "./ProjectIntelligenceSurfaceDetail";
import { ProjectIntelligenceSurfaceTable } from "./ProjectIntelligenceSurfaceTable";
import { ProjectIntelligenceWarnings } from "./ProjectIntelligenceWarnings";
import { ContextInspectorSection } from "./sections/ContextInspectorSection";

export interface ProjectIntelligencePanelProps {
  viewMode: ProjectIntelligenceViewMode;
  environmentId: EnvironmentId | null;
  projectCwd: string;
  effectiveCwd?: string | null | undefined;
  projectTitle?: string | null | undefined;
  section: ProjectIntelligenceSectionId;
  surfaceId: ProjectIntelligenceSurfaceId | null;
  canSwitchToThread: boolean;
  /** Optional thread id used by the context inspector for additive overrides. */
  threadId?: ThreadId | null | undefined;
  /** Numeric context-window max for the inspector headline. */
  contextMaxTokens?: number | undefined;
  /** Active model descriptor for the inspector model pill. */
  contextActiveModel?: { providerLabel: string; modelLabel: string } | undefined;
  /** Click handler for the model pill in project view (opens a picker). */
  contextOnPickModel?: (() => void) | undefined;
  /** Opens the project-level context manager from thread view. */
  onOpenProjectContext?: (() => void) | undefined;
  /** Thread activities used to show live/compacted thread context accounting. */
  contextThreadActivities?: ReadonlyArray<OrchestrationThreadActivity> | undefined;
  onClose: () => void;
  onSelectSection: (section: ProjectIntelligenceSectionId) => void;
  onSelectSurface: (surfaceId: ProjectIntelligenceSurfaceId | null) => void;
  onSwitchViewMode?: ((next: ProjectIntelligenceViewMode) => void) | undefined;
}

const EMPTY_SURFACES: ReadonlyArray<ProjectIntelligenceSurfaceSummary> = [];
const EMPTY_PROVIDERS: ReadonlyArray<ProjectIntelligenceProviderSummary> = [];
const EMPTY_WARNINGS: ReadonlyArray<ProjectIntelligenceWarning> = [];

export function ProjectIntelligencePanel(props: ProjectIntelligencePanelProps) {
  const queryClient = useQueryClient();
  const queryInput = useMemo(
    () =>
      ({
        environmentId: props.environmentId,
        projectCwd: props.projectCwd,
        effectiveCwd: props.effectiveCwd ?? null,
        viewMode: props.viewMode,
      }) as const,
    [props.effectiveCwd, props.environmentId, props.projectCwd, props.viewMode],
  );
  const queryKey = useMemo(
    () => projectIntelligenceQueryKeys.intelligence(queryInput),
    [queryInput],
  );
  const query = useQuery(projectIntelligenceQueryOptions(queryInput));

  const [searchText, setSearchText] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<ReadonlyArray<ProjectIntelligenceOwner>>([]);
  const [kindFilter, setKindFilter] = useState<ReadonlyArray<ProjectIntelligenceSurfaceKind>>([]);
  const [scopeFilter, setScopeFilter] = useState<ReadonlyArray<ProjectIntelligenceScope>>([]);
  const [healthFilter, setHealthFilter] = useState<ReadonlyArray<ProjectIntelligenceHealth>>([]);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  // Reset filters when the workspace target changes.
  useEffect(() => {
    setSearchText("");
    setOwnerFilter([]);
    setKindFilter([]);
    setScopeFilter([]);
    setHealthFilter([]);
  }, [props.viewMode, props.environmentId, props.projectCwd, props.effectiveCwd]);

  const handleRefresh = useCallback(() => {
    setIsManualRefreshing(true);
    void queryClient
      .invalidateQueries({
        queryKey,
      })
      .finally(() => {
        setIsManualRefreshing(false);
      });
  }, [queryClient, queryKey]);

  const allSurfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary> =
    query.data?.surfaces ?? EMPTY_SURFACES;
  const providers: ReadonlyArray<ProjectIntelligenceProviderSummary> =
    query.data?.providers ?? EMPTY_PROVIDERS;
  const warnings: ReadonlyArray<ProjectIntelligenceWarning> =
    query.data?.warnings ?? EMPTY_WARNINGS;
  const codeStats = query.data?.codeStats;
  const filterOptions = useMemo(() => buildFilterOptions(allSurfaces), [allSurfaces]);
  const filteredSurfaces = useMemo(
    () =>
      applySurfaceFilter(allSurfaces, {
        searchText,
        owners: ownerFilter,
        kinds: kindFilter,
        scopes: scopeFilter,
        healths: healthFilter,
      }),
    [allSurfaces, healthFilter, kindFilter, ownerFilter, scopeFilter, searchText],
  );

  const sectionScopedSurfaces = useMemo(() => {
    switch (props.section) {
      case "context-inspector":
        return filteredSurfaces.filter(isInspectorSurface);
      case "runtime":
        return filteredSurfaces.filter(isRuntimeSurface);
      default:
        return filteredSurfaces;
    }
  }, [filteredSurfaces, props.section]);

  const inspectorCount = useMemo(
    () => allSurfaces.filter(isInspectorSurface).length,
    [allSurfaces],
  );
  const runtimeCount = useMemo(() => allSurfaces.filter(isRuntimeSurface).length, [allSurfaces]);
  const countsBySection = useMemo<Partial<Record<ProjectIntelligenceSectionId, number>>>(
    () => ({
      "context-inspector": inspectorCount,
      runtime: runtimeCount,
      providers: providers.length,
      warnings: warnings.length,
    }),
    [inspectorCount, providers.length, runtimeCount, warnings.length],
  );

  const errorCount = warnings.filter((warning) => warning.severity === "error").length;
  const warningCount = warnings.filter((warning) => warning.severity === "warning").length;

  const selectedSurface = useMemo(() => {
    if (!props.surfaceId) return null;
    return allSurfaces.find((surface) => surface.id === props.surfaceId) ?? null;
  }, [allSurfaces, props.surfaceId]);

  const showFilters = props.section === "runtime";

  const handleClearFilters = useCallback(() => {
    setSearchText("");
    setOwnerFilter([]);
    setKindFilter([]);
    setScopeFilter([]);
    setHealthFilter([]);
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <ProjectIntelligenceHeader
        viewMode={props.viewMode}
        projectTitle={props.projectTitle ?? null}
        projectCwd={props.projectCwd}
        effectiveCwd={props.effectiveCwd ?? null}
        resolvedAtIso={query.data?.resolvedAt}
        isRefreshing={query.isFetching || isManualRefreshing}
        onRefresh={handleRefresh}
        onClose={props.onClose}
        canSwitchToThread={props.canSwitchToThread}
        onSwitchViewMode={props.onSwitchViewMode ?? undefined}
      />

      <ProjectIntelligenceSectionNav
        active={props.section}
        countsBySection={countsBySection}
        warningCount={warningCount}
        errorCount={errorCount}
        onSelect={props.onSelectSection}
      />

      {showFilters && allSurfaces.length > 0 ? (
        <ProjectIntelligenceFilters
          options={filterOptions}
          searchText={searchText}
          ownerFilter={ownerFilter}
          kindFilter={kindFilter}
          scopeFilter={scopeFilter}
          healthFilter={healthFilter}
          onSearchChange={setSearchText}
          onOwnerToggle={(value) => setOwnerFilter((current) => toggleArrayValue(current, value))}
          onKindToggle={(value) => setKindFilter((current) => toggleArrayValue(current, value))}
          onScopeToggle={(value) => setScopeFilter((current) => toggleArrayValue(current, value))}
          onHealthToggle={(value) => setHealthFilter((current) => toggleArrayValue(current, value))}
          onClear={handleClearFilters}
        />
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {query.status === "pending" ? (
          <PanelLoadingState
            label={
              props.viewMode === "thread"
                ? "Inspecting thread workspace..."
                : "Inspecting project workspace..."
            }
          />
        ) : query.status === "error" ? (
          <PanelErrorState
            message={resolveErrorMessage(query.error)}
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : allSurfaces.length === 0 &&
          providers.length === 0 &&
          warnings.length === 0 &&
          !codeStats ? (
          <ProjectIntelligenceEmptyState />
        ) : (
          <ScrollArea className="flex-1">
            <SectionContent
              section={props.section}
              {...(query.data?.codeStats ? { codeStats: query.data.codeStats } : {})}
              providers={providers}
              warnings={warnings}
              allSurfaces={allSurfaces}
              filteredSurfaces={sectionScopedSurfaces}
              selectedSurfaceId={props.surfaceId}
              onSelectSurface={props.onSelectSurface}
              viewMode={props.viewMode}
              environmentId={props.environmentId}
              projectCwd={props.projectCwd}
              threadId={props.threadId ?? null}
              {...(props.contextMaxTokens !== undefined
                ? { contextMaxTokens: props.contextMaxTokens }
                : {})}
              {...(props.contextActiveModel
                ? { contextActiveModel: props.contextActiveModel }
                : {})}
              {...(props.contextOnPickModel
                ? { contextOnPickModel: props.contextOnPickModel }
                : {})}
              {...(props.onOpenProjectContext
                ? { onOpenProjectContext: props.onOpenProjectContext }
                : {})}
              {...(props.contextThreadActivities
                ? { contextThreadActivities: props.contextThreadActivities }
                : {})}
            />
          </ScrollArea>
        )}
      </div>

      {selectedSurface ? (
        <ProjectIntelligenceSurfaceDetail
          surface={selectedSurface}
          environmentId={props.environmentId}
          projectCwd={props.projectCwd}
          effectiveCwd={props.effectiveCwd ?? null}
          viewMode={props.viewMode}
          onClose={() => props.onSelectSurface(null)}
        />
      ) : null}
    </div>
  );
}

function toggleArrayValue<TValue>(
  current: ReadonlyArray<TValue>,
  value: TValue,
): ReadonlyArray<TValue> {
  if (current.includes(value)) {
    return current.filter((entry) => entry !== value);
  }
  return [...current, value];
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Project intelligence failed to load.";
}

function PanelLoadingState(props: { label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Spinner className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{props.label}</p>
    </div>
  );
}

function PanelErrorState(props: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <AlertCircleIcon className="size-8 text-destructive" aria-hidden="true" />
      <div className="flex flex-col items-center gap-1">
        <h3 className="font-heading text-base font-semibold">
          Unable to load project intelligence
        </h3>
        <p className="max-w-sm text-sm text-muted-foreground">{props.message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  );
}

interface SectionContentProps {
  section: ProjectIntelligenceSectionId;
  codeStats?: NonNullable<React.ComponentProps<typeof ProjectIntelligenceCodeStats>["codeStats"]>;
  providers: ReadonlyArray<ProjectIntelligenceProviderSummary>;
  warnings: ReadonlyArray<ProjectIntelligenceWarning>;
  allSurfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  filteredSurfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  selectedSurfaceId: ProjectIntelligenceSurfaceId | null;
  onSelectSurface: (surfaceId: ProjectIntelligenceSurfaceId | null) => void;
  viewMode: ProjectIntelligenceViewMode;
  environmentId: EnvironmentId | null;
  projectCwd: string;
  threadId: ThreadId | null;
  contextMaxTokens?: number;
  contextActiveModel?: { providerLabel: string; modelLabel: string };
  contextOnPickModel?: () => void;
  onOpenProjectContext?: () => void;
  contextThreadActivities?: ReadonlyArray<OrchestrationThreadActivity>;
}

function SectionContent(props: SectionContentProps) {
  const description = SECTION_DESCRIPTIONS[props.section] ?? "";
  if (props.section === "context-inspector") {
    return (
      <ContextInspectorSection
        environmentId={props.environmentId}
        projectCwd={props.projectCwd}
        viewMode={props.viewMode === "thread" ? "thread" : "project"}
        threadId={props.threadId}
        surfaces={props.allSurfaces}
        {...(props.contextMaxTokens !== undefined ? { maxTokens: props.contextMaxTokens } : {})}
        {...(props.contextActiveModel ? { activeModel: props.contextActiveModel } : {})}
        {...(props.contextOnPickModel ? { onPickModel: props.contextOnPickModel } : {})}
        {...(props.onOpenProjectContext
          ? { onOpenProjectContext: props.onOpenProjectContext }
          : {})}
        {...(props.contextThreadActivities
          ? { threadActivities: props.contextThreadActivities }
          : {})}
      />
    );
  }
  if (props.section === "providers") {
    return (
      <div>
        <SectionDescriptor description={description} />
        <ProjectIntelligenceProviderHealth providers={props.providers} />
      </div>
    );
  }
  if (props.section === "warnings") {
    return (
      <div>
        <SectionDescriptor description={description} />
        <ProjectIntelligenceWarnings
          warnings={props.warnings}
          onSelectSurface={(id) => props.onSelectSurface(id)}
        />
      </div>
    );
  }
  // runtime section: project scripts + worktree setup + authored-source code
  // statistics rolled together (the previous standalone "Code Stats" section).
  const heading = SECTION_LABELS[props.section] ?? props.section;
  const surfaces = sortSurfacesByHealth(props.filteredSurfaces);
  return (
    <div>
      <SectionDescriptor description={description} />
      <ProjectIntelligenceSurfaceTable
        surfaces={surfaces}
        selectedSurfaceId={props.selectedSurfaceId}
        onSelect={(id) => props.onSelectSurface(id)}
        emptyTitle={`No ${heading.toLowerCase()} surfaces`}
        emptyDescription={
          props.allSurfaces.length === 0
            ? "Nothing was discovered for this workspace yet."
            : "Adjust filters or search to find surfaces in this section."
        }
      />
      {props.codeStats ? (
        <div className="mt-4 border-t border-border/40 pt-3">
          <ProjectIntelligenceCodeStats codeStats={props.codeStats} />
        </div>
      ) : null}
    </div>
  );
}

function SectionDescriptor(props: { description: string }) {
  return (
    <p className="px-3 pt-3 pb-2 text-[11px] leading-relaxed text-muted-foreground">
      {props.description}
    </p>
  );
}
