import type { ProjectIntelligenceViewMode } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useProjectIntelligenceNavigation } from "../../hooks/useProjectIntelligenceNavigation";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import { RightPanelSheet } from "../RightPanelSheet";

import { ProjectIntelligencePanel } from "./ProjectIntelligencePanel";

/**
 * Mounts the Project Intelligence v2 right panel based on the current route
 * search state. Lives at the root chat layout so the sheet is reachable from
 * any chat route (project, thread, draft).
 */
export function ProjectIntelligenceMount() {
  const navigation = useProjectIntelligenceNavigation();

  const allProjects = useStore(useShallow(selectProjectsAcrossEnvironments));

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

  if (!navigation.isOpen || !navigation.viewMode || !navigation.projectCwd) {
    return (
      <RightPanelSheet open={false} onClose={navigation.close}>
        {null}
      </RightPanelSheet>
    );
  }

  return (
    <RightPanelSheet open={navigation.isOpen} onClose={navigation.close}>
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
        onSwitchViewMode={navigation.effectiveCwd ? handleSwitchViewMode : undefined}
      />
    </RightPanelSheet>
  );
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\+/g, "/").replace(/\/+$/, "");
}
