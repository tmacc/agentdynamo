import type {
  EnvironmentId,
  ProjectGetIntelligenceResult,
  ProjectIntelligenceSectionId,
} from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";

import { useProjectIntelligenceNavigation } from "../../hooks/useProjectIntelligenceNavigation";
import { projectIntelligenceSummaryQueryOptions } from "../../lib/projectIntelligenceReactQuery";
import {
  getAlwaysLoadedSurfaces,
  getClaudeLayerSurfaces,
  getCodexLayerSurfaces,
  getProviderRuntimeForOwner,
  getSectionCount,
  getProjectIntelligenceSectionLabel,
  getMemorySurfaces,
  PROJECT_INTELLIGENCE_SECTION_ORDER,
} from "../../projectIntelligencePresentation";
import { selectProjectByRef, selectProjectsAcrossEnvironments, useStore } from "../../store";
import { createThreadSelectorByRef } from "../../storeSelectors";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Sheet, SheetPopup } from "../ui/sheet";
import { ProjectIntelligenceAlwaysLoadedSection } from "./ProjectIntelligenceAlwaysLoadedSection";
import { ProjectIntelligenceCodeStatsSection } from "./ProjectIntelligenceCodeStatsSection";
import { ProjectIntelligenceLayout } from "./ProjectIntelligenceLayout";
import { ProjectIntelligenceMemorySection } from "./ProjectIntelligenceMemorySection";
import { ProjectIntelligenceOverviewSection } from "./ProjectIntelligenceOverviewSection";
import { ProjectIntelligenceProviderLayerSection } from "./ProjectIntelligenceProviderLayerSection";
import { ProjectIntelligenceSheetHeader } from "./ProjectIntelligenceSheetHeader";
import { ProjectIntelligenceWarningsSection } from "./ProjectIntelligenceWarningsSection";

function renderSectionContent(input: {
  readonly section: ProjectIntelligenceSectionId;
  readonly result: ProjectGetIntelligenceResult;
  readonly environmentId: EnvironmentId | null;
  readonly workspaceCwd?: string | null | undefined;
}) {
  switch (input.section) {
    case "overview":
      return <ProjectIntelligenceOverviewSection result={input.result} />;
    case "always-loaded":
      return (
        <ProjectIntelligenceAlwaysLoadedSection
          surfaces={getAlwaysLoadedSurfaces(input.result)}
          environmentId={input.environmentId}
          workspaceCwd={input.workspaceCwd}
        />
      );
    case "codex-layer":
      return (
        <ProjectIntelligenceProviderLayerSection
          ownerLabel="Codex"
          environmentId={input.environmentId}
          providerRuntime={getProviderRuntimeForOwner(input.result, "codex")}
          surfaces={getCodexLayerSurfaces(input.result)}
          workspaceCwd={input.workspaceCwd}
        />
      );
    case "claude-layer":
      return (
        <ProjectIntelligenceProviderLayerSection
          ownerLabel="Claude"
          environmentId={input.environmentId}
          providerRuntime={getProviderRuntimeForOwner(input.result, "claude")}
          surfaces={getClaudeLayerSurfaces(input.result)}
          workspaceCwd={input.workspaceCwd}
        />
      );
    case "memory":
      return (
        <ProjectIntelligenceMemorySection
          surfaces={getMemorySurfaces(input.result)}
          environmentId={input.environmentId}
          workspaceCwd={input.workspaceCwd}
        />
      );
    case "code-stats":
      return <ProjectIntelligenceCodeStatsSection result={input.result} />;
    case "warnings":
      return <ProjectIntelligenceWarningsSection warnings={input.result.warnings} />;
  }
}

