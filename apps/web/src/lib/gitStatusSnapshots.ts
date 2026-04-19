import type { GitStatusResult } from "@t3tools/contracts";

export interface GitStatusSnapshotCache {
  readonly keys: ReadonlyArray<string>;
  readonly values: ReadonlyArray<GitStatusResult | null>;
  readonly snapshot: ReadonlyMap<string, GitStatusResult | null>;
}

export function buildStableGitStatusSnapshot(input: {
  cache: GitStatusSnapshotCache | null;
  keys: ReadonlyArray<string>;
  values: ReadonlyArray<GitStatusResult | null>;
}): {
  readonly cache: GitStatusSnapshotCache;
  readonly snapshot: ReadonlyMap<string, GitStatusResult | null>;
} {
  const { cache, keys, values } = input;
  if (
    cache &&
    cache.keys.length === keys.length &&
    cache.keys.every((key, index) => key === keys[index]) &&
    cache.values.every((value, index) => value === values[index])
  ) {
    return {
      cache,
      snapshot: cache.snapshot,
    };
  }

  const snapshot = new Map<string, GitStatusResult | null>();
  for (const [index, key] of keys.entries()) {
    snapshot.set(key, values[index] ?? null);
  }

  const nextCache: GitStatusSnapshotCache = {
    keys: [...keys],
    values: [...values],
    snapshot,
  };
  return {
    cache: nextCache,
    snapshot,
  };
}
