import { describe, expect, it } from "vitest";

import {
  isDedicatedDynamoTeamWorktreeTask,
  isMaterializedDynamoTeamTask,
} from "./teamTaskWorkspace.ts";

describe("teamTaskWorkspace", () => {
  it("treats legacy missing source and materialization fields as materialized Dynamo", () => {
    expect(isMaterializedDynamoTeamTask({})).toBe(true);
  });

  it("treats native provider tasks as not materialized Dynamo or dedicated worktree tasks", () => {
    const task = {
      source: "native-provider" as const,
      childThreadMaterialized: false,
      resolvedWorkspaceMode: "worktree" as const,
    };

    expect(isMaterializedDynamoTeamTask(task)).toBe(false);
    expect(isDedicatedDynamoTeamWorktreeTask(task)).toBe(false);
  });

  it("treats unmaterialized Dynamo tasks as not materialized", () => {
    expect(isMaterializedDynamoTeamTask({ childThreadMaterialized: false })).toBe(false);
  });

  it("returns dedicated only for materialized Dynamo worktree tasks", () => {
    expect(
      isDedicatedDynamoTeamWorktreeTask({
        source: "dynamo",
        childThreadMaterialized: true,
        resolvedWorkspaceMode: "worktree",
      }),
    ).toBe(true);
  });

  it("does not treat shared or missing workspace mode as dedicated", () => {
    expect(
      isDedicatedDynamoTeamWorktreeTask({
        source: "dynamo",
        childThreadMaterialized: true,
        resolvedWorkspaceMode: "shared",
      }),
    ).toBe(false);
    expect(
      isDedicatedDynamoTeamWorktreeTask({
        source: "dynamo",
        childThreadMaterialized: true,
      }),
    ).toBe(false);
  });
});
