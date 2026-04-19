import {
  type EnvironmentId,
  type FeatureCard,
  type FeatureCardColumn,
  type FeatureCardId,
  type FeatureCardStoredColumn,
  type GitStatusResult,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ArrowLeftIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  type BoardItem,
  deriveBoardColumns,
  isStoredBoardColumn,
} from "../../boardProjection";
import { useBoardUiStore } from "../../boardUiStore";
import { selectProjectByRef, selectSidebarThreadsForProjectRef, useStore } from "../../store";
import { useGitStatusSnapshots } from "../../lib/gitStatusState";
import { Button } from "../ui/button";
import { SidebarTrigger } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BoardColumn } from "./BoardColumn";
import { BoardCardSheet } from "./BoardCardSheet";
import { BoardUserCard } from "./BoardCard";
import type { SidebarThreadSummary } from "../../types";

interface BoardViewProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly onStartAgent: (card: FeatureCard) => void;
  readonly onCloseBoard?: (() => void) | undefined;
  readonly closeBoardLabel?: string | undefined;
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
  const project = useStore((s) => selectProjectByRef(s, projectRef));
  const threads = useStore(useShallow((s) => selectSidebarThreadsForProjectRef(s, projectRef)));

  const cards = useBoardCards(environmentId, projectId);
  const dismissedGhostThreadIds = useBoardDismissedGhostThreadIds(environmentId, projectId);
  const status = useBoardStatus(environmentId, projectId);
  const pendingAddColumn = useBoardUiStore(
    (state) => state.pendingAddColumnByKey[boardKey(environmentId, projectId)] ?? undefined,
  );
  const clearAddCardIntent = useBoardUiStore((state) => state.clearAddCardIntent);
  const [openCardId, setOpenCardId] = useState<FeatureCardId | null>(null);
  const [activeDragCard, setActiveDragCard] = useState<FeatureCard | null>(null);
  const [activeOverColumn, setActiveOverColumn] = useState<FeatureCardColumn | null>(null);

  // Subscribe to the board RPC stream for this project.
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
      // Column droppable: id is "board-column:<col>".
      if (overId.startsWith("board-column:")) {
        const maybeColumn = overId.slice("board-column:".length);
        if (maybeColumn === "ideas" || maybeColumn === "planned") {
          setActiveOverColumn(maybeColumn);
          return;
        }
        setActiveOverColumn(null);
        return;
      }
      // Sortable card droppable: id matches a card id; resolve its column.
      const overCard = cards.find((c) => (c.id as unknown as string) === overId);
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
      if (!activeId || !overId) return;

      const activeCard = cards.find((c) => (c.id as unknown as string) === activeId);
      if (!activeCard) return;

      // Determine target column from over target — either the column
      // droppable id ("board-column:<col>") or another card's id.
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
        const overCard = cards.find((c) => (c.id as unknown as string) === overId);
        if (overCard && isStoredBoardColumn(overCard.column)) {
          targetColumn = overCard.column;
          // The user dropped directly onto a sibling card — we'll insert
          // *before* that sibling (closer to the top of the column).
          afterId = overCard.id;
          // Compute the immediately-preceding card in the same column.
          const siblings = cards
            .filter((c) => c.column === overCard.column && c.archivedAt === null)
            .toSorted((a, b) => a.sortOrder - b.sortOrder);
          const idx = siblings.findIndex((s) => s.id === overCard.id);
          if (idx > 0) {
            beforeId = siblings[idx - 1]!.id;
          }
        }
      }

      if (!targetColumn) return;

      // If dropping into the same column in the same spot, no-op.
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
        cardCount={cards.filter((c) => c.archivedAt === null).length}
        status={status.status}
        onCloseBoard={onCloseBoard}
        closeBoardLabel={closeBoardLabel}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden scroll-smooth">
          <div className="flex h-full min-w-full w-max gap-3 p-3 pb-2">
            {BOARD_COLUMN_ORDER.map((col) => (
              <BoardColumn
                key={col}
                column={col}
                items={columns.find((c) => c.kind === col)?.items ?? []}
                environmentId={environmentId}
                projectId={projectId}
                onStartAgent={onStartAgent}
                onOpenCard={(card) => setOpenCardId(card.id)}
                shouldOpenAddCard={pendingAddColumn === col}
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
    const status = gitStatusesByTargetKey.get(targetKey) ?? null;
    map.set(thread.id, status);
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
  readonly onCloseBoard?: (() => void) | undefined;
  readonly closeBoardLabel?: string | undefined;
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

// Satisfy eslint: BoardItem is used transitively via `columns` typing.
void (null as unknown as BoardItem);
