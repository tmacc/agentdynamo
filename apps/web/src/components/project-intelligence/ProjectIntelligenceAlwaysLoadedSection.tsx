import type { EnvironmentId, ProjectIntelligenceSurfaceSummary } from "@t3tools/contracts";

import { ProjectIntelligenceSurfaceList } from "./ProjectIntelligenceSurfaceList";

interface ProjectIntelligenceAlwaysLoadedSectionProps {
  readonly surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  readonly environmentId: EnvironmentId | null;
  readonly workspaceCwd?: string | null | undefined;
}

export function ProjectIntelligenceAlwaysLoadedSection(
  props: ProjectIntelligenceAlwaysLoadedSectionProps,
) {
  return (
    <ProjectIntelligenceSurfaceList
      surfaces={props.surfaces}
      environmentId={props.environmentId}
      workspaceCwd={props.workspaceCwd}
      emptyTitle="No always-loaded surfaces"
      emptyDescription="This project snapshot does not currently expose any default instruction surfaces."
      emptyProjectMessage="No project-scoped always-loaded surfaces"
      emptyGlobalMessage="No global always-loaded surfaces"
    />
  );
}
