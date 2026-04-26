import type { ProjectIntelligenceProviderSummary } from "@t3tools/contracts";

import {
  formatNumber,
  getProviderLabel,
  HEALTH_BADGE_CLASS,
  HEALTH_LABELS,
  sortProvidersByHealth,
} from "../../projectIntelligencePresentation";
import { cn } from "~/lib/utils";

import { ProjectIntelligenceEmptyState } from "./ProjectIntelligenceEmptyState";
import { ProjectIntelligenceHealthDot } from "./ProjectIntelligenceHealthDot";

export interface ProjectIntelligenceProviderHealthProps {
  providers: ReadonlyArray<ProjectIntelligenceProviderSummary>;
}

export function ProjectIntelligenceProviderHealth(props: ProjectIntelligenceProviderHealthProps) {
  const providers = sortProvidersByHealth(props.providers);
  if (providers.length === 0) {
    return (
      <ProjectIntelligenceEmptyState
        title="No providers"
        description="No agent providers were detected for this workspace. Configure Codex, Claude Code, Cursor, or OpenCode to make them available."
      />
    );
  }
  return (
    <div className="px-3 pb-4">
      <div className="overflow-hidden rounded-md border border-border/60">
        <div className="hidden grid-cols-[minmax(10rem,1.3fr)_minmax(13rem,2fr)_4rem_5rem_6rem] gap-3 border-b border-border/60 bg-muted/25 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
          <span>Provider</span>
          <span>Status</span>
          <span className="text-right">Models</span>
          <span className="text-right">Tools</span>
          <span>Roles</span>
        </div>
        <ul className="divide-y divide-border/60">
          {providers.map((provider) => (
            <ProviderHealthRow key={provider.provider} provider={provider} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ProviderHealthRow(props: { provider: ProjectIntelligenceProviderSummary }) {
  const { provider } = props;
  const installedLabel = provider.installed ? "Installed" : "Not installed";
  const enabledLabel = provider.enabled ? "Enabled" : "Disabled";
  const versionLabel = provider.version ?? "Unknown version";
  const toolCount = provider.skillCount + provider.slashCommandCount;
  return (
    <li className="grid gap-2 bg-card/20 px-3 py-2 text-xs md:grid-cols-[minmax(10rem,1.3fr)_minmax(13rem,2fr)_4rem_5rem_6rem] md:items-center md:gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <ProjectIntelligenceHealthDot health={provider.health} />
        <span className="truncate font-semibold text-foreground">
          {getProviderLabel(provider.provider)}
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-medium",
            HEALTH_BADGE_CLASS[provider.health],
          )}
        >
          {HEALTH_LABELS[provider.health]}
        </span>
      </div>
      <div className="min-w-0 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>{installedLabel}</span>
          <span>-</span>
          <span>{enabledLabel}</span>
          <span>-</span>
          <span>{formatAuthLabel(provider.auth)}</span>
          <span>-</span>
          <span>{versionLabel}</span>
        </div>
        {provider.message ? <p className="mt-0.5 truncate">{provider.message}</p> : null}
      </div>
      <ProviderMetric label="Models" value={formatNumber(provider.modelCount)} />
      <ProviderMetric
        label="Tools"
        value={`${formatNumber(toolCount)} (${formatNumber(provider.skillCount)} skills, ${formatNumber(provider.slashCommandCount)} slash)`}
        compactValue={formatNumber(toolCount)}
      />
      <div className="text-[11px] font-medium text-foreground">
        <span className="md:hidden text-muted-foreground">Roles: </span>
        {formatRoles(provider.supportsCoordinatorTools, provider.supportsWorker)}
      </div>
    </li>
  );
}

function ProviderMetric(props: { label: string; value: string; compactValue?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] md:block md:text-right">
      <span className="text-muted-foreground md:hidden">{props.label}</span>
      <span className="font-medium tabular-nums text-foreground md:hidden">{props.value}</span>
      <span className="hidden font-medium tabular-nums text-foreground md:inline">
        {props.compactValue ?? props.value}
      </span>
    </div>
  );
}

function formatAuthLabel(auth: ProjectIntelligenceProviderSummary["auth"]): string {
  if (auth.label) return auth.label;
  switch (auth.status) {
    case "authenticated":
      return "Authenticated";
    case "unauthenticated":
      return "Not authenticated";
    case "unknown":
    default:
      return "Auth unknown";
  }
}

function formatRoles(coordinator: boolean, worker: boolean): string {
  const parts: string[] = [];
  if (coordinator) parts.push("Coord");
  if (worker) parts.push("Worker");
  if (parts.length === 0) return "-";
  return parts.join(" + ");
}
