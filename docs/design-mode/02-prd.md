# PRD — T3 Code Design Mode

## Summary

A new mode in T3 Code that lets developers visually browse, inspect, and modify the React components and routes of a project they have open, and generate new mockups that adhere to that project's existing design system. Powered by the agent already in T3 Code.

## Why this exists

Generic AI design tools (v0, Lovable, Bolt) generate from scratch. They produce shadcn-flavored output that doesn't fit existing apps. Developers with real codebases are stuck translating generic output by hand or writing detailed prompts every time. Onlook is the closest existing solution but is Next-only.

T3 Code already runs the agent loop. Adding Design Mode turns it from a coding agent into a design-aware coding agent for the project the developer actually works on.

## Goals

1. Render any route or component of the user's project inside T3 Code with no code changes to the project
2. Extract the project's design system (Tailwind tokens, CSS variables, primitives, composition patterns, class dialect) into a structured manifest
3. Feed that manifest to the agent on every design-mode turn so generated code looks native
4. Support click-to-select bidirectional mapping between rendered elements and source files
5. Support edit operations (tweak existing component, generate new variant, generate new mockup screen) that produce real changes to the project's source files using existing patterns

## Non-goals

- Replacing the developer's IDE for editing
- Visual drag-and-drop editing as the primary interface (agent-first, direct manipulation second)
- Supporting non-React frameworks
- Supporting non-Tailwind CSS approaches in v1 (CSS Modules and styled-components projects work but get less design-system intelligence)

## Success criteria

- A developer can open a Vite + Tailwind project, click a button on a rendered route, and see the source component highlighted in under 500ms
- A developer can ask "add a destructive variant" and see the variant land in the source file using the codebase's existing variant pattern (not a regenerated component)
- A generated mockup imports only from existing component paths in the project and uses only classes that exist in the project's class vocabulary, 95% of the time
- A developer with no prior Storybook setup can inspect any component in their codebase within 30 seconds of opening Design Mode

## Framework support

| Framework | v1 | v2 | Notes |
|---|---|---|---|
| Vite + React | ✓ | | Primary target |
| TanStack Start | ✓ | | Vite-based, mostly inherits |
| Next.js (App Router) | | ✓ | Server Components are hard |
| Next.js (Pages Router) | | ✓ | Easier than App Router |
| Remix / React Router | | future | |
| CRA | | future | Declining audience |

## CSS support

| Approach | v1 | Notes |
|---|---|---|
| Tailwind v3 | ✓ | Primary |
| Tailwind v4 | ✓ | CSS-first config, parse `@theme` blocks |
| CSS variables | ✓ | Always extracted |
| CSS Modules | ✓ | Renders fine, less design-system intelligence |
| styled-components / Emotion | partial | Renders fine, no token extraction in v1 |
| shadcn/ui | ✓ | Detected as a special case for better primitive identification |

## User flow

1. User opens a project in T3 Code
2. T3 Code detects framework and CSS approach, runs design system extraction in background
3. User clicks Design Mode in the sidebar
4. Project's dev server boots as a child process; iframe loads it
5. User browses routes, components, or asks the agent for a mockup
6. Agent receives design context manifest + user intent + selected component (if any)
7. Agent produces edits (AST modifications via ts-morph) or new files
8. HMR reflects changes; user iterates
9. User commits via T3 Code's existing git integration

## Constraints

- Must not require modification to the user's project source for Design Mode to work (config injection is acceptable; required imports are not)
- Must work offline (no calls to external services beyond the agent provider the user already configured)
- Must not break the user's normal `pnpm dev` workflow
- Generated code must use the project's existing import paths, not absolute paths or new aliases
- Must preserve user formatting (Prettier config, ESLint rules) on edits

## Risks

- **Server Components**: when Next support lands, RSC components can't render in the iframe in isolation. Need a server-side render path.
- **Framework drift**: Vite plugin APIs are stable but TanStack Start is young. May need to track breaking changes.
- **Design system extraction accuracy**: heuristics will misclassify primitives. The user-correctable manifest is the safety net.
- **Agent output quality**: bounded by the model. Design context can only push so far. Document what the product can and can't promise.
- **Iframe security**: same-origin issues, CSP, and dev-server WebSocket coexistence all need testing.

## Phasing

**Phase 1 — Renderer.** Boot dev server, embed in iframe, postMessage bridge, route browser. No agent integration. Just "I can see my app."

**Phase 2 — Inspection.** Click-to-select, component browser with `react-docgen-typescript`, props panel with Leva, virtual routes for component isolation.

**Phase 3 — Design system extraction.** Tailwind config resolution, CSS variable scanning, primitive detection, class dialect capture, user-correctable manifest stored in `.t3design/`.

**Phase 4 — Agent integration.** Design context packer, AST-based edits via ts-morph, mockup mode with hard import constraints.

**Phase 5 — Polish.** Screenshot diffing, mockup-to-route promotion, error recovery, telemetry.

Phases 1-2 ship as a usable inspection tool independent of agent work. Phase 4 is where the differentiated value lands.
