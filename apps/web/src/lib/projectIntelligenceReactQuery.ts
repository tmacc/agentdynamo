import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ProjectGetIntelligenceResult,
  ProjectIntelligenceSurfaceId,
  ProjectIntelligenceViewMode,
  ProjectReadIntelligenceSurfaceResult,
} from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "../environmentApi";

const DEFAULT_INTELLIGENCE_STALE_TIME_MS = 30_000;
const DEFAULT_SURFACE_STALE_TIME_MS = 30_000;

export const projectIntelligenceQueryKeys = {
  all: ["projectIntelligence"] as const,
  intelligence: (input: {
    environmentId: EnvironmentId | null;
    projectCwd: string | null;
    effectiveCwd: string | null;
    viewMode: ProjectIntelligenceViewMode;
  }) =>
    [
      "projectIntelligence",
      "summary",
      input.environmentId ?? null,
      input.projectCwd ?? null,
      input.effectiveCwd ?? null,
      input.viewMode,
    ] as const,
  surface: (input: {
    environmentId: EnvironmentId | null;
    projectCwd: string | null;
    effectiveCwd: string | null;
    viewMode: ProjectIntelligenceViewMode;
    surfaceId: ProjectIntelligenceSurfaceId | null;
  }) =>
    [
      "projectIntelligence",
      "surface",
      input.environmentId ?? null,
      input.projectCwd ?? null,
      input.effectiveCwd ?? null,
      input.viewMode,
      input.surfaceId ?? null,
    ] as const,
};

export interface ProjectIntelligenceQueryInput {
  environmentId: EnvironmentId | null;
  projectCwd: string | null;
  effectiveCwd: string | null;
  viewMode: ProjectIntelligenceViewMode;
  refresh?: boolean;
  enabled?: boolean;
  staleTime?: number;
}

export function projectIntelligenceQueryOptions(input: ProjectIntelligenceQueryInput) {
  return queryOptions({
    queryKey: projectIntelligenceQueryKeys.intelligence({
      environmentId: input.environmentId,
      projectCwd: input.projectCwd,
      effectiveCwd: input.effectiveCwd,
      viewMode: input.viewMode,
    }),
    queryFn: async (): Promise<ProjectGetIntelligenceResult> => {
      if (!input.environmentId || !input.projectCwd) {
        throw new Error("Project intelligence is unavailable for this selection.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.getIntelligence({
        projectCwd: input.projectCwd,
        ...(input.effectiveCwd ? { effectiveCwd: input.effectiveCwd } : {}),
        viewMode: input.viewMode,
        ...(input.refresh ? { refresh: true } : {}),
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.projectCwd !== null &&
      input.projectCwd.length > 0,
    staleTime: input.staleTime ?? DEFAULT_INTELLIGENCE_STALE_TIME_MS,
  });
}

export interface ProjectIntelligenceSurfaceQueryInput {
  environmentId: EnvironmentId | null;
  projectCwd: string | null;
  effectiveCwd: string | null;
  viewMode: ProjectIntelligenceViewMode;
  surfaceId: ProjectIntelligenceSurfaceId | null;
  enabled?: boolean;
  staleTime?: number;
}

export function projectIntelligenceSurfaceQueryOptions(
  input: ProjectIntelligenceSurfaceQueryInput,
) {
  return queryOptions({
    queryKey: projectIntelligenceQueryKeys.surface(input),
    queryFn: async (): Promise<ProjectReadIntelligenceSurfaceResult> => {
      if (!input.environmentId || !input.projectCwd || !input.surfaceId) {
        throw new Error("Surface preview is unavailable for this selection.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.readIntelligenceSurface({
        projectCwd: input.projectCwd,
        ...(input.effectiveCwd ? { effectiveCwd: input.effectiveCwd } : {}),
        viewMode: input.viewMode,
        surfaceId: input.surfaceId,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.projectCwd !== null &&
      input.surfaceId !== null,
    staleTime: input.staleTime ?? DEFAULT_SURFACE_STALE_TIME_MS,
  });
}
