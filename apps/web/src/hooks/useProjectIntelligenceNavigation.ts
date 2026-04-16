import type {
  EnvironmentId,
  ProjectIntelligenceSectionId,
  ProjectIntelligenceViewMode,
} from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import {
  parseProjectIntelligenceRouteSearch,
  stripProjectIntelligenceSearchParams,
} from "../projectIntelligenceRouteSearch";

export interface OpenProjectIntelligenceInput {
  readonly mode: ProjectIntelligenceViewMode;
  readonly environmentId?: EnvironmentId | null;
  readonly projectCwd?: string | null;
  readonly section?: ProjectIntelligenceSectionId;
}

export function useProjectIntelligenceNavigation() {
  const navigate = useNavigate();
  const intelligenceSearch = useSearch({
    strict: false,
    select: (search) => parseProjectIntelligenceRouteSearch(search),
  });

  const closeProjectIntelligence = useCallback(() => {
    void navigate({
      search: ((previous: Record<string, unknown>) => ({
        ...stripProjectIntelligenceSearchParams(previous),
        intel: undefined,
        intelEnvironmentId: undefined,
        intelProjectCwd: undefined,
        intelSection: undefined,
      })) as never,
    });
  }, [navigate]);

  const openProjectIntelligence = useCallback(
    (input: OpenProjectIntelligenceInput) => {
      void navigate({
        search: ((previous: Record<string, unknown>) => {
          return {
            ...stripProjectIntelligenceSearchParams(previous),
            intel: input.mode,
            intelEnvironmentId: input.environmentId ?? undefined,
            intelProjectCwd: input.projectCwd ?? undefined,
            intelSection: input.section ?? intelligenceSearch.intelSection ?? "overview",
          };
        }) as never,
      });
    },
    [intelligenceSearch.intelSection, navigate],
  );

  const setProjectIntelligenceSection = useCallback(
    (section: ProjectIntelligenceSectionId) => {
      if (!intelligenceSearch.intel) {
        return;
      }
      void navigate({
        search: ((previous: Record<string, unknown>) => {
          return {
            ...stripProjectIntelligenceSearchParams(previous),
            intel: intelligenceSearch.intel,
            intelEnvironmentId: intelligenceSearch.intelEnvironmentId ?? undefined,
            intelProjectCwd: intelligenceSearch.intelProjectCwd ?? undefined,
            intelSection: section,
          };
        }) as never,
      });
    },
    [
      intelligenceSearch.intel,
      intelligenceSearch.intelEnvironmentId,
      intelligenceSearch.intelProjectCwd,
      navigate,
    ],
  );

  return {
    intelligenceSearch,
    activeSection: intelligenceSearch.intelSection ?? "overview",
    isProjectIntelligenceOpen: intelligenceSearch.intel !== undefined,
    openProjectIntelligence,
    closeProjectIntelligence,
    setProjectIntelligenceSection,
  };
}
