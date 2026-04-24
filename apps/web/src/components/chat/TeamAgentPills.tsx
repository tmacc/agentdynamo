import type { OrchestrationTeamTask, TeamTaskId, ThreadId } from "@t3tools/contracts";
import { ExternalLinkIcon, XIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { isActiveTeamTask, teamTaskModelLabel, teamTaskStatusLabel } from "./TeamTaskShared";

export const TeamAgentPills = memo(function TeamAgentPills({
  tasks,
  onOpenTask,
  onCancelTask,
}: {
  tasks: ReadonlyArray<OrchestrationTeamTask>;
  onOpenTask: (threadId: ThreadId) => void;
  onCancelTask: (taskId: TeamTaskId) => void;
}) {
  const visibleTasks = tasks.filter((task) => isActiveTeamTask(task) || task.status === "failed");
  if (visibleTasks.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 bg-background/95 px-3 py-2 sm:px-5">
      {visibleTasks.map((task) => {
        const active = isActiveTeamTask(task);
        return (
          <div
            key={task.id}
            className={cn(
              "flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-xs",
              task.status === "failed"
                ? "border-destructive/35 bg-destructive/10 text-destructive"
                : "border-border/60 bg-card/60 text-muted-foreground",
            )}
          >
            <button
              type="button"
              className="min-w-0 text-left hover:text-foreground"
              onClick={() => onOpenTask(task.childThreadId)}
              title={`${task.title} - ${teamTaskModelLabel(task)}`}
            >
              <span className="font-medium text-foreground">{task.roleLabel || task.title}</span>
              <span className="mx-1 text-muted-foreground/60">/</span>
              <span>{teamTaskModelLabel(task)}</span>
              <span className="mx-1 text-muted-foreground/60">/</span>
              <span>{teamTaskStatusLabel(task.status)}</span>
            </button>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => onOpenTask(task.childThreadId)}
              title="Open child thread"
            >
              <ExternalLinkIcon className="size-3.5" />
            </button>
            {active && (
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => onCancelTask(task.id)}
                title="Cancel child agent"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});
