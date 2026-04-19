import type { ProjectionThreadActivity } from "../persistence/Services/ProjectionThreadActivities.ts";

export function compareProjectionActivitiesByOrder(
  left: ProjectionThreadActivity,
  right: ProjectionThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return (
    left.createdAt.localeCompare(right.createdAt) || left.activityId.localeCompare(right.activityId)
  );
}
