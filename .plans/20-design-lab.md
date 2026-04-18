# Plan: Design Lab (visual design system browser + live canvas)

## Problem

Coding agents work great with text, but frontend development is fundamentally visual. When an agent edits `Button.tsx`, the user has to context-switch to their browser, find the component, and eyeball whether the change looks right. There is no way to:

1. **See your project's design system at a glance** — colors, typography, components, pages.
2. **Point at a visual element and say "change this"** — the refine loop is text-only.
3. **Preview agent changes live** — the feedback loop requires manual browser refresh and navigation.

T3 Code already understands project structure (Project Intelligence), manages terminals (where dev servers run), and supports image attachments in threads. Design Lab connects these pieces into a visual workflow.

## Goals

1. **Design Tokens view**: extract and display colors, typography, spacing, and other tokens from the project's styling configuration.
2. **Component Gallery**: discover and catalog UI components with source links, prop signatures, and (when a dev server is running) live rendered previews.
3. **Pages/Views index**: detect routes from the project's router configuration and list them with navigation links.
4. **Live Canvas**: embed the project's running dev server in an iframe with an inspector overlay for click-to-select → "Refine with AI" workflows.
5. **Multi-target**: support web (React, Vue, Svelte, Astro), Electron, and React Native (via Expo web) — anything that produces a localhost URL.
6. **Everything routes back to threads**: every "Refine" or "Edit" action seeds a new thread with the right file context pre-loaded.

## Non-goals

- Replacing Storybook (we discover components, not host isolated stories).
- Visual regression testing.
- WYSIWYG editing (we show previews and let agents do the editing).
- Design file import (Figma, Sketch) — possible v3.

---

## Architecture overview

Design Lab adds two new workspace modes to the main content area, alongside Chat and Board:

```
Chat  ·  Board  ·  Design  ·  Canvas
                   ↑ this spec ↑
```

**Design** is a static analysis + gallery view. **Canvas** is a live iframe + inspector.

Both are accessed via the same header segmented control pattern defined in the Planning Board spec (`.plans/19-planning-board.md`). Both are scoped to the active project.

### System diagram

```
┌─────────────────────────────────────────────────┐
│  Browser (Design Lab UI)                         │
│  DesignLabStore (Zustand)                        │
│  TokensView · ComponentGallery · PagesIndex      │
│  CanvasView (iframe + inspector overlay)         │
└──────────┬───────────────┬──────────────────────┘
           │ ws            │ iframe (same-origin)
┌──────────▼───────────┐   │
│  apps/server          │   │
│  DesignAnalyzer       │   │  ┌────────────────────┐
│  (token extraction,   │   └──▶  Dev server         │
│   component discovery,│      │  (user's app on     │
│   route detection)    │      │   localhost:NNNN)    │
│  DevServerDiscovery   │      └────────────────────┘
│  (port detection,     │
│   process monitoring) │
└───────────────────────┘
```

---

## Feature A: Design Tokens

### What gets extracted

| Token type | Source | Detection strategy |
|---|---|---|
| **Colors** | Tailwind `theme.extend.colors`, CSS custom properties (`--color-*`), CSS-in-JS theme objects | Parse `tailwind.config.*`, scan `*.css` for `:root` vars, detect theme files via naming convention |
| **Typography** | Font families, sizes, weights, line heights | Parse Tailwind `theme.fontFamily/fontSize`, CSS `--font-*` vars |
| **Spacing** | Spacing scale | Parse Tailwind `theme.spacing`, CSS `--spacing-*` vars |
| **Radii** | Border radius values | Parse Tailwind `theme.borderRadius`, CSS `--radius-*` vars |
| **Shadows** | Box shadows | Parse Tailwind `theme.boxShadow`, CSS `--shadow-*` vars |
| **Breakpoints** | Responsive breakpoints | Parse Tailwind `theme.screens` |

### Extraction pipeline

