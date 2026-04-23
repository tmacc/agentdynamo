import {
  type EnvironmentId,
  type FeatureCard,
  type FeatureCardId,
  type FeatureCardStoredColumn,
  type GitStatusResult,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ArrowLeftIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useShallow } from "zustand/react/shallow";

import {
  acquireBoardSubscription,
  boardKey,
  computeSortOrderBetween,
  moveBoardCard,
  useBoardCards,
  useBoardDismissedGhostThreadIds,
  useBoardStatus,
} from "../../boardStore";
import {
  BOARD_COLUMN_ORDER,
  deriveBoardColumns,
  isStoredBoardColumn,
  type BoardItem,
} from "../../boardProjection";
import { useBoardUiStore } from "../../boardUiStore";
import { useGitStatusSnapshots } from "../../lib/gitStatusState";
import { selectProjectByRef, selectSidebarThreadsForProjectRef, useStore } from "../../store";
import type { SidebarThreadSummary } from "../../types";
import { BoardColumn } from "./BoardColumn";
import { BoardCardSheet } from "./BoardCardSheet";
import { BoardUserCard } from "./BoardCard";
import { Button } from "../ui/button";
import { SidebarTrigger } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface BoardViewProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly onStartAgent: (card: FeatureCard) => void;
  readonly onCloseBoard?: () => void;
  readonly closeBoardLabel?: string;
}

