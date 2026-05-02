import { ProviderDriverKind } from "@t3tools/contracts";
import type { ProviderKind } from "@t3tools/contracts";
import type {
  ProjectIntelligenceActivation,
  ProjectIntelligenceCodeStats,
  ProjectIntelligenceHealth,
  ProjectIntelligenceOwner,
  ProjectIntelligenceProviderSummary,
  ProjectIntelligenceScope,
  ProjectIntelligenceSectionId,
  ProjectIntelligenceSurfaceKind,
  ProjectIntelligenceSurfaceSummary,
  ProjectIntelligenceWarning,
} from "@t3tools/contracts";

export const SECTION_LABELS: Record<ProjectIntelligenceSectionId, string> = {
  "context-inspector": "Context",
  providers: "Providers",
  runtime: "Runtime",
  warnings: "Warnings",
};

export const SECTION_DESCRIPTIONS: Record<ProjectIntelligenceSectionId, string> = {
  "context-inspector":
    "What is loaded into the model's context, and what you can toggle off to reclaim tokens.",
  providers: "Provider health, authentication, models, and team capabilities.",
  runtime: "Project scripts, worktree setup, and authored-source code statistics.",
  warnings: "Actionable issues found while resolving project intelligence.",
};

const CODEX_PROVIDER = ProviderDriverKind.make("codex");
const CLAUDE_PROVIDER = ProviderDriverKind.make("claudeAgent");
const CURSOR_PROVIDER = ProviderDriverKind.make("cursor");
const OPENCODE_PROVIDER = ProviderDriverKind.make("opencode");

export const PROVIDER_LABELS: Partial<Record<ProviderKind, string>> = {
  [CODEX_PROVIDER]: "Codex",
  [CLAUDE_PROVIDER]: "Claude Code",
  [CURSOR_PROVIDER]: "Cursor",
  [OPENCODE_PROVIDER]: "OpenCode",
};

export const OWNER_LABELS: Partial<Record<ProjectIntelligenceOwner, string>> = {
  [CODEX_PROVIDER]: "Codex",
  [CLAUDE_PROVIDER]: "Claude Code",
  [CURSOR_PROVIDER]: "Cursor",
  [OPENCODE_PROVIDER]: "OpenCode",
  shared: "Shared",
  dynamo: "Dynamo",
};

export const SURFACE_KIND_LABELS: Record<ProjectIntelligenceSurfaceKind, string> = {
  instruction: "Instruction",
  skill: "Skill",
  "slash-command": "Slash command",
  "custom-agent": "Custom agent",
  hook: "Hook",
  "mcp-server": "MCP server",
  memory: "Memory",
  plugin: "Plugin",
  settings: "Settings",
  "project-script": "Project script",
  "worktree-setup": "Worktree setup",
  model: "Model",
  "team-capability": "Team capability",
  "runtime-config": "Runtime config",
};

export const SURFACE_KIND_PLURALS: Record<ProjectIntelligenceSurfaceKind, string> = {
  instruction: "Instructions",
  skill: "Skills",
  "slash-command": "Slash commands",
  "custom-agent": "Custom agents",
  hook: "Hooks",
  "mcp-server": "MCP servers",
  memory: "Memory entries",
  plugin: "Plugins",
  settings: "Settings",
  "project-script": "Project scripts",
  "worktree-setup": "Worktree setup",
  model: "Models",
  "team-capability": "Team capabilities",
  "runtime-config": "Runtime config",
};

export const ACTIVATION_LABELS: Record<ProjectIntelligenceActivation, string> = {
  "always-loaded": "Always loaded",
  "on-command": "On command",
  "on-skill-match": "On skill match",
  "on-agent-invoke": "On agent invoke",
  "on-hook-event": "On hook event",
  "on-mcp-tool": "On MCP tool",
  manual: "Manual",
  "runtime-config": "Runtime config",
  "separate-memory": "Separate memory",
};

export const SCOPE_LABELS: Record<ProjectIntelligenceScope, string> = {
  "thread-workspace": "Thread workspace",
  project: "Project",
  user: "User",
  system: "System",
  "provider-runtime": "Provider runtime",
};

export const HEALTH_LABELS: Record<ProjectIntelligenceHealth, string> = {
  ok: "Healthy",
  info: "Info",
  warning: "Warning",
  error: "Error",
};

export const HEALTH_TONE_CLASS: Record<ProjectIntelligenceHealth, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  info: "text-sky-600 dark:text-sky-400",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};