```
ProjectIntelligenceResolver (existing)
  → discovers config files (tailwind.config.*, postcss.config.*, globals.css, etc.)

DesignTokenExtractor (new server service)
  → reads discovered config files
  → applies parser per file type:
     - tailwindConfigParser (JS/TS eval in sandbox OR static regex for simple configs)
     - cssVarParser (regex on :root {} blocks)
     - themeFileParser (JSON/JS theme objects by naming convention)
  → normalizes into DesignToken[] schema
  → returns via RPC
```

### Token schema

```typescript
// packages/contracts/src/designLab.ts (new file)

export const DesignTokenKind = Schema.Literals([
  "color",
  "typography",
  "spacing",
  "radius",
  "shadow",
  "breakpoint",
  "custom",
]);

export const DesignToken = Schema.Struct({
  kind: DesignTokenKind,
  name: TrimmedNonEmptyString,          // e.g., "primary", "font-sans", "spacing-4"
  value: TrimmedNonEmptyString,          // e.g., "#3b82f6", "16px", "0 1px 3px..."
  resolvedValue: Schema.optional(Schema.String), // computed value if CSS var reference
  source: Schema.Struct({
    filePath: TrimmedNonEmptyString,     // relative to project root
    line: Schema.optional(NonNegativeInt),
  }),
  variants: Schema.optional(Schema.Array(Schema.Struct({
    name: TrimmedNonEmptyString,         // e.g., "dark", "hover"
    value: TrimmedNonEmptyString,
  }))),
});

export const DesignTokenGroup = Schema.Struct({
  kind: DesignTokenKind,
  label: TrimmedNonEmptyString,          // display name, e.g., "Colors"
  tokens: Schema.Array(DesignToken),
});
```

### Tokens UI

```
┌──────────────────────────────────────────────────────────┐
│  Design · Tokens                                          │
│  ─────────────────────────────────────────────────────── │
│  Colors (24)                                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │
│  │██████│ │██████│ │██████│ │██████│ │██████│ │██████│ │
│  │primary│ │second│ │accent│ │destr.│ │muted │ │card  │ │
│  │#3b82f6│ │#6b72│ │#f59e│ │#ef44│ │#6b72│ │#fafaf│ │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ │
│                                                          │
│  Typography (6)                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Aa  Inter · font-sans                               │ │
│  │ The quick brown fox jumps over the lazy dog         │ │
│  │ Regular 400 · Medium 500 · Semibold 600 · Bold 700  │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Aa  JetBrains Mono · font-mono                      │ │
│  │ const x = 42;                                       │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  Spacing (12)                                             │
│  ┌─┐ ┌──┐ ┌───┐ ┌────┐ ┌──────┐ ┌────────┐             │
│  │1│ │ 2│ │ 3 │ │  4 │ │   6  │ │    8   │             │
│  │4px│8px│12px│16px │ 24px │  32px  │             │
│  └─┘ └──┘ └───┘ └────┘ └──────┘ └────────┘             │
│                                                          │
│  [Refine tokens with AI]                                  │
└──────────────────────────────────────────────────────────┘
```

Each token swatch/specimen is clickable → shows source file + line, copy value, "Refine with AI."

"Refine with AI" on a token group seeds a thread with:
- The source file path as a `@mention`
- Context: "Here are the current {kind} tokens: {values}. Please help me refine them."

---

## Feature B: Component Gallery

### Component discovery

Phase 1 uses **static analysis** (no runtime rendering required):

```
DesignComponentDiscovery (new server service)
  1. Scan project file tree for component directories:
     - Common patterns: components/, src/components/, ui/, src/ui/, app/components/
     - Custom: read from optional t3code.designlab.json config
  2. For each .tsx/.jsx/.vue/.svelte/.astro file:
     - Parse exports (named + default) using lightweight AST (regex-based for v1)
     - Extract prop types/interfaces (TypeScript parser or regex)
     - Detect component name from filename or export name
     - Read first JSDoc/comment block as description
  3. Group by directory structure
  4. Return ComponentEntry[] via RPC
```

### Component schema

