import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  GitCreateWorktreeInput,
  GitGetPullRequestRemoteOptionsResult,
  GitPreparePullRequestThreadInput,
  GitPullRequestRemoteSelectionRequiredError,
  GitRunStackedActionResult,
  GitRunStackedActionInput,
  GitResolvePullRequestResult,
  GitSetPullRequestRemoteInput,
} from "./git.ts";

const decodeCreateWorktreeInput = Schema.decodeUnknownSync(GitCreateWorktreeInput);
const decodePreparePullRequestThreadInput = Schema.decodeUnknownSync(
  GitPreparePullRequestThreadInput,
);
const decodeRunStackedActionInput = Schema.decodeUnknownSync(GitRunStackedActionInput);
const decodeRunStackedActionResult = Schema.decodeUnknownSync(GitRunStackedActionResult);
const decodeResolvePullRequestResult = Schema.decodeUnknownSync(GitResolvePullRequestResult);
const decodeSetPullRequestRemoteInput = Schema.decodeUnknownSync(GitSetPullRequestRemoteInput);
const decodeGetPullRequestRemoteOptionsResult = Schema.decodeUnknownSync(
  GitGetPullRequestRemoteOptionsResult,
);
const decodePullRequestRemoteSelectionRequiredError = Schema.decodeUnknownSync(
  GitPullRequestRemoteSelectionRequiredError,
);

describe("GitCreateWorktreeInput", () => {
  it("accepts omitted newBranch for existing-branch worktrees", () => {
    const parsed = decodeCreateWorktreeInput({
      cwd: "/repo",
      branch: "feature/existing",
      path: "/tmp/worktree",
    });

    expect(parsed.newBranch).toBeUndefined();
    expect(parsed.branch).toBe("feature/existing");
  });
});

describe("GitPreparePullRequestThreadInput", () => {
  it("accepts pull request references and mode", () => {
    const parsed = decodePreparePullRequestThreadInput({
      cwd: "/repo",
      reference: "#42",
      mode: "worktree",
    });

    expect(parsed.reference).toBe("#42");
    expect(parsed.mode).toBe("worktree");
  });
});

describe("GitResolvePullRequestResult", () => {
  it("decodes resolved pull request metadata", () => {
    const parsed = decodeResolvePullRequestResult({
      pullRequest: {
        number: 42,
        title: "PR threads",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseBranch: "main",
        headBranch: "feature/pr-threads",
        state: "open",
      },
    });

    expect(parsed.pullRequest.number).toBe(42);
    expect(parsed.pullRequest.headBranch).toBe("feature/pr-threads");
  });
});

describe("Git pull request remote selection", () => {
  it("decodes target remote selection inputs and options", () => {
    const input = decodeSetPullRequestRemoteInput({
      cwd: "/repo",
      remoteName: "upstream",
    });
    const options = decodeGetPullRequestRemoteOptionsResult({
      configuredRemoteName: null,
      selectedRemoteName: null,
      requiresSelection: true,
      candidates: [
        {
          remoteName: "origin",
          repositoryNameWithOwner: "tmacc/agentdynamo2",
          ownerLogin: "tmacc",
          pushRepositoryNameWithOwner: null,
        },
        {
          remoteName: "upstream",
          repositoryNameWithOwner: "pingdotgg/t3code",
          ownerLogin: "pingdotgg",
          pushRepositoryNameWithOwner: "tmacc/agentdynamo2",
        },
      ],
    });

    expect(input.remoteName).toBe("upstream");
    expect(options.requiresSelection).toBe(true);
    expect(options.candidates[1]?.pushRepositoryNameWithOwner).toBe("tmacc/agentdynamo2");
  });

  it("decodes typed selection-required errors with candidates", () => {
    const error = decodePullRequestRemoteSelectionRequiredError({
      _tag: "GitPullRequestRemoteSelectionRequiredError",
      operation: "runPrStep",
      detail: "Choose which GitHub remote should receive pull requests.",
      configuredRemoteName: null,
      selectedRemoteName: null,
      candidates: [
        {
          remoteName: "origin",
          repositoryNameWithOwner: "tmacc/agentdynamo2",
          ownerLogin: "tmacc",
          pushRepositoryNameWithOwner: null,
        },
      ],
    });

    expect(error.message).toBe("Choose which GitHub remote should receive pull requests.");
    expect(error.candidates[0]?.remoteName).toBe("origin");
  });
});

describe("GitRunStackedActionInput", () => {
  it("accepts explicit stacked actions and requires a client-provided actionId", () => {
    const parsed = decodeRunStackedActionInput({
      actionId: "action-1",
      cwd: "/repo",
      action: "create_pr",
    });

    expect(parsed.actionId).toBe("action-1");
    expect(parsed.action).toBe("create_pr");
  });
});

describe("GitRunStackedActionResult", () => {
  it("decodes a server-authored completion toast", () => {
    const parsed = decodeRunStackedActionResult({
      action: "commit_push",
      branch: {
        status: "created",
        name: "feature/server-owned-toast",
      },
      commit: {
        status: "created",
        commitSha: "89abcdef01234567",
        subject: "feat: move toast state into git manager",
      },
      push: {
        status: "pushed",
        branch: "feature/server-owned-toast",
        upstreamBranch: "origin/feature/server-owned-toast",
      },
      pr: {
        status: "skipped_not_requested",
      },
      toast: {
        title: "Pushed 89abcde to origin/feature/server-owned-toast",
        description: "feat: move toast state into git manager",
        cta: {
          kind: "run_action",
          label: "Create PR",
          action: {
            kind: "create_pr",
          },
        },
      },
    });

    expect(parsed.toast.cta.kind).toBe("run_action");
    if (parsed.toast.cta.kind === "run_action") {
      expect(parsed.toast.cta.action.kind).toBe("create_pr");
    }
  });
});
