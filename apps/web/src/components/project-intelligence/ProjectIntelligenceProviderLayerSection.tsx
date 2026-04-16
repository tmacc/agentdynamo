import type {
  EnvironmentId,
  ProjectIntelligenceProviderRuntimeSummary,
  ProjectIntelligenceSurfaceSummary,
} from "@t3tools/contracts";

import { getNonSettingsSurfaces, getSettingsSurfaces } from "../../projectIntelligencePresentation";
import { ProjectIntelligenceRuntimeConfigCards } from "./ProjectIntelligenceRuntimeConfigCards";
import { ProjectIntelligenceSurfaceList } from "./ProjectIntelligenceSurfaceList";

interface ProjectIntelligenceProviderLayerSectionProps {
  readonly environmentId: EnvironmentId | null;
  readonly providerRuntime: ReadonlyArray<ProjectIntelligenceProviderRuntimeSummary>;
  readonly surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  readonly workspaceCwd?: string | null | undefined;
  readonly ownerLabel: "Codex" | "Claude";
}

export function ProjectIntelligenceProviderLayerSection(
  props: ProjectIntelligenceProviderLayerSectionProps,
) {
  const settingsSurfaces = getSettingsSurfaces(props.surfaces);
  const nonSettingsSurfaces = getNonSettingsSurfaces(props.surfaces);

  const hasConfig = props.providerRuntime.length > 0 || settingsSurfaces.length > 0;

  return (
    <div className="space-y-5">
      <ProjectIntelligenceRuntimeConfigCards
        environmentId={props.environmentId}
        providerRuntime={props.providerRuntime}
        settingsSurfaces={settingsSurfaces}
        workspaceCwd={props.workspaceCwd}
      />
      {hasConfig && nonSettingsSurfaces.length > 0 ? (
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border/50" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {props.ownerLabel} surfaces
          </span>
          <div className="h-px flex-1 bg-border/50" />
        </div>
      ) : null}
      <ProjectIntelligenceSurfaceList
        surfaces={nonSettingsSurfaces}
        environmentId={props.environmentId}
        workspaceCwd={props.workspaceCwd}
        emptyTitle={`No ${props.ownerLabel.toLowerCase()} surfaces`}
        emptyDescription={`${props.ownerLabel} did not report any discoverable prompt or tool surfaces for this scope.`}
        emptyProjectMessage={`No project-scoped ${props.ownerLabel.toLowerCase()} surfaces`}
        emptyGlobalMessage={`No global ${props.ownerLabel.toLowerCase()} surfaces`}
      />
    </div>
  );
}
