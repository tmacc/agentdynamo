# Plan: Planning Board (per-project kanban with live agent tracking)

## Problem

T3 Code gives users a powerful way to talk to agents, but no way to **plan what to talk about next**. Feature work happens ad-hoc: the user opens a thread, types a prompt, and hopes the result is what they wanted. There is no backlog, no queue, no bird's-eye view of "what's in flight right now."

Users who run multiple agents in parallel (team tasks, worktrees) have no single surface that answers: **"What's being worked on, what's done, and what should I start next?"**

## Goals

1. Per-project kanban board that shows feature ideas, queued work, live agent activity, and completed work in one view.
2. Live status on cards — pulsing indicators, elapsed timers, current tool call — reusing existing orchestration push infrastructure.
3. Seamless bridge between cards and threads: starting a card creates a seeded thread; completing a thread moves its card.
4. External sync to GitHub Issues and Linear (stretch, Phase 3).
5. No clutter: default experience (Chat mode) stays untouched. Board is opt-in.

## Non-goals

- Multi-user / team collaboration (out of scope for now).
- Cross-project "global board" view (v2 — filter over per-project boards).
- Full project-management tool (no milestones, epics, sprints, estimates).

---

## Architecture overview

### Mental model

A board is a **projection of two things**:

1. **FeatureCards** — lightweight user-created items (title, description, column, sort order, optional seeded prompt). These are new domain entities.
2. **Threads** — the existing thread/session/team-task model, projected into board columns based on orchestration state.

The board never duplicates thread state. "In Progress" and "Review" columns are **live read-only projections** of thread activity. "Ideas" and "Planned" are user-editable. "Done" is derived from archived threads or merged PRs.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Ideas          Planned         In Progress     Review       Done   │
│  (user cards)   (user cards     (threads,       (threads,    (arch- │
│                  with prompts)   derived)        derived)     ived) │
│ ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐        │
│ │ Add i18n  │  │ Dark mode │  │ 🟢 Auth   │  │ ✓ Nav bar │        │
│ │           │  │ [prompt]  │  │ claude 4m  │  │ 3 files   │        │
│ │           │  │           │  │ ▸ editing  │  │ +47 −12   │        │
│ └───────────┘  └───────────┘  │ user.ts   │  └───────────┘        │
│                               └───────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Data flow

```
User creates card (RPC)
  → board.createCard command
  → FeatureCardCreated event
  → persisted to SQLite (event store + projection)
  → pushed to client via board subscription stream

User clicks "Start Agent" on a Planned card
  → seeds a new draft thread with card's prompt
  → card gets linkedThreadId after thread is dispatched
  → thread starts → orchestration events move card to "In Progress" automatically

Thread completes
  → orchestration.domainEvent pushes turn completion
  → board projection re-derives column → card moves to "Review"

User archives thread / PR merges
  → card moves to "Done"
```

---

## Data model

### New aggregate: FeatureCard

```typescript
// packages/contracts/src/board.ts (new file)

export const FeatureCardId = TrimmedNonEmptyString;

export const FeatureCardColumn = Schema.Literals([
  "ideas",
  "planned",
  // "in-progress", "review", "done" are derived — not stored on card
]);

export const FeatureCard = Schema.Struct({
  id: FeatureCardId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),        // markdown, optional
  seededPrompt: Schema.NullOr(Schema.String),        // pre-built prompt for agent
  column: FeatureCardColumn,                          // user-controlled column
  sortOrder: Schema.Number,                           // within column
  linkedThreadId: Schema.NullOr(ThreadId),            // set when agent is started
  linkedProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
  externalRef: Schema.optional(Schema.Struct({        // GitHub/Linear sync
    provider: Schema.Literals(["github", "linear"]),
    externalId: TrimmedNonEmptyString,
    url: TrimmedNonEmptyString,
  })),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
});
```

### New events

```typescript
// Added to orchestration event union or as a separate board event aggregate

"board.card-created"        // { card: FeatureCard }
"board.card-updated"        // { cardId, patch: Partial<FeatureCard> }
"board.card-moved"          // { cardId, toColumn, sortOrder }
"board.card-linked"         // { cardId, threadId }
"board.card-unlinked"       // { cardId }
"board.card-archived"       // { cardId }
```

