import type { GitStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildStableGitStatusSnapshot } from "./gitStatusSnapshots";

describe("buildStableGitStatusSnapshot", () => {
  it("reuses the cached snapshot when keys and values are unchanged", () => {
    const status = { branch: "feature/a" } as GitStatusResult;
    const first = buildStableGitStatusSnapshot({
      cache: null,
      keys: ["env:/repo"],
      values: [status],
    });

    const second = buildStableGitStatusSnapshot({
      cache: first.cache,
      keys: ["env:/repo"],
      values: [status],
    });

    expect(second.snapshot).toBe(first.snapshot);
    expect(second.cache).toBe(first.cache);
  });

  it("creates a new snapshot when the key set changes", () => {
    const first = buildStableGitStatusSnapshot({
      cache: null,
      keys: ["env:/repo-a"],
      values: [null],
    });

    const second = buildStableGitStatusSnapshot({
      cache: first.cache,
      keys: ["env:/repo-a", "env:/repo-b"],
      values: [null, null],
    });

    expect(second.snapshot).not.toBe(first.snapshot);
    expect([...second.snapshot.keys()]).toEqual(["env:/repo-a", "env:/repo-b"]);
  });

  it("creates a new snapshot when a per-key value reference changes", () => {
    const firstStatus = { branch: "feature/a" } as GitStatusResult;
    const secondStatus = { branch: "feature/a" } as GitStatusResult;
    const first = buildStableGitStatusSnapshot({
      cache: null,
      keys: ["env:/repo"],
      values: [firstStatus],
    });

    const second = buildStableGitStatusSnapshot({
      cache: first.cache,
      keys: ["env:/repo"],
      values: [secondStatus],
    });

    expect(second.snapshot).not.toBe(first.snapshot);
    expect(second.snapshot.get("env:/repo")).toBe(secondStatus);
  });
});
