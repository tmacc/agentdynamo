import type { EnvironmentId, FeatureCardStoredColumn, ProjectId } from "@t3tools/contracts";
import { create } from "zustand";

import { boardKey } from "./boardStore";

export interface BoardUiState {
  readonly pendingAddColumnByKey: Record<string, FeatureCardStoredColumn | undefined>;
  readonly requestAddCard: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    column: FeatureCardStoredColumn,
  ) => void;
  readonly peekAddCardIntent: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
  ) => FeatureCardStoredColumn | undefined;
  readonly clearAddCardIntent: (environmentId: EnvironmentId, projectId: ProjectId) => void;
}

export const useBoardUiStore = create<BoardUiState>((set, get) => ({
  pendingAddColumnByKey: {},

  requestAddCard: (environmentId, projectId, column) => {
    const key = boardKey(environmentId, projectId);
    set((state) => ({
      pendingAddColumnByKey: { ...state.pendingAddColumnByKey, [key]: column },
    }));
  },

  peekAddCardIntent: (environmentId, projectId) => {
    const key = boardKey(environmentId, projectId);
    return get().pendingAddColumnByKey[key];
  },

  clearAddCardIntent: (environmentId, projectId) => {
    const key = boardKey(environmentId, projectId);
    set((state) => {
      const next = { ...state.pendingAddColumnByKey };
      delete next[key];
      return { pendingAddColumnByKey: next };
    });
  },
}));
