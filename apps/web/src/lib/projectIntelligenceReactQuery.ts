import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ProjectGetIntelligenceResult,
  ProjectGetSurfaceOverridesResult,
  ProjectIntelligenceSurfaceId,
  ProjectIntelligenceViewMode,
  ProjectReadIntelligenceSurfaceResult,
  ProjectSetSurfaceEnabledResult,
} from "@t3tools/contracts";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";

import { ensureEnvironmentApi } from "../environmentApi";

const DEFAULT_INTELLIGENCE_STALE_TIME_MS = 30_000;
const DEFAULT_SURFACE_STALE_TIME_MS = 30_000;
const DEFAULT_OVERRIDES_STALE_TIME_MS = 60_000;

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
  overrides: (input: { environmentId: EnvironmentId | null; projectCwd: string | null }) =>
    [
      "projectIntelligence",
      "overrides",
      input.environmentId ?? null,
      input.projectCwd ?? null,
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

export interface ProjectSurfaceOverridesQueryInput {
  environmentId: EnvironmentId | null;
  projectCwd: string | null;
  enabled?: boolean;
  staleTime?: number;
}

export function projectSurfaceOverridesQueryOptions(input: ProjectSurfaceOverridesQueryInput) {
  return queryOptions({
    queryKey: projectIntelligenceQueryKeys.overrides({
      environmentId: input.environmentId,
      projectCwd: input.projectCwd,
    }),
    queryFn: async (): Promise<ProjectGetSurfaceOverridesResult> => {
      if (!input.environmentId || !input.projectCwd) {
        throw new Error("Surface overrides unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.projects.getSurfaceOverrides({ projectCwd: input.projectCwd });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.projectCwd !== null &&
      input.projectCwd.length > 0,
    staleTime: input.staleTime ?? DEFAULT_OVERRIDES_STALE_TIME_MS,
  });
}

export interface SetSurfaceEnabledArgs {
  environmentId: EnvironmentId;
  projectCwd: string;
  surfaceId: ProjectIntelligenceSurfaceId;
  // null clears the override (revert to discovery default).
  enabled: boolean | null;
}

/**
 * Toggle a single surface's enabled state. Optimistically updates the overrides
 * cache; invalidates the parent intelligence query so the surface list re-renders
 * with the new `enabled` flag. The savings pill, dot grid, and per-cat totals
 * recompute from the refreshed surface list.
 */
export function useSetSurfaceEnabledMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: SetSurfaceEnabledArgs): Promise<ProjectSetSurfaceEnabledResult> => {
      const api = ensureEnvironmentApi(args.environmentId);
      return api.projects.setSurfaceEnabled({
        projectCwd: args.projectCwd,
        surfaceId: args.surfaceId,
        enabled: args.enabled,
      });
    },
    onSuccess: (result, args) => {
      // Update overrides cache directly with the authoritative server response.
      queryClient.setQueryData(
        projectIntelligenceQueryKeys.overrides({
          environmentId: args.environmentId,
          projectCwd: args.projectCwd,
        }),
        result,
      );
      // Invalidate every intelligence summary tied to this project (both view
      // modes, all effective-cwds) so the surface list reflects the override.
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const [namespace, kind, environmentId, projectCwd] =
            query.queryKey as ReadonlyArray<unknown>;
          return (
            namespace === "projectIntelligence" &&
            kind === "summary" &&
            environmentId === args.environmentId &&
            projectCwd === args.projectCwd
          );
        },
      });
    },
  });
}
