import type { OrchestrationThreadActivity } from "@t3tools/contracts";

export function materializeActivitySequence<TActivity extends OrchestrationThreadActivity>(
  activity: TActivity,
  fallbackSequence: number,
): TActivity {
  if (activity.sequence !== undefined) {
    return activity;
  }

  return {
    ...activity,
    sequence: fallbackSequence,
  } as TActivity;
}
