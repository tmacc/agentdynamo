import type {
  ProjectIntelligenceHealth,
  ProjectIntelligenceOwner,
  ProjectIntelligenceScope,
  ProjectIntelligenceSurfaceKind,
} from "@t3tools/contracts";
import { FilterIcon, SearchIcon, XIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { type FilterOptions, HEALTH_LABELS } from "../../projectIntelligencePresentation";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export interface ProjectIntelligenceFiltersProps {
  options: FilterOptions;
  searchText: string;
  ownerFilter: ReadonlyArray<ProjectIntelligenceOwner>;
  kindFilter: ReadonlyArray<ProjectIntelligenceSurfaceKind>;
  scopeFilter: ReadonlyArray<ProjectIntelligenceScope>;
  healthFilter: ReadonlyArray<ProjectIntelligenceHealth>;
  onSearchChange: (text: string) => void;
  onOwnerToggle: (owner: ProjectIntelligenceOwner) => void;
  onKindToggle: (kind: ProjectIntelligenceSurfaceKind) => void;
  onScopeToggle: (scope: ProjectIntelligenceScope) => void;
  onHealthToggle: (health: ProjectIntelligenceHealth) => void;
  onClear: () => void;
}

export function ProjectIntelligenceFilters(props: ProjectIntelligenceFiltersProps) {
  const searchId = useId();
  const [expanded, setExpanded] = useState(false);
  const activeFilterCount =
    props.ownerFilter.length +
    props.kindFilter.length +
    props.scopeFilter.length +
    props.healthFilter.length;
  const hasActiveFilters = props.searchText.length > 0 || activeFilterCount > 0;

  return (
    <div className="flex flex-col gap-2 border-b border-border/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={searchId}
            aria-label="Search agentic context"
            placeholder="Search context"
            value={props.searchText}
            onChange={(event) => props.onSearchChange(event.currentTarget.value)}
            className="h-8 ps-8 pe-8 text-xs"
          />
          {props.searchText.length > 0 ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => props.onSearchChange("")}
              className="absolute end-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
        <Button
          type="button"
          variant={expanded || activeFilterCount > 0 ? "secondary" : "outline"}
          size="xs"
          className="h-8 shrink-0 gap-1.5 px-2 text-xs"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <FilterIcon aria-hidden="true" className="size-3.5" />
          Filters
          {activeFilterCount > 0 ? (
            <span className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] tabular-nums text-primary">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>
        {hasActiveFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-8 shrink-0 px-2 text-xs"
            onClick={props.onClear}
          >
            Clear
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-2 text-xs">
          <FilterGroup
            label="Health"
            options={props.options.healths.map((option) => ({
              value: option.value,
              label: HEALTH_LABELS[option.value] ?? option.value,
              count: option.count,
              active: props.healthFilter.includes(option.value),
              onToggle: () => props.onHealthToggle(option.value),
            }))}
          />
          <FilterGroup
            label="Kind"
            options={props.options.kinds.map((option) => ({
              value: option.value,
              label: option.label,
              count: option.count,
              active: props.kindFilter.includes(option.value),
              onToggle: () => props.onKindToggle(option.value),
            }))}
          />
          <FilterGroup
            label="Owner"
            options={props.options.owners.map((option) => ({
              value: option.value,
              label: option.label,
              count: option.count,
              active: props.ownerFilter.includes(option.value),
              onToggle: () => props.onOwnerToggle(option.value),
            }))}
          />
          <FilterGroup
            label="Scope"
            options={props.options.scopes.map((option) => ({
              value: option.value,
              label: option.label,
              count: option.count,
              active: props.scopeFilter.includes(option.value),
              onToggle: () => props.onScopeToggle(option.value),
            }))}
          />
        </div>
      ) : null}
    </div>
  );
}

interface FilterGroupProps<TValue extends string> {
  label: string;
  options: ReadonlyArray<{
    value: TValue;
    label: string;
    count: number;
    active: boolean;
    onToggle: () => void;
  }>;
}

function FilterGroup<TValue extends string>(props: FilterGroupProps<TValue>) {
  const visibleOptions = useMemo(
    () => props.options.filter((option) => option.count > 0 || option.active),
    [props.options],
  );
  if (visibleOptions.length === 0) return null;
  return (
    <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-2">
      <span className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {props.label}
      </span>
      <div className="flex flex-wrap gap-1">
        {visibleOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            data-testid={`project-intelligence-filter-${props.label.toLowerCase()}-${option.value}`}
            data-active={option.active ? "true" : "false"}
            onClick={option.onToggle}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
              option.active
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/60 bg-card hover:bg-muted/50 text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{option.label}</span>
            <span
              className={cn(
                "rounded-full px-1 py-px text-[10px] tabular-nums",
                option.active ? "bg-primary/15 text-primary" : "bg-muted/70 text-muted-foreground",
              )}
            >
              {option.count}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
