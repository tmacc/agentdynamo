import { memo, useState, useCallback } from "react";
import type { ThreadId } from "@t3tools/contracts";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "../ui/collapsible";
import { PROVIDER_ICON_BY_PROVIDER, providerIconClassName } from "./ProviderModelPicker";
import { cn } from "~/lib/utils";
import type { TeamTask } from "../../types";
import type { ProviderPickerKind } from "../../session-logic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamTaskInlineView {
  task: TeamTask;
  diffSummary: string | null;
  elapsed: string | null;
}

interface TeamTaskInlineBlockProps {
  tasks: readonly TeamTaskInlineView[];
  onOpenThread: (threadId: ThreadId) => void;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_CLASS: Record<TeamTask["status"], string> = {
  queued: "text-muted-foreground",
  starting: "text-muted-foreground",
  running: "text-muted-foreground",
  waiting: "text-muted-foreground",
  completed: "text-muted-foreground",
  failed: "text-destructive",
  cancelled: "text-muted-foreground/60",
};

function statusLabel(status: TeamTask["status"]): string {
  switch (status) {
    case "queued":
    case "starting":
      return "starting\u2026";
    case "running":
    case "waiting":
      return "running\u2026";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

function isActive(status: TeamTask["status"]): boolean {
  return (
    status === "queued" || status === "starting" || status === "running" || status === "waiting"
  );
}

// ---------------------------------------------------------------------------
// Single task row
// ---------------------------------------------------------------------------

const TaskRow = memo(function TaskRow({
  view,
  onOpenThread,
}: {
  view: TeamTaskInlineView;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const [open, setOpen] = useState(false);
  const { task, diffSummary, elapsed } = view;
  const provider = task.modelSelection.provider as ProviderPickerKind;
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[provider];
  const iconClass = providerIconClassName(provider, "text-muted-foreground/70");
  const active = isActive(task.status);

  const handleOpenThread = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onOpenThread(task.childThreadId);
    },
    [onOpenThread, task.childThreadId],
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-muted/40",
          task.status === "failed" && "hover:bg-destructive/5",
        )}
      >
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground/50 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        {ProviderIcon && <ProviderIcon className={cn("size-3.5 shrink-0", iconClass)} />}
        <span
          className={cn(
            "min-w-0 truncate font-medium",
            task.status === "failed" ? "text-destructive" : "text-foreground/80",
          )}
        >
          {task.roleLabel ?? task.title}
        </span>
        <span className="shrink-0 text-muted-foreground/60">&mdash;</span>
        <span className={cn("shrink-0", STATUS_CLASS[task.status], active && "animate-pulse")}>
          {statusLabel(task.status)}
        </span>
        {elapsed && !active && <span className="shrink-0 text-muted-foreground/50">{elapsed}</span>}
      </CollapsibleTrigger>

      <CollapsiblePanel>
        <div className="space-y-1 py-1.5 pl-[34px] pr-2 text-xs text-muted-foreground">
          {diffSummary && <div>{diffSummary}</div>}
          {task.latestSummary && (
            <div className="line-clamp-3 text-foreground/70">{task.latestSummary}</div>
          )}
          {task.errorText && <div className="line-clamp-3 text-destructive">{task.errorText}</div>}
          <button
            type="button"
            className="mt-0.5 inline-flex cursor-pointer items-center gap-1 text-primary/80 transition-colors hover:text-primary"
            onClick={handleOpenThread}
          >
            Open thread
            <ExternalLinkIcon className="size-3" />
          </button>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
});

// ---------------------------------------------------------------------------
// Block container (renders all task rows)
// ---------------------------------------------------------------------------

export const TeamTaskInlineBlocks = memo(function TeamTaskInlineBlocks({
  tasks,
  onOpenThread,
}: TeamTaskInlineBlockProps) {
  if (tasks.length === 0) return null;

  return (
    <div
      className="my-1 rounded-lg border border-border/50 bg-muted/10 py-1"
      data-team-task-inline-blocks
    >
      {tasks.map((view) => (
        <TaskRow key={view.task.id} view={view} onOpenThread={onOpenThread} />
      ))}
    </div>
  );
});
