# Design Mode — Architecture & Implementation Plan

## Overview

A visual design mode for T3 Code that is a **bidirectional view of the user's codebase**, not a separate authored artifact. Users and agents can both edit pages and components in build mode (code) or design mode (visual), with the user's connected AI harness translating between the two. An infinite canvas shows all routes of the project; a separate canvas tab shows all components. New screens can be sketched visually then materialized into real code by the agent.

---

## Core Principles

1. **Code is the source of truth.** Designs are a live view. The user's repo never gains a `.t3/design/` folder. (Component registry, canvas layout, sample data, and transient sketches live in Dynamo's local storage, not the user's git.)
2. **Lean on the AI harness for hard problems.** Auto-discovery, sample data generation, structural code edits — all delegated to the user's connected AI agent. We build deterministic paths where they're cheap and reliable; AI fills the rest.
3. **Users and agents share one workspace.** No locks. Agent edits stream into the canvas live. Visual edits flow back through the same agent thread so the agent stays in context.
4. **No MVP.** Final feature, all phases shipped together.

---

## Architecture

### Source of Truth
| State | Where it lives | Why |
|---|---|---|
| Page/component code | User's repo (their git) | Code is canonical |
| Component registry (parsed metadata, prop schemas) | Dynamo local storage, per project | Derived from code, expensive to compute, branch-scoped via worktree |
| Sample data per component | Dynamo local storage, per project | AI-generated, regeneratable |
| Canvas layout (route positions, zoom, focused page) | Dynamo local storage, per thread | UX state, not portable |
| Per-route preview config (params, auth state) | Dynamo local storage, per project | Like sample data |
| Sketch state (new screens not yet materialized) | Dynamo local storage, per thread | Discarded after materialization |

### The Editor Loop
```
                       ┌──────────────────────────┐
                       │  User clicks button on   │
                       │  canvas, edits text      │
                       └────────────┬─────────────┘
                                    ▼
                       ┌──────────────────────────┐
                       │  Codemod layer:          │
                       │  Is this a known op?     │
                       └─────┬──────────────┬─────┘
                          yes│              │no
                             ▼              ▼
                ┌─────────────────┐  ┌────────────────────┐
                │  Deterministic  │  │  AI harness:       │
                │  AST edit       │  │  agent rewrites    │
                │  (jscodeshift)  │  │  the file          │
                └────────┬────────┘  └─────────┬──────────┘
                         │                     │
                         └──────────┬──────────┘
                                    ▼
                       ┌──────────────────────────┐
                       │  Code file changes on    │
                       │  disk → file watcher →   │
                       │  canvas re-renders       │
                       └──────────────────────────┘
```

### The Project Indexer (new core service)
Runs on first design-mode open and on relevant file changes.

```
                ┌────────────────────────────────┐
                │  Indexer agent (AI harness)    │
                │  given: project root + framework hint │
                └─────────────┬──────────────────┘
                              ▼
        ┌─────────────────────┴──────────────────────┐
        │                                            │
        ▼                                            ▼
┌──────────────────┐                       ┌────────────────────┐
│  Route discovery │                       │ Component discovery│
│  - identify       │                       │  - find components/│
│    framework     │                       │    dir             │
│  - list routes   │                       │  - parse exports   │
│  - capture        │                       │  - infer props     │
│    params         │                       │  - categorize      │
└────────┬──────────┘                       └─────────┬──────────┘
         │                                            │
         ▼                                            ▼
┌──────────────────┐                       ┌────────────────────┐
│  Sample data     │                       │  Component registry│
│  per route       │                       │  in Dynamo storage │
└──────────────────┘                       └────────────────────┘
```

Indexer outputs cached in Dynamo storage. Categorizes components:
- **`ready`** — pure component, props inferred, sample data generated, renders in isolation
- **`needs-config`** — depends on context/providers/hooks; user supplies config or AI suggests one
- **`unrenderable`** — can't render outside app context (e.g. server-only); shown in registry but not draggable

