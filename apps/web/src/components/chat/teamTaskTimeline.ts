import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import { compareActivitiesByOrder } from "../../session-logic";
import type { TeamTaskInlineView } from "./TeamTaskInlineBlock";

export interface TeamTaskLaunchGroup {
  id: string;
  createdAt: string;
  tasks: readonly TeamTaskInlineView[];
}

function insertGroupByCreatedAt(groups: TeamTaskLaunchGroup[], group: TeamTaskLaunchGroup) {
  const insertionIndex = groups.findIndex(
    (candidate) => candidate.createdAt.localeCompare(group.createdAt) > 0,
  );
  if (insertionIndex < 0) {
    groups.push(group);
    return;
  }
  groups.splice(insertionIndex, 0, group);
}

function readTaskId(activity: OrchestrationThreadActivity): string | null {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  return payload && typeof payload.taskId === "string" && payload.taskId.length > 0
    ? payload.taskId
    : null;
}

export function deriveTeamTaskLaunchGroups(input: {
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  taskViews: readonly TeamTaskInlineView[];
}): TeamTaskLaunchGroup[] {
  const orderedActivities = [...input.activities].toSorted(compareActivitiesByOrder);
  const taskViewById = new Map(input.taskViews.map((view) => [view.task.id, view] as const));
  const assignedTaskIds = new Set<string>();
  const groups: TeamTaskLaunchGroup[] = [];

  let currentBurstId: string | null = null;
  let currentBurstCreatedAt: string | null = null;
  let currentBurstTasks: TeamTaskInlineView[] = [];

  const flushBurst = () => {
    if (currentBurstId && currentBurstCreatedAt && currentBurstTasks.length > 0) {
      groups.push({
        id: currentBurstId,
        createdAt: currentBurstCreatedAt,
        tasks: currentBurstTasks,
      });
    }
    currentBurstId = null;
    currentBurstCreatedAt = null;
    currentBurstTasks = [];
  };

  for (const activity of orderedActivities) {
    if (activity.kind !== "team.task.spawned") {
      flushBurst();
      continue;
    }

    if (currentBurstId === null) {
      currentBurstId = activity.id;
      currentBurstCreatedAt = activity.createdAt;
    }

    const taskId = readTaskId(activity);
    if (!taskId || assignedTaskIds.has(taskId)) {
      continue;
    }
    const taskView = taskViewById.get(taskId);
    if (!taskView) {
      continue;
    }

    currentBurstTasks.push(taskView);
    assignedTaskIds.add(taskId);
  }

  flushBurst();

  for (const taskView of input.taskViews) {
    if (assignedTaskIds.has(taskView.task.id)) {
      continue;
    }
    insertGroupByCreatedAt(groups, {
      id: `team-task-fallback:${taskView.task.id}`,
      createdAt: taskView.task.createdAt,
      tasks: [taskView],
    });
  }

  return groups;
}