export const HEALTH_DOT_CLASS: Record<ProjectIntelligenceHealth, string> = {
  ok: "bg-emerald-500",
  info: "bg-sky-500",
  warning: "bg-amber-500",
  error: "bg-destructive",
};

export const HEALTH_BADGE_CLASS: Record<ProjectIntelligenceHealth, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
};

const HEALTH_RANK: Record<ProjectIntelligenceHealth, number> = {
  error: 0,
  warning: 1,
  info: 2,
  ok: 3,
};

const TOOL_KINDS = new Set<ProjectIntelligenceSurfaceKind>([
  "skill",
  "slash-command",
  "custom-agent",
  "hook",
  "mcp-server",
  "plugin",
]);

const LOADED_CONTEXT_KINDS = new Set<ProjectIntelligenceSurfaceKind>(["instruction", "settings"]);

const RUNTIME_KINDS = new Set<ProjectIntelligenceSurfaceKind>([
  "project-script",
  "worktree-setup",
  "runtime-config",
]);

const MEMORY_KINDS = new Set<ProjectIntelligenceSurfaceKind>(["memory"]);

export function compareHealth(a: ProjectIntelligenceHealth, b: ProjectIntelligenceHealth): number {
  return (HEALTH_RANK[a] ?? 99) - (HEALTH_RANK[b] ?? 99);
}

export function getOwnerLabel(owner: ProjectIntelligenceOwner): string {
  return OWNER_LABELS[owner] ?? owner;
}

export function getProviderLabel(provider: ProviderKind | undefined | null): string {
  if (!provider) return "Unknown provider";
  return PROVIDER_LABELS[provider] ?? provider;
}

export function getSurfaceKindLabel(kind: ProjectIntelligenceSurfaceKind): string {
  return SURFACE_KIND_LABELS[kind] ?? kind;
}

export function getActivationLabel(activation: ProjectIntelligenceActivation): string {
  return ACTIVATION_LABELS[activation] ?? activation;
}

export function getScopeLabel(scope: ProjectIntelligenceScope): string {
  return SCOPE_LABELS[scope] ?? scope;
}

export function getSectionLabel(section: ProjectIntelligenceSectionId): string {
  return SECTION_LABELS[section] ?? section;
}

export function isToolSurface(surface: ProjectIntelligenceSurfaceSummary): boolean {
  return TOOL_KINDS.has(surface.kind);
}

export function isLoadedContextSurface(surface: ProjectIntelligenceSurfaceSummary): boolean {
  if (LOADED_CONTEXT_KINDS.has(surface.kind)) return true;
  return surface.activation === "always-loaded";
}

export function isRuntimeSurface(surface: ProjectIntelligenceSurfaceSummary): boolean {
  return RUNTIME_KINDS.has(surface.kind);
}

export function isMemorySurface(surface: ProjectIntelligenceSurfaceSummary): boolean {
  return MEMORY_KINDS.has(surface.kind);
}

// ─── Context Inspector ───
// Categories shown in the context dot grid. "system" is locked (always-loaded
// instructions like AGENTS.md / CLAUDE.md). The preload surface categories are
// shown in the accordion; thread-live and thread-compacted are graph-only
// runtime categories in thread view. Tools/slash-commands/hooks/plugins surface
// as a read-only Capabilities block below the inspector — they are
// provider-managed and not directly user-toggleable.

export type InspectorCategoryId =
  | "system"
  | "skills"
  | "agents"
  | "memory"
  | "mcp"
  | "thread-compacted"
  | "thread-live";

export const INSPECTOR_KINDS: ReadonlyArray<ProjectIntelligenceSurfaceKind> = [
  "instruction",
  "skill",
  "custom-agent",
  "memory",
  "mcp-server",
];

const INSPECTOR_KIND_SET = new Set<ProjectIntelligenceSurfaceKind>(INSPECTOR_KINDS);

const KIND_TO_CATEGORY: Record<ProjectIntelligenceSurfaceKind, InspectorCategoryId | null> = {
  instruction: "system",
  skill: "skills",
  "custom-agent": "agents",
  memory: "memory",
  "mcp-server": "mcp",
  // Read-only / out of scope for the inspector dot grid:
  "slash-command": null,
  hook: null,
  plugin: null,
  settings: null,
  "project-script": null,
  "worktree-setup": null,
  model: null,
  "team-capability": null,
  "runtime-config": null,
};