---

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ ChatRouteLayout (search.view === "design")                          │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ DesignModeView                                                  │ │
│ │ ┌──────────────────────────────────────────────────────────┐    │ │
│ │ │ CanvasTabs:  [Routes] [Components] [Library]             │    │ │
│ │ └──────────────────────────────────────────────────────────┘    │ │
│ │ ┌──────────────┬─────────────────────────────┬─────────────┐    │ │
│ │ │ ComponentsRail│ DesignCanvas (active tab)   │ RightPanel  │    │ │
│ │ │              │                              │             │    │ │
│ │ │ (registry +  │  Routes tab:                 │ if sketching│    │ │
│ │ │  sample data)│  ┌────────┐ ┌────────┐       │   PuckFields│    │ │
│ │ │              │  │ Route  │ │ Route  │       │             │    │ │
│ │ │              │  │ /home  │ │ /about │       │ if focused: │    │ │
│ │ │              │  └────────┘ └────────┘       │   PreviewCfg│    │ │
│ │ │              │  ┌────────┐                  │   StateToggle│    │ │
│ │ │              │  │ Route  │                  │   AskAgent  │    │ │
│ │ │              │  │/dash/[id]│                │   button    │    │ │
│ │ │              │  └────────┘                  │             │    │ │
│ │ │              │                              │ otherwise:  │    │ │
│ │ │              │  Components tab:             │   collapsed │    │ │
│ │ │              │  Each component shown with   │             │    │ │
│ │ │              │  variants stacked vertically │             │    │ │
│ │ └──────────────┴─────────────────────────────┴─────────────┘    │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Build Phases

| Phase | Focus | Status |
|-------|-------|--------|
| **P0** | Foundation: mode toggle, route, Dynamo storage scaffold | Foundation |
| **P1** | Project Indexer: AI-powered scan, registry, sample data | Critical infra |
| **P2** | Canvas Shell: infinite canvas, tabs, route/component cards | UI surface |
| **P3** | Renderer: live preview of routes and components in cards | First visual payoff |
| **P4** | Code-Bidirectional Editor: Puck + codemod + AI fallback | Core feature |
| **P5** | Sketch & Materialize: new screens, agent handoff | New design flow |
| **P6** | Thread/Agent Integration: per-thread state, concurrent editing | Multi-actor support |
| **P7** | Polish: shortcuts, minimap, animations, perf | Final UX |

---

## Issues

### PHASE 0 — Foundation

**[P0-1] Add `view=design` search param to `_chat` route**
Extend the `view=board` pattern to include `"design"`. New file `apps/web/src/designRouteSearch.ts` mirroring `boardRouteSearch.ts`. Update `_chat.tsx` `validateSearch` and `ChatRouteLayout`.
Files: `_chat.tsx`, new `designRouteSearch.ts`
Depends on: nothing
Size: S

**[P0-2] Add mode toggle dropdown to sidebar footer**
In `SidebarChromeFooter` (Sidebar.tsx:2464), insert a `SidebarMenuItem` above settings using @base-ui/react Menu. Items: "Build" (clears `view`), "Design" (sets `view=design`). Active mode highlighted. Icon `LayoutDashboard` from lucide-react.
Files: `Sidebar.tsx`
Depends on: P0-1
Size: M

**[P0-3] Empty `DesignModeView` component**
Placeholder rendered when `view === "design"`. Renders a centered loading state for now. Mirrors `BoardRouteView`'s shape.
Files: new `apps/web/src/components/design/DesignModeView.tsx`, `_chat.tsx`
Depends on: P0-1
Size: S

**[P0-4] Define design data schemas in contracts**
Effect Schema definitions for: `ComponentRegistryEntry`, `RouteDescriptor`, `SampleData`, `CanvasLayoutState`, `PreviewConfig`, `SketchState`. These are Dynamo-local types — no server persistence yet (Phase P0-5 handles storage).
Files: new `packages/contracts/src/design.ts`, update `packages/contracts/src/index.ts`
Depends on: nothing
Size: M

