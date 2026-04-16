import { memo, useCallback } from "react";
import type { ThreadId } from "@t3tools/contracts";
import { PROVIDER_ICON_BY_PROVIDER, providerIconClassName } from "./ProviderModelPicker";
import { cn } from "~/lib/utils";
import type { TeamTask } from "../../types";
import type { ProviderPickerKind } from "../../session-logic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamAgentPillsProps {
  tasks: readonly { task: TeamTask }[];
  onOpenThread: (threadId: ThreadId) => void;
}

// ---------------------------------------------------------------------------
// Status dot color
// ---------------------------------------------------------------------------

function statusDotClass(status: TeamTask["status"]): string {
  switch (status) {
    case "queued":
    case "starting":
    case "running":
    case "waiting":
      return "bg-primary animate-pulse";
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-destructive";
    case "cancelled":
      return "bg-muted-foreground/40";
  }
}

// ---------------------------------------------------------------------------
// Single pill
// ---------------------------------------------------------------------------

const AgentPill = memo(function AgentPill({
  task,
  onOpenThread,
}: {
  task: TeamTask;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const provider = task.modelSelection.provider as ProviderPickerKind;
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[provider];
  const iconClass = providerIconClassName(provider, "text-muted-foreground/70");

  const handleClick = useCallback(() => {
    onOpenThread(task.childThreadId);
  }, [onOpenThread, task.childThreadId]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-xs text-foreground/80 shadow-sm transition-colors hover:border-border hover:bg-accent/40 hover:text-foreground"
    >
      <span className={cn("relative inline-flex size-3 items-center justify-center")}>
        {ProviderIcon && <ProviderIcon className={cn("size-3", iconClass)} />}
      </span>
      <span className="max-w-32 truncate">{task.roleLabel ?? task.title}</span>
      <span
        className={cn("size-1.5 rounded-full", statusDotClass(task.status))}
        aria-label={task.status}
      />
    </button>
  );
});

// ---------------------------------------------------------------------------
// Pills container
// ---------------------------------------------------------------------------

export const TeamAgentPills = memo(function TeamAgentPills({
  tasks,
  onOpenThread,
}: TeamAgentPillsProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="mx-auto flex w-full max-w-208 flex-wrap items-center gap-1.5 px-3 pb-1 sm:px-5">
      {tasks.map(({ task }) => (
        <AgentPill key={task.id} task={task} onOpenThread={onOpenThread} />
      ))}
    </div>
  );
});
