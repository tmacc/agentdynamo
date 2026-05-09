# Task Breakdown Guide — for Claude Code

This document instructs Claude Code on how to atomize the Design Mode work into issues with a dependency graph. Read this first, then read the four other docs.

## How to atomize

An issue is correctly sized when:

- It can be completed in one focused session (rough target: 1-4 hours of human-equivalent work)
- It produces a verifiable output (passing tests, a working command, a screenshot, a committed file)
- It has at most 2-3 unfinished prerequisites
- Its acceptance criteria are concrete enough that "done" is unambiguous

If a task feels bigger than this, split it. If it feels smaller (changing one constant), bundle it with neighbors.

## Issue template

Every issue should follow this shape:

```markdown
## Issue: [Short imperative title]

**Phase**: 1 | 2 | 3 | 4 | 5
**Package**: which package this lives in
**Depends on**: #IDs of prerequisite issues
**Estimate**: S (1-2h) | M (2-4h) | L (4-8h, prefer to split)

### Context

1-3 sentences. Reference the doc section that motivates this.

### Goal

The single outcome.

### Acceptance criteria

- [ ] Concrete, testable
- [ ] Concrete, testable
- [ ] Concrete, testable

### Implementation notes

Pointers, gotchas, references to specific tech-spec sections. NOT a full design.

### Out of scope

What this task explicitly does not do (often the next issue).
```

## Dependency graph rules

1. **Phases are not strict gates.** Issues in Phase 3 can start while Phase 2 is finishing, as long as their explicit dependencies are met.
2. **Contracts before consumers.** Every shared type and interface in `design-mode-contracts` must exist (even as stubs) before any package consumes it. Stub issues are tiny and unblock parallelism.
3. **Adapters are independent.** Vite and TanStack Start adapters can be built in parallel after the `ProjectAdapter` interface stub lands.
4. **The bridge is a critical path.** Renderer features depend on it. Land it early in Phase 1.
5. **AST editor and design extractor can develop in parallel.** They have no dependency on each other until Phase 4.

## Suggested epics (rough groupings — Claude Code can refine)

### Epic 1: Foundation (Phase 1)

- Monorepo setup for new packages
- `design-mode-contracts` package with all type stubs from Tech Spec
- Bridge protocol scaffold (host side + iframe injection script)
- Iframe pane in the Electron renderer
- Child-process dev server orchestration (framework-agnostic shell)
- ProjectAdapter interface + base test suite

### Epic 2: Vite Adapter (Phase 1)

- Detect Vite projects
- Start/stop Vite dev server as child process
- Parse Vite stdout for URL/port
- Inject Vite plugin for virtual routes and bridge script
- HMR subscription

### Epic 3: TanStack Start Adapter (Phase 1, parallel with Vite)

- Detect TanStack Start
- Inherit ViteBaseAdapter behavior
- Route enumeration from file-based router

### Epic 4: Routes browser (Phase 1)

- Sidebar UI listing routes from adapter
- Click-to-navigate via bridge
- Loading and error states

### Epic 5: Click-to-select (Phase 2)

- Embed react-devtools-inline in renderer
- Iframe-side select-mode overlay
- Fiber → source file resolution
- Highlight overlay rendering

### Epic 6: Component browser (Phase 2)

- Index components via ts-morph + react-docgen-typescript
- Sidebar tree UI (grouped by directory)
- Virtual route per component for isolation
- Wrapper detection (providers from App.tsx)

### Epic 7: Props panel (Phase 2)

- Leva integration
- Prop-type → control mapping
- Props → virtual route props bridge
- Reset and save controls

### Epic 8: Design system extractor (Phase 3)

- Tailwind config resolver
- CSS variable scanner (PostCSS)
- Primitive scoring heuristic
- Class dialect collector
- Composition pattern detector
- Manifest serialization to `.t3design/manifest.json`
- Overrides file loader

### Epic 9: Manifest UI (Phase 3)

- Show extracted manifest in a tab
- Allow user corrections (mark/unmark primitives)
- Persist to overrides.json

### Epic 10: AST editor (Phase 4)

- ts-morph wrapper with operation interface
- Implement each ASTOperation kind
- JSX node locator system
- Variant pattern detection
- Validation pipeline

### Epic 11: Design context packer (Phase 4)

- Per-turn-kind packers (tweak, variant, mockup, inspect)
- Exemplar selection algorithm
- Constraint generator
- Integration into existing T3 Code agent message envelope

### Epic 12: Mockup mode (Phase 4)

- Mockup-specific UI (separate from inspection)
- Route generation flow
- Mockup history in `.t3design/mockups/`
- Promote-to-real-route action

### Epic 13: Polish & robustness (Phase 5)

- Screenshot diff on edits
- Error recovery (dev server crashes, AST validation failures)
- Performance instrumentation against budgets
- Telemetry opt-in
- Documentation

## Specific atomization heuristics for this project

**For each adapter method**, one issue. Don't bundle "implement Vite adapter" — split into "Vite: detect," "Vite: start dev server," "Vite: enumerate routes," "Vite: inject virtual route plugin," "Vite: HMR subscription." Each has its own test against the fixture.

**For each ASTOperation kind**, one issue. They're independent.

**For each manifest extractor** (TokenExtractor, PrimitiveExtractor, DialectExtractor, etc.), one issue per extractor. They run independently.

**Bridge messages**: don't make one issue per message type — group by direction (host→iframe issue, iframe→host issue) since they share envelope code.

**UI issues**: split by "static rendering" vs "wired up" if there's enough complexity. Otherwise one issue per panel.

## Critical-path identification

To produce the dependency graph, mark these as critical-path nodes (everything else hangs off them):

1. `design-mode-contracts` package with stubbed types
2. `ProjectAdapter` interface stub
3. Bridge protocol scaffold
4. Vite adapter MVP (detect + start + ready event)
5. Iframe pane in renderer
6. First end-to-end "I can see my Vite app" demo

Hitting milestone 6 unblocks all of Phase 2 and most of Phase 3.

## What good output looks like

When Claude Code is done atomizing, it should produce:

1. A flat list of ~80-120 issues (Design Mode is sizeable)
2. Each issue formatted per the template above
3. A dependency graph (text-based, e.g., a Mermaid diagram or a parent-of-children list)
4. A suggested phase ordering with parallelism explicitly marked
5. A "first 10 issues to do" call-out for kickoff

If the issue count comes out much smaller than 80, the atomization is too coarse. If much larger than 150, it's too fine. The mid-range is where the dependency graph has useful signal.

## What Claude Code should NOT do

- Invent requirements not in the docs. If a doc is silent on something, ask or note as "open question for product."
- Bundle work across packages into single issues.
- Write issues with vague acceptance criteria like "works correctly" or "user-friendly."
- Resolve open questions in the Tech Spec — surface them, don't decide them.
- Skip the test-related issues. Each adapter, extractor, and AST operation needs its own test issue (paired or separate, but present).

## Final note on style

Issues should read like real engineering tickets, not AI output. Short. Direct. No filler. No "this is a great opportunity to..." preambles. If an issue's description is more than 200 words, it's too big or too vague — split or sharpen.
