import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";

/**
 * Search params for the tiled view. The URL form is a comma-separated list of
 * `env:thread` keys plus a numeric focus index. Storing as a string avoids
 * forcing TanStack Router to round-trip an array through JSON.
 */
export interface TileRouteSearch {
  threads?: string | undefined;
  focus?: number | undefined;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Parse a comma-separated list of scoped thread keys into validated refs, deduped. */
export function parseTileThreadList(value: unknown): ScopedThreadRef[] {
  const raw = normalizeSearchString(value);
  if (!raw) return [];

  const seen = new Set<string>();
  const result: ScopedThreadRef[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const ref = parseScopedThreadKey(trimmed);
    if (!ref) continue;
    const key = scopedThreadKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function parseFocusIndex(value: unknown, max: number): number | undefined {
  if (max <= 0) return undefined;
  let parsed: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) {
    parsed = Math.trunc(value);
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return undefined;
    parsed = Math.trunc(num);
  }
  if (parsed === null) return undefined;
  if (parsed < 0) return 0;
  if (parsed >= max) return max - 1;
  return parsed;
}

/**
 * Validates the route's search params. Drops invalid thread keys silently and
 * normalizes the comma-separated list to a canonical form. Returns an empty
 * object when no threads are present (so single-thread routes don't grow stale
 * search params).
 */
export function parseTileRouteSearch(search: Record<string, unknown>): TileRouteSearch {
  const threadList = parseTileThreadList(search.threads);
  if (threadList.length === 0) return {};
  const canonicalThreads = threadList.map(scopedThreadKey).join(",");
  const focus = parseFocusIndex(search.focus, threadList.length) ?? 0;
  return { threads: canonicalThreads, focus };
}

/** Serialize tile state to the URL search form. */
export function serializeTileRouteSearch(state: {
  tiles: readonly ScopedThreadRef[];
  focusedIndex: number;
}): { threads: string; focus: number } {
  const threads = state.tiles.map(scopedThreadKey).join(",");
  const clampedFocus = Math.max(0, Math.min(state.focusedIndex, state.tiles.length - 1));
  return { threads, focus: clampedFocus };
}

export function stripTileRouteSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "threads" | "focus"> {
  const { threads: _threads, focus: _focus, ...rest } = params;
  return rest as Omit<T, "threads" | "focus">;
}

export function clearTileRouteSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "threads" | "focus"> & { threads: undefined; focus: undefined } {
  return {
    ...stripTileRouteSearchParams(params),
    threads: undefined,
    focus: undefined,
  };
}
