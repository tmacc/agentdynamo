import {
  BOARD_DEFAULT_SORT_SPACING,
  BOARD_REINDEX_THRESHOLD,
  type BoardCommand,
  type BoardDismissedGhost,
  type BoardStreamEvent,
  type EnvironmentId,
  type FeatureCard,
  type FeatureCardId,
  type FeatureCardStoredColumn,
  type OrchestrationEvent,
  type ProjectId,
  type ThreadId,
  computeMidpointSortOrder,
} from "@t3tools/contracts";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { createEnvironmentApi, ensureEnvironmentApi, readEnvironmentApi } from "./environmentApi";
import { readEnvironmentConnection, subscribeEnvironmentConnections } from "./environments/runtime";
import { newCommandId, newFeatureCardId, randomUUID } from "./lib/utils";

/**
 * Key combining environment id + project id. Board state is scoped to this
 * tuple so that the same project id in a different environment never collides.
 */
export function boardKey(environmentId: EnvironmentId, projectId: ProjectId): string {
  return `${environmentId}::${projectId}`;
}

interface BoardSubscriptionEntry {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  refCount: number;
  currentSource: unknown;
  unsubscribe: () => void;
  unsubscribeConnectionListener: (() => void) | null;
  snapshotLoadedAt: string | null;
  error: string | null;
}

interface BoardStoreState {
  readonly cardsByKey: Record<string, ReadonlyArray<FeatureCard>>;
  readonly dismissedGhostsByKey: Record<string, ReadonlyArray<BoardDismissedGhost>>;
  readonly snapshotSequenceByKey: Record<string, number>;
  readonly statusByKey: Record<string, "loading" | "ready" | "error">;
  readonly errorByKey: Record<string, string | null>;

  setSnapshot: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    snapshot: {
      cards: ReadonlyArray<FeatureCard>;
      dismissedGhosts: ReadonlyArray<BoardDismissedGhost>;
      snapshotSequence: number;
    },
  ) => void;
  applyEvent: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    event: OrchestrationEvent,
  ) => void;
  setStatus: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    status: "loading" | "ready" | "error",
    error?: string | null,
  ) => void;
  optimisticUpsertCard: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    card: FeatureCard,
  ) => void;
  optimisticMoveCard: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    cardId: FeatureCardId,
    toColumn: FeatureCardStoredColumn,
    sortOrder: number,
  ) => void;
  optimisticArchiveCard: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    cardId: FeatureCardId,
    archivedAt: string,
  ) => void;
  optimisticDeleteCard: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    cardId: FeatureCardId,
  ) => void;
  optimisticDismissGhost: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    threadId: ThreadId,
    dismissedAt: string,
  ) => void;
  optimisticUndismissGhost: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    threadId: ThreadId,
  ) => void;
}

