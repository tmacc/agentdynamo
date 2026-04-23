import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

export interface BoardRouteSearch {
  view?: "board" | undefined;
  boardEnvironmentId?: EnvironmentId | undefined;
  boardProjectId?: ProjectId | undefined;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseBoardRouteSearch(search: Record<string, unknown>): BoardRouteSearch {
  if (search.view !== "board") return {};
  const boardEnvironmentId = normalizeString(search.boardEnvironmentId) as
    | EnvironmentId
    | undefined;
  const boardProjectId = normalizeString(search.boardProjectId) as ProjectId | undefined;
  return {
    view: "board",
    ...(boardEnvironmentId ? { boardEnvironmentId } : {}),
    ...(boardProjectId ? { boardProjectId } : {}),
  };
}

export function stripBoardRouteSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "view" | "boardEnvironmentId" | "boardProjectId"> {
  const {
    view: _view,
    boardEnvironmentId: _boardEnvironmentId,
    boardProjectId: _boardProjectId,
    ...rest
  } = params;
  return rest as Omit<T, "view" | "boardEnvironmentId" | "boardProjectId">;
}

export function clearBoardRouteSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "view" | "boardEnvironmentId" | "boardProjectId"> & {
  view: undefined;
  boardEnvironmentId: undefined;
  boardProjectId: undefined;
} {
  return {
    ...stripBoardRouteSearchParams(params),
    view: undefined,
    boardEnvironmentId: undefined,
    boardProjectId: undefined,
  };
}
