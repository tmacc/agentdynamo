import type { ProjectGetIntelligenceResult, ProjectIntelligenceViewMode } from "@t3tools/contracts";
import { EyeIcon, GitBranchIcon, XIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";

interface ProjectIntelligenceSheetHeaderProps {
  readonly viewMode: ProjectIntelligenceViewMode;
  readonly result: ProjectGetIntelligenceResult | undefined;
  readonly projectName?: string | null;
  readonly onClose: () => void;
}

export function ProjectIntelligenceSheetHeader(props: ProjectIntelligenceSheetHeaderProps) {
  const title = props.projectName ? `${props.projectName} Intelligence` : "Project Intelligence";
  const activePath = props.result?.effectiveCwd ?? props.result?.projectCwd ?? null;

  return (
    <SheetHeader className="relative border-b border-border/70 pb-5 pr-16">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="absolute right-4 top-4"
        onClick={props.onClose}
        aria-label="Close project intelligence"
      >
        <XIcon />
      </Button>
      <div className="flex items-center gap-2.5">
        <SheetTitle>{title}</SheetTitle>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" size="sm">
            {props.viewMode === "thread" ? (
              <>
                <GitBranchIcon className="size-3" />
                Thread view
              </>
            ) : (
              <>
                <EyeIcon className="size-3" />
                Project view
              </>
            )}
          </Badge>
          {props.result?.effectiveCwd ? (
            <Badge variant="info" size="sm">
              Effective workspace
            </Badge>
          ) : null}
        </div>
      </div>
      <SheetDescription className="text-xs leading-relaxed">
        Loaded-now context, agent tooling, runtime config, memory, and cross-stack authored code
        stats for the current project snapshot.
      </SheetDescription>
      {activePath ? (
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/70">
          {activePath}
        </div>
      ) : null}
    </SheetHeader>
  );
}
