import {
  type EnvironmentId,
  type FeatureCard,
  type ProjectId,
} from "@t3tools/contracts";
import {
  ArchiveIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  EyeIcon,
  GhostIcon,
  GitPullRequestIcon,
  LinkIcon,
  PlayIcon,
  SparklesIcon,
} from "lucide-react";
import { memo, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

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
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface BoardCardCommonProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly onStartAgent?: (card: FeatureCard) => void;
  readonly onOpenSheet?: (card: FeatureCard) => void;
}

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
    <div
      ref={dragHandleRef}
      style={style}
      className={cn(
        "group rounded-md border bg-card text-card-foreground shadow-sm transition-shadow",
        isDragging ? "opacity-60 shadow-lg" : "hover:shadow-md",
      )}
      {...attributes}
    >
      <div
        className="cursor-grab active:cursor-grabbing"
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
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
        <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            {canStartAgent ? (
              <Button
                size="sm"
                variant="secondary"
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartAgent?.(card);
                }}
              >
                <PlayIcon className="size-2.5" />
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
    </div>
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
    }).catch(() => undefined);
  }, [navigate, thread.environmentId, thread.id]);

  return (
    <div className="group relative rounded-md border bg-card text-card-foreground shadow-sm transition hover:shadow-md">
      <button
        type="button"
        onClick={openThread}
        className="flex w-full items-start justify-between gap-2 p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <CircleDotIcon className="size-3 shrink-0 animate-pulse text-emerald-500" />
            <div className="truncate text-sm font-medium text-foreground">{title}</div>
          </div>
          {thread.branch ? (
            <div className="mt-1 truncate text-[10px] text-muted-foreground">{thread.branch}</div>
          ) : null}
          {teamTasks.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {teamTasks.map((pill) => (
                <TeamTaskPill key={pill.threadId} pill={pill} />
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
      </button>
      {isGhost ? (
        <div className="flex items-center justify-end border-t px-3 py-1 text-[10px] text-muted-foreground">
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1 text-[10px]"
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
    </div>
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
    }).catch(() => undefined);
  }, [navigate, thread.environmentId, thread.id]);

  return (
    <button
      type="button"
      onClick={openThread}
      className="flex w-full flex-col gap-1 rounded-md border bg-card p-3 text-left text-card-foreground shadow-sm transition hover:shadow-md"
    >
      <div className="flex items-center gap-1.5">
        <EyeIcon className="size-3 shrink-0 text-amber-500" />
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
      </div>
      {thread.branch ? (
        <div className="truncate text-[10px] text-muted-foreground">{thread.branch}</div>
      ) : null}
      {pr ? <PrBadge pr={pr} /> : null}
    </button>
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
    }).catch(() => undefined);
  }, [navigate, thread.environmentId, thread.id]);

  return (
    <button
      type="button"
      onClick={openThread}
      className="flex w-full flex-col gap-1 rounded-md border border-dashed bg-card/50 p-3 text-left text-muted-foreground shadow-sm transition hover:shadow-md"
    >
      <div className="flex items-center gap-1.5">
        {reason === "pr-merged" ? (
          <CheckCircle2Icon className="size-3 shrink-0 text-violet-500" />
        ) : (
          <ArchiveIcon className="size-3 shrink-0 text-muted-foreground" />
        )}
        <div className="truncate text-sm font-medium text-foreground/80">{title}</div>
      </div>
      {thread.branch ? <div className="truncate text-[10px]">{thread.branch}</div> : null}
      {pr ? <PrBadge pr={pr} /> : null}
    </button>
  );
});

function PrBadge({ pr }: { readonly pr: NonNullable<ThreadPr> }) {
  return (
    <Badge variant="outline" className="w-fit gap-1 text-[10px]">
      <GitPullRequestIcon className="size-3" />
      <span>
        #{pr.number} {pr.state}
      </span>
    </Badge>
  );
}

function TeamTaskPill({ pill }: { readonly pill: BoardTeamTaskPill }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] text-muted-foreground">
      <LinkIcon className="size-2" />
      <span className="truncate">{pill.roleLabel ?? "team task"}</span>
      {pill.status ? <span className="opacity-70">· {pill.status}</span> : null}
    </span>
  );
}

interface BoardCardOverflowMenuProps {
  readonly onArchive?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
}

function BoardCardOverflowMenu({ onArchive, onDelete }: BoardCardOverflowMenuProps) {
  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      {onArchive ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-5 px-1 text-[10px]"
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
        >
          Archive
        </Button>
      ) : null}
      {onDelete ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-5 px-1 text-[10px] text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          Delete
        </Button>
      ) : null}
    </div>
  );
}

// Re-export the store accessor for use in the column/view without creating
// a separate import path.
export { useBoardStore };