```typescript
export const ComponentEntry = Schema.Struct({
  id: TrimmedNonEmptyString,             // deterministic hash of filePath + exportName
  name: TrimmedNonEmptyString,           // "Button", "Card", etc.
  filePath: TrimmedNonEmptyString,       // relative to project root
  exportName: TrimmedNonEmptyString,     // "Button" or "default"
  description: Schema.NullOr(Schema.String),
  props: Schema.Array(Schema.Struct({
    name: TrimmedNonEmptyString,
    type: TrimmedNonEmptyString,         // stringified type, e.g., "string | undefined"
    required: Schema.Boolean,
    defaultValue: Schema.optional(Schema.String),
  })),
  group: TrimmedNonEmptyString,          // directory-based grouping, e.g., "ui", "chat"
  lineCount: NonNegativeInt,
  previewUrl: Schema.optional(Schema.String), // set when live preview is available
});

export const ComponentGroup = Schema.Struct({
  name: TrimmedNonEmptyString,
  components: Schema.Array(ComponentEntry),
});
```

### Gallery UI

```
┌──────────────────────────────────────────────────────────┐
│  Design · Components                                      │
│  ─────────────────────────────────────────────────────── │
│  [Search components...]          [Group ▾] [Sort ▾]       │
│                                                          │
│  ui/ (24 components)                                      │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐            │
│  │ ┌────────┐ │ │ ┌────────┐ │ │ ┌────────┐ │            │
│  │ │ Button │ │ │ │  Card  │ │ │ │ Badge  │ │            │
│  │ │ ██████ │ │ │ │ ┌────┐ │ │ │ │ [tag]  │ │            │
│  │ └────────┘ │ │ │ │    │ │ │ │ └────────┘ │            │
│  │ Button     │ │ │ └────┘ │ │ │ Badge      │            │
│  │ 8 props    │ │ │ Card   │ │ │ 4 props    │            │
│  │ 142 lines  │ │ │ 5 props│ │ │ 38 lines   │            │
│  │ [Open] [AI]│ │ │ 89 ln  │ │ │ [Open] [AI]│            │
│  └────────────┘ │ └────────┘ │ └────────────┘            │
│                 └────────────┘                            │
│  chat/ (12 components)                                    │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐            │
│  │ ...        │ │ ...        │ │ ...        │            │
│  └────────────┘ └────────────┘ └────────────┘            │
└──────────────────────────────────────────────────────────┘
```

**Card thumbnail strategies** (progressive):

1. **Phase 1 — Code preview**: syntax-highlighted first 8 lines of the component's return/render JSX. Lightweight, no dev server needed.
2. **Phase 2 — Live thumbnail**: if dev server is running, render component in a hidden iframe sandbox → capture screenshot → cache as thumbnail. Use `html2canvas` or `<iframe>` screenshot API.
3. **Phase 3 — Storybook integration** (if requested): detect `.stories.tsx` files, link to Storybook dev server for interactive preview.

**Component detail view** (click a card → right sheet):

```
┌────────────────────────────────────────┐
│  Button                          [×]   │
│  components/ui/button.tsx              │
│  ─────────────────────────────────────│
│  Props                                 │
│  ┌──────────────────────────────────┐  │
│  │ variant   "default"|"outline"|…  │  │
│  │ size      "sm"|"md"|"lg"    opt  │  │
│  │ disabled  boolean           opt  │  │
│  │ onClick   () => void        opt  │  │
│  └──────────────────────────────────┘  │
│                                        │
│  Preview (live)                        │
│  ┌──────────────────────────────────┐  │
│  │  [  Button  ]  [ Outline ]      │  │
│  │  [ Small ]  [  Disabled  ]      │  │
│  └──────────────────────────────────┘  │
│                                        │
│  Source (first 30 lines)               │
│  ┌──────────────────────────────────┐  │
│  │ 1  import { cn } from "~/lib/…" │  │
│  │ 2  import { forwardRef } from … │  │
│  │ 3                               │  │
│  │ 4  interface ButtonProps {       │  │
│  │ ...                              │  │
│  └──────────────────────────────────┘  │
│                                        │
│  [Open in Editor]  [Refine with AI]    │
│  [View in Canvas]                      │
└────────────────────────────────────────┘
```

"Refine with AI" seeds a thread with:
- File path as `@mention`
- Component source code in context
- Prompt: "Here is the {name} component ({lineCount} lines, {propCount} props). How would you like to change it?"

