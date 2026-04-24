import type { OrchestrationTeamTask, TeamTaskId, ThreadId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { BotIcon, CheckIcon, ExternalLinkIcon, PanelRightCloseIcon, XIcon } from "lucide-react";
import { memo } from "react";

import { formatTimestamp } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "~/lib/utils";
import {
  isActiveTeamTask,
  teamTaskModelLabel,
  teamTaskStatusClassName,
  teamTaskStatusLabel,
} from "./TeamTaskShared";
import type { TeamTaskInlineView } from "./TeamTaskInlineBlock";
import { PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";

export const TeamAgentsSidebar = memo(function TeamAgentsSidebar({
  coordinatorTitle,
  coordinatorThreadId,
  activeThreadId,
  tasks,
  timestampFormat,
  mode = "sidebar",
  onOpenThread,
  onCancelTask,
  onReviewTaskChanges,
  onApplyTaskChanges,
  onClose,
}: {
  coordinatorTitle: string;
  coordinatorThreadId: ThreadId;
  activeThreadId: ThreadId;
  tasks: ReadonlyArray<TeamTaskInlineView>;
  timestampFormat: TimestampFormat;
  mode?: "sheet" | "sidebar";
  onOpenThread: (threadId: ThreadId) => void;
  onCancelTask: (taskId: TeamTaskId) => void;
  onReviewTaskChanges: (threadId: ThreadId) => void;
  onApplyTaskChanges: (task: OrchestrationTeamTask) => void;
  onClose: () => void;
}) {
  const activeCount = tasks.filter((view) => isActiveTeamTask(view.task)).length;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-card/50",
        mode === "sidebar"
          ? "h-full w-[360px] shrink-0 border-l border-border/70"
          : "h-full w-full",
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="secondary"
            className="rounded-md bg-primary/10 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-primary uppercase"
          >
            Agents
          </Badge>
          <span className="truncate text-[11px] text-muted-foreground/70">
            {activeCount > 0 ? `${activeCount} active` : `${tasks.length} total`}
          </span>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onClose}
          aria-label="Close agents sidebar"
          className="text-muted-foreground/50 hover:text-foreground/70"
        >
          <PanelRightCloseIcon className="size-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          <button
            type="button"
            className={cn(
              "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted/35",
              activeThreadId === coordinatorThreadId
                ? "border-primary/45 bg-primary/5"
                : "border-border/60 bg-background/35",
            )}
            onClick={() => onOpenThread(coordinatorThreadId)}
          >
            <BotIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/75" />
            <span className="min-w-0">
              <span className="block truncate font-medium text-foreground/90">Coordinator</span>
              <span className="block truncate text-muted-foreground/75">{coordinatorTitle}</span>
            </span>
          </button>

          {tasks.length > 0 ? (
            <div className="space-y-2">
              {tasks.map(({ task, diffSummary, elapsed, childWorktreePath }) => (
                <AgentCard
                  key={task.id}
                  task={task}
                  active={activeThreadId === task.childThreadId}
                  diffSummary={diffSummary}
                  elapsed={elapsed}
                  childWorktreePath={childWorktreePath}
                  timestampFormat={timestampFormat}
                  onOpenThread={onOpenThread}
                  onCancelTask={onCancelTask}
                  onReviewTaskChanges={onReviewTaskChanges}
                  onApplyTaskChanges={onApplyTaskChanges}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-muted-foreground text-xs">
              No child agents yet.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

const AgentCard = memo(function AgentCard({
  task,
  active,
  diffSummary,
  elapsed,
  childWorktreePath,
  timestampFormat,
  onOpenThread,
  onCancelTask,
  onReviewTaskChanges,
  onApplyTaskChanges,
}: {
  task: OrchestrationTeamTask;
  active: boolean;
  diffSummary: string | null;
  elapsed: string | null;
  childWorktreePath: string | null;
  timestampFormat: TimestampFormat;
  onOpenThread: (threadId: ThreadId) => void;
  onCancelTask: (taskId: TeamTaskId) => void;
  onReviewTaskChanges: (threadId: ThreadId) => void;
  onApplyTaskChanges: (task: OrchestrationTeamTask) => void;
}) {
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[task.modelSelection.provider];
  const isActive = isActiveTeamTask(task);

  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-2 text-xs",
        active ? "border-primary/45 bg-primary/5" : "border-border/60 bg-background/35",
        task.status === "failed" && "border-destructive/35 bg-destructive/5",
      )}
    >
      <div className="flex items-start gap-2">
        <ProviderIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/75" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate font-medium text-foreground/90">
              {task.roleLabel || task.title}
            </span>
            <span className={cn("shrink-0 text-[11px]", teamTaskStatusClassName(task.status))}>
              {teamTaskStatusLabel(task.status)}
            </span>
          </div>
          <div className="mt-0.5 truncate text-muted-foreground/75">{teamTaskModelLabel(task)}</div>
        </div>
      </div>

      <div className="mt-2 line-clamp-3 text-muted-foreground/85">{task.task}</div>
      {task.latestSummary ? (
        <div className="mt-2 line-clamp-4 text-foreground/85">{task.latestSummary}</div>
      ) : null}
      {task.errorText ? (
        <div className="mt-2 line-clamp-4 text-destructive">{task.errorText}</div>
      ) : null}
      {diffSummary ? <div className="mt-2 text-muted-foreground/75">{diffSummary}</div> : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/60">
        <span>{formatTimestamp(task.createdAt, timestampFormat)}</span>
        {elapsed ? <span>{elapsed}</span> : null}
        <span>
          {task.resolvedWorkspaceMode}
          {task.resolvedSetupMode === "run" ? " · setup" : ""}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="xs" variant="outline" onClick={() => onOpenThread(task.childThreadId)}>
          <ExternalLinkIcon className="size-3" />
          Open chat
        </Button>
        <Button size="xs" variant="outline" onClick={() => onReviewTaskChanges(task.childThreadId)}>
          <ExternalLinkIcon className="size-3" />
          Review diff
        </Button>
        {childWorktreePath ? (
          <Button size="xs" variant="ghost" onClick={() => onApplyTaskChanges(task)}>
            <CheckIcon className="size-3" />
            Apply
          </Button>
        ) : null}
        {isActive ? (
          <Button size="xs" variant="ghost" onClick={() => onCancelTask(task.id)}>
            <XIcon className="size-3" />
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
});
