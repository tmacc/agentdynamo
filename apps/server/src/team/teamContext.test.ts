import { describe, expect, it } from "vitest";

import { resolveTeamWorkspacePolicy } from "./teamContext.ts";

describe("resolveTeamWorkspacePolicy", () => {
  it("runs setup for auto coding tasks in git projects with configured setup", () => {
    expect(
      resolveTeamWorkspacePolicy({
        taskKind: "coding",
        workspaceMode: "auto",
        setupMode: "auto",
        isGitProject: true,
        projectHasWorktreeSetup: true,
      }),
    ).toEqual({
      resolvedWorkspaceMode: "worktree",
      resolvedSetupMode: "run",
    });
  });

  it("skips setup for shared tasks even when setup was requested", () => {
    expect(
      resolveTeamWorkspacePolicy({
        taskKind: "coding",
        workspaceMode: "shared",
        setupMode: "run",
        isGitProject: true,
        projectHasWorktreeSetup: true,
      }),
    ).toEqual({
      resolvedWorkspaceMode: "shared",
      resolvedSetupMode: "skip",
    });
  });

  it("keeps non-git auto tasks shared and skips setup", () => {
    expect(
      resolveTeamWorkspacePolicy({
        taskKind: "coding",
        workspaceMode: "auto",
        setupMode: "run",
        isGitProject: false,
        projectHasWorktreeSetup: true,
      }),
    ).toEqual({
      resolvedWorkspaceMode: "shared",
      resolvedSetupMode: "skip",
    });
  });

  it("assumes explicit worktree availability is prevalidated by the spawn service", () => {
    expect(
      resolveTeamWorkspacePolicy({
        taskKind: "coding",
        workspaceMode: "worktree",
        setupMode: "run",
        isGitProject: false,
        projectHasWorktreeSetup: true,
      }),
    ).toEqual({
      resolvedWorkspaceMode: "worktree",
      resolvedSetupMode: "run",
    });
  });
});
