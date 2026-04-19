import { memo, useCallback } from "react";
import type { ThreadId } from "@t3tools/contracts";
import { PanelRightCloseIcon } from "lucide-react";

import { PROVIDER_ICON_BY_PROVIDER, providerIconClassName } from "./ProviderModelPicker";
import type { ProviderPickerKind } from "../../session-logic";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Badge } from "../ui/badge";
import {
  isTeamTaskChildThreadReady,
  TeamTaskDetailContent,
  TeamTaskPresentationView,
  TeamTaskStatusBadge,
} from "./TeamTaskShared";

export const TeamTaskInspector = memo(function TeamTaskInspector(props: {
  tasks: readonly TeamTaskPresentationView[];
  selectedChildThreadId: ThreadId | null;
  onClose: () => void;
  onSelectTask: (threadId: ThreadId) => void;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  return (
    <div
      className="flex h-full min-h-0 w-full flex-col bg-card/50"
      data-testid="team-task-inspector"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="rounded-md bg-sky-500/10 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-sky-500 uppercase"
          >
            Agents
          </Badge>
          <span className="text-[11px] text-muted-foreground/60">
            {props.tasks.length} {props.tasks.length === 1 ? "task" : "tasks"}
          </span>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={props.onClose}
          aria-label="Close agents sidebar"
          className="text-muted-foreground/50 hover:text-foreground/70"
        >
          <PanelRightCloseIcon className="size-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {props.tasks.map((view) => (
            <InspectorTaskCard
              key={view.task.id}
              view={view}
              selected={view.task.childThreadId === props.selectedChildThreadId}
              onSelectTask={props.onSelectTask}
              onOpenThread={props.onOpenThread}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
});

const InspectorTaskCard = memo(function InspectorTaskCard(props: {
  view: TeamTaskPresentationView;
  selected: boolean;
  onSelectTask: (threadId: ThreadId) => void;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const { view, selected, onSelectTask, onOpenThread } = props;
  const provider = view.task.modelSelection.provider as ProviderPickerKind;
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[provider];
  const iconClass = providerIconClassName(provider, "text-muted-foreground/70");
  const childThreadReady = isTeamTaskChildThreadReady(view);

  const handleSelect = useCallback(() => {
    onSelectTask(view.task.childThreadId);
  }, [onSelectTask, view.task.childThreadId]);
  const handleOpenThread = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onOpenThread(view.task.childThreadId);
    },
    [onOpenThread, view.task.childThreadId],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (event.currentTarget !== event.target) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleSelect();
        }
      }}
      className={cn(
        "w-full rounded-xl border p-3 text-left transition-colors",
        selected
          ? "border-sky-500/50 bg-sky-500/6 shadow-sm"
          : "border-border/70 bg-background/60 hover:border-border hover:bg-muted/15",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {ProviderIcon ? <ProviderIcon className={cn("size-4 shrink-0", iconClass)} /> : null}
            <span className="truncate text-sm font-medium text-foreground">
              {view.task.roleLabel ?? view.task.title}
            </span>
          </div>
          {view.elapsed ? (
            <div className="mt-1 text-xs text-muted-foreground/70">{view.elapsed}</div>
          ) : null}
        </div>
        <TeamTaskStatusBadge status={view.task.status} />
      </div>

      <TeamTaskDetailContent
        view={view}
        includeModelDetails
        className="mt-3"
        supplementaryNote={
          childThreadReady
            ? undefined
            : "This task has started, but its child thread is still being prepared."
        }
        action={
          childThreadReady ? (
            <Button size="sm" variant="outline" onClick={handleOpenThread}>
              Open child thread
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled>
              Child thread not ready
            </Button>
          )
        }
      />
    </div>
  );
});
