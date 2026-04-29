import type { TeamTaskResolvedWorkspaceMode, TeamTaskSource } from "@t3tools/contracts";

export interface TeamTaskWorkspacePolicyShape {
  readonly source?: TeamTaskSource | null | undefined;
  readonly childThreadMaterialized?: boolean | null | undefined;
  readonly resolvedWorkspaceMode?: TeamTaskResolvedWorkspaceMode | null | undefined;
}

export function isMaterializedDynamoTeamTask(task: TeamTaskWorkspacePolicyShape): boolean {
  return (task.source ?? "dynamo") === "dynamo" && (task.childThreadMaterialized ?? true) === true;
}

export function isDedicatedDynamoTeamWorktreeTask(task: TeamTaskWorkspacePolicyShape): boolean {
  return isMaterializedDynamoTeamTask(task) && task.resolvedWorkspaceMode === "worktree";
}
