import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ProjectIntelligenceSectionId,
  ProjectIntelligenceSurfaceId,
  ProjectIntelligenceViewMode,
} from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import {
  buildProjectIntelligenceRouteSearch,
  clearProjectIntelligenceRouteSearchParams,
  DEFAULT_PROJECT_INTELLIGENCE_SECTION,
  type ProjectIntelligenceRouteSearch,
} from "../projectIntelligenceRouteSearch";

export interface ProjectIntelligenceTarget {
  readonly viewMode: ProjectIntelligenceViewMode;
  readonly environmentId: EnvironmentId | null;
  readonly projectCwd: string;
  readonly effectiveCwd?: string | null;
  readonly section?: ProjectIntelligenceSectionId | null;
  readonly surfaceId?: ProjectIntelligenceSurfaceId | null;
}

export interface UseProjectIntelligenceNavigationResult {
  readonly isOpen: boolean;
  readonly viewMode: ProjectIntelligenceViewMode | null;
  readonly environmentId: EnvironmentId | null;
  readonly projectCwd: string | null;
  readonly effectiveCwd: string | null;
  readonly section: ProjectIntelligenceSectionId;
  readonly surfaceId: ProjectIntelligenceSurfaceId | null;
  readonly open: (target: ProjectIntelligenceTarget) => void;
  readonly close: () => void;
  readonly setSection: (section: ProjectIntelligenceSectionId) => void;
  readonly setSurfaceId: (surfaceId: ProjectIntelligenceSurfaceId | null) => void;
}

interface SearchSlice extends ProjectIntelligenceRouteSearch {
  [key: string]: unknown;
}

export function useProjectIntelligenceNavigation(): UseProjectIntelligenceNavigationResult {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as SearchSlice;

  const viewMode = (search.intel ?? null) as ProjectIntelligenceViewMode | null;
  const environmentId = (search.intelEnvironmentId ?? null) as EnvironmentId | null;
  const projectCwd = search.intelProjectCwd ?? null;
  const effectiveCwd = search.intelEffectiveCwd ?? null;
  const section = (search.intelSection ??
    DEFAULT_PROJECT_INTELLIGENCE_SECTION) as ProjectIntelligenceSectionId;
  const surfaceId = (search.intelSurfaceId ?? null) as ProjectIntelligenceSurfaceId | null;

  const isOpen = viewMode !== null && projectCwd !== null;

  const open = useCallback(
    (target: ProjectIntelligenceTarget) => {
      const next = buildProjectIntelligenceRouteSearch({
        viewMode: target.viewMode,
        environmentId: target.environmentId,
        projectCwd: target.projectCwd,
        effectiveCwd: target.effectiveCwd ?? null,
        section: target.section ?? DEFAULT_PROJECT_INTELLIGENCE_SECTION,
        surfaceId: target.surfaceId ?? null,
      });
      void navigate({
        to: ".",
        search: (previous) => ({
          ...(previous as Record<string, unknown>),
          intel: next.intel,
          intelEnvironmentId: next.intelEnvironmentId,
          intelProjectCwd: next.intelProjectCwd,
          intelEffectiveCwd: next.intelEffectiveCwd,
          intelSection: next.intelSection,
          intelSurfaceId: next.intelSurfaceId,
        }),
      }).catch(() => undefined);
    },
    [navigate],
  );

  const close = useCallback(() => {
    void navigate({
      to: ".",
      search: (previous) =>
        clearProjectIntelligenceRouteSearchParams(previous as Record<string, unknown>),
      replace: true,
    }).catch(() => undefined);
  }, [navigate]);

  const setSection = useCallback(
    (next: ProjectIntelligenceSectionId) => {
      void navigate({
        to: ".",
        search: (previous) => ({
          ...(previous as Record<string, unknown>),
          intelSection: next,
          // Reset surface focus when switching sections to avoid stale detail.
          intelSurfaceId: undefined,
        }),
      }).catch(() => undefined);
    },
    [navigate],
  );

  const setSurfaceId = useCallback(
    (next: ProjectIntelligenceSurfaceId | null) => {
      void navigate({
        to: ".",
        search: (previous) => ({
          ...(previous as Record<string, unknown>),
          intelSurfaceId: next ?? undefined,
        }),
      }).catch(() => undefined);
    },
    [navigate],
  );

  return useMemo(
    () => ({
      isOpen,
      viewMode,
      environmentId,
      projectCwd,
      effectiveCwd,
      section,
      surfaceId,
      open,
      close,
      setSection,
      setSurfaceId,
    }),
    [
      close,
      effectiveCwd,
      environmentId,
      isOpen,
      open,
      projectCwd,
      section,
      setSection,
      setSurfaceId,
      surfaceId,
      viewMode,
    ],
  );
}
