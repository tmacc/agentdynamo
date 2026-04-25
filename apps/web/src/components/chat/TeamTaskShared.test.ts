import { TeamTaskId, ThreadId, type OrchestrationTeamTask } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  isDynamoManagedTeamTask,
  isNativeProviderTeamTask,
  teamTaskModelLabel,
  teamTaskSourceLabel,
} from "./TeamTaskShared";

function task(overrides: Partial<OrchestrationTeamTask> = {}): OrchestrationTeamTask {
  return {
    id: TeamTaskId.make("team-task-1"),
    parentThreadId: ThreadId.make("thread-parent"),
    childThreadId: ThreadId.make("thread-child"),
    title: "Task",
    task: "Do work",
    roleLabel: null,
    kind: "general",
    modelSelection: {
      provider: "codex",
      model: "gpt-5.5",
    },
    modelSelectionMode: "coordinator-selected",
    modelSelectionReason: "Selected by coordinator.",
    workspaceMode: "auto",
    resolvedWorkspaceMode: "shared",
    setupMode: "auto",
    resolvedSetupMode: "skip",
    source: "dynamo",
    childThreadMaterialized: true,
    nativeProviderRef: null,
    status: "running",
    latestSummary: null,
    errorText: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("TeamTaskShared", () => {
  it("identifies Dynamo-managed and native provider task sources", () => {
    const dynamo = task();
    const native = task({
      source: "native-provider",
      childThreadMaterialized: false,
      nativeProviderRef: {
        provider: "codex",
        providerItemId: "item-1",
      },
    });

    expect(isDynamoManagedTeamTask(dynamo)).toBe(true);
    expect(isNativeProviderTeamTask(dynamo)).toBe(false);
    expect(teamTaskSourceLabel(dynamo)).toBe("Dynamo");
    expect(isDynamoManagedTeamTask(native)).toBe(false);
    expect(isNativeProviderTeamTask(native)).toBe(true);
    expect(teamTaskSourceLabel(native)).toBe("Native");
    expect(teamTaskModelLabel(native)).toBe("Codex gpt-5.5 · native");
  });
});