export const INSPECTOR_CATEGORY_ORDER: ReadonlyArray<InspectorCategoryId> = [
  "system",
  "skills",
  "agents",
  "memory",
  "mcp",
  "thread-compacted",
  "thread-live",
];

export const INSPECTOR_SURFACE_CATEGORY_ORDER: ReadonlyArray<InspectorCategoryId> = [
  "system",
  "skills",
  "agents",
  "memory",
  "mcp",
];

export const INSPECTOR_CATEGORY_LABELS: Record<InspectorCategoryId, string> = {
  system: "System",
  skills: "Skills",
  agents: "Sub-agents",
  memory: "Memory",
  mcp: "MCP servers",
  "thread-compacted": "Compacted retained",
  "thread-live": "Live thread",
};

// Category swatch colors. These correspond to CSS variables defined in
// `index.css` (see --inspector-cat-*). Kept here so JS can reference them by id.
export const INSPECTOR_CATEGORY_COLOR_VAR: Record<InspectorCategoryId, string> = {
  system: "var(--inspector-cat-system)",
  skills: "var(--inspector-cat-skills)",
  agents: "var(--inspector-cat-agents)",
  memory: "var(--inspector-cat-memory)",
  mcp: "var(--inspector-cat-mcp)",
  "thread-compacted": "var(--inspector-cat-thread-compacted)",
  "thread-live": "var(--inspector-cat-thread-live)",
};

// Surface kinds that show up in the read-only Capabilities block below the
// inspector. These are invocable surfaces that don't (typically) consume
// permanent context tokens but are listed here so users see the full
// capability set without a separate Tools tab.
const CAPABILITY_KINDS = new Set<ProjectIntelligenceSurfaceKind>([
  "slash-command",
  "hook",
  "plugin",
]);

export function isCapabilitySurface(surface: ProjectIntelligenceSurfaceSummary): boolean {
  return CAPABILITY_KINDS.has(surface.kind);
}

export function isInspectorSurface(surface: ProjectIntelligenceSurfaceSummary): boolean {
  return INSPECTOR_KIND_SET.has(surface.kind);
}

export function categorizeForInspector(
  surface: ProjectIntelligenceSurfaceSummary,
): InspectorCategoryId | null {
  return KIND_TO_CATEGORY[surface.kind];
}

export interface ProjectIntelligenceSurfaceFilter {
  readonly searchText?: string | undefined;
  readonly owners?: ReadonlyArray<ProjectIntelligenceOwner> | undefined;
  readonly kinds?: ReadonlyArray<ProjectIntelligenceSurfaceKind> | undefined;
  readonly scopes?: ReadonlyArray<ProjectIntelligenceScope> | undefined;
  readonly healths?: ReadonlyArray<ProjectIntelligenceHealth> | undefined;
}

function normalizeSearchText(value: string | null | undefined): string {
  return value ? value.toLowerCase().trim() : "";
}

export function matchesSurfaceSearch(
  surface: ProjectIntelligenceSurfaceSummary,
  searchText: string,
): boolean {
  const normalized = normalizeSearchText(searchText);
  if (normalized.length === 0) return true;
  const haystack = [
    surface.label,
    surface.path,
    surface.description ?? "",
    surface.triggerLabel ?? "",
    surface.sourceLabel ?? "",
    SURFACE_KIND_LABELS[surface.kind] ?? "",
    OWNER_LABELS[surface.owner] ?? surface.owner,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalized);
}

export function applySurfaceFilter(
  surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>,
  filter: ProjectIntelligenceSurfaceFilter,
): ProjectIntelligenceSurfaceSummary[] {
  const owners = filter.owners && filter.owners.length > 0 ? new Set(filter.owners) : null;
  const kinds = filter.kinds && filter.kinds.length > 0 ? new Set(filter.kinds) : null;
  const scopes = filter.scopes && filter.scopes.length > 0 ? new Set(filter.scopes) : null;
  const healths = filter.healths && filter.healths.length > 0 ? new Set(filter.healths) : null;
  const searchText = filter.searchText ?? "";

  return surfaces.filter((surface) => {
    if (owners && !owners.has(surface.owner)) return false;
    if (kinds && !kinds.has(surface.kind)) return false;
    if (scopes && !scopes.has(surface.scope)) return false;
    if (healths && !healths.has(surface.health)) return false;
    if (!matchesSurfaceSearch(surface, searchText)) return false;
    return true;
  });
}