"View in Canvas" (if dev server running) switches to Canvas mode with the component's page/route pre-navigated.

---

## Feature C: Pages/Views Index

### Route detection

```
RouteDetector (new server service)
  1. Detect router type from project dependencies:
     - TanStack Router: scan for routeTree.gen.ts or routes/ directory
     - Next.js: scan app/ or pages/ directories
     - React Router: scan for createBrowserRouter or <Route> in source
     - Vue Router: scan for router.ts/router.js with createRouter
     - SvelteKit: scan src/routes/
     - Astro: scan src/pages/
  2. Parse route tree into PageEntry[]
  3. Return via RPC
```

### Page schema

```typescript
export const PageEntry = Schema.Struct({
  path: TrimmedNonEmptyString,           // e.g., "/settings/general"
  filePath: TrimmedNonEmptyString,       // source file, relative to project root
  name: Schema.NullOr(TrimmedNonEmptyString), // route name if available
  isLayout: Schema.Boolean,             // layout routes vs. page routes
  isDynamic: Schema.Boolean,            // contains params like $id or [slug]
  params: Schema.Array(TrimmedNonEmptyString), // ["id", "slug"]
  children: Schema.Array(Schema.suspend(() => PageEntry)),
});
```

### Pages UI

Tree view of routes, grouped by path hierarchy. Each route links to:
- Source file (open in editor)
- Canvas view (open in live preview)
- Refine with AI (seed thread)

```
┌──────────────────────────────────────────────────────────┐
│  Design · Pages                                           │
│  ─────────────────────────────────────────────────────── │
│  Routes (12)                                Detected: TanStack Router │
│                                                          │
│  /                           _chat.index.tsx     [▸][AI] │
│  ├── /$envId/$threadId       _chat.$env…tsx      [▸][AI] │
│  ├── /draft/$draftId         _chat.draft…tsx     [▸][AI] │
│  ├── /pair                   pair.tsx            [▸][AI] │
│  ├── /settings               settings.tsx        [▸][AI] │
│  │   ├── /general            settings.general…   [▸][AI] │
│  │   ├── /connections        settings.conne…     [▸][AI] │
│  │   └── /archived           settings.archi…     [▸][AI] │
│  └── (layouts)                                           │
│      ├── __root              __root.tsx          [▸][AI] │
│      └── _chat               _chat.tsx           [▸][AI] │
│                                                          │
│  [▸] = Open in Canvas    [AI] = Refine with AI            │
└──────────────────────────────────────────────────────────┘
```

---

## Feature D: Live Canvas

### Dev server discovery

```
DevServerDiscovery (new server service)
  1. Check project scripts for dev/start/serve commands:
     - Existing ProjectScript[] from project intelligence
     - Match by name: "dev", "start", "serve", "preview"
     - Match by command content: "vite", "next dev", "expo start --web"
  2. If a terminal is already running with a matching command:
     - Parse terminal output history for URL patterns (http://localhost:NNNN)
     - Return discovered URL
  3. If no dev server detected:
     - Offer "Start dev server" CTA that runs the detected script in a new terminal
     - Monitor terminal output for URL
  4. Port validation:
     - Probe discovered URL with HTTP HEAD request
     - Verify it responds before showing iframe
```

### Dev server schema

```typescript
export const DevServerStatus = Schema.Struct({
  status: Schema.Literals(["not-detected", "detected", "starting", "running", "error"]),
  url: Schema.NullOr(Schema.String),              // e.g., "http://localhost:3000"
  scriptName: Schema.NullOr(TrimmedNonEmptyString), // which project script matched
  terminalId: Schema.NullOr(TrimmedNonEmptyString), // terminal running the server
  framework: Schema.NullOr(Schema.Literals([
    "vite", "next", "remix", "expo", "astro", "nuxt", "sveltekit", "webpack", "other",
  ])),
  detectedAt: Schema.NullOr(IsoDateTime),
});
```

### Canvas UI

