import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

/**
 * Search-param schema for the planning board view. The board replaces the
 * thread / index outlet whenever `view === "board"`, scoped to the (env,
 * project) pair identified by `boardEnvironmentId` + `boardProjectId`.
 *
 * When `view === "board"` but one of the id fields is missing, the layout
 * falls back to showing the project inferred from the active thread's
 * project ref (handled at render time).
 */
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