### Persistence (follows existing patterns)

- **Event store**: new aggregate kind `"board"` in `orchestration_events` table.
- **Projection table**: `projection_board_cards` (id, project_id, title, description, seeded_prompt, column, sort_order, linked_thread_id, linked_proposed_plan_id, external_ref_json, created_at, updated_at, archived_at).
- **Projection state**: tracked in `projection_state` as `board_projector` with its own sequence cursor.
- **Migration**: new table DDL added to SQLite migration chain.

### Derived columns (no persistence — computed client-side)

The "In Progress," "Review," and "Done" columns are not stored. They are derived by the client from:

| Derived column | Source | Condition |
|---|---|---|
| In Progress | Threads with `session.status === "running"` AND `activeTurnId != null` | Thread is linked to a card, OR thread belongs to this project and is running |
| Review | Threads where `latestTurn.state === "completed"` AND thread is not archived AND has unreviewed diff | Derived from `turnDiffSummaries` + `latestTurn` |
| Done | Threads with `archivedAt != null` OR merged PR detected | Uses existing `resolveThreadPr` + git status |

Unlinked threads that are running also appear in "In Progress" as auto-generated cards (ghost cards) so the board is always a complete picture.

---

## RPC contract

```typescript
// packages/contracts/src/rpc.ts — new methods added to ORCHESTRATION_WS_METHODS
// or a new BOARD_WS_METHODS namespace

"board.listCards"        // { projectId } → { cards: FeatureCard[] }
"board.createCard"       // { projectId, title, description?, seededPrompt?, column } → { card }
"board.updateCard"       // { cardId, patch } → { card }
"board.moveCard"         // { cardId, toColumn, sortOrder } → { card }
"board.archiveCard"      // { cardId } → void
"board.deleteCard"       // { cardId } → void
"board.linkThread"       // { cardId, threadId } → { card }
"board.unlinkThread"     // { cardId } → { card }
"board.subscribeProject" // { projectId } → Stream<BoardStreamEvent>
```

**`board.subscribeProject`** streams:

