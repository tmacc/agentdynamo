import type { OrchestrationTeamTask, TeamTaskId, ThreadId } from "@t3tools/contracts";
import { CheckIcon, ChevronRightIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { memo, useState, type MouseEvent } from "react";

import { cn } from "~/lib/utils";
import {
  isActiveTeamTask,
  isMaterializedDynamoTeamTask,
  teamTaskModelLabel,
  teamTaskStatusClassName,
  teamTaskStatusLabel,
} from "./TeamTaskShared";
import { PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";

export interface TeamTaskInlineView {
  task: OrchestrationTeamTask;
  diffSummary: string | null;
  elapsed: string | null;
  childWorktreePath: string | null;
}

function stopPropagation(handler: () => void) {
  return (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    handler();
  };
}

export const TeamTaskInlineBlocks = memo(function TeamTaskInlineBlocks({
  tasks,
  onOpenTask,
  onCancelTask,
  onReviewTaskChanges,
}: {
  tasks: ReadonlyArray<TeamTaskInlineView>;
  onOpenTask: (threadId: ThreadId) => void;
  onCancelTask: (taskId: TeamTaskId) => void;
  onReviewTaskChanges: (task: OrchestrationTeamTask) => void;
}) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <div
      className="my-1 overflow-hidden rounded-md border border-border/60 bg-card/35"
      data-team-task-inline-blocks="true"
    >
      {tasks.map((view) => (
        <TeamTaskInlineRow
          key={view.task.id}
          view={view}
          onOpenTask={onOpenTask}
          onCancelTask={onCancelTask}
          onReviewTaskChanges={onReviewTaskChanges}
        />
      ))}
    </div>
  );
});

const TeamTaskInlineRow = memo(function TeamTaskInlineRow({
  view,
  onOpenTask,
  onCancelTask,
  onReviewTaskChanges,
}: {
  view: TeamTaskInlineView;
  onOpenTask: (threadId: ThreadId) => void;
  onCancelTask: (taskId: TeamTaskId) => void;
  onReviewTaskChanges: (task: OrchestrationTeamTask) => void;
}) {
  const [open, setOpen] = useState(false);
  const { task, diffSummary, elapsed } = view;
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[task.modelSelection.provider];
  const active = isActiveTeamTask(task);
  const isMaterializedDynamo = isMaterializedDynamoTeamTask(task);

  return (
    <div className="border-border/50 border-b last:border-b-0">
      <button
        type="button"
        className={cn(
          "grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted/35",
          task.status === "failed" && "hover:bg-destructive/5",
        )}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground/60 transition-transform",
            open && "rotate-90",
          )}
        />
        <ProviderIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
        <span className="min-w-0">
          <span className="block truncate font-medium text-foreground/90">
            {task.roleLabel || task.title}
          </span>
          <span className="block truncate text-muted-foreground/75">
            {teamTaskModelLabel(task)}
            {task.modelSelectionMode === "coordinator-selected" ? " · auto-selected" : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className={cn("text-[11px]", teamTaskStatusClassName(task.status))}>
            {teamTaskStatusLabel(task.status)}
          </span>
          {elapsed && !active ? (
            <span className="hidden text-[11px] text-muted-foreground/55 sm:inline">{elapsed}</span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 px-8 pb-2 text-xs">
          <div className="text-muted-foreground">{task.task}</div>
          <div className="text-muted-foreground/80">{task.modelSelectionReason}</div>
          {diffSummary ? <div className="text-muted-foreground">{diffSummary}</div> : null}
          {task.latestSummary ? (
            <div className="line-clamp-4 text-foreground/85">{task.latestSummary}</div>
          ) : null}
          {task.errorText ? (
            <div className="line-clamp-4 text-destructive">{task.errorText}</div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 pt-0.5">
            {isMaterializedDynamo ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-primary/85 transition-colors hover:text-primary"
                onClick={stopPropagation(() => onOpenTask(task.childThreadId))}
              >
                Open child thread
                <ExternalLinkIcon className="size-3" />
              </button>
            ) : null}
            {view.childWorktreePath && !active && isMaterializedDynamo ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-success transition-colors hover:text-success/80"
                onClick={stopPropagation(() => onReviewTaskChanges(task))}
              >
                Review & apply
                <CheckIcon className="size-3" />
              </button>
            ) : null}
            {active && isMaterializedDynamo ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-destructive"
                onClick={stopPropagation(() => onCancelTask(task.id))}
              >
                Cancel
                <XIcon className="size-3" />
              </button>
            ) : null}
            {!isMaterializedDynamo ? (
              <span className="text-muted-foreground/70">Observed in parent thread</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
