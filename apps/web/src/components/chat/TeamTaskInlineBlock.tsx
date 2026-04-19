import { memo, useState, useCallback } from "react";
import type { ThreadId } from "@t3tools/contracts";
import { ChevronRightIcon, EyeIcon } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "../ui/collapsible";
import { PROVIDER_ICON_BY_PROVIDER, providerIconClassName } from "./ProviderModelPicker";
import { cn } from "~/lib/utils";
import type { ProviderPickerKind } from "../../session-logic";
import {
  formatTeamTaskStatusLabel,
  isActiveTeamTaskStatus,
  TeamTaskDetailContent,
  type TeamTaskPresentationView,
} from "./TeamTaskShared";

export type TeamTaskInlineView = TeamTaskPresentationView;

interface TeamTaskInlineBlockProps {
  tasks: readonly TeamTaskPresentationView[];
  onInspectThread: (threadId: ThreadId) => void;
}

// ---------------------------------------------------------------------------
// Single task row
// ---------------------------------------------------------------------------

const TaskRow = memo(function TaskRow({
  view,
  onInspectThread,
}: {
  view: TeamTaskPresentationView;
  onInspectThread: (threadId: ThreadId) => void;
}) {
  const [open, setOpen] = useState(false);
  const { task, elapsed } = view;
  const provider = task.modelSelection.provider as ProviderPickerKind;
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[provider];
  const iconClass = providerIconClassName(provider, "text-muted-foreground/70");
  const active = isActiveTeamTaskStatus(task.status);

  const handleInspectThread = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onInspectThread(task.childThreadId);
    },
    [onInspectThread, task.childThreadId],
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
        <span
          className={cn(
            "shrink-0 text-muted-foreground",
            task.status === "failed" && "text-destructive",
            task.status === "cancelled" && "text-muted-foreground/60",
            active && "animate-pulse",
          )}
        >
          {formatTeamTaskStatusLabel(task.status)}
        </span>
        {elapsed && !active && <span className="shrink-0 text-muted-foreground/50">{elapsed}</span>}
      </CollapsibleTrigger>

      <CollapsiblePanel>
        <TeamTaskDetailContent
          view={view}
          className="px-2 pb-1.5 pl-[34px] pt-1.5"
          action={
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1 text-primary/80 transition-colors hover:text-primary"
              onClick={handleInspectThread}
            >
              Inspect task
              <EyeIcon className="size-3" />
            </button>
          }
        />
      </CollapsiblePanel>
    </Collapsible>
  );
});

// ---------------------------------------------------------------------------
// Block container (renders all task rows)
// ---------------------------------------------------------------------------

export const TeamTaskInlineBlocks = memo(function TeamTaskInlineBlocks({
  tasks,
  onInspectThread,
}: TeamTaskInlineBlockProps) {
  if (tasks.length === 0) return null;

  return (
    <div
      className="my-1 rounded-lg border border-border/50 bg-muted/10 py-1"
      data-team-task-inline-blocks
    >
      {tasks.map((view) => (
        <TaskRow key={view.task.id} view={view} onInspectThread={onInspectThread} />
      ))}
    </div>
  );
});
