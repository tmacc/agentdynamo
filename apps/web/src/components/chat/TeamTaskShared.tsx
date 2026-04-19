import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import type { Thread, TeamTask } from "../../types";
import { Badge } from "../ui/badge";

export interface TeamTaskPresentationView {
  task: TeamTask;
  diffSummary: string | null;
  elapsed: string | null;
  childThread: Pick<Thread, "branch" | "worktreePath"> | null;
}

const TEAM_STATUS_TONE: Record<
  TeamTask["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "outline",
  starting: "outline",
  running: "secondary",
  waiting: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
};

export function isActiveTeamTaskStatus(status: TeamTask["status"]): boolean {
  return (
    status === "queued" || status === "starting" || status === "running" || status === "waiting"
  );
}

export function formatTeamTaskStatusLabel(status: TeamTask["status"]): string {
  switch (status) {
    case "queued":
    case "starting":
      return "starting...";
    case "running":
    case "waiting":
      return "running...";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

function providerLabel(task: TeamTask): string {
  return task.modelSelection.provider === "claudeAgent" ? "Claude" : "Codex";
}

export function TeamTaskStatusBadge({ status }: { status: TeamTask["status"] }) {
  return (
    <Badge variant={TEAM_STATUS_TONE[status]} size="sm" className="capitalize">
      {status}
    </Badge>
  );
}

export function TeamTaskDetailContent(props: {
  view: TeamTaskPresentationView;
  action?: ReactNode;
  className?: string;
  includeModelDetails?: boolean;
}) {
  const { view, action, className, includeModelDetails = false } = props;
  const { task, diffSummary, childThread } = view;

  return (
    <div className={cn("space-y-1 text-xs text-muted-foreground", className)}>
      {includeModelDetails ? (
        <div>
          {providerLabel(task)} · {task.modelSelection.model} · {task.workspaceMode}
        </div>
      ) : null}
      {diffSummary ? <div>{diffSummary}</div> : null}
      {task.latestSummary ? (
        <div className="line-clamp-3 text-foreground/70">{task.latestSummary}</div>
      ) : null}
      {task.errorText ? (
        <div className="line-clamp-3 text-destructive">{task.errorText}</div>
      ) : null}
      {childThread && (childThread.branch || childThread.worktreePath) ? (
        <div>
          {childThread.branch ? `Branch: ${childThread.branch}` : "Branch: n/a"}
          {childThread.worktreePath ? ` · Worktree: ${childThread.worktreePath}` : ""}
        </div>
      ) : null}
      {action ? <div className="pt-0.5">{action}</div> : null}
    </div>
  );
}
