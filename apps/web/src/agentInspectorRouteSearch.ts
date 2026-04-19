import { ThreadId } from "@t3tools/contracts";

export interface AgentInspectorRouteSearch {
  agentChildThreadId?: ThreadId | undefined;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function stripAgentInspectorSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "agentChildThreadId"> {
  const { agentChildThreadId: _agentChildThreadId, ...rest } = params;
  return rest as Omit<T, "agentChildThreadId">;
}

export function clearAgentInspectorSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "agentChildThreadId"> & {
  agentChildThreadId: undefined;
} {
  return {
    ...stripAgentInspectorSearchParams(params),
    agentChildThreadId: undefined,
  };
}

export function parseAgentInspectorRouteSearch(
  search: Record<string, unknown>,
): AgentInspectorRouteSearch {
  const agentChildThreadId = normalizeSearchString(search.agentChildThreadId);
  return agentChildThreadId ? { agentChildThreadId: ThreadId.make(agentChildThreadId) } : {};
}
