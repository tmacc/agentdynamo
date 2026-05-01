import { ProviderDriverKind } from "@t3tools/contracts";
import type { OrchestrationTeamTask } from "@t3tools/contracts";
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import {
  isDedicatedDynamoTeamWorktreeTask,
  isMaterializedDynamoTeamTask,
} from "@t3tools/shared/team-task-workspace";

export { isDedicatedDynamoTeamWorktreeTask, isMaterializedDynamoTeamTask };

export const TEAM_TASK_ACTIVE_STATUSES = new Set(["queued", "starting", "running", "waiting"]);

export function isActiveTeamTask(task: OrchestrationTeamTask): boolean {
  return TEAM_TASK_ACTIVE_STATUSES.has(task.status);
}

export const isDynamoManagedTeamTask = isMaterializedDynamoTeamTask;

export function isNativeProviderTeamTask(task: OrchestrationTeamTask): boolean {
  return task.source === "native-provider";
}

export function teamTaskSourceLabel(task: OrchestrationTeamTask): string {
  return isNativeProviderTeamTask(task) ? "Native" : "Dynamo";
}

export function teamTaskStatusLabel(status: OrchestrationTeamTask["status"]): string {
  switch (status) {
    case "queued":
      return "queued";
    case "starting":
      return "starting";
    case "running":
      return "running";
    case "waiting":
      return "waiting for input";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

export function teamTaskStatusClassName(status: OrchestrationTeamTask["status"]): string {
  switch (status) {
    case "queued":
    case "starting":
      return "text-muted-foreground";
    case "running":
      return "text-primary";
    case "waiting":
      return "text-amber-500";
    case "completed":
      return "text-emerald-500";
    case "failed":
      return "text-destructive";
    case "cancelled":
      return "text-muted-foreground/60";
  }
}

export function teamTaskProviderDriver(task: OrchestrationTeamTask): ProviderDriverKind | null {
  return ProviderDriverKind.make(String(task.modelSelection.instanceId));
}

export function teamTaskModelLabel(task: OrchestrationTeamTask): string {
  const provider = teamTaskProviderDriver(task);
  const providerLabel = provider ? (PROVIDER_DISPLAY_NAMES[provider] ?? provider) : "Provider";
  const sourceLabel = isNativeProviderTeamTask(task) ? " · native" : "";
  return `${providerLabel} ${task.modelSelection.model}${sourceLabel}`;
}