export function sortSurfacesByHealth(
  surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>,
): ProjectIntelligenceSurfaceSummary[] {
  return surfaces.toSorted((a, b) => {
    const healthDelta = compareHealth(a.health, b.health);
    if (healthDelta !== 0) return healthDelta;
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export function sortProvidersByHealth(
  providers: ReadonlyArray<ProjectIntelligenceProviderSummary>,
): ProjectIntelligenceProviderSummary[] {
  return providers.toSorted((a, b) => {
    const healthDelta = compareHealth(a.health, b.health);
    if (healthDelta !== 0) return healthDelta;
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return getProviderLabel(a.provider).localeCompare(getProviderLabel(b.provider));
  });
}

export function sortWarningsBySeverity(
  warnings: ReadonlyArray<ProjectIntelligenceWarning>,
): ProjectIntelligenceWarning[] {
  const severityRank: Record<ProjectIntelligenceWarning["severity"], number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  return warnings.toSorted((a, b) => {
    const delta = (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99);
    if (delta !== 0) return delta;
    return a.message.localeCompare(b.message);
  });
}

export interface SurfaceSectionGrouping {
  readonly loadedContext: ProjectIntelligenceSurfaceSummary[];
  readonly tools: ProjectIntelligenceSurfaceSummary[];
  readonly memory: ProjectIntelligenceSurfaceSummary[];
  readonly runtime: ProjectIntelligenceSurfaceSummary[];
  readonly other: ProjectIntelligenceSurfaceSummary[];
}

export function groupSurfacesBySection(
  surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>,
): SurfaceSectionGrouping {
  const grouping: SurfaceSectionGrouping = {
    loadedContext: [],
    tools: [],
    memory: [],
    runtime: [],
    other: [],
  };
  for (const surface of surfaces) {
    if (isLoadedContextSurface(surface)) {
      grouping.loadedContext.push(surface);
      continue;
    }
    if (isToolSurface(surface)) {
      grouping.tools.push(surface);
      continue;
    }
    if (isMemorySurface(surface)) {
      grouping.memory.push(surface);
      continue;
    }
    if (isRuntimeSurface(surface)) {
      grouping.runtime.push(surface);
      continue;
    }
    grouping.other.push(surface);
  }
  return grouping;
}

export interface SurfaceKindCount {
  readonly kind: ProjectIntelligenceSurfaceKind;
  readonly label: string;
  readonly count: number;
}

export function countSurfacesByKind(
  surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>,
): SurfaceKindCount[] {
  const counts = new Map<ProjectIntelligenceSurfaceKind, number>();
  for (const surface of surfaces) {
    counts.set(surface.kind, (counts.get(surface.kind) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([kind, count]) => ({
      kind,
      label: SURFACE_KIND_PLURALS[kind] ?? kind,
      count,
    }))
    .toSorted((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface OverviewStats {
  readonly totalSurfaces: number;
  readonly loadedContextCount: number;
  readonly toolCount: number;
  readonly memoryCount: number;
  readonly runtimeCount: number;
  readonly providerCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  readonly worstHealth: ProjectIntelligenceHealth;
  readonly codeStats: ProjectIntelligenceCodeStats | null;
  readonly enabledSurfaceCount: number;
  readonly disabledSurfaceCount: number;
}

export function summarizeOverview(input: {
  surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  providers: ReadonlyArray<ProjectIntelligenceProviderSummary>;
  warnings: ReadonlyArray<ProjectIntelligenceWarning>;
  codeStats?: ProjectIntelligenceCodeStats | undefined;
}): OverviewStats {
  const grouped = groupSurfacesBySection(input.surfaces);
  const errorCount = input.warnings.filter((warning) => warning.severity === "error").length;
  const warningCount = input.warnings.filter((warning) => warning.severity === "warning").length;
  const infoCount = input.warnings.filter((warning) => warning.severity === "info").length;
  const enabledSurfaceCount = input.surfaces.filter((surface) => surface.enabled).length;
  const disabledSurfaceCount = input.surfaces.length - enabledSurfaceCount;
  const worstHealth = computeWorstHealth({
    surfaces: input.surfaces,
    providers: input.providers,
    warningCount,
    errorCount,
    infoCount,
  });
  return {
    totalSurfaces: input.surfaces.length,
    loadedContextCount: grouped.loadedContext.length,
    toolCount: grouped.tools.length,
    memoryCount: grouped.memory.length,
    runtimeCount: grouped.runtime.length,
    providerCount: input.providers.length,
    warningCount: warningCount + infoCount,
    errorCount,
    worstHealth,
    codeStats: input.codeStats ?? null,
    enabledSurfaceCount,
    disabledSurfaceCount,
  };
}

function computeWorstHealth(input: {
  surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>;
  providers: ReadonlyArray<ProjectIntelligenceProviderSummary>;
  warningCount: number;
  errorCount: number;
  infoCount: number;
}): ProjectIntelligenceHealth {
  let worst: ProjectIntelligenceHealth = "ok";
  if (input.errorCount > 0) return "error";
  for (const surface of input.surfaces) {
    if (compareHealth(surface.health, worst) < 0) worst = surface.health;
    if (worst === "error") return "error";
  }
  for (const provider of input.providers) {
    if (compareHealth(provider.health, worst) < 0) worst = provider.health;
    if (worst === "error") return "error";
  }
  if (input.warningCount > 0 && compareHealth("warning", worst) < 0) worst = "warning";
  else if (input.infoCount > 0 && compareHealth("info", worst) < 0) worst = "info";
  return worst;
}

export interface FilterOptions {
  readonly owners: ReadonlyArray<{
    value: ProjectIntelligenceOwner;
    label: string;
    count: number;
  }>;
  readonly kinds: ReadonlyArray<{
    value: ProjectIntelligenceSurfaceKind;
    label: string;
    count: number;
  }>;
  readonly scopes: ReadonlyArray<{
    value: ProjectIntelligenceScope;
    label: string;
    count: number;
  }>;
  readonly healths: ReadonlyArray<{
    value: ProjectIntelligenceHealth;
    label: string;
    count: number;
  }>;
}

export function buildFilterOptions(
  surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>,
): FilterOptions {
  const ownerCounts = new Map<ProjectIntelligenceOwner, number>();
  const kindCounts = new Map<ProjectIntelligenceSurfaceKind, number>();
  const scopeCounts = new Map<ProjectIntelligenceScope, number>();
  const healthCounts = new Map<ProjectIntelligenceHealth, number>();

  for (const surface of surfaces) {
    ownerCounts.set(surface.owner, (ownerCounts.get(surface.owner) ?? 0) + 1);
    kindCounts.set(surface.kind, (kindCounts.get(surface.kind) ?? 0) + 1);
    scopeCounts.set(surface.scope, (scopeCounts.get(surface.scope) ?? 0) + 1);
    healthCounts.set(surface.health, (healthCounts.get(surface.health) ?? 0) + 1);
  }

  const owners = Array.from(ownerCounts.entries())
    .map(([value, count]) => ({ value, label: getOwnerLabel(value), count }))
    .toSorted((a, b) => a.label.localeCompare(b.label));

  const kinds = Array.from(kindCounts.entries())
    .map(([value, count]) => ({ value, label: getSurfaceKindLabel(value), count }))
    .toSorted((a, b) => a.label.localeCompare(b.label));

  const scopes = Array.from(scopeCounts.entries())
    .map(([value, count]) => ({ value, label: getScopeLabel(value), count }))
    .toSorted((a, b) => a.label.localeCompare(b.label));

  const healths = Array.from(healthCounts.entries())
    .map(([value, count]) => ({ value, label: HEALTH_LABELS[value] ?? value, count }))
    .toSorted((a, b) => compareHealth(a.value, b.value));

  return { owners, kinds, scopes, healths };
}

export function formatTokenCount(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 10_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return value.toLocaleString();
}

export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return value.toLocaleString();
}

export function formatPath(path: string, maxLength = 60): string {
  if (path.length <= maxLength) return path;
  const head = Math.floor((maxLength - 1) / 2);
  const tail = maxLength - head - 1;
  return `${path.slice(0, head)}...${path.slice(-tail)}`;
}

export function isProviderRuntimeSurface(surface: ProjectIntelligenceSurfaceSummary): boolean {
  return surface.scope === "provider-runtime";
}

export function shouldShowOpenInEditor(surface: ProjectIntelligenceSurfaceSummary): boolean {
  if (!surface.openPath) return false;
  if (surface.openPath.trim().length === 0) return false;
  if (isProviderRuntimeSurface(surface)) return false;
  return true;
}