export const useBoardStore = create<BoardStoreState>((set) => ({
  cardsByKey: {},
  dismissedGhostsByKey: {},
  snapshotSequenceByKey: {},
  statusByKey: {},
  errorByKey: {},

  setSnapshot: (environmentId, projectId, snapshot) =>
    set((state) => {
      const key = boardKey(environmentId, projectId);
      return {
        cardsByKey: { ...state.cardsByKey, [key]: [...snapshot.cards] },
        dismissedGhostsByKey: {
          ...state.dismissedGhostsByKey,
          [key]: [...snapshot.dismissedGhosts],
        },
        snapshotSequenceByKey: {
          ...state.snapshotSequenceByKey,
          [key]: snapshot.snapshotSequence,
        },
        statusByKey: { ...state.statusByKey, [key]: "ready" },
        errorByKey: { ...state.errorByKey, [key]: null },
      };
    }),

  applyEvent: (environmentId, projectId, event) =>
    set((state) => {
      const key = boardKey(environmentId, projectId);
      return applyBoardEventToState(state, key, event);
    }),

  setStatus: (environmentId, projectId, status, error = null) =>
    set((state) => {
      const key = boardKey(environmentId, projectId);
      return {
        statusByKey: { ...state.statusByKey, [key]: status },
        errorByKey: { ...state.errorByKey, [key]: error },
      };
    }),

  optimisticUpsertCard: (environmentId, projectId, card) =>
    set((state) => {
      const key = boardKey(environmentId, projectId);
      const existing = state.cardsByKey[key] ?? [];
      const filtered = existing.filter((c) => c.id !== card.id);
      return {
        cardsByKey: {
          ...state.cardsByKey,
          [key]: [...filtered, card],
        },
      };
    }),

  optimisticMoveCard: (environmentId, projectId, cardId, toColumn, sortOrder) =>
    set((state) => {
      const key = boardKey(environmentId, projectId);
      const existing = state.cardsByKey[key] ?? [];
      return {
        cardsByKey: {
          ...state.cardsByKey,
          [key]: existing.map((c) =>
            c.id === cardId
              ? {
                  ...c,
                  column: toColumn,
                  sortOrder,
                  updatedAt: new Date().toISOString(),
                }
              : c,
          ),
        },
      };
    }),

  optimisticArchiveCard: (environmentId, projectId, cardId, archivedAt) =>
    set((state) => {
      const key = boardKey(environmentId, projectId);
      const existing = state.cardsByKey[key] ?? [];
      return {
        cardsByKey: {
          ...state.cardsByKey,
          [key]: existing.map((c) =>
            c.id === cardId
              ? {
                  ...c,
                  archivedAt,
                  updatedAt: archivedAt,
                }
              : c,
          ),
        },
      };
    }),

  optimisticDeleteCard: (environmentId, projectId, cardId) =>
    set((state) => {
      const key = boardKey(environmentId, projectId);
      const existing = state.cardsByKey[key] ?? [];
      return {
        cardsByKey: {
          ...state.cardsByKey,
          [key]: existing.filter((c) => c.id !== cardId),
        },
      };
    }),

  optimisticDismissGhost: (environmentId, projectId, threadId, dismissedAt) =>
    set((state) => {
      const key = boardKey(environmentId, projectId);
      const existing = state.dismissedGhostsByKey[key] ?? [];
      if (existing.some((g) => g.threadId === threadId)) {
        return state;
      }
      return {
        dismissedGhostsByKey: {
          ...state.dismissedGhostsByKey,
          [key]: [...existing, { projectId, threadId, dismissedAt: dismissedAt as never }],
        },
      };
    }),

  optimisticUndismissGhost: (environmentId, projectId, threadId) =>
    set((state) => {
      const key = boardKey(environmentId, projectId);
      const existing = state.dismissedGhostsByKey[key] ?? [];
      return {
        dismissedGhostsByKey: {
          ...state.dismissedGhostsByKey,
          [key]: existing.filter((g) => g.threadId !== threadId),
        },
      };
    }),
}));