**[P0-5] Dynamo-side storage for design state**
Local storage layer for design data, keyed by `(projectId, threadId?)`. Use existing client persistence pattern (`ensureLocalApi().persistence`). Endpoints: `getRegistry`, `setRegistry`, `getCanvasLayout`, `setCanvasLayout`, `getPreviewConfig`, `setPreviewConfig`, `getSketches`, `setSketches`. NOT in user's git — explicitly Dynamo state.
Files: new persistence handlers, RPC additions in `packages/contracts/src/rpc.ts`, server-side handler in `apps/server/`
Depends on: P0-4
Size: L

**[P0-6] Design mode Zustand store**
`useDesignModeStore` holding: `registry`, `routes`, `sampleData`, `canvas` (camera, focused id, active tab), `sketches`, `indexerStatus`. Actions for CRUD on each. Persistence sync to P0-5 storage.
Files: new `apps/web/src/designModeStore.ts`
Depends on: P0-4, P0-5
Size: M

---

### PHASE 1 — Project Indexer (AI-powered)

**[P1-1] Indexer agent harness adapter**
A wrapper that takes a "task description" and project context and dispatches to the user's connected AI harness (whatever provider/model they have configured). Returns structured JSON. Reuses existing `ProviderInstance` and `ModelSelection` infrastructure. Indexing must work non-interactively — this is a one-shot task, not a chat thread.
Files: new `apps/server/src/services/indexer/indexerAgent.ts`, new RPC `design.runIndexer`
Depends on: P0-5
Size: L

**[P1-2] Framework + route discovery**
Indexer task #1: detect React framework (Next.js App, Next.js Pages, TanStack, React Router, Vite + custom). Output: `{ framework, routesFile?, routes: RouteDescriptor[] }`. Each route includes path pattern, file path, params, layout chain. Falls back to AI scan if heuristics fail.
Files: `indexerAgent.ts`, prompts, parsers
Depends on: P1-1
Size: L

**[P1-3] Component discovery**
Indexer task #2: locate components directory, list components by file, classify each as `ready` / `needs-config` / `unrenderable`. For `ready`: extract prop signature (TS types, default props, JSDoc). Output: `ComponentRegistryEntry[]`.
Files: `indexerAgent.ts`, prompts, parsers
Depends on: P1-1
Size: L

**[P1-4] Sample data generation**
Indexer task #3: for each `ready` component and each route, generate sample data. Cascade: real Convex/DB rows → TS type defaults → fixtures/stories → AI fabrication. Stores in registry alongside component entries.
Files: `indexerAgent.ts`, sample data resolver, prompts
Depends on: P1-3
Size: L

**[P1-5] Indexer progress UI**
Full-screen onboarding overlay shown on first design-mode open. Streams status: "Detecting framework... ✓ Next.js App Router", "Found 12 routes... ✓", "Cataloging components... ✓ 47 found, 5 need config". Skip-able to "use what's done so far". Persists `indexerStatus` to store so it doesn't re-run on re-entry.
Files: new `apps/web/src/components/design/IndexerOnboarding.tsx`, `DesignModeView.tsx`
Depends on: P1-1, P1-2, P1-3, P1-4, P0-6
Size: M

**[P1-6] Background re-indexing on file changes**
File watcher in main process triggers selective re-index when files in `components/` or routes change. Debounced 5s. Updates registry incrementally, not full re-scan.
Files: main process file watcher, IPC, handler in `apps/web/src/components/design/`
Depends on: P1-5
Size: M

---

### PHASE 2 — Canvas Shell

**[P2-1] Infinite canvas with pan/zoom**
`<DesignCanvas>` using `@use-gesture/react`: wheel to zoom (Ctrl+wheel = zoom, plain wheel = pan), drag to pan, pinch to zoom on trackpad. Camera state in store. Zoom-to-cursor math. Range 0.05x–3x. Subtle grid background.
Files: new `DesignCanvas.tsx`, install `@use-gesture/react`
Depends on: P0-6
Size: L

