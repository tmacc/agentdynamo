import {
  type EnvironmentId,
  type FeatureCard,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  ArchiveIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  EllipsisIcon,
  EyeIcon,
  GhostIcon,
  GitPullRequestIcon,
  LinkIcon,
  PlayIcon,
  SparklesIcon,
} from "lucide-react";
import { memo, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

import { clearBoardRouteSearchParams } from "../../boardRouteSearch";
import { clearAgentInspectorSearchParams } from "../../agentInspectorRouteSearch";
import { cn } from "../../lib/utils";
import {
  deleteBoardCard,
  archiveBoardCard,
  dismissGhostCard,
  useBoardStore,
} from "../../boardStore";
import type { BoardItem, BoardTeamTaskPill } from "../../boardProjection";
import type { ThreadPr } from "../ThreadStatusIndicators";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface BoardCardCommonProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly onStartAgent?: (card: FeatureCard) => void;
  readonly onOpenSheet?: (card: FeatureCard) => void;
}

// Shared card chrome — small radius and subtle shadow tuned for kanban density.
// Overrides the design-system default `rounded-2xl` for a tighter look.
const KANBAN_CARD_CLASSES = "rounded-md shadow-sm transition-shadow";

interface UserBoardCardProps extends BoardCardCommonProps {
  readonly item: Extract<BoardItem, { kind: "user-card" }>;
  readonly isDragging?: boolean;
  readonly listeners?: Record<string, unknown> | undefined;
  readonly attributes?: Record<string, unknown>;
  readonly style?: React.CSSProperties;
  readonly dragHandleRef?: (node: HTMLElement | null) => void;
}

export const BoardUserCard = memo(function BoardUserCard({
  item,
  environmentId,
  projectId,
  onStartAgent,
  onOpenSheet,
  isDragging,
  listeners,
  attributes,
  style,
  dragHandleRef,
}: UserBoardCardProps) {
  const card = item.card;
  const canStartAgent = card.column === "planned" && card.linkedThreadId === null;

  const handleClick = useCallback(() => {
    onOpenSheet?.(card);
  }, [card, onOpenSheet]);

  return (
    <Card
      ref={dragHandleRef}
      style={style}
      className={cn(
        "group",
        KANBAN_CARD_CLASSES,
        // While dragging, hide the source card so the DragOverlay shows the only copy.
        isDragging ? "opacity-0" : "hover:shadow-md",
      )}
      {...attributes}
    >
      <div
        className="cursor-grab active:cursor-grabbing"
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.currentTarget !== e.target) {
            return;
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        {...(listeners as Record<string, unknown>)}
      >
        <div className="flex items-start justify-between gap-2 p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{card.title}</div>
            {card.description ? (
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {card.description}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {card.linkedProposedPlanId ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex size-5 items-center justify-center rounded-full text-violet-500">
                      <SparklesIcon className="size-3" />
                    </span>
                  }
                />
                <TooltipPopup side="top">Imported from proposed plan</TooltipPopup>
              </Tooltip>
            ) : null}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            {canStartAgent ? (
              <Button
                size="xs"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartAgent?.(card);
                }}
              >
                <PlayIcon className="size-3" />
                Start Agent
              </Button>
            ) : null}
          </div>
          <BoardCardOverflowMenu
            onArchive={() => {
              archiveBoardCard({ environmentId, projectId, cardId: card.id }).catch(
                () => undefined,
              );
            }}
            onDelete={
              card.linkedThreadId
                ? undefined
                : () => {
                    deleteBoardCard({ environmentId, projectId, cardId: card.id }).catch(
                      () => undefined,
                    );
                  }
            }
          />
        </div>
      </div>
    </Card>
  );
});

interface LiveBoardCardProps extends BoardCardCommonProps {
  readonly item: Extract<BoardItem, { kind: "live-thread" }>;
}

export const BoardLiveCard = memo(function BoardLiveCard({
  item,
  environmentId,
  projectId,
}: LiveBoardCardProps) {
  const navigate = useNavigate();
  const { thread, linkedCard, teamTasks, isGhost } = item;
  const title = linkedCard?.title ?? thread.title;

  const openThread = useCallback(() => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: thread.environmentId, threadId: thread.id },
      search: (previous) => clearBoardRouteSearchParams(previous as Record<string, unknown>),
    }).catch(() => undefined);
  }, [navigate, thread.environmentId, thread.id]);
  const inspectTeamTask = useCallback(
    (childThreadId: ThreadId) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: thread.environmentId, threadId: thread.id },
        search: (previous) => ({
          ...clearAgentInspectorSearchParams(
            clearBoardRouteSearchParams(previous as Record<string, unknown>),
          ),
          agentChildThreadId: childThreadId,
        }),
      }).catch(() => undefined);
    },
    [navigate, thread.environmentId, thread.id],
  );

  return (
    <Card className={cn("group relative", KANBAN_CARD_CLASSES, "transition hover:shadow-md")}>
      <div
        role="button"
        tabIndex={0}
        onClick={openThread}
        onKeyDown={(event) => {
          if (event.currentTarget !== event.target) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openThread();
          }
        }}
        className="flex w-full items-start justify-between gap-2 p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <CircleDotIcon className="size-3 shrink-0 animate-pulse text-success" />
            <div className="truncate text-sm font-medium text-foreground">{title}</div>
          </div>
          {thread.branch ? (
            <div className="mt-1 truncate text-xs text-muted-foreground">{thread.branch}</div>
          ) : null}
          {teamTasks.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {teamTasks.map((pill) => (
                <TeamTaskPill key={pill.threadId} pill={pill} onInspectTask={inspectTeamTask} />
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isGhost ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex size-5 items-center justify-center text-muted-foreground">
                    <GhostIcon className="size-3" />
                  </span>
                }
              />
              <TooltipPopup side="top">Ghost card: thread started outside the board</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
      </div>
      {isGhost ? (
        <div className="flex items-center justify-end border-t px-3 py-1 text-xs text-muted-foreground">
          <Button
            size="xs"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              dismissGhostCard({ environmentId, projectId, threadId: thread.id }).catch(
                () => undefined,
              );
            }}
          >
            Hide
          </Button>
        </div>
      ) : null}
    </Card>
  );
});

