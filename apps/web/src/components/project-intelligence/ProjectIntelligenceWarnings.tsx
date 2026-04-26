import type { ProjectIntelligenceSurfaceId, ProjectIntelligenceWarning } from "@t3tools/contracts";
import { AlertCircleIcon, AlertTriangleIcon, InfoIcon } from "lucide-react";

import {
  formatPath,
  getProviderLabel,
  sortWarningsBySeverity,
} from "../../projectIntelligencePresentation";
import { cn } from "~/lib/utils";

import { ProjectIntelligenceEmptyState } from "./ProjectIntelligenceEmptyState";

const SEVERITY_ICON: Record<
  ProjectIntelligenceWarning["severity"],
  React.ComponentType<{ className?: string }>
> = {
  error: AlertCircleIcon,
  warning: AlertTriangleIcon,
  info: InfoIcon,
};

const SEVERITY_TONE: Record<ProjectIntelligenceWarning["severity"], string> = {
  error: "border-destructive/30 bg-destructive/5 text-destructive",
  warning: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  info: "border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300",
};

const SEVERITY_LABEL: Record<ProjectIntelligenceWarning["severity"], string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

export interface ProjectIntelligenceWarningsProps {
  warnings: ReadonlyArray<ProjectIntelligenceWarning>;
  onSelectSurface?: (surfaceId: ProjectIntelligenceSurfaceId) => void;
}

export function ProjectIntelligenceWarnings(props: ProjectIntelligenceWarningsProps) {
  const sorted = sortWarningsBySeverity(props.warnings);
  if (sorted.length === 0) {
    return (
      <ProjectIntelligenceEmptyState
        title="No warnings"
        description="Project intelligence resolved cleanly. We'll surface unreachable roots, missing files, or suspicious settings here."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2 px-3 pb-4">
      {sorted.map((warning) => {
        const Icon = SEVERITY_ICON[warning.severity];
        return (
          <li
            key={warning.id}
            className={cn(
              "flex flex-col gap-1 rounded-md border px-3 py-2 text-xs",
              SEVERITY_TONE[warning.severity],
            )}
          >
            <div className="flex items-start gap-2">
              <Icon aria-hidden="true" className="mt-0.5 size-3.5" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold uppercase tracking-wide text-[10px]">
                    {SEVERITY_LABEL[warning.severity]}
                  </span>
                  {warning.provider ? (
                    <span className="text-[10px] text-muted-foreground">
                      {getProviderLabel(warning.provider)}
                    </span>
                  ) : null}
                </div>
                <p className="text-foreground/90 leading-snug">{warning.message}</p>
                {warning.path ? (
                  <code className="truncate text-[11px] text-muted-foreground">
                    {formatPath(warning.path, 80)}
                  </code>
                ) : null}
                {warning.surfaceId && props.onSelectSurface ? (
                  <button
                    type="button"
                    onClick={() => props.onSelectSurface?.(warning.surfaceId!)}
                    className="self-start text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    View surface details
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