**[P2-2] Canvas tabs (Routes / Components / Library)**
Tab strip at top of canvas. Each tab is its own canvas with independent camera state. Library tab is hidden until P5 (user-installed component packs). Routes and Components tabs visible day 1.
Files: new `CanvasTabs.tsx`, `DesignCanvas.tsx`
Depends on: P2-1
Size: M

**[P2-3] Route card component**
`<RouteCard>` shows a single route at its canvas position. Header: route path + framework badge. Body: viewport frame (default 1280x800). Footer: state badge (loading/loaded/error). Selectable, draggable to reposition, double-click to focus.
Files: new `RouteCard.tsx`
Depends on: P2-2
Size: M

**[P2-4] Component card component**
`<ComponentCard>` for the Components tab. Shows component name, file path, status badge. Body: vertical stack of up to N variants (different prop combos). Drag to reposition.
Files: new `ComponentCard.tsx`
Depends on: P2-2
Size: M

**[P2-5] Auto-arrange layout**
On first canvas load (or "Auto-arrange" button), positions cards in a grid: routes by depth/path hierarchy, components alphabetically grouped by directory. Stores resulting positions. Animates transitions.
Files: new `canvasLayout.ts`, `DesignCanvas.tsx`
Depends on: P2-3, P2-4
Size: M

**[P2-6] Canvas toolbar**
Floating bottom toolbar: zoom %, zoom in/out, zoom-to-fit, zoom-to-selection, reset. Tab-aware (different actions per tab).
Files: new `CanvasToolbar.tsx`
Depends on: P2-1
Size: S

**[P2-7] Components rail (left panel)**
Left-side panel listing all registry entries grouped by directory. Search/filter. Status icons. Drag a component out → starts a sketch on the canvas (Phase 5 wires up actual drop). For now just visual.
Files: new `ComponentsRail.tsx`
Depends on: P0-6, P2-1
Size: M

---

### PHASE 3 — Renderer (live preview of code on canvas)

**[P3-1] Code → live render bridge for routes**
Each `RouteCard` renders its route by loading the actual route component from the user's project. Uses Vite SSR-like dynamic import via Electron file:// protocol, scoped to the project root. Wraps the rendered component in our preview providers (mock router, mock auth, sample data).
Files: new `apps/web/src/components/design/render/RouteRenderer.tsx`, new preview-providers shim
Depends on: P2-3, P1-4
Size: XL

**[P3-2] Code → live render bridge for components**
Same pattern for `ComponentCard`. Renders the component with each variant's sample data. Catches render errors per variant; failed variants show error placeholder.
Files: new `ComponentRenderer.tsx`
Depends on: P2-4, P1-4
Size: L

**[P3-3] LOD rendering system**
Three rendering tiers based on zoom and focus:
- `zoom < 0.3`: cached PNG thumbnail (regenerated when code changes)
- `zoom 0.3–0.7`: live `RouteRenderer` / `ComponentRenderer` at scale
- `zoom > 0.7` + focused: full-res, fully interactive
Viewport culling via IntersectionObserver — off-screen cards unmount entirely.
Files: `RouteCard.tsx`, `ComponentCard.tsx`, new `useViewportCulling.ts`, new `thumbnailCache.ts`, install `html-to-image`
Depends on: P3-1, P3-2
Size: L

**[P3-4] Per-route preview config panel**
Right-side panel when a route is selected. Form fields: route params (auto-filled from indexer with real DB IDs), auth state (signed in / signed out / mock user), feature flags. Stored in `previewConfig`. Re-renders the focused route on change.
Files: new `PreviewConfigPanel.tsx`, integrates with `RouteRenderer`
Depends on: P3-1, P0-6
Size: M

