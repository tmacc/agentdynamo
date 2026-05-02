import type { ProjectIntelligenceViewMode } from "@t3tools/contracts";
import { Schema } from "effect";
import { useCallback, useMemo, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { useProjectIntelligenceNavigation } from "../../hooks/useProjectIntelligenceNavigation";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import {
  clampResizablePanelWidth,
  useResizablePanelDrag,
  type ResizablePanelElements,
} from "../../hooks/useResizablePanelDrag";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import { cn } from "~/lib/utils";

import { ProjectIntelligencePanel } from "./ProjectIntelligencePanel";

const DOCK_WIDTH_STORAGE_KEY = "project_intelligence_dock_width";
const DOCK_DEFAULT_WIDTH = 460;
const DOCK_MIN_WIDTH = 320;
const DOCK_MAX_WIDTH = 720;

/**
 * Mounts the Project Intelligence v2 panel as a non-modal docked side panel
 * along the right edge of the chat layout. Lives at the chat layout root so
 * the dock is reachable from any chat route (project, thread, draft).
 *
 * Renders inline (not via portal), so the X button closes synchronously and
 * the underlying chat content stays interactive.
 */
export function ProjectIntelligenceMount() {
  const navigation = useProjectIntelligenceNavigation();

  const allProjects = useStore(useShallow(selectProjectsAcrossEnvironments));

  const [storedWidth, setStoredWidth] = useLocalStorage(
    DOCK_WIDTH_STORAGE_KEY,
    DOCK_DEFAULT_WIDTH,
    Schema.Number,
  );

  const projectMatch = useMemo(() => {
    if (!navigation.projectCwd) return null;
    const normalized = normalizePath(navigation.projectCwd);
    return (
      allProjects.find(
        (project) =>
          (!navigation.environmentId || project.environmentId === navigation.environmentId) &&
          normalizePath(project.cwd) === normalized,
      ) ?? null
    );
  }, [allProjects, navigation.environmentId, navigation.projectCwd]);

  const handleSwitchViewMode = useCallback(
    (next: ProjectIntelligenceViewMode) => {
      if (!navigation.projectCwd) return;
      navigation.open({
        viewMode: next,
        environmentId: navigation.environmentId,
        projectCwd: navigation.projectCwd,
        effectiveCwd: next === "thread" ? navigation.effectiveCwd : null,
        section: navigation.section,
        surfaceId: null,
      });
    },
    [navigation],
  );

  const handleOpenProjectContext = useCallback(() => {
    if (!navigation.projectCwd) return;
    navigation.open({
      viewMode: "project",
      environmentId: navigation.environmentId,
      projectCwd: navigation.projectCwd,
      effectiveCwd: null,
      section: "context-inspector",
      surfaceId: null,
    });
  }, [navigation]);

  if (!navigation.isOpen || !navigation.viewMode || !navigation.projectCwd) {
    return null;
  }

  const width = clampResizablePanelWidth(storedWidth, {
    minWidth: DOCK_MIN_WIDTH,
    maxWidth: DOCK_MAX_WIDTH,
  });

  return (
    <ProjectIntelligenceDock width={width} onWidthChange={setStoredWidth}>
      <ProjectIntelligencePanel
        viewMode={navigation.viewMode}
        environmentId={navigation.environmentId}
        projectCwd={navigation.projectCwd}
        effectiveCwd={navigation.effectiveCwd}
        projectTitle={projectMatch?.name ?? null}
        section={navigation.section}
        surfaceId={navigation.surfaceId}
        canSwitchToThread={Boolean(navigation.effectiveCwd)}
        onClose={navigation.close}
        onSelectSection={navigation.setSection}
        onSelectSurface={navigation.setSurfaceId}
        onOpenProjectContext={handleOpenProjectContext}
        onSwitchViewMode={navigation.effectiveCwd ? handleSwitchViewMode : undefined}
      />
    </ProjectIntelligenceDock>
  );
}

function ProjectIntelligenceDock(props: {
  width: number;
  onWidthChange: (width: number) => void;
  children: ReactNode;
}) {
  const resizeDrag = useResizablePanelDrag<ResizablePanelElements>({
    enabled: true,
    minWidth: DOCK_MIN_WIDTH,
    maxWidth: DOCK_MAX_WIDTH,
    side: "right",
    onResize: props.onWidthChange,
    applyWidth: (elements, nextWidth) => {
      elements.panel.style.width = `${nextWidth}px`;
    },
    getElements: (rail) => {
      const panel = rail.closest<HTMLElement>("[data-project-intelligence-dock='true']");
      if (!panel) return null;
      return { panel, transitionTargets: [panel] };
    },
  });

  return (
    <aside
      aria-label="Project intelligence"
      data-project-intelligence-dock="true"
      className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-border/70 bg-card/50"
      style={{ width: props.width }}
    >
      <button
        aria-label="Resize project intelligence panel"
        className={cn(
          "absolute inset-y-0 left-0 z-20 hidden w-3 -translate-x-1/2 cursor-e-resize sm:flex",
          "after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border",
        )}
        onClick={(event) => {
          if (resizeDrag.consumeClickSuppression()) {
            event.preventDefault();
          }
        }}
        onPointerCancel={resizeDrag.onPointerCancel}
        onPointerDown={resizeDrag.onPointerDown}
        onPointerMove={resizeDrag.onPointerMove}
        onPointerUp={resizeDrag.onPointerUp}
        ref={resizeDrag.railRef}
        tabIndex={-1}
        title="Drag to resize project intelligence panel"
        type="button"
      />
      {props.children}
    </aside>
  );
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\+/g, "/").replace(/\/+$/, "");
}
