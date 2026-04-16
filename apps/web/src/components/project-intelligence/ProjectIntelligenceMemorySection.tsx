import type { EnvironmentId, ProjectIntelligenceSurfaceSummary } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { ProjectIntelligenceSurfaceList } from "./ProjectIntelligenceSurfaceList";

interface ProjectIntelligenceMemorySectionProps {
  readonly surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  readonly environmentId: EnvironmentId | null;
  readonly workspaceCwd?: string | null | undefined;
}

export function ProjectIntelligenceMemorySection(props: ProjectIntelligenceMemorySectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="space-y-4">
        <CollapsibleTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-between text-left text-[13px]"
            />
          }
        >
          <span>
            {open ? "Hide memory sources" : "Show memory sources"}
            <span className="ml-1.5 text-muted-foreground">({props.surfaces.length})</span>
          </span>
          <ChevronDownIcon
            className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ProjectIntelligenceSurfaceList
            surfaces={props.surfaces}
            environmentId={props.environmentId}
            workspaceCwd={props.workspaceCwd}
            emptyTitle="No matching memory files"
            emptyDescription="Claude project memory was not found for the active project path."
            emptyProjectMessage="No project-scoped memory files"
            emptyGlobalMessage="No global memory files"
          />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