**[P3-5] State variant toggle**
For focused route: small toggle group `[Loaded] [Loading] [Error] [Empty]`. Forces the renderer to surface that state (overrides query results, etc.). Power users can pin a state — pinned states appear as adjacent canvas cards.
Files: new `StateVariantToggle.tsx`, mock data adapter for forced states
Depends on: P3-4
Size: M

**[P3-6] File watcher → render invalidation**
Main process watches `src/`. Changes IPC the renderer, which invalidates cached imports and re-renders affected cards. Streaming agent edits surface here naturally — no separate codepath.
Files: main process watcher, IPC, store integration
Depends on: P3-1, P3-2
Size: M

---

### PHASE 4 — Code-Bidirectional Editor

**[P4-1] Install Puck and configure with discovered components**
Install `@puckeditor/core`. Build Puck `config` dynamically from the registry: each `ready` component becomes a Puck component with auto-generated fields from its prop schema. Fields use AI-suggested input types (string→text, color string→color picker, image URL→image picker).
Files: new `apps/web/src/components/design/puck/buildPuckConfig.ts`, new field renderers
Depends on: P1-3, P1-4
Size: L

**[P4-2] Custom Puck editor shell using Composition API**
`<PuckEditorShell>` uses `<Puck>` with `children` composition. Layout: `<Puck.Preview>` fills the focused route card on canvas. `<Puck.Fields>` swaps into the right panel. `<Puck.Components>` is hidden — we use the existing `ComponentsRail` as the source of draggable items.
Files: new `PuckEditorShell.tsx`, theme bridge CSS
Depends on: P4-1, P2-7
Size: L

**[P4-3] Code → Puck data parser**
When a user focuses a route, we need Puck JSON to drive its editor. Codemod-based parser walks the route's JSX AST and emits Puck `Data`. Components matched against the registry. Handles nested children, props, slots. Unrecognized JSX falls back to a "raw code" Puck node that AI must edit.
Files: new `apps/server/src/services/codeBridge/parseRoute.ts`, jscodeshift integration
Depends on: P1-3, P4-1
Size: XL

**[P4-4] Codemod layer: visual edit → AST edit (deterministic)**
Handles common ops without AI: text content change, className/prop value change, reorder children, insert known component, delete component, duplicate. Each op produces a jscodeshift transform. Fast, lossless, no token cost.
Files: new codemods/ directory, transform per op
Depends on: P4-3
Size: XL

**[P4-5] AI fallback for structural edits**
When the codemod layer can't handle an op (insert unknown component, complex layout swap, conditional logic), dispatch to the AI harness with: current file content + visual change description. AI returns full file rewrite. Diff before applying. Optimistic preview with rollback.
Files: integration with existing agent dispatch in `apps/server/`, new `editFallback.ts`
Depends on: P4-4, P1-1
Size: L

**[P4-6] Wire Puck into focused route card**
On double-click, route card swaps from `RouteRenderer` (live code) to `PuckEditorShell` (editable Puck). Puck `onChange` triggers code edits via P4-4/P4-5. Closing the editor re-renders from disk. `key={route.id}` ensures clean Puck mount.
Files: `RouteCard.tsx`, `DesignModeView.tsx`
Depends on: P4-2, P4-3, P4-4, P4-5
Size: L

**[P4-7] Same pattern for components**
Component editing via Puck on the Components tab. Edits the component file, propagates to all routes using it (via re-render).
Files: `ComponentCard.tsx`, code parser for components
Depends on: P4-6
Size: M

**[P4-8] Theme bridge — Puck UI matches Tailwind tokens**
CSS overrides on Puck's chrome to match our design system: backgrounds, borders, focus rings, font stack. Dark mode aware. Use `overrides.iframe` (or disable iframe) so styles inherit.
Files: new `puckTheme.css`, `PuckEditorShell.tsx`
Depends on: P4-2
Size: M

---

### PHASE 5 — Sketch & Materialize

