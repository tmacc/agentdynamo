import type {
  ProjectIntelligenceProviderSummary,
  ProjectIntelligenceSurfaceId,
  ProjectIntelligenceSurfaceSummary,
  ProjectIntelligenceWarning,
  ProjectIntelligenceCodeStats as CodeStats,
  ProjectIntelligenceSectionId,
} from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  HardDriveIcon,
  PackageOpenIcon,
  ScrollIcon,
  SettingsIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";

import {
  countSurfacesByKind,
  formatNumber,
  formatTokenCount,
  getProviderLabel,
  groupSurfacesBySection,
  HEALTH_BADGE_CLASS,
  HEALTH_LABELS,
  sortProvidersByHealth,
  sortSurfacesByHealth,
  sortWarningsBySeverity,
  summarizeOverview,
} from "../../projectIntelligencePresentation";
import { cn } from "~/lib/utils";

import { ProjectIntelligenceHealthDot } from "./ProjectIntelligenceHealthDot";

export interface ProjectIntelligenceOverviewProps {
  surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  providers: ReadonlyArray<ProjectIntelligenceProviderSummary>;
  warnings: ReadonlyArray<ProjectIntelligenceWarning>;
  codeStats?: CodeStats | undefined;
  onNavigateSection: (section: ProjectIntelligenceSectionId) => void;
  onSelectSurface: (surfaceId: ProjectIntelligenceSurfaceId) => void;
}

