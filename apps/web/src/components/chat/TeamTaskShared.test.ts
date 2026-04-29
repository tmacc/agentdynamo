import {
  EnvironmentId,
  TeamTaskId,
  ThreadId,
  type OrchestrationTeamTask,
} from "@t3tools/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TeamAgentsSidebar } from "./TeamAgentsSidebar";
import { TeamAgentPills } from "./TeamAgentPills";
import { TeamTaskInlineBlocks } from "./TeamTaskInlineBlock";
import { TeamTaskInspector } from "./TeamTaskInspector";
import {
  isDedicatedDynamoTeamWorktreeTask,
  isDynamoManagedTeamTask,
  isMaterializedDynamoTeamTask,
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

  it("treats legacy Dynamo source defaults as materialized only when the child thread exists", () => {
    const legacyMissingSource = {
      ...task(),
    } as OrchestrationTeamTask & { source?: OrchestrationTeamTask["source"] };
    delete legacyMissingSource.source;
    const pendingDynamo = task({ childThreadMaterialized: false });

    expect(isMaterializedDynamoTeamTask(legacyMissingSource)).toBe(true);
    expect(isDynamoManagedTeamTask(legacyMissingSource)).toBe(true);
    expect(isMaterializedDynamoTeamTask(pendingDynamo)).toBe(false);
    expect(isDedicatedDynamoTeamWorktreeTask(legacyMissingSource)).toBe(false);
    expect(isDedicatedDynamoTeamWorktreeTask(task({ resolvedWorkspaceMode: "worktree" }))).toBe(
      true,
    );
  });

  it("renders native provider tasks without Dynamo child-thread controls", () => {
    const native = task({
      source: "native-provider",
      childThreadMaterialized: false,
      childThreadId: ThreadId.make("native-child:codex:item-1"),
      nativeProviderRef: {
        provider: "codex",
        providerItemId: "item-1",
      },
      status: "completed",
      completedAt: "2026-01-01T00:01:00.000Z",
    });

    const markup = renderToStaticMarkup(
      createElement(TeamAgentsSidebar, {
        environmentId: EnvironmentId.make("environment-local"),
        coordinatorTitle: "Coordinator",
        coordinatorThreadId: native.parentThreadId,
        activeThreadId: native.parentThreadId,
        tasks: [
          {
            task: native,
            diffSummary: "1 file changed, +1/-0",
            elapsed: "1m",
            childWorktreePath: "/tmp/native-child",
          },
        ],
        timestampFormat: "locale",
        onOpenThread: () => {},
        onCancelTask: () => {},
        onReviewTaskChanges: () => {},
        onClose: () => {},
      }),
    );

    expect(markup).toContain("Native");
    expect(markup).toContain("Inspect activity");
    expect(markup).not.toContain("Open chat");
    expect(markup).not.toContain("Review &amp; apply");
    expect(markup).not.toContain("Cancel");

    const pillsMarkup = renderToStaticMarkup(
      createElement(TeamAgentPills, {
        tasks: [native],
        onOpenTask: () => {},
        onCancelTask: () => {},
      }),
    );
    expect(pillsMarkup).not.toContain("Open child thread");
    expect(pillsMarkup).not.toContain("Cancel child agent");
  });

  it("keeps Dynamo task controls visible for dedicated worktree children", () => {
    const dynamo = task({
      workspaceMode: "worktree",
      resolvedWorkspaceMode: "worktree",
      status: "completed",
      completedAt: "2026-01-01T00:01:00.000Z",
    });

    const sidebarMarkup = renderToStaticMarkup(
      createElement(TeamAgentsSidebar, {
        environmentId: EnvironmentId.make("environment-local"),
        coordinatorTitle: "Coordinator",
        coordinatorThreadId: dynamo.parentThreadId,
        activeThreadId: dynamo.parentThreadId,
        tasks: [
          {
            task: dynamo,
            diffSummary: "1 file changed, +1/-0",
            elapsed: "1m",
            childWorktreePath: "/tmp/dynamo-child",
          },
        ],
        timestampFormat: "locale",
        onOpenThread: () => {},
        onCancelTask: () => {},
        onReviewTaskChanges: () => {},
        onClose: () => {},
      }),
    );
    const inspectorMarkup = renderToStaticMarkup(
      createElement(TeamTaskInspector, {
        task: task({ status: "running" }),
        onOpenTask: () => {},
        onCancelTask: () => {},
      }),
    );

    expect(sidebarMarkup).toContain("Open chat");
    expect(sidebarMarkup).toContain("Review &amp; apply");
    expect(inspectorMarkup).toContain("Open child thread");
    expect(inspectorMarkup).toContain("Cancel");
  });

  it("does not show review controls for shared Dynamo children with inherited worktree paths", () => {
    const dynamo = task({
      resolvedWorkspaceMode: "shared",
      status: "completed",
      completedAt: "2026-01-01T00:01:00.000Z",
    });

    const sidebarMarkup = renderToStaticMarkup(
      createElement(TeamAgentsSidebar, {
        environmentId: EnvironmentId.make("environment-local"),
        coordinatorTitle: "Coordinator",
        coordinatorThreadId: dynamo.parentThreadId,
        activeThreadId: dynamo.parentThreadId,
        tasks: [
          {
            task: dynamo,
            diffSummary: "1 file changed, +1/-0",
            elapsed: "1m",
            childWorktreePath: "/tmp/coordinator-worktree",
          },
        ],
        timestampFormat: "locale",
        onOpenThread: () => {},
        onCancelTask: () => {},
        onReviewTaskChanges: () => {},
        onClose: () => {},
      }),
    );

    expect(sidebarMarkup).toContain("Open chat");
    expect(sidebarMarkup).not.toContain("Review &amp; apply");
  });

  it("does not show inline review controls for shared Dynamo children with inherited worktree paths", () => {
    const dynamo = task({
      resolvedWorkspaceMode: "shared",
      status: "completed",
      completedAt: "2026-01-01T00:01:00.000Z",
    });

    const markup = renderToStaticMarkup(
      createElement(TeamTaskInlineBlocks, {
        tasks: [
          {
            task: dynamo,
            diffSummary: "1 file changed, +1/-0",
            elapsed: "1m",
            childWorktreePath: "/tmp/coordinator-worktree",
            defaultOpen: true,
          },
        ],
        onOpenTask: () => {},
        onCancelTask: () => {},
        onReviewTaskChanges: () => {},
      }),
    );

    expect(markup).toContain("Open child thread");
    expect(markup).not.toContain("Review &amp; apply");
  });

  it("shows inline review controls for dedicated worktree children", () => {
    const dynamo = task({
      workspaceMode: "worktree",
      resolvedWorkspaceMode: "worktree",
      status: "completed",
      completedAt: "2026-01-01T00:01:00.000Z",
    });

    const markup = renderToStaticMarkup(
      createElement(TeamTaskInlineBlocks, {
        tasks: [
          {
            task: dynamo,
            diffSummary: "1 file changed, +1/-0",
            elapsed: "1m",
            childWorktreePath: "/tmp/child-worktree",
            defaultOpen: true,
          },
        ],
        onOpenTask: () => {},
        onCancelTask: () => {},
        onReviewTaskChanges: () => {},
      }),
    );

    expect(markup).toContain("Open child thread");
    expect(markup).toContain("Review &amp; apply");
  });
});
