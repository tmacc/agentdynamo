import type { OrchestrationTeamTask, TeamTaskId, ThreadId } from "@t3tools/contracts";
import { memo } from "react";

import { isActiveTeamTask, teamTaskModelLabel, teamTaskStatusLabel } from "./TeamTaskShared";

export const TeamTaskInspector = memo(function TeamTaskInspector({
  task,
  onOpenTask,
  onCancelTask,
}: {
  task: OrchestrationTeamTask;
  onOpenTask: (threadId: ThreadId) => void;
  onCancelTask: (taskId: TeamTaskId) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-card/50 p-3 text-xs">
      <div>
        <div className="font-medium text-foreground">{task.title}</div>
        <div className="text-muted-foreground">{teamTaskStatusLabel(task.status)}</div>
      </div>
      <div className="text-muted-foreground">{task.task}</div>
      <div className="text-muted-foreground">
        {teamTaskModelLabel(task)} - {task.modelSelectionReason}
      </div>
      <div className="text-muted-foreground">
        Workspace {task.resolvedWorkspaceMode}; setup {task.resolvedSetupMode}
      </div>
      {task.latestSummary && <div className="text-foreground/85">{task.latestSummary}</div>}
      {task.errorText && <div className="text-destructive">{task.errorText}</div>}
      <div className="flex gap-2">
        <button
          type="button"
          className="text-foreground hover:underline"
          onClick={() => onOpenTask(task.childThreadId)}
        >
          Open child thread
        </button>
        {isActiveTeamTask(task) && (
          <button
            type="button"
            className="text-destructive hover:underline"
            onClick={() => onCancelTask(task.id)}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
});