```
┌──────────────────────────────────────────────────────────────┐
│  Canvas · http://localhost:3000/pricing     [🔍] [📱] [💻] [×] │
│  ──────────────────────────────────────────────────────────── │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                                                          │ │
│  │                    ┌─────────────┐                       │ │
│  │                    │ Pricing     │   ← user's app        │ │
│  │                    │             │     rendered in        │ │
│  │  ┌─────────────────┤  $19/mo     │     iframe            │ │
│  │  │  [selected]     │             │                       │ │
│  │  │  ─ ─ ─ ─ ─ ─ ─ ├─────────────┤   ← inspector        │ │
│  │  │  PricingCard    │  $49/mo     │     overlay on        │ │
│  │  └─────────────────┤             │     hover/click       │ │
│  │                    └─────────────┘                       │ │
│  │                                                          │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Selected: <PricingCard>                                  │ │
│  │  components/pricing/PricingCard.tsx:28                     │ │
│  │  [Refine with AI]  [Open in Editor]  [Copy Selector]      │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Canvas toolbar

| Control | Function |
|---|---|
| URL bar | Navigate within the app (editable, updates on iframe navigation) |
| 🔍 Inspector toggle | Enable/disable click-to-select mode |
| 📱 Mobile viewport | Resize iframe to 375×812 (iPhone SE) |
| 💻 Desktop viewport | Resize iframe to full width |
| 🔄 Refresh | Reload iframe |
| [×] | Close canvas, return to previous mode |

### Inspector overlay architecture

The inspector is a **thin script injected into the iframe** at load time. Two approaches:

**Approach A — Proxy injection (recommended for v1):**
- T3 Code server acts as reverse proxy for the dev server URL.
- Injects a `<script>` tag at the end of `<body>` in proxied HTML responses.
- Script communicates with parent via `postMessage`.
- Pro: works with any framework. Con: proxy adds complexity; WebSocket HMR needs passthrough.

**Approach B — Companion browser extension (v2):**
- Chrome/Firefox extension that activates when T3 Code canvas is open.
- Content script provides inspector overlay.
- Pro: no proxy needed. Con: requires extension install.

**Approach C — Direct iframe injection (simplest, limited):**
- If dev server is same-origin (localhost), parent page injects script via `iframe.contentDocument`.
- Pro: zero infra. Con: breaks if dev server uses different port (cross-origin).

**Recommendation: Start with Approach C** (same-origin injection, works for most local dev setups), add Approach A as a fallback for cross-origin cases.

### Inspector script behavior

```typescript
// Injected into iframe — lightweight, framework-agnostic

// On mousemove (when inspector active):
//   - Find element under cursor
//   - Draw highlight overlay (absolute positioned div with border)
//   - Show element tag + dimensions tooltip

// On click (when inspector active):
//   - Prevent default navigation/interaction
//   - Capture selected element info:
//     - tagName, className, id
//     - Bounding rect
//     - Computed styles (key properties)
//     - Nearest React fiber → __source (file, line, column) if available
//     - Nearest [data-component], [data-testid], or similar attribute
//     - CSS selector path
//   - postMessage to parent: { type: "element-selected", payload: { ... } }

