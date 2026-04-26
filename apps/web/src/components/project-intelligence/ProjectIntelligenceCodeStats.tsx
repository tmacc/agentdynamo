import type { ProjectIntelligenceCodeStats as CodeStats } from "@t3tools/contracts";
import { FileTextIcon, HashIcon, LayersIcon } from "lucide-react";

import { formatNumber, formatTokenCount } from "../../projectIntelligencePresentation";

import { ProjectIntelligenceEmptyState } from "./ProjectIntelligenceEmptyState";

export interface ProjectIntelligenceCodeStatsProps {
  codeStats?: CodeStats | null;
}

export function ProjectIntelligenceCodeStats(props: ProjectIntelligenceCodeStatsProps) {
  if (!props.codeStats) {
    return (
      <ProjectIntelligenceEmptyState
        title="Code stats unavailable"
        description="The resolver could not produce authored-source statistics for this workspace. This may indicate a non-git repository or a recent scan failure."
      />
    );
  }
  const stats = props.codeStats;
  return (
    <div className="flex flex-col gap-3 px-3 pb-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <CodeStatCard
          label="Files"
          value={formatNumber(stats.fileCount)}
          icon={<FileTextIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
        />
        <CodeStatCard
          label="Lines of code"
          value={formatNumber(stats.loc)}
          icon={<LayersIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
        />
        <CodeStatCard
          label="Approx. tokens"
          value={formatTokenCount(stats.approxTokenCount)}
          icon={<HashIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
        />
      </div>
      <div className="rounded-md border border-border/60 bg-card/50 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-foreground">Basis:</span>
          <span>{stats.basis}</span>
          {stats.partial ? (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-300">
              Partial scan
            </span>
          ) : (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              Full scan
            </span>
          )}
        </div>
        <p className="mt-1 leading-snug">
          Stats exclude generated files, lockfiles, and bundled output. Token counts are
          approximate.
        </p>
      </div>
    </div>
  );
}

function CodeStatCard(props: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {props.icon}
        <span>{props.label}</span>
      </div>
      <div className="mt-1 font-heading text-2xl font-semibold tabular-nums">{props.value}</div>
    </div>
  );
}
