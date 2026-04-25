import type {
  EnvironmentId,
  OrchestrationTeamTask,
  TeamTaskId,
  ThreadId,
} from "@t3tools/contracts";
import { ArrowLeftIcon } from "lucide-react";
import { memo } from "react";

import { useTeamTaskTrace } from "../../hooks/useTeamTaskTrace";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { NativeSubagentTraceItemView } from "./NativeSubagentTraceItem";
import { teamTaskModelLabel, teamTaskStatusLabel } from "./TeamTaskShared";

export const NativeSubagentTracePanel = memo(function NativeSubagentTracePanel({
  environmentId,
  parentThreadId,
  task,
  onBack,
}: {
  environmentId: EnvironmentId;
  parentThreadId: ThreadId;
  task: OrchestrationTeamTask;
  onBack: () => void;
}) {
  const trace = useTeamTaskTrace({
    environmentId,
    parentThreadId,
    taskId: task.id as TeamTaskId,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border/60 p-3">
        <Button size="xs" variant="ghost" onClick={onBack} className="mb-2">
          <ArrowLeftIcon className="size-3" />
          Agents
        </Button>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{task.title}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {teamTaskModelLabel(task)} · {teamTaskStatusLabel(task.status)}
            </div>
          </div>
          <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[10px] uppercase">
            Native
          </Badge>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground/70">Observed provider thread</div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-3">
          {trace.status === "loading" && trace.items.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-muted-foreground text-xs">
              Loading native activity...
            </div>
          ) : null}
          {trace.status === "error" ? (
            <div className="rounded-md border border-destructive/35 bg-destructive/5 px-3 py-2 text-destructive text-xs">
              {trace.error}
            </div>
          ) : null}
          {trace.status !== "loading" && trace.items.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-muted-foreground text-xs">
              No native activity captured yet.
            </div>
          ) : null}
          {trace.items.map((item) => (
            <NativeSubagentTraceItemView key={item.id} item={item} />
          ))}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground/65">
        Read-only native provider subagent
      </div>
    </div>
  );
});