interface ReviewBoardCardProps extends BoardCardCommonProps {
  readonly item: Extract<BoardItem, { kind: "review-thread" }>;
}

export const BoardReviewCard = memo(function BoardReviewCard({ item }: ReviewBoardCardProps) {
  const navigate = useNavigate();
  const { thread, linkedCard, pr } = item;
  const title = linkedCard?.title ?? thread.title;

  const openThread = useCallback(() => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: thread.environmentId, threadId: thread.id },
      search: (previous) => clearBoardRouteSearchParams(previous as Record<string, unknown>),
    }).catch(() => undefined);
  }, [navigate, thread.environmentId, thread.id]);

  return (
    <Card className={cn(KANBAN_CARD_CLASSES, "transition hover:shadow-md")}>
      <button
        type="button"
        onClick={openThread}
        className="flex w-full flex-col gap-1 p-3 text-left"
      >
        <div className="flex items-center gap-1.5">
          <EyeIcon className="size-3 shrink-0 text-warning" />
          <div className="truncate text-sm font-medium text-foreground">{title}</div>
        </div>
        {thread.branch ? (
          <div className="truncate text-xs text-muted-foreground">{thread.branch}</div>
        ) : null}
        {pr ? <PrBadge pr={pr} /> : null}
      </button>
    </Card>
  );
});

interface DoneBoardCardProps extends BoardCardCommonProps {
  readonly item: Extract<BoardItem, { kind: "done-thread" }>;
}

export const BoardDoneCard = memo(function BoardDoneCard({ item }: DoneBoardCardProps) {
  const navigate = useNavigate();
  const { thread, linkedCard, pr, reason } = item;
  const title = linkedCard?.title ?? thread.title;

  const openThread = useCallback(() => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: thread.environmentId, threadId: thread.id },
      search: (previous) => clearBoardRouteSearchParams(previous as Record<string, unknown>),
    }).catch(() => undefined);
  }, [navigate, thread.environmentId, thread.id]);

  return (
    <Card
      className={cn(
        "border-dashed bg-card/50 text-muted-foreground",
        KANBAN_CARD_CLASSES,
        "transition hover:shadow-md",
      )}
    >
      <button
        type="button"
        onClick={openThread}
        className="flex w-full flex-col gap-1 p-3 text-left"
      >
        <div className="flex items-center gap-1.5">
          {reason === "pr-merged" ? (
            <CheckCircle2Icon className="size-3 shrink-0 text-violet-500" />
          ) : (
            <ArchiveIcon className="size-3 shrink-0 text-muted-foreground" />
          )}
          <div className="truncate text-sm font-medium text-foreground/80">{title}</div>
        </div>
        {thread.branch ? <div className="truncate text-xs">{thread.branch}</div> : null}
        {pr ? <PrBadge pr={pr} /> : null}
      </button>
    </Card>
  );
});

function PrBadge({ pr }: { readonly pr: NonNullable<ThreadPr> }) {
  return (
    <Badge variant="outline" className="w-fit gap-1 text-xs">
      <GitPullRequestIcon className="size-3" />
      <span>
        #{pr.number} {pr.state}
      </span>
    </Badge>
  );
}

function TeamTaskPill(props: {
  readonly pill: BoardTeamTaskPill;
  readonly onInspectTask: (threadId: ThreadId) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        props.onInspectTask(props.pill.threadId);
      }}
      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-accent/40 hover:text-foreground"
    >
      <LinkIcon className="size-2" />
      <span className="truncate">{props.pill.roleLabel ?? "team task"}</span>
      {props.pill.status ? <span className="opacity-70">· {props.pill.status}</span> : null}
    </button>
  );
}

interface BoardCardOverflowMenuProps {
  readonly onArchive?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
}

function BoardCardOverflowMenu({ onArchive, onDelete }: BoardCardOverflowMenuProps) {
  if (!onArchive && !onDelete) return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label="Card actions"
            size="icon-xs"
            variant="ghost"
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end">
        {onArchive ? (
          <MenuItem
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
          >
            <ArchiveIcon />
            Archive
          </MenuItem>
        ) : null}
        {onDelete ? (
          <MenuItem
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            Delete
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

// Re-export the store accessor for use in the column/view without creating
// a separate import path.
export { useBoardStore };