**[P5-1] New screen sketch flow**
"+" button on the Routes tab opens a blank Puck editor on a new transient card. Puck JSON stored in `sketches` slice of the design store (not yet code). Sketch persists across sessions in Dynamo storage but never touches user's repo.
Files: new `SketchCard.tsx`, store actions, `DesignModeView.tsx`
Depends on: P0-6, P4-2
Size: M

**[P5-2] Materialize sketch action**
"Materialize" button on a sketch card opens a small dialog: target path (auto-suggested by framework conventions, e.g. `app/new-screen/page.tsx`), display name, route slug. Submitting hands the sketch JSON + target path to the AI harness as a structured task. Agent generates the file, updates router config if needed, replies with the new route id.
Files: new `MaterializeDialog.tsx`, new server task `design.materializeSketch`, prompts
Depends on: P5-1, P1-1
Size: L

**[P5-3] Post-materialization handoff**
Once the agent reports success: file watcher (P3-6) sees the new file → indexer (P1-6) registers the new route → sketch is removed from `sketches` → new `RouteCard` appears on canvas at the sketch's position. Smooth visual continuity (no flash).
Files: store actions, `DesignModeView.tsx`
Depends on: P5-2, P1-6, P3-6
Size: M

**[P5-4] Drag-component-from-rail-to-canvas creates sketch**
Dragging a registry component from `ComponentsRail` onto empty canvas creates a new sketch with that component pre-placed. Streamlines the "I want a screen with a Hero and a Footer" workflow.
Files: `ComponentsRail.tsx`, drop handler in `DesignCanvas.tsx`
Depends on: P5-1, P2-7
Size: M

---

### PHASE 6 — Thread / Agent Integration

**[P6-1] Stay in design mode on thread switch**
Clicking a thread in the sidebar while `view=design` keeps the search param. Navigation goes to `/$environmentId/$threadId?view=design`. `DesignModeView` reads the active thread's `worktreePath`.
Files: thread click handler in `Sidebar.tsx`, `DesignModeView.tsx`
Depends on: P0-3
Size: M

**[P6-2] Worktree-scoped registry and renderer**
The indexer (P1-1) and renderer (P3-1) accept an explicit project root path. When a thread has a worktree, the indexer runs against that worktree and the renderer loads code from there. Switching threads switches paths. Cached registries per worktree path.
Files: indexer agent, render bridge, store
Depends on: P6-1, P1-2, P3-1
Size: L

**[P6-3] Per-thread canvas state**
Camera position, focused route, active tab — saved per thread in the design store. Switching threads restores that thread's view. New threads start zoomed-to-fit.
Files: store, `DesignCanvas.tsx`
Depends on: P6-1, P0-6
Size: S

**[P6-4] Stream agent edits to canvas in real-time**
When the agent in the active thread modifies a file in the worktree, the file watcher (P3-6) triggers a re-render. Already wired via P3-6, but this issue verifies the loop works end-to-end during streaming agent work, with smooth (not janky) updates. May need throttling on watcher events during heavy streaming.
Files: file watcher tuning, render scheduler
Depends on: P3-6, P6-2
Size: M

**[P6-5] Surface canvas context to agent**
When user has a route focused in design mode and sends a chat message, prepend canvas context to the message: focused route, selected component, current preview config. Lets users say "make this button bigger" naturally.
Files: chat send pipeline, system prompt augmentation
Depends on: P6-1, P3-4
Size: M

**[P6-6] Visual edit attribution in agent thread**
When user makes a visual edit that falls back to AI (P4-5), the AI's file rewrite shows up as a normal agent message in the thread, attributed to the user (e.g. "User edited Button visually → applied via [model]"). Keeps thread history coherent.
Files: chat message types, P4-5 integration
Depends on: P4-5
Size: M

**[P6-7] Optimistic edit + rollback**
Visual edits via codemod (P4-4): apply optimistically to the canvas before the file is written. If the file write fails, roll back. AI fallback edits (P4-5): show the canvas in a "pending" state until the AI finishes, with a cancel option.
Files: edit pipeline, store
Depends on: P4-4, P4-5
Size: M

---

### PHASE 7 — Polish

