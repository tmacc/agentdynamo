import type {
  EnvironmentId,
  ProjectIntelligenceSectionId,
  ProjectIntelligenceViewMode,
} from "@t3tools/contracts";

export interface ProjectIntelligenceRouteSearch {
  intel?: ProjectIntelligenceViewMode | undefined;
  intelEnvironmentId?: EnvironmentId | undefined;
  intelProjectCwd?: string | undefined;
  intelSection?: ProjectIntelligenceSectionId | undefined;
}

const INTELLIGENCE_SECTION_IDS = new Set<ProjectIntelligenceSectionId>([
  "overview",
  "always-loaded",
  "codex-layer",
  "claude-layer",
  "memory",
  "code-stats",
  "warnings",
]);

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeViewMode(value: unknown): ProjectIntelligenceViewMode | undefined {
  return value === "project" || value === "thread" ? value : undefined;
}

function normalizeSection(value: unknown): ProjectIntelligenceSectionId | undefined {
  return typeof value === "string" &&
    INTELLIGENCE_SECTION_IDS.has(value as ProjectIntelligenceSectionId)
    ? (value as ProjectIntelligenceSectionId)
    : undefined;
}

export function stripProjectIntelligenceSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "intel" | "intelEnvironmentId" | "intelProjectCwd" | "intelSection"> {
  const {
    intel: _intel,
    intelEnvironmentId: _intelEnvironmentId,
    intelProjectCwd: _intelProjectCwd,
    intelSection: _intelSection,
    ...rest
  } = params;
  return rest as Omit<T, "intel" | "intelEnvironmentId" | "intelProjectCwd" | "intelSection">;
}

export function parseProjectIntelligenceRouteSearch(
  search: Record<string, unknown>,
): ProjectIntelligenceRouteSearch {
  const intel = normalizeViewMode(search.intel);
  if (!intel) {
    return {};
  }

  const intelEnvironmentId = normalizeSearchString(search.intelEnvironmentId) as
    | EnvironmentId
    | undefined;
  const intelProjectCwd = normalizeSearchString(search.intelProjectCwd);
  const intelSection = normalizeSection(search.intelSection) ?? "overview";

  return {
    intel,
    ...(intelEnvironmentId ? { intelEnvironmentId } : {}),
    ...(intelProjectCwd ? { intelProjectCwd } : {}),
    intelSection,
  };
}
