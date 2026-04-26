import type {
  ProjectIntelligenceSurfaceId,
  ProjectIntelligenceSurfaceSummary,
} from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";

import {
  formatNumber,
  formatPath,
  formatTokenCount,
  getActivationLabel,
  getOwnerLabel,
  getProviderLabel,
  getScopeLabel,
  getSurfaceKindLabel,
  sortSurfacesByHealth,
} from "../../projectIntelligencePresentation";
import { cn } from "~/lib/utils";

import { ProjectIntelligenceEmptyState } from "./ProjectIntelligenceEmptyState";
import { ProjectIntelligenceHealthDot } from "./ProjectIntelligenceHealthDot";

export interface ProjectIntelligenceSurfaceTableProps {
  surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  selectedSurfaceId: ProjectIntelligenceSurfaceId | null;
  onSelect: (surfaceId: ProjectIntelligenceSurfaceId) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  groupLabel?: string;
}

export function ProjectIntelligenceSurfaceTable(props: ProjectIntelligenceSurfaceTableProps) {
  const sorted = sortSurfacesByHealth(props.surfaces);
  if (sorted.length === 0) {
    return (
      <ProjectIntelligenceEmptyState
        title={props.emptyTitle ?? "No surfaces"}
        description={
          props.emptyDescription ??
          "Nothing matched the current filters. Try widening the search or clearing filters."
        }
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-col">
      {props.groupLabel ? (
        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {props.groupLabel}
        </div>
      ) : null}
      <ul role="list" className="divide-y divide-border/50 border-y border-border/50">
        {sorted.map((surface) => (
          <SurfaceRow
            key={surface.id}
            surface={surface}
            isSelected={surface.id === props.selectedSurfaceId}
            onSelect={props.onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

function SurfaceRow(props: {
  surface: ProjectIntelligenceSurfaceSummary;
  isSelected: boolean;
  onSelect: (surfaceId: ProjectIntelligenceSurfaceId) => void;
}) {
  const { surface } = props;
  const tokens = surface.approxTokenCount;
  const lines = surface.lineCount;
  return (
    <li>
      <button
        type="button"
        data-testid={`project-intelligence-surface-${surface.id}`}
        data-active={props.isSelected ? "true" : "false"}
        aria-pressed={props.isSelected}
        onClick={() => props.onSelect(surface.id)}
        className={cn(
          "group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-start transition-colors",
          props.isSelected ? "bg-primary/5 text-foreground" : "hover:bg-muted/50 text-foreground",
          !surface.enabled && !props.isSelected ? "opacity-70" : "",
        )}
      >
        <ProjectIntelligenceHealthDot health={surface.health} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[13px] font-medium">{surface.label}</span>
            {!surface.enabled ? (
              <span className="shrink-0 rounded-full border border-border/60 bg-muted/50 px-1.5 py-px text-[10px] text-muted-foreground">
                Disabled
              </span>
            ) : null}
            <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground sm:inline">
              {getSurfaceKindLabel(surface.kind)} - {getOwnerLabel(surface.owner)}
              {surface.provider ? ` - ${getProviderLabel(surface.provider)}` : ""} -{" "}
              {getScopeLabel(surface.scope)}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            <code className="min-w-0 truncate font-mono">{formatPath(surface.path, 84)}</code>
            <span className="hidden shrink-0 sm:inline">
              {getActivationLabel(surface.activation)}
            </span>
            {surface.triggerLabel ? (
              <span className="hidden truncate md:inline">{surface.triggerLabel}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
          <div className="hidden flex-col items-end gap-0.5 sm:flex">
            {tokens !== undefined ? (
              <span className="tabular-nums">{formatTokenCount(tokens)} tok</span>
            ) : null}
            {lines !== undefined ? (
              <span className="tabular-nums">{formatNumber(lines)} ln</span>
            ) : null}
          </div>
          <ChevronRightIcon
            className={cn(
              "size-3.5 text-muted-foreground/60 transition-transform",
              props.isSelected ? "rotate-90 text-foreground" : "group-hover:translate-x-0.5",
            )}
            aria-hidden="true"
          />
        </div>
      </button>
    </li>
  );
}
