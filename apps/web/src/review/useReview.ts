import type { ReviewStartInput, ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";

import { readEnvironmentApi } from "../environmentApi";
import type { Thread } from "../types";

export function useReview(thread: Thread | null | undefined) {
  const startReview = useCallback(
    async (input?: Omit<ReviewStartInput, "threadId">) => {
      if (!thread) throw new Error("No active thread.");
      const api = readEnvironmentApi(thread.environmentId);
      if (!api) throw new Error("Environment API is unavailable.");
      return api.orchestration.startReview({
        threadId: thread.id,
        ...(input?.prRef ? { prRef: input.prRef } : {}),
      });
    },
    [thread],
  );

  const cancelReview = useCallback(async () => {
    if (!thread) throw new Error("No active thread.");
    const api = readEnvironmentApi(thread.environmentId);
    if (!api) throw new Error("Environment API is unavailable.");
    return api.orchestration.cancelReview({ threadId: thread.id as ThreadId });
  }, [thread]);

  return {
    reviewState: thread?.reviewState ?? null,
    startReview,
    cancelReview,
  };
}