**[P7-1] Keyboard shortcuts**
Cmd+0 (fit), Cmd+= / Cmd+- (zoom), Space+drag (pan), Cmd+1/2/3 (switch tab), Delete (delete selected), Cmd+D (duplicate), Cmd+E (focus/edit), Escape (deselect/exit edit), Cmd+K (component search). Wired through existing keybinding system.
Files: keybinding config, canvas
Depends on: P2-1, P2-3, P5-1
Size: M

**[P7-2] Minimap**
Bottom-right minimap showing all cards as dots and current viewport as a draggable highlight. Clickable to pan. Hidden by default, toggleable.
Files: new `CanvasMinimap.tsx`
Depends on: P2-1
Size: M

**[P7-3] Mode-switch animation**
Crossfade between Build and Design mode. Zoom-to-focus animation when entering edit mode for a card. Smooth `requestAnimationFrame`-driven camera tweens.
Files: `DesignModeView.tsx`, `DesignCanvas.tsx`
Depends on: P4-6
Size: M

**[P7-4] Performance pass**
Profile with 50+ routes and 100+ components. Targets: 60fps pan/zoom, < 200ms tab switch, < 500ms focus-to-edit. Likely needs: Puck `usePuck(selector)` audit, `will-change: transform` on canvas layer, virtualized component rail, deferred sample data loading, React Concurrent rendering for renderer cards.
Files: many
Depends on: P3-3, P4-6
Size: L

**[P7-5] Empty / error / first-run states**
Polished empty states: "No routes detected — drag a component to start sketching," "Indexer needs an AI provider — connect one in Settings." Error boundary per card so one broken render doesn't crash the canvas.
Files: empty-state components, error boundaries
Depends on: P3-1, P3-2, P5-1
Size: M

**[P7-6] Library tab (component packs)**
Reveals the third tab. Curated packs of pre-built components users can install into their project (mapped to popular libraries: shadcn/ui, Radix, Mantine). Installing a pack runs `npm install` and adds source files. Out-of-scope detail for now but the slot is reserved.
Files: new tab content, pack registry
Depends on: P2-2
Size: XL (likely a future cycle)

---

## Dependency Graph

```
PHASE 0
═══════
P0-1 ──┬─→ P0-2
       └─→ P0-3
P0-4 ──┬─→ P0-5 ──→ P0-6
       └────────────↗

PHASE 1                         PHASE 2 (parallel)
═══════                         ═════════════════
P0-5 ─→ P1-1 ──┬─→ P1-2 ─┐     P0-6 ─→ P2-1 ──┬─→ P2-2 ──┬─→ P2-3
               ├─→ P1-3 ─┼─→ P1-5             │          ├─→ P2-4
               │   ↓     │                    │          └─→ P2-7
               └─→ P1-4 ─┘                    └─→ P2-6
P1-5 ─→ P1-6                                  P2-3+P2-4 ─→ P2-5

PHASE 3
═══════
P2-3 + P1-4 ─→ P3-1 ─┐
P2-4 + P1-4 ─→ P3-2 ─┴─→ P3-3
P3-1 + P0-6 ─→ P3-4 ─→ P3-5
P3-1 + P3-2 ─→ P3-6

PHASE 4
═══════
P1-3 + P1-4 ─→ P4-1 ──→ P4-2 ──→ P4-8
                          ↓
P1-3 + P4-1 ─→ P4-3 ──→ P4-4 ──→ P4-5
                                   ↓
P4-2 + P4-3 + P4-4 + P4-5 ─→ P4-6 ─→ P4-7

PHASE 5
═══════
P0-6 + P4-2 ─→ P5-1 ─┬─→ P5-4 (also needs P2-7)
                     └─→ P5-2 (also needs P1-1) ─→ P5-3 (also needs P1-6, P3-6)

PHASE 6
═══════
P0-3 ─→ P6-1 ─┬─→ P6-2 (needs P1-2, P3-1)
              ├─→ P6-3 (needs P0-6)
              └─→ P6-5 (needs P3-4)
P3-6 + P6-2 ─→ P6-4
P4-5       ─→ P6-6
P4-4 + P4-5 ─→ P6-7

PHASE 7
═══════
P2-1 + P2-3 + P5-1 ─→ P7-1
P2-1 ─→ P7-2
P4-6 ─→ P7-3
P3-3 + P4-6 ─→ P7-4
P3-1 + P3-2 + P5-1 ─→ P7-5
P2-2 ─→ P7-6
```

