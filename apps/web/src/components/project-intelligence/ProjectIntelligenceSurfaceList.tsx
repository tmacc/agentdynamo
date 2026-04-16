import type { EnvironmentId, ProjectIntelligenceSurfaceSummary } from "@t3tools/contracts";
import { FolderIcon, GlobeIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";

import { isProjectScopedSurface } from "../../projectIntelligencePresentation";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ProjectIntelligenceSurfaceCard } from "./ProjectIntelligenceSurfaceCard";

interface ScopeGroupHeaderProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly count: number;
}

export function ScopeGroupHeader({ icon, label, count }: ScopeGroupHeaderProps) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {icon}
        {label}
        <span className="rounded-full bg-muted px-1.5 py-0.5 font-normal tabular-nums">
          {count}
        </span>
      </div>
      <div className="h-px flex-1 bg-border/50" />
    </div>
  );
}

export function ScopeGroupEmpty({ message }: { readonly message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/50 px-4 py-3 text-center text-[12px] text-muted-foreground/70">
      {message}
    </div>
  );
}

interface ProjectIntelligenceSurfaceListProps {
  readonly surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  readonly environmentId: EnvironmentId | null;
  readonly workspaceCwd?: string | null | undefined;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly emptyProjectMessage?: string;
  readonly emptyGlobalMessage?: string;
}

export function ProjectIntelligenceSurfaceList(props: ProjectIntelligenceSurfaceListProps) {
  const { projectSurfaces, globalSurfaces } = useMemo(() => {
    const project = props.surfaces.filter(isProjectScopedSurface);
    const global = props.surfaces.filter((s) => !isProjectScopedSurface(s));
    return { projectSurfaces: project, globalSurfaces: global };
  }, [props.surfaces]);

  if (props.surfaces.length === 0) {
    return (
      <Empty className="min-h-52 rounded-2xl border border-dashed border-border/70 bg-muted/18">
        <EmptyHeader>
          <EmptyTitle>{props.emptyTitle}</EmptyTitle>
          <EmptyDescription>{props.emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      <ScopeGroupHeader
        icon={<FolderIcon className="size-3" />}
        label="Project"
        count={projectSurfaces.length}
      />
      {projectSurfaces.length > 0 ? (
        projectSurfaces.map((surface) => (
          <ProjectIntelligenceSurfaceCard
            key={surface.id}
            surface={surface}
            environmentId={props.environmentId}
            workspaceCwd={props.workspaceCwd}
          />
        ))
      ) : (
        <ScopeGroupEmpty message={props.emptyProjectMessage ?? "No project-scoped surfaces"} />
      )}
      <div className="pt-2">
        <div className="space-y-3">
          <ScopeGroupHeader
            icon={<GlobeIcon className="size-3" />}
            label="Global"
            count={globalSurfaces.length}
          />
          {globalSurfaces.length > 0 ? (
            globalSurfaces.map((surface) => (
              <ProjectIntelligenceSurfaceCard
                key={surface.id}
                surface={surface}
                environmentId={props.environmentId}
                workspaceCwd={props.workspaceCwd}
              />
            ))
          ) : (
            <ScopeGroupEmpty message={props.emptyGlobalMessage ?? "No global surfaces"} />
          )}
        </div>
      </div>
    </div>
  );
}
