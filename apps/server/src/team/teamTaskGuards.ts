import type { OrchestrationTeamTask } from "@t3tools/contracts";

export function isMaterializedDynamoTeamTask(task: OrchestrationTeamTask): boolean {
  return (task.source ?? "dynamo") === "dynamo" && task.childThreadMaterialized === true;
}