---

## Parallel Work Streams

These streams can run in parallel with one engineer each from Day 1:

| Stream | Issues (in order) | Bottleneck |
|---|---|---|
| **A: Mode switching** | P0-1 → P0-2 → P0-3 | Independent |
| **B: Data layer** | P0-4 → P0-5 → P0-6 | Independent |
| **C: Indexer agent** | P1-1 → P1-2 ‖ P1-3 → P1-4 → P1-5 | Needs P0-5 |
| **D: Canvas UI** | P2-1 → P2-2 → P2-3 ‖ P2-4 ‖ P2-7 → P2-5 → P2-6 | Needs P0-6 |
| **E: Code parser** | P4-3 (the AST work — start early, gnarly) | Needs P1-3 + P4-1 |
| **F: Codemods** | P4-4 (per-op transforms — many small PRs) | Needs P4-3 |

The **critical path** is: P0 → P1-1 → P1-3 → P4-1 → P4-3 → P4-4 → P4-6. Everything else either parallelizes off the critical path or builds on it.

The **first user-visible payoff** is at P3-3 (LOD renderer): the canvas shows live-rendered routes and components from the user's actual code. Everything before that is plumbing.

---

## New Dependencies

| Package | Purpose | Phase |
|---|---|---|
| `@puckeditor/core` | Visual page editor | P4 |
| `@use-gesture/react` | Pan/zoom/pinch gestures | P2 |
| `html-to-image` | Thumbnail generation from DOM | P3 |
| `jscodeshift` | AST codemods for visual→code edits | P4 |
| `recast` (likely) | Print-preserving AST output | P4 |

---

## Risk Areas

1. **Code parser fidelity (P4-3)**: parsing arbitrary JSX into Puck JSON is the single hardest technical problem in this plan. A user's existing route uses arbitrary patterns (early returns, conditional rendering, spread props). We need a graceful fallback: anything not parseable becomes a "raw code" node that's read-only in Puck but editable via AI. Plan for this from day one of P4-3.

2. **Indexer correctness (P1-2/P1-3)**: AI-driven discovery may miss components or misclassify them. Mitigation: surface "Add manually" / "Mark as unrenderable" controls in the rail; never silently fail.

3. **Live rendering of user code in our process (P3-1)**: loading arbitrary user code into our renderer is a security and stability risk. Mitigation: isolate in a separate Electron BrowserWindow (off-screen) and post rendered DOM via `capturePage()` for thumbnails + a sandboxed iframe for live cards. This may push P3-1 to XL+ size.

4. **Codemod completeness (P4-4)**: defining "common ops" is open-ended. Pragmatic: ship the 80% (text, className, prop value, reorder, insert/delete/duplicate of registered components) and let AI fallback handle the long tail.

5. **AI cost/latency for fallback edits (P4-5)**: every structural edit is a token-billing event. Mitigation: aggressive codemod coverage in P4-4; debounce visual edits before dispatching; optionally cache common transformations.

6. **Concurrent edits (P6-4/P6-7)**: optimistic UI + agent stream edits can race. Last-write-wins on the file system is fine because files are atomic, but the canvas state needs reconciliation. Lean on the file watcher being authoritative — what's on disk wins.

7. **Indexer in worktree mode (P6-2)**: each thread/worktree triggers its own indexer run, which is expensive (AI tokens). Mitigation: cache registries by file-content hash; when switching to a worktree we've seen before, restore from cache.
