import type {
  EnvironmentId,
  ProjectIntelligenceSurfaceId,
  ProjectIntelligenceViewMode,
} from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "../environmentApi";

export const projectIntelligenceQueryKeys = {
  all: ["project-intelligence"] as const,
  summary: (
    environmentId: EnvironmentId | null,
    projectCwd: string | null,
    effectiveCwd: string | null,
    viewMode: ProjectIntelligenceViewMode | null,
  ) =>
    [
      "project-intelligence",
      "summary",
      environmentId ?? null,
      projectCwd,
      effectiveCwd,
      viewMode,
    ] as const,
  surface: (environmentId: EnvironmentId | null, surfaceId: ProjectIntelligenceSurfaceId | null) =>
    ["project-intelligence", "surface", environmentId ?? null, surfaceId ?? null] as const,
};

export function projectIntelligenceSummaryQueryOptions(input: {
  environmentId: EnvironmentId | null;
  projectCwd: string | null;
  effectiveCwd?: string | null;
  viewMode: ProjectIntelligenceViewMode | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: projectIntelligenceQueryKeys.summary(
      input.environmentId,
      input.projectCwd,
      input.effectiveCwd ?? null,
      input.viewMode,
    ),
    queryFn: async () => {
      if (!input.environmentId || !input.projectCwd || !input.viewMode) {
        throw new Error("Project intelligence is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.getIntelligence({
        projectCwd: input.projectCwd,
        ...(input.effectiveCwd ? { effectiveCwd: input.effectiveCwd } : {}),
        viewMode: input.viewMode,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.projectCwd !== null &&
      input.viewMode !== null,
    staleTime: 15_000,
  });
}

export function projectIntelligenceSurfaceQueryOptions(input: {
  environmentId: EnvironmentId | null;
  surfaceId: ProjectIntelligenceSurfaceId | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: projectIntelligenceQueryKeys.surface(input.environmentId, input.surfaceId),
    queryFn: async () => {
      if (!input.environmentId || !input.surfaceId) {
        throw new Error("Project intelligence surface is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.readIntelligenceSurface({
        surfaceId: input.surfaceId,
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.surfaceId !== null,
    staleTime: Infinity,
  });
}
