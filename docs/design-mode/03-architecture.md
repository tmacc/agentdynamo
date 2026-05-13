# Architecture — T3 Code Design Mode

## System shape

Design Mode is a new top-level pane in the existing T3 Code Electron app. It runs alongside the chat/agent pane, not instead of it. Three subsystems sit behind it:

```
┌─────────────────────────────────────────────────────────────┐
│  T3 Code (Electron)                                         │
│                                                              │
│  ┌────────────┐  ┌─────────────────────────────────────┐    │
│  │ Agent pane │  │ Design Mode pane                    │    │
│  │ (existing) │  │                                      │    │
│  │            │  │  ┌────────────────────────────────┐ │    │
│  │            │  │  │ <iframe>  user's dev server   │ │    │
│  │            │  │  └────────────────────────────────┘ │    │
│  │            │  │  ┌──────────┐ ┌──────────────────┐ │    │
│  │            │  │  │ Routes / │ │ Props panel      │ │    │
│  │            │  │  │ Components│ │ (Leva)          │ │    │
│  │            │  │  └──────────┘ └──────────────────┘ │    │
│  └────────────┘  └─────────────────────────────────────┘    │
│         │                       │                            │
│  ┌──────┴───────────────────────┴────────────────────────┐  │
│  │ Design Mode Service (Node, in main process)           │  │
│  │  ├ ProjectAdapter (Vite | TanStack | Next)            │  │
│  │  ├ DesignSystemExtractor                              │  │
│  │  ├ ComponentIndexer                                   │  │
│  │  ├ ASTEditor (ts-morph)                               │  │
│  │  └ DesignContextPacker                                │  │
│  └───────────────────────────────────────────────────────┘  │
│         │                                                    │
│  ┌──────┴────────────────┐                                  │
│  │ User's project        │                                  │
│  │ (child process: pnpm  │                                  │
│  │ dev → localhost:5173) │                                  │
│  └───────────────────────┘                                  │
└─────────────────────────────────────────────────────────────┘
```

## Major components

### ProjectAdapter

Interface implemented per framework. The rest of the system depends on this abstraction, never on framework specifics.

Responsibilities: detect the project type, start/stop the dev server, enumerate routes, identify component roots, inject virtual routes for component isolation, expose an HMR event channel.

V1 adapters: `ViteAdapter`, `TanStackStartAdapter`. Both share most code via a `ViteBaseAdapter` since TanStack Start is Vite underneath.

### DesignSystemExtractor

Runs once on project open and on Tailwind config change. Produces a `DesignManifest` (schema in Tech Spec). Three independent extractors that compose:

- **TokenExtractor** — uses Tailwind's own `resolveConfig` to expand the user's config into a flat token map. Walks `@theme` blocks for v4. Walks imported CSS for `:root` custom properties via PostCSS.
- **PrimitiveExtractor** — scans `components/**` (or the user's configured component root), scores each file on "primitiveness" (small prop surface, single root, high import frequency, re-exports of Radix/Headless/Ariakit). Outputs ranked candidates.
- **DialectExtractor** — walks all JSX in the project, collects every Tailwind class string, builds a frequency map and per-component vocabulary. This is what makes generated mockups feel native.

### ComponentIndexer

Builds the searchable index of every component file: path, exported names, prop signatures (via `react-docgen-typescript`), JSDoc, dependencies, usage count across project. Updated on file change.

### ASTEditor

Wraps `ts-morph`. Exposes high-level operations the agent can call:

- `addVariant(componentPath, variantName, classes)`
- `modifyClassString(filePath, jsxNodeId, newClasses)`
- `extractComponent(selection, newName)`
- `addProp(componentPath, propName, propType, defaultValue)`
- `createMockupRoute(routePath, jsxBody, importsToResolve)`

Each operation is structurally aware. The agent doesn't write raw JSX — it requests an AST operation. Operations validate against the design manifest before applying (no imports of nonexistent components, no classes outside the project's vocabulary unless explicitly opted in).

### DesignContextPacker

On every design-mode turn, packages the relevant subset of the design manifest plus contextual exemplars into the agent's system prompt and context window. Different shapes for different turn types:

- "Tweak component" turn: full prop signatures of the target component, sibling components in same directory, design tokens, recent edit history
- "Mockup" turn: primitives list with prop signatures, design tokens, 2-3 exemplar route compositions, class dialect summary
- "Variant" turn: target component's existing variants, the variant API pattern detected (cva, tv, hand-rolled cn(), etc.)