1. Initial snapshot (all cards for project).
2. Card CRUD events.
3. **Thread state deltas** relevant to the board (reuses `orchestration.domainEvent` internally — the server filters and re-projects for board consumers so the client doesn't duplicate projection logic).

---

## UI design

### Entry points (how users get to the board)

1. **Chat header segmented control**: adds `Board` alongside existing header actions. Icon-only by default, label appears on hover/focus. Only visible when a project is active.

   ```
   ┌─────────────────────────────────────────────────┐
   │ [≡] Thread title   [Project ▾]  ... [⊞] [◻] [▤]│
   │                                       │    │   │
   │                                    Board Diff Term
   └─────────────────────────────────────────────────┘
   ```

   The `[⊞]` (LayoutGrid icon) toggle switches the main content area from Chat → Board. Sidebar remains unchanged.

2. **Command palette**: new action group `"Board"` with:
   - "Open board for {project}"
   - "Add idea to {project}"
   - "Add planned card to {project}"

3. **Keyboard shortcut**: `⌘⇧B` / `Ctrl+Shift+B` — opens board for active project.

4. **Sidebar project context menu**: "Open Board" item added below "Project Intelligence."

5. **From chat**: when a `ProposedPlanCard` is rendered in timeline, add a subtle "Add to Board" action in its overflow menu. This creates a Planned card linked to the proposed plan.

### Board layout

The board replaces the main content area (same slot as ChatView). The sidebar stays.

```
┌──────────┬────────────────────────────────────────────────┐
│ SIDEBAR  │  BOARD HEADER                                  │
│          │  [≡] Project Name · Board    [+ Add Card] [⚙]  │
│ Projects │ ─────────────────────────────────────────────── │
│  └ Threads│  Ideas    │ Planned  │ In Progress │ Review │ Done │
│          │ ┌───────┐ │┌───────┐ │ ┌─────────┐ │┌──────┐│     │
│          │ │Card A │ ││Card B │ │ │🟢Thread │ ││✓ Thr ││     │
│          │ │       │ ││[▸ ⚡] │ │ │claude   │ ││3 file││     │
│          │ └───────┘ │└───────┘ │ │4m 12s   │ │└──────┘│     │
│          │ ┌───────┐ │         │ │▸ user.ts │ │        │     │
│          │ │Card C │ │         │ └─────────┘ │        │     │
│          │ └───────┘ │         │ ┌─────────┐ │        │     │
│          │           │         │ │Ghost thr│ │        │     │
│          │           │         │ │(no card)│ │        │     │
│          │           │         │ └─────────┘ │        │     │
│          │           │         │             │        │     │
└──────────┴───────────┴─────────┴─────────────┴────────┴─────┘
```

### Card anatomy

**User card (Ideas / Planned):**
```
┌──────────────────────────────┐
│ Add dark mode support        │  ← title (editable inline)
│ Support system preference &  │  ← description preview (2 lines max)
│ manual toggle...             │
│                              │
│ [▸ Start Agent]   [⋯]       │  ← CTA only on Planned cards with prompt
└──────────────────────────────┘
```

**Live card (In Progress — derived from thread):**
```
┌──────────────────────────────┐
│ 🟢 Auth flow refactor        │  ← pulsing dot = running
│ claude · sonnet-4.6  · 4m 12s│  ← provider, model, LiveElapsed
│ ▸ Editing auth/login.tsx     │  ← latest activity (from activities[])
│ ┌─────┐ ┌─────┐             │  ← team agent pills (if team tasks)
│ │🔵 DB│ │🟡 UI│             │
│ └─────┘ └─────┘             │
│ 2 files changed  +47 −12    │  ← diff stats (from turnDiffSummaries)
│ [Open Thread →]              │  ← click navigates to chat
└──────────────────────────────┘
```

**Review card (derived from completed thread):**
```
┌──────────────────────────────┐
│ ✓ Navigation redesign        │
│ Worked for 6m 34s            │
│ 5 files changed  +128 −43   │
│ ┌────────────────────────┐   │
│ │ PR #42 — Open ↗       │   │  ← if PR detected
│ └────────────────────────┘   │
│ [Open Thread →]  [Archive]   │
└──────────────────────────────┘
```

### Card interactions

| Interaction | Ideas column | Planned column | In Progress | Review | Done |
|---|---|---|---|---|---|
| Drag to reorder | ✓ (manual sort) | ✓ (manual sort) | — (auto-sorted by start time) | — | — |
| Drag between columns | Ideas ↔ Planned | Planned → Ideas | — (derived) | — (derived) | — |
| Edit title/description | ✓ inline | ✓ inline | — (thread title) | — | — |
| Edit seeded prompt | — | ✓ (opens prompt editor) | — | — | — |
| Start Agent | — | ✓ (creates draft thread) | — | — | — |
| Open Thread | — | — | ✓ → Chat mode | ✓ → Chat mode | ✓ → Chat mode |
| Archive card | ✓ | ✓ | — (archive thread instead) | ✓ (archives thread + card) | — |
| Delete card | ✓ | ✓ (if no linked thread) | — | — | — |
| Link existing thread | — | ✓ (picker) | — | — | — |

### Drag-and-drop

Reuse `@dnd-kit/core` (already a dependency) with `SortableContext` and `verticalListSortingStrategy` — same pattern as sidebar thread reordering. Cards snap to columns; column drop zones highlight on drag-over.

Restrict drag to user-editable columns only (Ideas ↔ Planned). Derived columns reject drops.

### "Start Agent" flow

When user clicks "Start Agent" on a Planned card:

1. Read card's `seededPrompt` (or fall back to `title + "\n\n" + description` if no prompt).
2. Call existing `startNewThreadInProjectFromContext()` with the prompt pre-filled.
3. Navigate to the new draft thread in Chat mode.
4. When the thread is dispatched and gets a server thread ID, fire `board.linkThread({ cardId, threadId })`.
5. Board subscription receives the link event; card disappears from "Planned" and the thread appears in "In Progress."

### Auto-promotion of proposed plans

When an agent produces a `ProposedPlan` in any thread, the board can optionally auto-create a card:

- Timeline renders existing `ProposedPlanCard` with new "Add to Board" action.
- Clicking it fires `board.createCard({ ...fromPlan, column: "planned", linkedProposedPlanId })`.
- The card's `seededPrompt` is set to `buildPlanImplementationPrompt(planMarkdown)` (already exists).

---

## Server implementation

### New files

| File | Role |
|---|---|
| `packages/contracts/src/board.ts` | Schema definitions (FeatureCard, events, RPC schemas) |
| `apps/server/src/board/Layers/BoardEngine.ts` | Command → event → persist (mirrors OrchestrationEngine pattern) |
| `apps/server/src/board/Layers/BoardProjection.ts` | Event → projection table updates |
| `apps/server/src/board/Layers/BoardSubscription.ts` | Stream subscription for live board state |
| `apps/server/src/board/Services/BoardEngine.ts` | Effect service definition |
| `apps/server/src/board/Services/BoardProjection.ts` | Effect service definition |
| `apps/server/src/board/Services/BoardSubscription.ts` | Effect service definition |

### Event-sourcing integration

Two options:

**Option A — Shared aggregate (recommended for v1):** Add board events as a new aggregate kind (`"board"`) within the existing `orchestration_events` table and `OrchestrationEngine` processing pipeline. Pro: single event log, single projection state table, no new infra. Con: couples board lifecycle to orchestration engine.

**Option B — Separate engine:** New `BoardEngine` with its own event table. Pro: clean separation. Con: duplicates engine machinery, harder to cross-reference thread events.

Recommend **Option A** for Phase 1, migrate to B later if the event volume justifies it.

### Board projection as derived view

The key insight: "In Progress," "Review," and "Done" columns are **not persisted as card state**. They are computed by joining:

- `projection_board_cards` (user cards with linkedThreadId)
- `projection_threads` + `projection_thread_sessions` (thread status)
- `projection_turns` (turn completion)
- Existing git status / PR detection (already client-side)

The `board.subscribeProject` stream merges board-card events with thread-status events for linked threads. The server does the join so the client receives a unified stream.

---

## Client implementation

### New files

| File | Role |
|---|---|
| `apps/web/src/components/BoardView.tsx` | Main board layout — columns + cards |
| `apps/web/src/components/board/BoardColumn.tsx` | Single column with droppable zone |
| `apps/web/src/components/board/BoardCard.tsx` | Card component (user / live / review variants) |
| `apps/web/src/components/board/BoardCardEditor.tsx` | Inline card create/edit form |
| `apps/web/src/components/board/BoardHeader.tsx` | Board header with add-card CTA |
| `apps/web/src/boardStore.ts` | Zustand store for board state (cards, subscription, optimistic updates) |
| `apps/web/src/boardProjection.ts` | Client-side derived column computation |

### State management

```typescript
// boardStore.ts

interface BoardStore {
  // Persisted cards (from server)
  cardsByProjectId: Record<ProjectId, FeatureCard[]>;

  // Subscription state
  subscriptionStatus: "idle" | "connecting" | "connected" | "error";

  // Optimistic state for drag-in-progress
  optimisticMoves: Map<FeatureCardId, { column: FeatureCardColumn; sortOrder: number }>;

  // Actions
  createCard: (input: CreateCardInput) => Promise<void>;
  updateCard: (cardId: FeatureCardId, patch: Partial<FeatureCard>) => Promise<void>;
  moveCard: (cardId: FeatureCardId, column: FeatureCardColumn, sortOrder: number) => Promise<void>;
  archiveCard: (cardId: FeatureCardId) => Promise<void>;
  linkThread: (cardId: FeatureCardId, threadId: ThreadId) => Promise<void>;
}
```

Derived columns are computed via selectors that combine `boardStore` cards with `useStore` thread state:

```typescript
// boardProjection.ts

function deriveBoardColumns(input: {
  cards: FeatureCard[];
  threads: SidebarThreadSummary[];
  threadLastVisitedAts: Record<string, string | null>;
  gitStatusByThread: Map<string, GitStatusResult>;
}): BoardColumnData[] {
  // Ideas: cards where column === "ideas"
  // Planned: cards where column === "planned"
  // In Progress: threads with running session (matched to cards via linkedThreadId, plus unlinked "ghost" cards)
  // Review: threads with completed latest turn + unreviewed diff
  // Done: archived threads + merged PRs
}
```

### Routing

Add `view` search param to existing chat routes rather than new route paths:

```typescript
// Existing: /_chat/$environmentId/$threadId
// Board:    /_chat/$environmentId/$threadId?view=board
// Or from project context: /_chat?view=board&projectId=xxx&envId=xxx
```

The `ChatRouteLayout` checks `view` param and renders `<BoardView>` instead of `<Outlet>` when `view === "board"`.

Alternative: dedicated route `/_chat/$environmentId/board/$projectId`. Cleaner URLs but requires route-tree changes. Decide during implementation.

---

## External sync (Phase 3 — GitHub Issues + Linear)

### GitHub Issues

- Use `gh` CLI (already available in terminal) or GitHub API via server proxy.
- Sync strategy: **pull-only first** (import issues as cards), then **bidirectional** (create issues from cards).
- Card `externalRef` stores `{ provider: "github", externalId: "42", url: "https://..." }`.
- Sync trigger: manual "Import from GitHub" button in board header, or periodic poll.

### Linear

- Linear GraphQL API via server proxy (requires API key in settings).
- Same `externalRef` pattern.
- Map Linear issue states → board columns.

### Sync conflict resolution

- External source is always "truth" for title/description when synced.
- Column mapping is configurable (e.g., Linear "In Progress" → board "In Progress").
- Card can be unlinked from external source to stop syncing.

---

## Phased delivery

### Phase 1 — Core board (target: 2-3 weeks)

- [ ] `packages/contracts/src/board.ts` — FeatureCard schema, event schemas, RPC schemas
- [ ] `apps/server/src/board/` — BoardEngine (event sourcing), BoardProjection, BoardSubscription
- [ ] SQLite migration for `projection_board_cards` table
- [ ] `board.*` RPC handlers in `wsServer`
- [ ] `apps/web/src/boardStore.ts` — Zustand store + subscription
- [ ] `apps/web/src/boardProjection.ts` — derived column computation
- [ ] `apps/web/src/components/BoardView.tsx` — 5-column layout
- [ ] `apps/web/src/components/board/BoardCard.tsx` — user card + live card variants
- [ ] Board toggle in ChatHeader (LayoutGrid icon)
- [ ] Command palette "Open board" action
- [ ] Keyboard shortcut `⌘⇧B`
- [ ] DnD for user columns (Ideas ↔ Planned)
- [ ] "Start Agent" CTA on Planned cards
- [ ] Ghost cards for unlinked running threads

### Phase 2 — Polish + proposed plan integration (1-2 weeks)

- [ ] "Add to Board" action on ProposedPlanCard in timeline
- [ ] Board card → thread backlink in chat header
- [ ] Card description editor (markdown, inline)
- [ ] Prompt editor sheet for Planned cards
- [ ] Board settings (column visibility, sort preferences in ClientSettings)
- [ ] Sidebar project context menu "Open Board"
- [ ] Empty state for boards with no cards

### Phase 3 — External sync (2-3 weeks)

- [ ] GitHub Issues import (via `gh api`)
- [ ] Linear API integration (server proxy + API key in settings)
- [ ] Bidirectional sync for GitHub
- [ ] External ref display on cards (icon + link)
- [ ] Sync status indicators
- [ ] Conflict resolution UX

---

## Open questions

1. **Should ghost cards (unlinked running threads) be dismissible?** Probably yes — user might not want every thread on the board.
2. **Card limits per column?** Virtualize if > 50 cards; warn if > 200 per project.
3. **Board state on thread archive**: auto-move card to Done, or let user decide?
4. **Multi-environment boards**: if project spans local + remote environments, should the board merge threads from all environments? (Probably yes — mirrors sidebar grouping logic.)
