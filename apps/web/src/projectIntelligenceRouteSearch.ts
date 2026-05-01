import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ProjectIntelligenceSectionId,
  ProjectIntelligenceSurfaceId,
  ProjectIntelligenceViewMode,
} from "@t3tools/contracts";

export const PROJECT_INTELLIGENCE_SECTION_IDS: ReadonlyArray<ProjectIntelligenceSectionId> = [
  "context-inspector",
  "providers",
  "runtime",
  "warnings",
];

export const DEFAULT_PROJECT_INTELLIGENCE_SECTION: ProjectIntelligenceSectionId =
  "context-inspector";

// Old section ids that have been folded into the inspector. URLs/bookmarks
// referencing these get redirected to context-inspector instead of
// rejected.
const LEGACY_SECTION_REDIRECTS: Record<string, ProjectIntelligenceSectionId> = {
  overview: "context-inspector",
  "loaded-context": "context-inspector",
  tools: "context-inspector",
  memory: "context-inspector",
  "code-stats": "runtime",
};

export interface ProjectIntelligenceRouteSearch {
  intel?: ProjectIntelligenceViewMode | undefined;
  intelEnvironmentId?: EnvironmentId | undefined;
  intelProjectCwd?: string | undefined;
  intelEffectiveCwd?: string | undefined;
  intelSection?: ProjectIntelligenceSectionId | undefined;
  intelSurfaceId?: ProjectIntelligenceSurfaceId | undefined;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeViewMode(value: unknown): ProjectIntelligenceViewMode | undefined {
  if (value === "project" || value === "thread") {
    return value;
  }
  return undefined;
}

function normalizeSection(value: unknown): ProjectIntelligenceSectionId | undefined {
  if (typeof value !== "string") return undefined;
  if ((PROJECT_INTELLIGENCE_SECTION_IDS as readonly string[]).includes(value)) {
    return value as ProjectIntelligenceSectionId;
  }
  return LEGACY_SECTION_REDIRECTS[value];
}

export function parseProjectIntelligenceRouteSearch(
  search: Record<string, unknown>,
): ProjectIntelligenceRouteSearch {
  const intel = normalizeViewMode(search.intel);
  if (!intel) return {};
  const intelEnvironmentId = normalizeString(search.intelEnvironmentId) as
    | EnvironmentId
    | undefined;
  const intelProjectCwd = normalizeString(search.intelProjectCwd);
  const intelEffectiveCwd = normalizeString(search.intelEffectiveCwd);
  const intelSection = normalizeSection(search.intelSection);
  const intelSurfaceIdRaw = normalizeString(search.intelSurfaceId);
  const intelSurfaceId = intelSurfaceIdRaw
    ? (intelSurfaceIdRaw as ProjectIntelligenceSurfaceId)
    : undefined;

  return {
    intel,
    ...(intelEnvironmentId ? { intelEnvironmentId } : {}),
    ...(intelProjectCwd ? { intelProjectCwd } : {}),
    ...(intelEffectiveCwd ? { intelEffectiveCwd } : {}),
    ...(intelSection ? { intelSection } : {}),
    ...(intelSurfaceId ? { intelSurfaceId } : {}),
  };
}

export function stripProjectIntelligenceRouteSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<
  T,
  | "intel"
  | "intelEnvironmentId"
  | "intelProjectCwd"
  | "intelEffectiveCwd"
  | "intelSection"
  | "intelSurfaceId"
> {
  const {
    intel: _intel,
    intelEnvironmentId: _intelEnvironmentId,
    intelProjectCwd: _intelProjectCwd,
    intelEffectiveCwd: _intelEffectiveCwd,
    intelSection: _intelSection,
    intelSurfaceId: _intelSurfaceId,
    ...rest
  } = params;
  return rest as Omit<
    T,
    | "intel"
    | "intelEnvironmentId"
    | "intelProjectCwd"
    | "intelEffectiveCwd"
    | "intelSection"
    | "intelSurfaceId"
  >;
}

export function clearProjectIntelligenceRouteSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<
  T,
  | "intel"
  | "intelEnvironmentId"
  | "intelProjectCwd"
  | "intelEffectiveCwd"
  | "intelSection"
  | "intelSurfaceId"
> & {
  intel: undefined;
  intelEnvironmentId: undefined;
  intelProjectCwd: undefined;
  intelEffectiveCwd: undefined;
  intelSection: undefined;
  intelSurfaceId: undefined;
} {
  return {
    ...stripProjectIntelligenceRouteSearchParams(params),
    intel: undefined,
    intelEnvironmentId: undefined,
    intelProjectCwd: undefined,
    intelEffectiveCwd: undefined,
    intelSection: undefined,
    intelSurfaceId: undefined,
  };
}

export function buildProjectIntelligenceRouteSearch(input: {
  viewMode: ProjectIntelligenceViewMode;
  environmentId: EnvironmentId | null;
  projectCwd: string;
  effectiveCwd?: string | null;
  section?: ProjectIntelligenceSectionId | null;
  surfaceId?: ProjectIntelligenceSurfaceId | null;
}): ProjectIntelligenceRouteSearch {
  const projectCwd = input.projectCwd.trim();
  if (projectCwd.length === 0) return {};
  const effectiveCwdRaw = input.effectiveCwd?.trim() ?? "";
  const result: ProjectIntelligenceRouteSearch = {
    intel: input.viewMode,
    intelProjectCwd: projectCwd,
  };
  if (input.environmentId) {
    result.intelEnvironmentId = input.environmentId;
  }
  if (effectiveCwdRaw.length > 0) {
    result.intelEffectiveCwd = effectiveCwdRaw;
  }
  if (input.section) {
    result.intelSection = input.section;
  }
  if (input.surfaceId) {
    result.intelSurfaceId = input.surfaceId;
  }
  return result;
}