### Iframe Bridge

`postMessage`-based RPC between the host (Electron renderer) and the iframe (user's dev server page). Two channels:

- **Command channel**: host → iframe. "Highlight this element," "navigate to /foo," "enter select mode."
- **Event channel**: iframe → host. "User clicked at (x,y) and the React fiber is X," "HMR reloaded module Y," "console error in app."

Implementation uses a tiny client script injected by the ProjectAdapter into the dev server's HTML. For Vite, a plugin transforms `index.html`. For Next, middleware injects on dev-only.

### react-devtools-inline

Embedded in the host pane, inspects the iframe's React tree. Provides the fiber-to-source mapping for click-to-select. This is the universal piece that works across all frameworks because it operates on the React runtime, not the bundler.

## Data flow examples

### Click-to-select

1. User clicks "Select Mode" button in Design Mode pane
2. Host posts `{type: 'enter-select-mode'}` to iframe
3. Iframe overlays a transparent capture layer; on click, captures `event.target`
4. Iframe queries `react-devtools-inline` for the fiber, walks up to find the nearest user component
5. Iframe posts `{type: 'element-selected', fiberId, sourceFile, lineNumber}` to host
6. Host opens the file in the editor pane, scrolls to the line, populates the props panel

### Mockup generation

1. User types "Create a settings page with a sidebar nav and three sections" in chat
2. Chat detects design-mode intent (or user explicitly invoked design mode)
3. DesignContextPacker assembles: tokens, primitives list (filtered to layout-relevant), 2-3 exemplar routes (chosen by similarity to "settings" or by being the most-typical compositions), class dialect summary
4. Agent receives system prompt with constraints: "Only import from these paths: [...]. Only use these classes: [...]. Match this composition style: [...]"
5. Agent produces a sequence of ASTEditor operations, primarily `createMockupRoute`
6. ASTEditor validates operations against the manifest (rejects imports of nonexistent components, etc.)
7. Operations apply, dev server HMRs, iframe reflects the new route
8. User iterates; each iteration replays from step 3 with updated context

### Component tweak

1. User has a Button component selected, asks "make this rounded-full"
2. DesignContextPacker assembles: Button's full source, sibling components, tokens, variant pattern detection
3. Agent produces `modifyClassString` operation targeting the className prop
4. ASTEditor applies, file saves, HMR reloads, iframe updates

## Storage

Project-local config: `.t3design/` directory in project root.

- `manifest.json` — current design manifest, regenerated but cached
- `overrides.json` — user corrections to the manifest (which components are primitives, what's in the dialect, etc.)
- `mockups/` — saved mockup history, route paths and metadata
- `.gitignore` recommendation: commit `overrides.json` (team-shared corrections), gitignore `manifest.json` (regenerable cache)

T3 Code app config (existing): adds Design Mode preferences (default viewport size, agent design verbosity, etc.).

## Process model

- **Main Electron process**: hosts Design Mode Service, spawns/manages dev server child processes
- **Renderer process**: hosts UI, including the iframe
- **User dev server**: child process started by ProjectAdapter, communicates via stdout for logs and HTTP for the served app
- **react-devtools-inline backend**: injected into the iframe page
- **Agent process**: existing T3 Code provider subprocess (Codex/Claude/OpenCode)

## Cross-cutting concerns

**HMR coexistence**: the user's dev server WebSocket and our bridge WebSocket must not conflict. Use `postMessage` for our bridge to avoid a second WS.

**Provider context**: components that depend on app-level providers (Theme, Auth, Router) need those providers to render in isolation. ProjectAdapter scans for `<App>` or root layout files and reuses them as wrappers in virtual routes. User can override via `.t3design/wrappers.tsx`.

**Type-safety**: the design manifest schema is shared between main and renderer. Define once in a `packages/design-mode-contracts` package, follow the existing T3 Code monorepo pattern.

**Errors from user code**: dev server crashes, build errors, runtime errors — all surface in the iframe. Bridge captures them and shows them in the host pane with file/line links.

## What we are explicitly not building

- Our own dev server (we use the user's)
- Our own bundler (we don't bundle anything from the user's project)
- A custom React renderer (we use react-devtools-inline)
- A visual editor with drag-and-drop (the agent is the editor)
- A component sandbox separate from the project (virtual routes inside the project's own dev server)

The architectural through-line: **borrow the user's pipeline, don't replicate it.** Every framework-specific complication that exists in the user's project also exists in their dev server. By embedding their dev server, we inherit correctness for free.
