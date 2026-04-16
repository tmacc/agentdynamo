import type {
  ProjectGetIntelligenceResult,
  ProjectIntelligenceCodeStats,
  ProjectIntelligenceProviderRuntimeSummary,
  ProjectIntelligenceSectionId,
  ProjectIntelligenceSurfaceSummary,
} from "@t3tools/contracts";

export const PROJECT_INTELLIGENCE_SECTION_ORDER: readonly ProjectIntelligenceSectionId[] = [
  "overview",
  "always-loaded",
  "codex-layer",
  "claude-layer",
  "memory",
  "code-stats",
  "warnings",
];

export const PROJECT_INTELLIGENCE_SECTION_LABELS: Record<ProjectIntelligenceSectionId, string> = {
  overview: "Overview",
  "always-loaded": "Always Loaded",
  "codex-layer": "Codex Layer",
  "claude-layer": "Claude Layer",
  memory: "Memory",
  "code-stats": "Code Stats",
  warnings: "Warnings",
};

export function getProjectIntelligenceSectionLabel(section: ProjectIntelligenceSectionId): string {
  return PROJECT_INTELLIGENCE_SECTION_LABELS[section];
}

function hasAlias(surface: ProjectIntelligenceSurfaceSummary, alias: string): boolean {
  return (
    surface.path.endsWith(`/${alias}`) ||
    surface.path === alias ||
    surface.aliases.includes(alias) ||
    surface.sourceLabel?.includes(alias.replace(".md", " Instruction")) === true
  );
}

function isClaudeInstructionSurface(surface: ProjectIntelligenceSurfaceSummary): boolean {
  return surface.kind === "instruction" && hasAlias(surface, "CLAUDE.md");
}

export function getAlwaysLoadedSurfaces(
  result: ProjectGetIntelligenceResult,
): ReadonlyArray<ProjectIntelligenceSurfaceSummary> {
  return result.surfaces.filter((surface) => surface.activation === "always-loaded");
}

export function getCodexLayerSurfaces(
  result: ProjectGetIntelligenceResult,
): ReadonlyArray<ProjectIntelligenceSurfaceSummary> {
  return result.surfaces.filter(
    (surface) => surface.owner === "codex" && surface.kind !== "memory",
  );
}

export function getClaudeLayerSurfaces(
  result: ProjectGetIntelligenceResult,
): ReadonlyArray<ProjectIntelligenceSurfaceSummary> {
  return result.surfaces.filter(
    (surface) =>
      surface.kind !== "memory" &&
      (surface.owner === "claude" || isClaudeInstructionSurface(surface)),
  );
}

export function getMemorySurfaces(
  result: ProjectGetIntelligenceResult,
): ReadonlyArray<ProjectIntelligenceSurfaceSummary> {
  return result.surfaces.filter((surface) => surface.kind === "memory");
}

export function getSectionSurfaces(
  result: ProjectGetIntelligenceResult,
  section: ProjectIntelligenceSectionId,
): ReadonlyArray<ProjectIntelligenceSurfaceSummary> {
  switch (section) {
    case "always-loaded":
      return getAlwaysLoadedSurfaces(result);
    case "codex-layer":
      return getCodexLayerSurfaces(result);
    case "claude-layer":
      return getClaudeLayerSurfaces(result);
    case "memory":
      return getMemorySurfaces(result);
    default:
      return [];
  }
}

export function getSectionCount(
  result: ProjectGetIntelligenceResult,
  section: ProjectIntelligenceSectionId,
): number {
  switch (section) {
    case "overview":
      return 0;
    case "always-loaded":
    case "codex-layer":
    case "claude-layer":
    case "memory":
      return getSectionSurfaces(result, section).length;
    case "code-stats":
      return result.scopeSummaries.filter((scope) => scope.codeStats !== undefined).length;
    case "warnings":
      return result.warnings.length;
  }
}

export function getSettingsSurfaces(
  surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>,
): ReadonlyArray<ProjectIntelligenceSurfaceSummary> {
  return surfaces.filter((surface) => surface.kind === "settings");
}

export function getNonSettingsSurfaces(
  surfaces: ReadonlyArray<ProjectIntelligenceSurfaceSummary>,
): ReadonlyArray<ProjectIntelligenceSurfaceSummary> {
  return surfaces.filter((surface) => surface.kind !== "settings");
}

export function getProviderRuntimeForOwner(
  result: ProjectGetIntelligenceResult,
  owner: "codex" | "claude",
): ReadonlyArray<ProjectIntelligenceProviderRuntimeSummary> {
  return result.providerRuntime.filter((provider) =>
    owner === "codex" ? provider.provider === "codex" : provider.provider === "claudeAgent",
  );
}

export function getPreferredCodeStats(
  result: ProjectGetIntelligenceResult,
): ProjectIntelligenceCodeStats | null {
  return (
    result.scopeSummaries.find((scope) => scope.kind === "effective-project")?.codeStats ??
    result.scopeSummaries.find((scope) => scope.kind === "base-project")?.codeStats ??
    null
  );
}

export function formatProviderLabel(provider: ProjectIntelligenceProviderRuntimeSummary): string {
  return provider.provider === "claudeAgent" ? "Claude Code" : "Codex";
}

export function formatOwnerLabel(surface: ProjectIntelligenceSurfaceSummary): string {
  switch (surface.owner) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    default:
      return "Shared";
  }
}

export function formatActivationLabel(surface: ProjectIntelligenceSurfaceSummary): string {
  switch (surface.activation) {
    case "always-loaded":
      return "Loaded now";
    case "on-agent-invoke":
      return "On agent invoke";
    case "on-command":
      return "On command";
    case "on-event":
      return "On event";
    case "on-skill-match":
      return "On skill match";
    case "runtime-config":
      return "Runtime config";
    case "separate-memory":
      return "Separate memory";
  }
}

export function formatScopeLabel(surface: ProjectIntelligenceSurfaceSummary): string {
  switch (surface.scope) {
    case "effective-project":
      return "Thread workspace";
    case "base-project":
      return "Project";
    case "system":
      return "System";
    case "user":
      return "Global";
  }
}

/** Returns true for surfaces that are scoped to this project (not user-global or system). */
export function isProjectScopedSurface(surface: ProjectIntelligenceSurfaceSummary): boolean {
  return surface.scope === "base-project" || surface.scope === "effective-project";
}