export function BoardView({
  environmentId,
  projectId,
  onStartAgent,
  onCloseBoard,
  closeBoardLabel,
}: BoardViewProps) {
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const project = useStore((state) => selectProjectByRef(state, projectRef));
  const threads = useStore(
    useShallow((state) => selectSidebarThreadsForProjectRef(state, projectRef)),
  );

  const cards = useBoardCards(environmentId, projectId);
  const dismissedGhostThreadIds = useBoardDismissedGhostThreadIds(environmentId, projectId);
  const status = useBoardStatus(environmentId, projectId);
  const pendingAddColumn = useBoardUiStore(
    (state) => state.pendingAddColumnByKey[boardKey(environmentId, projectId)] ?? undefined,
  );
  const clearAddCardIntent = useBoardUiStore((state) => state.clearAddCardIntent);
  const [openCardId, setOpenCardId] = useState<FeatureCardId | null>(null);
  const [activeDragCard, setActiveDragCard] = useState<FeatureCard | null>(null);
  const [activeOverColumn, setActiveOverColumn] = useState<"ideas" | "planned" | null>(null);
  const boardStripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const release = acquireBoardSubscription(environmentId, projectId);
    return () => {
      release();
    };
  }, [environmentId, projectId]);

  const gitStatusTargets = useMemo(
    () => resolveBoardGitStatusTargets(threads, project?.cwd ?? null),
    [project?.cwd, threads],
  );
  const gitStatusSnapshots = useGitStatusSnapshots(gitStatusTargets);
  const gitStatusByThreadId = useMemo(
    () => resolveBoardThreadGitStatusMap(threads, project?.cwd ?? null, gitStatusSnapshots),
    [gitStatusSnapshots, project?.cwd, threads],
  );

  const columns = useMemo(
    () =>
      deriveBoardColumns({
        projectId,
        cards,
        threads,
        gitStatusByThreadId,
        dismissedGhostThreadIds,
      }),
    [cards, dismissedGhostThreadIds, gitStatusByThreadId, projectId, threads],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active?.data?.current as { kind?: string; card?: FeatureCard } | undefined;
    if (data?.kind === "user-card" && data.card) {
      setActiveDragCard(data.card);
    }
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const overId = event.over?.id as string | undefined;
      if (!overId) {
        setActiveOverColumn(null);
        return;
      }
      if (overId.startsWith("board-column:")) {
        const maybeColumn = overId.slice("board-column:".length);
        if (maybeColumn === "ideas" || maybeColumn === "planned") {
          setActiveOverColumn(maybeColumn);
          return;
        }
        setActiveOverColumn(null);
        return;
      }
      const overCard = cards.find((card) => card.id === overId);
      if (overCard && isStoredBoardColumn(overCard.column)) {
        setActiveOverColumn(overCard.column);
        return;
      }
      setActiveOverColumn(null);
    },
    [cards],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragCard(null);
      setActiveOverColumn(null);
      const activeId = event.active?.id as string | undefined;
      const overId = event.over?.id as string | undefined;
      if (!activeId || !overId) {
        return;
      }

      const activeCard = cards.find((card) => card.id === activeId);
      if (!activeCard) {
        return;
      }

      let targetColumn: "ideas" | "planned" | null = null;
      let beforeId: FeatureCardId | null = null;
      let afterId: FeatureCardId | null = null;

      if (overId.startsWith("board-column:")) {
        const maybeColumn = overId.slice("board-column:".length);
        if (maybeColumn === "ideas" || maybeColumn === "planned") {
          targetColumn = maybeColumn;
          ({ beforeId, afterId } = resolveBoardColumnDropPlacement(cards, targetColumn));
        }
      } else {
        const overCard = cards.find((card) => card.id === overId);
        if (overCard && isStoredBoardColumn(overCard.column)) {
          targetColumn = overCard.column;
          afterId = overCard.id;
          const siblings = cards
            .filter((card) => card.column === overCard.column && card.archivedAt === null)
            .toSorted((left, right) => left.sortOrder - right.sortOrder);
          const overIndex = siblings.findIndex((sibling) => sibling.id === overCard.id);
          if (overIndex > 0) {
            beforeId = siblings[overIndex - 1]!.id;
          }
        }
      }

      if (!targetColumn) {
        return;
      }
      if (activeCard.column === targetColumn && !beforeId && !afterId) {
        return;
      }

      const { sortOrder } = computeSortOrderBetween(cards, targetColumn, beforeId, afterId);
      void moveBoardCard({
        environmentId,
        projectId,
        cardId: activeCard.id,
        toColumn: targetColumn,
        sortOrder,
      }).catch(() => undefined);
    },
    [cards, environmentId, projectId],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDragCard(null);
    setActiveOverColumn(null);
  }, []);

  const handleBoardStripWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const element = boardStripRef.current;
    if (!element || element.scrollWidth <= element.clientWidth + 1 || !event.shiftKey) {
      return;
    }
    const horizontalDelta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY;
    if (horizontalDelta === 0) {
      return;
    }
    event.preventDefault();
    element.scrollBy({ left: horizontalDelta, behavior: "auto" });
  }, []);

  if (!project) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        Project not found.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <BoardHeader
        projectName={project.name}
        cardCount={cards.filter((card) => card.archivedAt === null).length}
        status={status.status}
        {...(onCloseBoard ? { onCloseBoard } : {})}
        {...(closeBoardLabel ? { closeBoardLabel } : {})}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          ref={boardStripRef}
          className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden scroll-smooth"
          onWheel={handleBoardStripWheel}
        >
          <div className="flex h-full min-w-full w-max gap-3 p-3 pb-2">
            {BOARD_COLUMN_ORDER.map((column) => (
              <BoardColumn
                key={column}
                column={column}
                items={columns.find((entry) => entry.kind === column)?.items ?? []}
                environmentId={environmentId}
                projectId={projectId}
                onStartAgent={onStartAgent}
                onOpenCard={(card) => setOpenCardId(card.id)}
                shouldOpenAddCard={pendingAddColumn === column}
                onAddCardIntentHandled={() => clearAddCardIntent(environmentId, projectId)}
                activeOverColumn={activeOverColumn}
              />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={{ duration: 150, easing: "cubic-bezier(0.18,0.67,0.6,1.22)" }}>
          {activeDragCard ? (
            <BoardUserCard
              item={{ kind: "user-card", card: activeDragCard }}
              environmentId={environmentId}
              projectId={projectId}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      {openCardId ? (
        <BoardCardSheet
          environmentId={environmentId}
          projectId={projectId}
          cardId={openCardId}
          onClose={() => setOpenCardId(null)}
          onStartAgent={onStartAgent}
        />
      ) : null}
    </div>
  );
}

interface BoardGitStatusTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}

function boardGitStatusTargetKey(target: BoardGitStatusTarget): string {
  return `${target.environmentId}:${target.cwd}`;
}

export function resolveBoardGitStatusTargets(
  threads: ReadonlyArray<SidebarThreadSummary>,
  projectCwd: string | null,
): ReadonlyArray<BoardGitStatusTarget> {
  const seen = new Set<string>();
  const targets: BoardGitStatusTarget[] = [];

  for (const thread of threads) {
    if (thread.branch === null) {
      continue;
    }
    const cwd = thread.worktreePath ?? projectCwd;
    if (!cwd) {
      continue;
    }
    const target = { environmentId: thread.environmentId, cwd };
    const key = boardGitStatusTargetKey(target);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push(target);
  }

  return targets;
}

export function resolveBoardThreadGitStatusMap(
  threads: ReadonlyArray<SidebarThreadSummary>,
  projectCwd: string | null,
  gitStatusesByTargetKey: ReadonlyMap<string, GitStatusResult | null>,
): ReadonlyMap<ThreadId, GitStatusResult | null> {
  const map = new Map<ThreadId, GitStatusResult | null>();

  for (const thread of threads) {
    if (thread.branch === null) {
      map.set(thread.id, null);
      continue;
    }

    const cwd = thread.worktreePath ?? projectCwd;
    if (!cwd) {
      map.set(thread.id, null);
      continue;
    }

    const targetKey = boardGitStatusTargetKey({
      environmentId: thread.environmentId,
      cwd,
    });
    map.set(thread.id, gitStatusesByTargetKey.get(targetKey) ?? null);
  }

  return map;
}

export function resolveBoardColumnDropPlacement(
  cards: ReadonlyArray<FeatureCard>,
  targetColumn: FeatureCardStoredColumn,
): { beforeId: FeatureCardId | null; afterId: FeatureCardId | null } {
  const siblings = cards
    .filter((card) => card.column === targetColumn && card.archivedAt === null)
    .toSorted((left, right) => left.sortOrder - right.sortOrder);
  const lastCard = siblings.at(-1) ?? null;
  return {
    beforeId: lastCard?.id ?? null,
    afterId: null,
  };
}

interface BoardHeaderProps {
  readonly projectName: string;
  readonly cardCount: number;
  readonly status: "loading" | "ready" | "error" | "idle";
  readonly onCloseBoard?: () => void;
  readonly closeBoardLabel?: string;
}

function BoardHeader({
  projectName,
  cardCount,
  status,
  onCloseBoard,
  closeBoardLabel,
}: BoardHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border bg-background px-3 py-2 sm:px-5 sm:py-3">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <h2 className="min-w-0 truncate text-sm font-medium text-foreground" title={projectName}>
          {projectName}
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground">
          {cardCount} {cardCount === 1 ? "card" : "cards"}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {status === "loading" ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex size-5 items-center justify-center text-muted-foreground">
                  <Spinner className="size-3" />
                </span>
              }
            />
            <TooltipPopup side="bottom">Loading board</TooltipPopup>
          </Tooltip>
        ) : null}
        {status === "error" ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex h-5 items-center rounded-full bg-destructive/10 px-2 text-xs text-destructive-foreground">
                  Error
                </span>
              }
            />
            <TooltipPopup side="bottom">Failed to load the board</TooltipPopup>
          </Tooltip>
        ) : null}
        {onCloseBoard ? (
          <Button size="xs" variant="outline" onClick={onCloseBoard}>
            <ArrowLeftIcon className="size-3" />
            {closeBoardLabel ?? "Close board"}
          </Button>
        ) : null}
      </div>
    </header>
  );
}

void (null as unknown as BoardItem);
