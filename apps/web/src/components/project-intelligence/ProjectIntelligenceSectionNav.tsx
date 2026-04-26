import type { ProjectIntelligenceSectionId } from "@t3tools/contracts";

import { PROJECT_INTELLIGENCE_SECTION_IDS } from "../../projectIntelligenceRouteSearch";
import { SECTION_LABELS } from "../../projectIntelligencePresentation";
import { cn } from "~/lib/utils";

type SectionMeta = {
  id: ProjectIntelligenceSectionId;
  label: string;
};

const SHORT_LABELS: Partial<Record<ProjectIntelligenceSectionId, string>> = {
  "loaded-context": "Context",
  "code-stats": "Stats",
};

export interface ProjectIntelligenceSectionNavProps {
  active: ProjectIntelligenceSectionId;
  countsBySection: Partial<Record<ProjectIntelligenceSectionId, number>>;
  warningCount: number;
  errorCount: number;
  onSelect: (section: ProjectIntelligenceSectionId) => void;
}

export function ProjectIntelligenceSectionNav(props: ProjectIntelligenceSectionNavProps) {
  const sections: ReadonlyArray<SectionMeta> = PROJECT_INTELLIGENCE_SECTION_IDS.map((id) => ({
    id,
    label: SHORT_LABELS[id] ?? SECTION_LABELS[id] ?? id,
  }));

  return (
    <nav
      aria-label="Project intelligence sections"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/60 px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {sections.map((section) => {
        const isActive = section.id === props.active;
        const count = props.countsBySection[section.id] ?? 0;
        const isWarnings = section.id === "warnings";
        const showCount = count > 0;
        const accentClass =
          isWarnings && props.errorCount > 0
            ? "text-destructive"
            : isWarnings && props.warningCount > 0
              ? "text-amber-600 dark:text-amber-400"
              : isActive
                ? "text-foreground"
                : "text-muted-foreground";
        return (
          <button
            key={section.id}
            type="button"
            data-testid={`project-intelligence-nav-${section.id}`}
            data-active={isActive ? "true" : "false"}
            onClick={() => props.onSelect(section.id)}
            className={cn(
              "group relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 text-[11px] font-medium transition-colors",
              "hover:bg-muted/60",
              isActive
                ? "bg-card border-border/60 shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={isActive}
          >
            <span className={cn(accentClass, "whitespace-nowrap")}>{section.label}</span>
            {showCount ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[10px] leading-none tabular-nums",
                  isWarnings && props.errorCount > 0
                    ? "bg-destructive/15 text-destructive"
                    : isWarnings && props.warningCount > 0
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : isActive
                        ? "bg-muted text-foreground"
                        : "bg-muted/60 text-muted-foreground",
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