// On Escape: deselect, clear overlay
// On Shift+click: multi-select (add to selection set)
```

### Source file resolution (element → file path)

Priority order:

1. **React `__source` transform**: if project uses `@babel/plugin-transform-react-jsx-source` or React 17+ automatic JSX runtime in dev mode, each JSX element has `__source: { fileName, lineNumber, columnNumber }`. Access via React fiber: `element._reactFiber$*.__debugSource`.
2. **Vite dev ID**: some Vite setups add `data-vite-dev-id` attributes with file paths.
3. **Component display name**: React fibers have `type.displayName` or `type.name` → match against discovered components from ComponentGallery → resolve file path.
4. **CSS selector heuristic**: if no source mapping available, provide the CSS selector to the AI and let it find the file (agents are good at this).
5. **User confirmation**: always show the resolved file path and let user confirm/override before AI edits.

### "Refine with AI" flow from Canvas

1. User selects element(s) in canvas.
2. Selection strip shows resolved component name + file path.
3. User clicks "Refine with AI."
4. System captures:
   - Screenshot of the selected area (via `iframe.contentWindow` capture or `html2canvas`)
   - Source file path + line range
   - Element's computed styles (relevant subset)
   - Current viewport dimensions
5. Seeds a new thread with:
   - Image attachment: cropped screenshot of selected area
   - File `@mention`: resolved source file
   - Pre-filled prompt: "I've selected the {componentName} element on the {pagePath} page. Here's what it looks like currently: [screenshot]. The source file is {filePath}:{lineRange}. Please help me refine it."
6. Navigates to chat mode with the new thread.
7. After agent makes changes, HMR updates the canvas automatically (if it's still open in a panel).

### Multi-target support

| Target | Dev server command | URL detection | Inspector support |
|---|---|---|---|
| **Vite (React/Vue/Svelte)** | `vite dev`, `bun dev` | `Local: http://localhost:5173` | Full (same-origin, React fibers) |
| **Next.js** | `next dev` | `Local: http://localhost:3000` | Full (React fibers, `__source`) |
| **Expo Web** | `expo start --web` | `Web is ready on http://localhost:8081` | Partial (React Native Web components) |
| **Astro** | `astro dev` | `Local http://localhost:4321` | Partial (island components) |
| **Electron** | `electron .` | App window, not iframe-embeddable | Via screenshot capture only (no iframe) |
| **React Native (device)** | `expo start` | No web URL | Screenshot only (capture from device/simulator) |

For non-iframe targets (Electron, native mobile), Canvas degrades to **screenshot mode**: user takes/pastes a screenshot, selects a region, and "Refine with AI" works from the screenshot alone (no live inspector). The image attachment system already supports this.

---

## RPC contract

```typescript
// packages/contracts/src/designLab.ts — new RPC schemas

// Design Tokens
"designLab.getTokens"           // { projectCwd, effectiveCwd? } → { groups: DesignTokenGroup[] }

// Components
"designLab.getComponents"       // { projectCwd } → { groups: ComponentGroup[] }
"designLab.getComponentDetail"  // { projectCwd, componentId } → { component, sourcePreview }

// Pages
"designLab.getPages"            // { projectCwd } → { pages: PageEntry[], routerType }

// Dev Server
"designLab.getDevServerStatus"  // { projectCwd } → DevServerStatus
"designLab.startDevServer"      // { projectCwd, scriptName } → { terminalId }

// Canvas
"designLab.resolveElementSource" // { projectCwd, selector, componentName?, reactSource? }
                                 //   → { filePath, line?, confidence: "high"|"medium"|"low" }
```

All are **stateless RPC calls** (no event sourcing needed — design analysis is a read-only projection of the file system). Results are cached on the client with `@tanstack/react-query` and invalidated on file-change signals (watch the orchestration activity stream for file-write events).

---

## Server implementation

### New files

| File | Role |
|---|---|
| `packages/contracts/src/designLab.ts` | Schema definitions for tokens, components, pages, dev server, canvas |
| `apps/server/src/designLab/Layers/DesignTokenExtractor.ts` | Parse config files → DesignTokenGroup[] |
| `apps/server/src/designLab/Layers/ComponentDiscovery.ts` | Scan project tree → ComponentGroup[] |
| `apps/server/src/designLab/Layers/RouteDetector.ts` | Detect router → PageEntry[] |
| `apps/server/src/designLab/Layers/DevServerDiscovery.ts` | Find/start dev servers, detect URLs |
| `apps/server/src/designLab/Layers/ElementSourceResolver.ts` | Map DOM selectors → source file paths |
| `apps/server/src/designLab/Services/*.ts` | Effect service definitions (one per layer) |

### Integration with existing services

- **ProjectIntelligenceResolver**: extend to emit design-relevant surface kinds (tailwind config, theme files, component directories). The existing `surfaces[]` system can carry these without schema changes.
- **WorkspaceEntries**: reuse `browse()` and `search()` for file discovery.
- **Terminal Manager**: reuse for dev server process management. The existing `subscribe(TerminalEvent)` listener pattern lets DevServerDiscovery monitor terminal output for URL patterns.
- **Editor integration**: reuse `OpenInEditorInput` for "Open in Editor" actions.

### Token extraction security

