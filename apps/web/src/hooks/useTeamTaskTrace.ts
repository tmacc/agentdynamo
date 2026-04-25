import type {
  EnvironmentId,
  OrchestrationNativeSubagentTraceItem,
  TeamTaskId,
  ThreadId,
} from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { readEnvironmentApi } from "../environmentApi";

export interface TeamTaskTraceState {
  readonly items: ReadonlyArray<OrchestrationNativeSubagentTraceItem>;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly error: string | null;
}

export function useTeamTaskTrace(input: {
  readonly environmentId: EnvironmentId;
  readonly parentThreadId: ThreadId;
  readonly taskId: TeamTaskId | null;
}): TeamTaskTraceState {
  const [state, setState] = useState<TeamTaskTraceState>({
    items: [],
    status: "idle",
    error: null,
  });

  const key = useMemo(
    () => (input.taskId ? `${input.environmentId}:${input.parentThreadId}:${input.taskId}` : null),
    [input.environmentId, input.parentThreadId, input.taskId],
  );

  useEffect(() => {
    if (!input.taskId || !key) {
      setState({ items: [], status: "idle", error: null });
      return;
    }

    const api = readEnvironmentApi(input.environmentId);
    if (!api) {
      setState({ items: [], status: "error", error: "Environment API unavailable." });
      return;
    }

    setState((current) => ({ ...current, status: "loading", error: null }));
    const unsubscribe = api.orchestration.subscribeTeamTaskTrace(
      {
        parentThreadId: input.parentThreadId,
        taskId: input.taskId,
      },
      (event) => {
        if (event.kind === "snapshot") {
          setState({ items: event.snapshot.items, status: "ready", error: null });
          return;
        }
        setState((current) => {
          switch (event.event.type) {
            case "thread.team-task-native-trace-item-upserted": {
              const nextItem = event.event.payload.item;
              const items = [
                ...current.items.filter((item) => item.id !== nextItem.id),
                nextItem,
              ].toSorted(
                (left, right) =>
                  left.sequence - right.sequence ||
                  left.createdAt.localeCompare(right.createdAt) ||
                  left.id.localeCompare(right.id),
              );
              return { ...current, items, status: "ready" };
            }
            case "thread.team-task-native-trace-content-appended": {
              const { traceItemId, delta, updatedAt } = event.event.payload;
              return {
                ...current,
                status: "ready",
                items: current.items.map((item) =>
                  item.id === traceItemId
                    ? { ...item, text: `${item.text ?? ""}${delta}`, updatedAt }
                    : item,
                ),
              };
            }
            case "thread.team-task-native-trace-item-completed": {
              const { traceItemId, status, detail, outputSummary, completedAt, updatedAt } =
                event.event.payload;
              return {
                ...current,
                status: "ready",
                items: current.items.map((item) =>
                  item.id === traceItemId
                    ? {
                        ...item,
                        status,
                        detail: detail !== undefined ? detail : item.detail,
                        outputSummary:
                          outputSummary !== undefined ? outputSummary : item.outputSummary,
                        completedAt,
                        updatedAt,
                      }
                    : item,
                ),
              };
            }
            default:
              return current;
          }
        });
      },
      {
        onResubscribe: () => {
          setState((current) => ({ ...current, status: "loading", error: null }));
        },
      },
    );

    return unsubscribe;
  }, [input.environmentId, input.parentThreadId, input.taskId, key]);

  return state;
}