export function ProjectIntelligenceOverview(props: ProjectIntelligenceOverviewProps) {
  const stats = summarizeOverview({
    surfaces: props.surfaces,
    providers: props.providers,
    warnings: props.warnings,
    ...(props.codeStats ? { codeStats: props.codeStats } : {}),
  });
  const grouped = groupSurfacesBySection(props.surfaces);
  const loadedSorted = sortSurfacesByHealth(grouped.loadedContext).slice(0, 5);
  const sortedProviders = sortProvidersByHealth(props.providers);
  const topWarnings = sortWarningsBySeverity(props.warnings).slice(0, 4);
  const kindCounts = countSurfacesByKind(props.surfaces).slice(0, 6);

  return (
    <div className="flex flex-col gap-2 px-3 pb-4">
      <div className="rounded-md border border-border/60 bg-card/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <ProjectIntelligenceHealthDot health={stats.worstHealth} />
            <span>Overall health</span>
            <span
              className={cn(
                "rounded-full border px-1.5 py-px text-[10px]",
                HEALTH_BADGE_CLASS[stats.worstHealth],
              )}
            >
              {HEALTH_LABELS[stats.worstHealth]}
            </span>
          </div>
          <SummaryStat label="surfaces" value={stats.totalSurfaces} />
          <SummaryStat label="providers" value={stats.providerCount} />
          <SummaryStat label="errors" value={stats.errorCount} />
          <SummaryStat label="warnings" value={stats.warningCount} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <SectionTile
          icon={<ScrollIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
          label="Loaded"
          value={stats.loadedContextCount}
          onClick={() => props.onNavigateSection("loaded-context")}
        />
        <SectionTile
          icon={<WrenchIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
          label="Tools"
          value={stats.toolCount}
          onClick={() => props.onNavigateSection("tools")}
        />
        <SectionTile
          icon={<HardDriveIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
          label="Memory"
          value={stats.memoryCount}
          onClick={() => props.onNavigateSection("memory")}
        />
        <SectionTile
          icon={<SettingsIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
          label="Runtime"
          value={stats.runtimeCount}
          onClick={() => props.onNavigateSection("runtime")}
        />
      </div>

      {stats.codeStats ? (
        <button
          type="button"
          onClick={() => props.onNavigateSection("code-stats")}
          className="group flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/60 bg-card/20 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/40"
        >
          <PackageOpenIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Code stats
          </span>
          <span className="text-foreground">
            <span className="font-medium tabular-nums">
              {formatNumber(stats.codeStats.fileCount)}
            </span>{" "}
            files
            <span className="mx-1 text-muted-foreground">-</span>
            <span className="font-medium tabular-nums">
              {formatNumber(stats.codeStats.loc)}
            </span>{" "}
            LOC
            <span className="mx-1 text-muted-foreground">-</span>
            <span className="font-medium tabular-nums">
              {formatTokenCount(stats.codeStats.approxTokenCount)}
            </span>{" "}
            tokens
          </span>
          {stats.codeStats.partial ? (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-300">
              Partial
            </span>
          ) : null}
          <ArrowRightIcon
            className="ms-auto size-3.5 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>
      ) : null}

      <PanelSection
        title="Provider health"
        icon={<SparklesIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />}
        action={{
          label: `View all (${sortedProviders.length})`,
          onClick: () => props.onNavigateSection("providers"),
        }}
      >
        {sortedProviders.length === 0 ? (
          <p className="text-xs text-muted-foreground">No providers detected.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {sortedProviders.slice(0, 4).map((provider) => (
              <li
                key={provider.provider}
                className="flex items-center gap-2 rounded-md border border-border/40 bg-card/30 px-2 py-1.5 text-xs"
              >
                <ProjectIntelligenceHealthDot health={provider.health} />
                <span className="font-medium text-foreground">
                  {getProviderLabel(provider.provider)}
                </span>
                <span className="ms-auto text-[11px] text-muted-foreground">
                  {provider.installed ? "Installed" : "Not installed"} - {provider.modelCount}{" "}
                  models
                </span>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      <PanelSection
        title="What's loaded right now"
        icon={<ScrollIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />}
        {...(stats.loadedContextCount > loadedSorted.length
          ? {
              action: {
                label: `View all (${stats.loadedContextCount})`,
                onClick: () => props.onNavigateSection("loaded-context"),
              },
            }
          : {})}
      >
        {loadedSorted.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No always-loaded context discovered for this {stats.codeStats ? "workspace" : "scope"}.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {loadedSorted.map((surface) => (
              <li key={surface.id}>
                <button
                  type="button"
                  onClick={() => {
                    props.onNavigateSection("loaded-context");
                    props.onSelectSurface(surface.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-md border border-transparent bg-card/20 px-2 py-1.5 text-left text-xs transition-colors hover:border-border/40 hover:bg-card/40"
                >
                  <ProjectIntelligenceHealthDot health={surface.health} />
                  <span className="truncate font-medium text-foreground">{surface.label}</span>
                  <span className="ms-auto truncate text-[11px] text-muted-foreground">
                    {surface.sourceLabel ?? surface.path}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      <PanelSection
        title="Surface inventory"
        icon={<WrenchIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />}
      >
        {kindCounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No surfaces discovered.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {kindCounts.map((entry) => (
              <span
                key={entry.kind}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/30 px-2 py-0.5 text-[11px]"
              >
                <span className="text-muted-foreground">{entry.label}</span>
                <span className="font-medium tabular-nums text-foreground">{entry.count}</span>
              </span>
            ))}
          </div>
        )}
      </PanelSection>

      <PanelSection
        title="Warnings"
        icon={<AlertTriangleIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />}
        {...(props.warnings.length > 0
          ? {
              action: {
                label: `View all (${props.warnings.length})`,
                onClick: () => props.onNavigateSection("warnings"),
              },
            }
          : {})}
      >
        {topWarnings.length === 0 ? (
          <p className="text-xs text-muted-foreground">All clear - no warnings reported.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {topWarnings.map((warning) => (
              <li
                key={warning.id}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-xs",
                  warning.severity === "error"
                    ? "border-destructive/30 bg-destructive/5 text-destructive"
                    : warning.severity === "warning"
                      ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
                      : "border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300",
                )}
              >
                {warning.message}
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
    </div>
  );
}

function SummaryStat(props: { label: string; value: number }) {
  return (
    <span className="text-[11px] text-muted-foreground">
      <span className="font-medium tabular-nums text-foreground">{props.value}</span> {props.label}
    </span>
  );
}

function SectionTile(props: {
  icon: React.ReactNode;
  label: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="group flex items-center gap-2 rounded-md border border-border/60 bg-card/20 px-2.5 py-2 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {props.icon}
        <span className="truncate">{props.label}</span>
      </div>
      <span className="ms-auto font-heading text-lg font-semibold tabular-nums text-foreground">
        {props.value}
      </span>
    </button>
  );
}

function PanelSection(props: {
  title: string;
  icon: React.ReactNode;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-card/20 p-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {props.icon}
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {props.title}
          </span>
        </div>
        {props.action ? (
          <button
            type="button"
            onClick={props.action.onClick}
            className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
          >
            {props.action.label}
          </button>
        ) : null}
      </header>
      {props.children}
    </section>
  );
}