- **No eval**: do not eval Tailwind configs as JS. Use regex/AST parsing for v1. If the config uses dynamic JS (spreads, function calls), show "complex config — run `npx tailwindcss --help` to resolve" warning.
- **Size limits**: cap config file reads at 64KB (matches ProjectIntelligence convention).
- **Secret redaction**: apply existing `redactSecretPatterns` to any config content displayed in the UI.

---

## Client implementation

### New files

| File | Role |
|---|---|
| `apps/web/src/components/DesignLabView.tsx` | Main Design Lab layout with tab navigation |
| `apps/web/src/components/design-lab/TokensView.tsx` | Color swatches, typography specimens, spacing blocks |
| `apps/web/src/components/design-lab/ComponentGallery.tsx` | Grid of component cards with search/filter |
| `apps/web/src/components/design-lab/ComponentDetailSheet.tsx` | Right sheet with props, preview, source |
| `apps/web/src/components/design-lab/PagesIndex.tsx` | Route tree view |
| `apps/web/src/components/design-lab/CanvasView.tsx` | Iframe + toolbar + inspector overlay |
| `apps/web/src/components/design-lab/CanvasToolbar.tsx` | URL bar, viewport controls, inspector toggle |
| `apps/web/src/components/design-lab/SelectionStrip.tsx` | Selected element info + action buttons |
| `apps/web/src/components/design-lab/InspectorOverlay.ts` | Script injected into iframe (postMessage protocol) |
| `apps/web/src/designLabStore.ts` | Zustand store for design lab state |
| `apps/web/src/lib/devServerDetection.ts` | Client-side dev server status polling |
| `apps/web/src/lib/canvasInspector.ts` | PostMessage protocol handler for inspector events |

### Design Lab tab structure

The Design Lab uses the same left-nav + content layout as Project Intelligence:

```typescript
// DesignLabView.tsx
const DESIGN_LAB_TABS = ["tokens", "components", "pages"] as const;

// Canvas is a separate workspace mode, not a tab within Design.
// Design = static analysis. Canvas = live runtime.
```

### Canvas state machine

```
┌──────────────┐     startDevServer()     ┌──────────┐
│ no-dev-server │ ──────────────────────▶ │ starting  │
│               │                         │           │
│ "Start dev    │                         │ monitoring│
│  server" CTA  │                         │ terminal  │
└──────────────┘                         └────┬──────┘
       ▲                                      │ URL detected
       │ server crashes                       ▼
       │                              ┌──────────────┐
       └────────────────────────────── │   running     │
                                      │               │
                                      │ iframe loaded │
                                      │ inspector     │
                                      │ available     │
                                      └──────────────┘
```

### Workspace mode integration

The four modes (`Chat · Board · Design · Canvas`) share a single toggle mechanism:

```typescript
// uiStateStore.ts — extend existing store

interface UiStateStore {
  // ... existing fields ...
  workspaceMode: "chat" | "board" | "design" | "canvas";
  designLabTab: "tokens" | "components" | "pages";
  canvasUrl: string | null;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
}
```

The `ChatRouteLayout` checks `workspaceMode` and renders the appropriate view:

```typescript
function ChatRouteLayout() {
  const workspaceMode = useUiStateStore((s) => s.workspaceMode);
  return (
    <>
      <ChatRouteGlobalShortcuts />
      {workspaceMode === "chat" && <Outlet />}
      {workspaceMode === "board" && <BoardView />}
      {workspaceMode === "design" && <DesignLabView />}
      {workspaceMode === "canvas" && <CanvasView />}
      <ProjectIntelligenceRouteSheet />
    </>
  );
}
```

### Feature detection (hide modes that don't apply)

```typescript
// designLabStore.ts

function deriveAvailableModes(project: Project): WorkspaceMode[] {
  const modes: WorkspaceMode[] = ["chat", "board"]; // always available

  // Design is available if project has frontend indicators
  if (hasDesignLabSupport(project)) {
    modes.push("design");
  }

  // Canvas is available if a dev server can be detected
  if (hasDevServerCandidate(project)) {
    modes.push("canvas");
  }

  return modes;
}

function hasDesignLabSupport(project: Project): boolean {
  // Check project scripts for frontend-related commands
  // Check if project has component directories
  // Check if tailwind/CSS config exists
  // Conservative: show if any indicator is present
}
```

