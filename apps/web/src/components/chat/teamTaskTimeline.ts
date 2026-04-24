import type { OrchestrationTeamTask } from "@t3tools/contracts";

import { teamTaskStatusLabel } from "./TeamTaskShared";

export function formatTeamTaskTimelineLabel(task: OrchestrationTeamTask): string {
  return `${task.roleLabel || task.title}: ${teamTaskStatusLabel(task.status)}`;
}
