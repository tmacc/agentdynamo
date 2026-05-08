import { describe, expect, it } from "vitest";

import { resolvedPullRequestToThreadPr } from "./ThreadStatusIndicators";

describe("resolvedPullRequestToThreadPr", () => {
  it("maps a resolved pull request when the head branch matches the thread branch", () => {
    expect(
      resolvedPullRequestToThreadPr("feature/pr-status", {
        pullRequest: {
          number: 42,
          title: "Track PR status",
          url: "https://github.com/example/project/pull/42",
          baseBranch: "main",
          headBranch: "feature/pr-status",
          state: "open",
        },
      }),
    ).toEqual({
      number: 42,
      title: "Track PR status",
      url: "https://github.com/example/project/pull/42",
      baseRef: "main",
      headRef: "feature/pr-status",
      state: "open",
    });
  });

  it("ignores resolved pull requests for a different branch", () => {
    expect(
      resolvedPullRequestToThreadPr("feature/current-thread", {
        pullRequest: {
          number: 42,
          title: "Track PR status",
          url: "https://github.com/example/project/pull/42",
          baseBranch: "main",
          headBranch: "feature/other-thread",
          state: "open",
        },
      }),
    ).toBeNull();
  });
});
