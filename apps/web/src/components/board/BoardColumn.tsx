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

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `board-column:${column}`,
    data: { column },
    disabled: !isStored,
  });

  return (
    <div
      ref={setDroppableRef}
      className={cn(
        "flex min-h-0 min-w-[18rem] max-w-[20rem] flex-1 flex-col overflow-hidden rounded-lg border bg-muted/30",
        isOver && "bg-muted/60 ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {BOARD_COLUMN_LABELS[column]}
          </h3>
          <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {items.length}
          </span>
        </div>
        {isStored ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            aria-label={`Add to ${BOARD_COLUMN_LABELS[column]}`}
            onClick={() => setIsAdding(true)}
          >
            <PlusIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
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
          <div className="py-6 text-center text-xs text-muted-foreground/80">
            {emptyStateCopy(column)}
          </div>
        ) : null}
      </div>
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
    data: { kind: "user-card", card: item.card },
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
