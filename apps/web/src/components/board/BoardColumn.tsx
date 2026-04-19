import {
  type EnvironmentId,
  type FeatureCard,
  type FeatureCardColumn,
  type ProjectId,
} from "@t3tools/contracts";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PlusIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import { BOARD_COLUMN_LABELS, type BoardItem } from "../../boardProjection";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { BoardDoneCard, BoardLiveCard, BoardReviewCard, BoardUserCard } from "./BoardCard";
import { BoardAddCardInput } from "./BoardAddCardInput";

interface BoardColumnProps {
  readonly column: FeatureCardColumn;
  readonly items: ReadonlyArray<BoardItem>;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly onStartAgent: (card: FeatureCard) => void;
  readonly onOpenCard: (card: FeatureCard) => void;
  readonly shouldOpenAddCard: boolean;
  readonly onAddCardIntentHandled: () => void;
  /**
   * The column that the active drag is currently hovering over, computed at
   * the BoardView level so that the highlight stays steady whether the pointer
   * is over the empty column body or any of its cards (avoids flicker that
   * would otherwise happen when toggling between sibling droppables).
   */
  readonly activeOverColumn: FeatureCardColumn | null;
}

export const BoardColumn = memo(function BoardColumn({
  column,
  items,
  environmentId,
  projectId,
  onStartAgent,
  onOpenCard,
  shouldOpenAddCard,
  onAddCardIntentHandled,
  activeOverColumn,
}: BoardColumnProps) {
  const isStored = column === "ideas" || column === "planned";
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (!isStored || !shouldOpenAddCard) return;
    setIsAdding(true);
    onAddCardIntentHandled();
  }, [isStored, onAddCardIntentHandled, shouldOpenAddCard]);

  const userCardIds = useMemo(
    () =>
      items
        .filter(
          (item): item is Extract<BoardItem, { kind: "user-card" }> => item.kind === "user-card",
        )
        .map((item) => item.card.id as unknown as string),
    [items],
  );

  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `board-column:${column}`,
    data: { column },
    disabled: !isStored,
  });

  // Use the BoardView-supplied "active over column" rather than the per-droppable
  // `isOver` flag. The latter flickers when the pointer transitions between the
  // column body droppable and a child sortable card.
  const isOver = isStored && activeOverColumn === column;

  return (
    <div
      ref={setDroppableRef}
      className={cn(
        "flex min-h-0 w-[19rem] flex-shrink-0 flex-col overflow-hidden rounded-lg border bg-muted/30",
        isOver && "bg-muted/60 ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {BOARD_COLUMN_LABELS[column]}
          </h3>
          <span className="rounded-full bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
            {items.length}
          </span>
        </div>
        {isStored ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Add to ${BOARD_COLUMN_LABELS[column]}`}
            onClick={() => setIsAdding(true)}
          >
            <PlusIcon />
          </Button>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-2">
          {isAdding ? (
            <BoardAddCardInput
              environmentId={environmentId}
              projectId={projectId}
              column={column as "ideas" | "planned"}
              onDone={() => setIsAdding(false)}
            />
          ) : null}
          <SortableContext items={userCardIds} strategy={verticalListSortingStrategy}>
            {items.map((item) => (
              <BoardColumnItem
                key={keyForItem(item)}
                item={item}
                environmentId={environmentId}
                projectId={projectId}
                onStartAgent={onStartAgent}
                onOpenCard={onOpenCard}
              />
            ))}
          </SortableContext>
          {items.length === 0 && !isAdding ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              {emptyStateCopy(column)}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
});

function keyForItem(item: BoardItem): string {
  switch (item.kind) {
    case "user-card":
      return `card:${item.card.id}`;
    case "live-thread":
    case "review-thread":
    case "done-thread":
      return `thread:${item.thread.id}`;
  }
}

function emptyStateCopy(column: FeatureCardColumn): string {
  switch (column) {
    case "ideas":
      return "Capture a rough idea here.";
    case "planned":
      return "Move ideas here once they're ready to start.";
    case "in-progress":
      return "Running agents appear here.";
    case "review":
      return "Completed turns await review.";
    case "done":
      return "Archived threads and merged PRs land here.";
  }
}

interface BoardColumnItemProps {
  readonly item: BoardItem;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly onStartAgent: (card: FeatureCard) => void;
  readonly onOpenCard: (card: FeatureCard) => void;
}

function BoardColumnItem({
  item,
  environmentId,
  projectId,
  onStartAgent,
  onOpenCard,
}: BoardColumnItemProps) {
  if (item.kind === "user-card") {
    return (
      <SortableUserCard
        item={item}
        environmentId={environmentId}
        projectId={projectId}
        onStartAgent={onStartAgent}
        onOpenCard={onOpenCard}
      />
    );
  }
  if (item.kind === "live-thread") {
    return <BoardLiveCard item={item} environmentId={environmentId} projectId={projectId} />;
  }
  if (item.kind === "review-thread") {
    return <BoardReviewCard item={item} environmentId={environmentId} projectId={projectId} />;
  }
  return <BoardDoneCard item={item} environmentId={environmentId} projectId={projectId} />;
}

interface SortableUserCardProps {
  readonly item: Extract<BoardItem, { kind: "user-card" }>;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly onStartAgent: (card: FeatureCard) => void;
  readonly onOpenCard: (card: FeatureCard) => void;
}

function SortableUserCard({
  item,
  environmentId,
  projectId,
  onStartAgent,
  onOpenCard,
}: SortableUserCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.card.id as unknown as string,
    data: { kind: "user-card", card: item.card, column: item.card.column },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <BoardUserCard
      item={item}
      environmentId={environmentId}
      projectId={projectId}
      onStartAgent={onStartAgent}
      onOpenSheet={onOpenCard}
      isDragging={isDragging}
      listeners={listeners as Record<string, unknown> | undefined}
      attributes={attributes as unknown as Record<string, unknown>}
      style={style}
      dragHandleRef={setNodeRef}
    />
  );
}