function applyBoardEventToState(
  state: BoardStoreState,
  key: string,
  event: OrchestrationEvent,
): Partial<BoardStoreState> {
  const cards = state.cardsByKey[key] ?? [];
  const dismissed = state.dismissedGhostsByKey[key] ?? [];

  switch (event.type) {
    case "board.card-created": {
      const p = event.payload;
      const newCard: FeatureCard = {
        id: p.cardId,
        projectId: p.projectId,
        title: p.title,
        description: p.description,
        seededPrompt: p.seededPrompt,
        column: p.column,
        sortOrder: p.sortOrder,
        linkedThreadId: p.linkedThreadId,
        linkedProposedPlanId: p.linkedProposedPlanId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        archivedAt: null,
      };
      const filtered = cards.filter((c) => c.id !== newCard.id);
      return {
        cardsByKey: { ...state.cardsByKey, [key]: [...filtered, newCard] },
        snapshotSequenceByKey: {
          ...state.snapshotSequenceByKey,
          [key]: event.sequence,
        },
      };
    }
    case "board.card-updated": {
      const p = event.payload;
      return {
        cardsByKey: {
          ...state.cardsByKey,
          [key]: cards.map((c) =>
            c.id === p.cardId
              ? {
                  ...c,
                  ...(p.title !== undefined ? { title: p.title } : {}),
                  ...(p.description !== undefined ? { description: p.description } : {}),
                  ...(p.seededPrompt !== undefined ? { seededPrompt: p.seededPrompt } : {}),
                  updatedAt: p.updatedAt,
                }
              : c,
          ),
        },
        snapshotSequenceByKey: {
          ...state.snapshotSequenceByKey,
          [key]: event.sequence,
        },
      };
    }
    case "board.card-moved": {
      const p = event.payload;
      return {
        cardsByKey: {
          ...state.cardsByKey,
          [key]: cards.map((c) =>
            c.id === p.cardId
              ? { ...c, column: p.toColumn, sortOrder: p.sortOrder, updatedAt: p.updatedAt }
              : c,
          ),
        },
        snapshotSequenceByKey: {
          ...state.snapshotSequenceByKey,
          [key]: event.sequence,
        },
      };
    }
    case "board.card-archived": {
      const p = event.payload;
      return {
        cardsByKey: {
          ...state.cardsByKey,
          [key]: cards.map((c) =>
            c.id === p.cardId ? { ...c, archivedAt: p.archivedAt, updatedAt: p.updatedAt } : c,
          ),
        },
        snapshotSequenceByKey: {
          ...state.snapshotSequenceByKey,
          [key]: event.sequence,
        },
      };
    }
    case "board.card-deleted": {
      const p = event.payload;
      return {
        cardsByKey: {
          ...state.cardsByKey,
          [key]: cards.filter((c) => c.id !== p.cardId),
        },
        snapshotSequenceByKey: {
          ...state.snapshotSequenceByKey,
          [key]: event.sequence,
        },
      };
    }
    case "board.card-thread-linked": {
      const p = event.payload;
      return {
        cardsByKey: {
          ...state.cardsByKey,
          [key]: cards.map((c) =>
            c.id === p.cardId ? { ...c, linkedThreadId: p.threadId, updatedAt: p.updatedAt } : c,
          ),
        },
        snapshotSequenceByKey: {
          ...state.snapshotSequenceByKey,
          [key]: event.sequence,
        },
      };
    }
    case "board.card-thread-unlinked": {
      const p = event.payload;
      return {
        cardsByKey: {
          ...state.cardsByKey,
          [key]: cards.map((c) =>
            c.id === p.cardId ? { ...c, linkedThreadId: null, updatedAt: p.updatedAt } : c,
          ),
        },
        snapshotSequenceByKey: {
          ...state.snapshotSequenceByKey,
          [key]: event.sequence,
        },
      };
    }
    case "board.ghost-card-dismissed": {
      const p = event.payload;
      if (dismissed.some((g) => g.threadId === p.threadId)) {
        return {
          snapshotSequenceByKey: {
            ...state.snapshotSequenceByKey,
            [key]: event.sequence,
          },
        };
      }
      return {
        dismissedGhostsByKey: {
          ...state.dismissedGhostsByKey,
          [key]: [
            ...dismissed,
            { projectId: p.projectId, threadId: p.threadId, dismissedAt: p.dismissedAt },
          ],
        },
        snapshotSequenceByKey: {
          ...state.snapshotSequenceByKey,
          [key]: event.sequence,
        },
      };
    }
    case "board.ghost-card-undismissed": {
      const p = event.payload;
      return {
        dismissedGhostsByKey: {
          ...state.dismissedGhostsByKey,
          [key]: dismissed.filter((g) => g.threadId !== p.threadId),
        },
        snapshotSequenceByKey: {
          ...state.snapshotSequenceByKey,
          [key]: event.sequence,
        },
      };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function selectCardsForProject(
  state: BoardStoreState,
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ReadonlyArray<FeatureCard> {
  return state.cardsByKey[boardKey(environmentId, projectId)] ?? EMPTY_CARDS;
}

export function selectDismissedGhostsForProject(
  state: BoardStoreState,
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ReadonlyArray<BoardDismissedGhost> {
  return state.dismissedGhostsByKey[boardKey(environmentId, projectId)] ?? EMPTY_DISMISSED;
}

export function selectBoardStatus(
  state: BoardStoreState,
  environmentId: EnvironmentId,
  projectId: ProjectId,
): { status: "loading" | "ready" | "error" | "idle"; error: string | null } {
  const key = boardKey(environmentId, projectId);
  return {
    status: state.statusByKey[key] ?? "idle",
    error: state.errorByKey[key] ?? null,
  };
}

const EMPTY_CARDS: ReadonlyArray<FeatureCard> = Object.freeze([]);
const EMPTY_DISMISSED: ReadonlyArray<BoardDismissedGhost> = Object.freeze([]);

export function useBoardCards(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ReadonlyArray<FeatureCard> {
  return useBoardStore((s) => selectCardsForProject(s, environmentId, projectId));
}

export function useBoardDismissedGhostThreadIds(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ReadonlySet<ThreadId> {
  return useBoardStore(
    useShallow((s) => {
      const dismissed = selectDismissedGhostsForProject(s, environmentId, projectId);
      return new Set(dismissed.map((d) => d.threadId));
    }),
  );
}

export function useBoardStatus(environmentId: EnvironmentId, projectId: ProjectId) {
  return useBoardStore(useShallow((s) => selectBoardStatus(s, environmentId, projectId)));
}

// ---------------------------------------------------------------------------
// Subscription manager
// ---------------------------------------------------------------------------

const subscriptions = new Map<string, BoardSubscriptionEntry>();
const NOOP = () => undefined;

type BoardSubscriptionAttachResult = "attached" | "unchanged" | "disconnected";

function readBoardSubscriptionSource(environmentId: EnvironmentId): {
  api: ReturnType<typeof readEnvironmentApi> | undefined;
  source: unknown;
} {
  const connection = readEnvironmentConnection(environmentId);
  if (connection) {
    return {
      api: createEnvironmentApi(connection.client),
      source: connection,
    };
  }

  const api = readEnvironmentApi(environmentId);
  return {
    api,
    source: api ?? null,
  };
}

function attachBoardSubscription(entry: BoardSubscriptionEntry): BoardSubscriptionAttachResult {
  const { api, source } = readBoardSubscriptionSource(entry.environmentId);
  if (!api || !source) {
    if (entry.currentSource !== null) {
      entry.unsubscribe();
      entry.unsubscribe = NOOP;
      entry.currentSource = null;
    }
    useBoardStore
      .getState()
      .setStatus(entry.environmentId, entry.projectId, "error", "Environment not connected.");
    return "disconnected";
  }

  if (entry.currentSource === source && entry.unsubscribe !== NOOP) {
    return "unchanged";
  }

  entry.unsubscribe();
  useBoardStore.getState().setStatus(entry.environmentId, entry.projectId, "loading");
  entry.unsubscribe = api.board.subscribeProject(
    { projectId: entry.projectId },
    (event: BoardStreamEvent) => {
      if (event.kind === "snapshot") {
        useBoardStore.getState().setSnapshot(entry.environmentId, entry.projectId, {
          cards: event.cards,
          dismissedGhosts: event.dismissedGhosts,
          snapshotSequence: event.snapshotSequence,
        });
        entry.snapshotLoadedAt = new Date().toISOString();
        return;
      }
      useBoardStore
        .getState()
        .applyEvent(entry.environmentId, entry.projectId, event.event as OrchestrationEvent);
    },
    {
      onResubscribe: () => {
        useBoardStore.getState().setStatus(entry.environmentId, entry.projectId, "loading");
      },
    },
  );
  entry.currentSource = source;
  return "attached";
}

/**
 * Acquire a subscription to a project's board events. Returns a `release`
 * function — when the last holder releases, the underlying WS stream is
 * torn down. Safe to call from React effects.
 */
export function acquireBoardSubscription(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): () => void {
  const key = boardKey(environmentId, projectId);
  const existing = subscriptions.get(key);
  if (existing) {
    existing.refCount += 1;
    return () => releaseBoardSubscription(key);
  }

  const entry: BoardSubscriptionEntry = {
    environmentId,
    projectId,
    refCount: 1,
    currentSource: null,
    unsubscribe: NOOP,
    unsubscribeConnectionListener: null,
    snapshotLoadedAt: null,
    error: null,
  };
  subscriptions.set(key, entry);

  useBoardStore.getState().setStatus(environmentId, projectId, "loading");
  entry.unsubscribeConnectionListener = subscribeEnvironmentConnections(() => {
    try {
      attachBoardSubscription(entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useBoardStore.getState().setStatus(environmentId, projectId, "error", message);
    }
  });

  try {
    attachBoardSubscription(entry);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    useBoardStore.getState().setStatus(environmentId, projectId, "error", message);
  }

  return () => releaseBoardSubscription(key);
}

function releaseBoardSubscription(key: string): void {
  const entry = subscriptions.get(key);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount > 0) return;
  try {
    entry.unsubscribe();
  } catch {
    // noop
  }
  entry.unsubscribeConnectionListener?.();
  subscriptions.delete(key);
}

export function __resetBoardStoreForTests(): void {
  for (const entry of subscriptions.values()) {
    try {
      entry.unsubscribe();
    } catch {
      // noop
    }
    entry.unsubscribeConnectionListener?.();
  }
  subscriptions.clear();
  useBoardStore.setState({
    cardsByKey: {},
    dismissedGhostsByKey: {},
    snapshotSequenceByKey: {},
    statusByKey: {},
    errorByKey: {},
  });
}

// ---------------------------------------------------------------------------
// Command dispatchers (optimistic + server commit)
// ---------------------------------------------------------------------------

export interface BoardCreateCardInput {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly description?: string | null;
  readonly seededPrompt?: string | null;
  readonly column: FeatureCardStoredColumn;
  readonly linkedThreadId?: ThreadId | null;
  readonly linkedProposedPlanId?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sortByOrder(cards: ReadonlyArray<FeatureCard>): FeatureCard[] {
  return [...cards].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function computeNextSortOrderForAppend(
  cards: ReadonlyArray<FeatureCard>,
  column: FeatureCardStoredColumn,
): number {
  const inColumn = sortByOrder(cards.filter((c) => c.column === column && c.archivedAt === null));
  if (inColumn.length === 0) return 0;
  return inColumn[inColumn.length - 1]!.sortOrder + BOARD_DEFAULT_SORT_SPACING;
}

export function computeSortOrderBetween(
  cards: ReadonlyArray<FeatureCard>,
  column: FeatureCardStoredColumn,
  beforeId: FeatureCardId | null,
  afterId: FeatureCardId | null,
): { sortOrder: number; needsReindex: boolean } {
  const inColumn = sortByOrder(cards.filter((c) => c.column === column && c.archivedAt === null));
  const before = beforeId ? inColumn.find((c) => c.id === beforeId) : null;
  const after = afterId ? inColumn.find((c) => c.id === afterId) : null;
  const prev = before ? before.sortOrder : null;
  const next = after ? after.sortOrder : null;
  const sortOrder = computeMidpointSortOrder(prev, next);
  const needsReindex =
    prev !== null && next !== null && Math.abs(next - prev) < BOARD_REINDEX_THRESHOLD * 4;
  return { sortOrder, needsReindex };
}

export async function createBoardCard(input: BoardCreateCardInput): Promise<FeatureCard> {
  const api = ensureEnvironmentApi(input.environmentId);
  const store = useBoardStore.getState();
  const existing = selectCardsForProject(store, input.environmentId, input.projectId);
  const sortOrder = computeNextSortOrderForAppend(existing, input.column);
  const now = nowIso();
  const cardId = newFeatureCardId();
  const optimisticCard: FeatureCard = {
    id: cardId,
    projectId: input.projectId,
    title: input.title as never,
    description: input.description ?? null,
    seededPrompt: input.seededPrompt ?? null,
    column: input.column,
    sortOrder,
    linkedThreadId: input.linkedThreadId ?? null,
    linkedProposedPlanId: (input.linkedProposedPlanId ?? null) as never,
    createdAt: now as never,
    updatedAt: now as never,
    archivedAt: null,
  };

  store.optimisticUpsertCard(input.environmentId, input.projectId, optimisticCard);

  const command: BoardCommand = {
    type: "board.card.create",
    commandId: newCommandId(),
    cardId,
    projectId: input.projectId,
    title: input.title as never,
    description: input.description ?? null,
    seededPrompt: input.seededPrompt ?? null,
    column: input.column,
    sortOrder,
    linkedThreadId: input.linkedThreadId ?? null,
    linkedProposedPlanId: (input.linkedProposedPlanId ?? null) as never,
    createdAt: now as never,
  };

  try {
    await api.board.dispatchCommand(command);
    return optimisticCard;
  } catch (err) {
    // Roll back the optimistic insert. Real state will catch up from the
    // server stream if the server actually committed the command.
    useBoardStore.getState().optimisticDeleteCard(input.environmentId, input.projectId, cardId);
    throw err;
  }
}

export async function updateBoardCard(input: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  cardId: FeatureCardId;
  title?: string;
  description?: string | null;
  seededPrompt?: string | null;
}): Promise<void> {
  const api = ensureEnvironmentApi(input.environmentId);
  const now = nowIso();
  const store = useBoardStore.getState();
  const existing = selectCardsForProject(store, input.environmentId, input.projectId).find(
    (c) => c.id === input.cardId,
  );
  if (!existing) {
    throw new Error("Card not found for update");
  }
  const optimistic: FeatureCard = {
    ...existing,
    ...(input.title !== undefined ? { title: input.title as never } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.seededPrompt !== undefined ? { seededPrompt: input.seededPrompt } : {}),
    updatedAt: now as never,
  };
  store.optimisticUpsertCard(input.environmentId, input.projectId, optimistic);

  const command: BoardCommand = {
    type: "board.card.update",
    commandId: newCommandId(),
    cardId: input.cardId,
    projectId: input.projectId,
    ...(input.title !== undefined ? { title: input.title as never } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.seededPrompt !== undefined ? { seededPrompt: input.seededPrompt } : {}),
    updatedAt: now as never,
  };

  try {
    await api.board.dispatchCommand(command);
  } catch (err) {
    useBoardStore.getState().optimisticUpsertCard(input.environmentId, input.projectId, existing);
    throw err;
  }
}

export async function moveBoardCard(input: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  cardId: FeatureCardId;
  toColumn: FeatureCardStoredColumn;
  sortOrder: number;
}): Promise<void> {
  const api = ensureEnvironmentApi(input.environmentId);
  const store = useBoardStore.getState();
  const previous = selectCardsForProject(store, input.environmentId, input.projectId).find(
    (c) => c.id === input.cardId,
  );
  if (!previous) return;

  store.optimisticMoveCard(
    input.environmentId,
    input.projectId,
    input.cardId,
    input.toColumn,
    input.sortOrder,
  );
  const now = nowIso();
  const command: BoardCommand = {
    type: "board.card.move",
    commandId: newCommandId(),
    cardId: input.cardId,
    projectId: input.projectId,
    toColumn: input.toColumn,
    sortOrder: input.sortOrder,
    updatedAt: now as never,
  };
  try {
    await api.board.dispatchCommand(command);
  } catch (err) {
    store.optimisticMoveCard(
      input.environmentId,
      input.projectId,
      input.cardId,
      previous.column,
      previous.sortOrder,
    );
    throw err;
  }
}

export async function archiveBoardCard(input: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  cardId: FeatureCardId;
}): Promise<void> {
  const api = ensureEnvironmentApi(input.environmentId);
  const store = useBoardStore.getState();
  const previous = selectCardsForProject(store, input.environmentId, input.projectId).find(
    (card) => card.id === input.cardId,
  );
  if (!previous) {
    throw new Error("Card not found for archive");
  }
  const now = nowIso();
  store.optimisticArchiveCard(input.environmentId, input.projectId, input.cardId, now);
  const command: BoardCommand = {
    type: "board.card.archive",
    commandId: newCommandId(),
    cardId: input.cardId,
    projectId: input.projectId,
    archivedAt: now as never,
  };
  try {
    await api.board.dispatchCommand(command);
  } catch (err) {
    store.optimisticUpsertCard(input.environmentId, input.projectId, previous);
    throw err;
  }
}

export async function deleteBoardCard(input: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  cardId: FeatureCardId;
}): Promise<void> {
  const api = ensureEnvironmentApi(input.environmentId);
  const store = useBoardStore.getState();
  const previous = selectCardsForProject(store, input.environmentId, input.projectId).find(
    (c) => c.id === input.cardId,
  );
  store.optimisticDeleteCard(input.environmentId, input.projectId, input.cardId);
  const now = nowIso();
  const command: BoardCommand = {
    type: "board.card.delete",
    commandId: newCommandId(),
    cardId: input.cardId,
    projectId: input.projectId,
    deletedAt: now as never,
  };
  try {
    await api.board.dispatchCommand(command);
  } catch (err) {
    if (previous) {
      store.optimisticUpsertCard(input.environmentId, input.projectId, previous);
    }
    throw err;
  }
}

export async function linkBoardCardThread(input: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  cardId: FeatureCardId;
  threadId: ThreadId;
}): Promise<void> {
  const api = ensureEnvironmentApi(input.environmentId);
  const now = nowIso();
  const store = useBoardStore.getState();
  const previous = selectCardsForProject(store, input.environmentId, input.projectId).find(
    (c) => c.id === input.cardId,
  );
  if (previous) {
    store.optimisticUpsertCard(input.environmentId, input.projectId, {
      ...previous,
      linkedThreadId: input.threadId,
      updatedAt: now as never,
    });
  }
  const command: BoardCommand = {
    type: "board.card.linkThread",
    commandId: newCommandId(),
    cardId: input.cardId,
    projectId: input.projectId,
    threadId: input.threadId,
    updatedAt: now as never,
  };
  try {
    await api.board.dispatchCommand(command);
  } catch (err) {
    if (previous) {
      store.optimisticUpsertCard(input.environmentId, input.projectId, previous);
    }
    throw err;
  }
}

export async function unlinkBoardCardThread(input: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  cardId: FeatureCardId;
  previousThreadId: ThreadId | null;
}): Promise<void> {
  const api = ensureEnvironmentApi(input.environmentId);
  const now = nowIso();
  const store = useBoardStore.getState();
  const previous = selectCardsForProject(store, input.environmentId, input.projectId).find(
    (c) => c.id === input.cardId,
  );
  if (previous) {
    store.optimisticUpsertCard(input.environmentId, input.projectId, {
      ...previous,
      linkedThreadId: null,
      updatedAt: now as never,
    });
  }
  const command: BoardCommand = {
    type: "board.card.unlinkThread",
    commandId: newCommandId(),
    cardId: input.cardId,
    projectId: input.projectId,
    previousThreadId: input.previousThreadId,
    updatedAt: now as never,
  };
  try {
    await api.board.dispatchCommand(command);
  } catch (err) {
    if (previous) {
      store.optimisticUpsertCard(input.environmentId, input.projectId, previous);
    }
    throw err;
  }
}

export async function dismissGhostCard(input: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadId: ThreadId;
}): Promise<void> {
  const api = ensureEnvironmentApi(input.environmentId);
  const now = nowIso();
  useBoardStore
    .getState()
    .optimisticDismissGhost(input.environmentId, input.projectId, input.threadId, now);
  const command: BoardCommand = {
    type: "board.ghost-card.dismiss",
    commandId: newCommandId(),
    projectId: input.projectId,
    threadId: input.threadId,
    dismissedAt: now as never,
  };
  try {
    await api.board.dispatchCommand(command);
  } catch (err) {
    useBoardStore
      .getState()
      .optimisticUndismissGhost(input.environmentId, input.projectId, input.threadId);
    throw err;
  }
}

export async function undismissGhostCard(input: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadId: ThreadId;
}): Promise<void> {
  const api = ensureEnvironmentApi(input.environmentId);
  const now = nowIso();
  useBoardStore
    .getState()
    .optimisticUndismissGhost(input.environmentId, input.projectId, input.threadId);
  const command: BoardCommand = {
    type: "board.ghost-card.undismiss",
    commandId: newCommandId(),
    projectId: input.projectId,
    threadId: input.threadId,
    undismissedAt: now as never,
  };
  try {
    await api.board.dispatchCommand(command);
  } catch (err) {
    useBoardStore
      .getState()
      .optimisticDismissGhost(input.environmentId, input.projectId, input.threadId, now);
    throw err;
  }
}

// Silence unused-var lint for helpers pulled from shared infra at the top.
void randomUUID;