export function ProjectIntelligenceRouteSheet() {
  const {
    intelligenceSearch,
    activeSection,
    closeProjectIntelligence,
    isProjectIntelligenceOpen,
    setProjectIntelligenceSection,
  } = useProjectIntelligenceNavigation();
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const activeProject = useStore((state) =>
    activeThread
      ? selectProjectByRef(state, {
          environmentId: activeThread.environmentId,
          projectId: activeThread.projectId,
        })
      : undefined,
  );
  const selectedProject = useStore(
    useMemo(
      () => (state: import("../../store").AppState) => {
        if (!intelligenceSearch.intelEnvironmentId || !intelligenceSearch.intelProjectCwd) {
          return undefined;
        }
        return selectProjectsAcrossEnvironments(state).find(
          (project) =>
            project.environmentId === intelligenceSearch.intelEnvironmentId &&
            project.cwd === intelligenceSearch.intelProjectCwd,
        );
      },
      [intelligenceSearch.intelEnvironmentId, intelligenceSearch.intelProjectCwd],
    ),
  );
  const environmentId =
    intelligenceSearch.intel === "thread"
      ? (routeThreadRef?.environmentId ?? intelligenceSearch.intelEnvironmentId ?? null)
      : intelligenceSearch.intel
        ? (intelligenceSearch.intelEnvironmentId ?? selectedProject?.environmentId ?? null)
        : null;
  const projectCwd =
    intelligenceSearch.intel === "thread"
      ? (activeProject?.cwd ?? intelligenceSearch.intelProjectCwd ?? selectedProject?.cwd ?? null)
      : intelligenceSearch.intel
        ? (intelligenceSearch.intelProjectCwd ?? selectedProject?.cwd ?? activeProject?.cwd ?? null)
        : null;
  const effectiveCwd =
    intelligenceSearch.intel === "thread"
      ? (activeThread?.worktreePath ??
        activeProject?.cwd ??
        intelligenceSearch.intelProjectCwd ??
        null)
      : null;
  const workspaceCwd = effectiveCwd ?? projectCwd;
  const projectName =
    intelligenceSearch.intel === "thread"
      ? (activeProject?.name ?? selectedProject?.name ?? null)
      : (selectedProject?.name ?? null);

  const intelligenceQuery = useQuery(
    projectIntelligenceSummaryQueryOptions({
      environmentId,
      projectCwd,
      effectiveCwd,
      viewMode: intelligenceSearch.intel ?? null,
      enabled: environmentId !== null && projectCwd !== null,
    }),
  );

  if (!isProjectIntelligenceOpen || !intelligenceSearch.intel) {
    return null;
  }

  const navItems = intelligenceQuery.data
    ? PROJECT_INTELLIGENCE_SECTION_ORDER.map((section) => ({
        id: section,
        label: getProjectIntelligenceSectionLabel(section),
        count: getSectionCount(intelligenceQuery.data, section),
      }))
    : PROJECT_INTELLIGENCE_SECTION_ORDER.map((section) => ({
        id: section,
        label: getProjectIntelligenceSectionLabel(section),
        count: 0,
      }));

  return (
    <Sheet
      open={isProjectIntelligenceOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeProjectIntelligence();
        }
      }}
    >
      <SheetPopup
        side="right"
        keepMounted
        showCloseButton={false}
        className="w-[min(96vw,1160px)] max-w-[1160px] p-0"
      >
        <ProjectIntelligenceSheetHeader
          viewMode={intelligenceSearch.intel}
          result={intelligenceQuery.data}
          projectName={projectName}
          onClose={closeProjectIntelligence}
        />
        <ScrollArea scrollFade className="flex-1 min-h-0">
          <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-1">
            {!environmentId || !projectCwd ? (
              <Empty className="min-h-80 rounded-2xl border border-dashed border-border/70 bg-muted/18">
                <EmptyHeader>
                  <EmptyTitle>Project intelligence is unavailable</EmptyTitle>
                  <EmptyDescription>
                    Select a project from the sidebar or open a thread-bound project pill to inspect
                    its agent context.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : intelligenceQuery.isPending ? (
              <Empty className="min-h-80 rounded-2xl border border-dashed border-border/70 bg-muted/18">
                <EmptyHeader>
                  <EmptyTitle>Loading project intelligence</EmptyTitle>
                  <EmptyDescription>
                    Reading instruction layers, skills, hooks, memory, runtime config, and code
                    stats.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : intelligenceQuery.isError || !intelligenceQuery.data ? (
              <Empty className="min-h-80 rounded-2xl border border-dashed border-destructive/30 bg-destructive/5">
                <EmptyHeader>
                  <EmptyTitle>Unable to load project intelligence</EmptyTitle>
                  <EmptyDescription>
                    {intelligenceQuery.error instanceof Error
                      ? intelligenceQuery.error.message
                      : "An unexpected error occurred while reading project intelligence."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ProjectIntelligenceLayout
                navItems={navItems}
                activeSection={activeSection}
                onSectionChange={setProjectIntelligenceSection}
              >
                {renderSectionContent({
                  section: activeSection,
                  result: intelligenceQuery.data,
                  environmentId,
                  workspaceCwd,
                })}
              </ProjectIntelligenceLayout>
            )}
          </div>
        </ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}