---

## Phased delivery

### Phase 1 — Design Tokens + Component Gallery static (2-3 weeks)

- [ ] `packages/contracts/src/designLab.ts` — token, component, page schemas
- [ ] `apps/server/src/designLab/Layers/DesignTokenExtractor.ts` — Tailwind config + CSS var parsing
- [ ] `apps/server/src/designLab/Layers/ComponentDiscovery.ts` — file tree scan + export detection
- [ ] `apps/server/src/designLab/Layers/RouteDetector.ts` — TanStack Router + Next.js detection
- [ ] RPC handlers for `designLab.getTokens`, `designLab.getComponents`, `designLab.getPages`
- [ ] `apps/web/src/components/DesignLabView.tsx` — tab layout
- [ ] `apps/web/src/components/design-lab/TokensView.tsx` — color swatches, typography, spacing
- [ ] `apps/web/src/components/design-lab/ComponentGallery.tsx` — grid with search
- [ ] `apps/web/src/components/design-lab/PagesIndex.tsx` — route tree
- [ ] Design mode toggle in header segmented control
- [ ] "Refine with AI" thread seeding for tokens + components
- [ ] Command palette "Open design for {project}"
- [ ] Keyboard shortcut `⌘⇧D`

### Phase 2 — Live Canvas MVP (2-3 weeks)

- [ ] `apps/server/src/designLab/Layers/DevServerDiscovery.ts` — script matching + URL detection
- [ ] `designLab.getDevServerStatus` + `designLab.startDevServer` RPCs
- [ ] `apps/web/src/components/design-lab/CanvasView.tsx` — iframe + toolbar
- [ ] `apps/web/src/components/design-lab/InspectorOverlay.ts` — hover/click overlay
- [ ] `apps/web/src/components/design-lab/SelectionStrip.tsx` — element info + actions
- [ ] Same-origin iframe injection (Approach C)
- [ ] Basic element selection → "Refine with AI" (CSS selector + screenshot)
- [ ] Viewport presets (mobile / desktop)
- [ ] Canvas mode toggle in header
- [ ] `⌘⇧L` keyboard shortcut

### Phase 3 — Source resolution + live thumbnails (2-3 weeks)

- [ ] React fiber `__source` resolution
- [ ] `designLab.resolveElementSource` RPC
- [ ] Confidence indicator on source resolution
- [ ] User confirmation/override for resolved file
- [ ] Live component thumbnails in gallery (iframe sandbox render + screenshot)
- [ ] Multi-select in canvas (Shift+click)
- [ ] Reverse proxy injection (Approach A) for cross-origin dev servers

### Phase 4 — Multi-target + polish (2-3 weeks)

- [ ] Expo Web detection and URL format parsing
- [ ] Astro/SvelteKit/Nuxt route detection
- [ ] Electron/React Native screenshot-only fallback mode
- [ ] Component detail sheet (right panel with full props + preview + source)
- [ ] Dark/light mode token variant display
- [ ] Token diff view ("before → after" when agent changes tokens)
- [ ] Storybook integration (optional, if user demand)
- [ ] `t3code.designlab.json` project config for custom component directories

---

## Open questions

1. **Should token extraction run on every file change or be manually refreshed?** Start with manual refresh + "stale" indicator; auto-refresh is expensive for large configs.
2. **Component thumbnail quality**: `html2canvas` vs. native screenshot API? The former is more compatible but less accurate.
3. **Multi-framework projects**: if a project has both React and Vue components (monorepo), should they appear in separate sections or merged?
4. **Canvas + Chat split view**: should Canvas be embeddable as a right panel alongside Chat (like Diff panel), or always full-main-area? Split would be powerful for refine workflows but complex to implement. Recommend: Phase 2 experiment.
5. **Element selection granularity**: should the inspector show React component boundaries or raw DOM elements? Component boundaries are more useful for AI editing but harder to detect reliably. Start with DOM, add React component grouping as an enhancement.
