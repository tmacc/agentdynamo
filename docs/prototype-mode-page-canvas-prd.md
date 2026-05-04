# PRD: Page-Context Prototype Mode and Canvas Viewer

## Summary

Prototype mode should generate realistic, page-context product prototypes, not HTML presentations. When a user asks to redesign a component, the component should be shown in the page where it lives. When a user asks for multiple options or screens, Dynamo should show those pages as frames on a zoomable canvas.

The core product decision is that Dynamo owns the prototype viewer. Agents should not invent a new canvas, slide deck, or presentation shell for every turn. Agents should write structured prototype artifacts into `.dynamo/prototypes/<slug>/`, and the Dynamo-owned viewer should render those artifacts consistently.

## Problem

The first Prototype mode implementation gave providers workflow instructions and an extractor, but left too much output structure to the agent. In practice, providers can drift into:

- Slide-like HTML presentations with hero sections, explanatory panels, and marketing copy.
- Isolated component mockups that omit the actual page context.
- Multi-option decks instead of comparable working pages.
- Inconsistent canvas implementations generated from scratch each time.
- DOM extraction attempts that are not clearly tied to the generated output.

This is a product and architecture problem, not only a prompt problem. Prompt changes help, but reliable output requires a stable artifact contract and a reusable viewer.

## Goals

- Default Prototype output is an actual usable product page.
- Component redesigns render in situ inside the page shell where the component appears.
- Existing rendered DOM, computed styles, screenshots, and metadata are treated as required ground truth when the user references an existing screen.
- Multi-option and multi-screen outputs appear on a zoomable canvas of real prototype frames.
- The canvas is generated from a stable Dynamo-owned template, not invented by the provider.
- Every frame remains directly openable as a standalone HTML page.
- Prototype artifacts are self-contained under `.dynamo/prototypes/<slug>/`.
- The implementation remains provider-agnostic across Codex, Claude, Cursor, and OpenCode.

## Non-Goals

- Do not implement production React changes in Prototype mode unless the user explicitly asks.
- Do not build a full design tool or Figma replacement.
- Do not require target repositories to install Dynamo prototype tooling.
- Do not require target repositories to define `dynamo-design-extract` scripts.
- Do not solve full framework-specific token extraction for every stack in v1.
- Do not support scripted multi-step browser automation in the first canvas milestone unless explicitly added as a later issue.

## Users

- Product engineers redesigning existing app screens.
- Designers or founders comparing UI directions.
- PMs reviewing flow concepts and state coverage.
- Coding agents that need a strict output contract instead of open-ended HTML generation.

## Product Principles

1. **Pages, not presentations**: A prototype frame should look like a product surface a user could operate, not a slide explaining a design.
2. **Context is part of the component**: A topbar, sidebar, modal, table, or composer must be judged in its surrounding page.
3. **Reference capture is evidence**: If a user references an existing screen, the prototype directory should prove that rendered DOM was captured.
4. **Dynamo owns repeatable viewer behavior**: Pan, zoom, frame layout, keyboard handling, and viewer chrome should be implemented once.
5. **Agents generate frames, not infrastructure**: Providers should generate page HTML, manifest data, and assets under a contract.

## Desired UX

### Single Existing Screen

User asks: "Redesign the topbar on this chat page."

Prototype mode should:

1. Identify the rendered page URL. If the user references "this page" and the URL is not known, ask for the URL or infer it from the running dev app.
2. Capture rendered DOM, computed styles, metadata, and screenshot using Dynamo's app-owned extractor.
3. Identify the target component. If the component is ambiguous, ask for a selector or enough detail to locate it.
4. Recreate the page shell with realistic density and neighboring content.
5. Redesign the topbar in place.
6. Write a single frame and `prototype.json`.
7. Open the Dynamo-owned viewer, which may show a single frame without heavy canvas chrome.

### Component Redesign With Selector

User asks: "Redesign `.thread-topbar` with 3 options."

Prototype mode should:

1. Extract the page and selector metadata.
2. Preserve the original page shell in each option.
3. Replace only the target component and directly affected adjacent UI.
4. Render three full-page frames on the canvas.
5. Keep labels and option names in the viewer chrome, not inside the page content.

### Multiple Screens or Flow

User asks: "Prototype the settings onboarding flow."

Prototype mode should:

1. Generate one frame per screen or major state.
2. Preserve shared app chrome across frames.
3. Use click-through links between frames where useful.
4. Show frames on the canvas in a flow layout.
5. Keep arrows, frame names, and flow labels as canvas metadata, not page content.

## Architecture

### Ownership Model

Dynamo owns:

- The DOM extractor command and app-owned command shim.
- The prototype directory contract.
- The manifest schema.
- The reusable canvas/viewer template.
- Viewer behavior: pan, zoom, keyboard shortcuts, fit, frame layout, lazy loading, and direct-open links.

Providers own:

- Reading the user's prompt and target repository.
- Running the app-owned extractor when required.
- Generating frame HTML pages and any local assets.
- Writing `prototype.json` that conforms to the manifest schema.
- Running a final artifact self-check.

### Output Directory Contract

```text
.dynamo/prototypes/<slug>/
  prototype.json
  index.html
  .reference/
    dom.html
    computed-styles.css
    meta.json
    screenshot.png
  assets/
    tokens.css
    prototype-frame.css
    generated-assets...
  frames/
    option-a.html
    option-b.html
    state-empty.html
```

`index.html` should be copied or rendered from the Dynamo-owned viewer template. Agents should not hand-author a custom canvas unless the template is unavailable and they clearly report that fallback.

### Manifest Contract

`prototype.json` is the source of truth for the viewer.

```json
{
  "version": 1,
  "mode": "page-canvas",
  "title": "Topbar redesign concepts",
  "source": {
    "url": "http://localhost:5733/_chat/",
    "referenceDir": ".reference",
    "selector": ".thread-topbar"
  },
  "canvas": {
    "layout": "grid",
    "initialZoom": 0.75
  },
  "frames": [
    {
      "id": "option-a",
      "title": "Compact controls",
      "path": "frames/option-a.html",
      "viewport": { "width": 1440, "height": 960 },
      "type": "option"
    }
  ]
}
```

Required fields:

- `version`
- `mode`
- `title`
- `frames[].id`
- `frames[].title`
- `frames[].path`

Recommended fields:

- `source.url`
- `source.referenceDir`
- `source.selector`
- `canvas.layout`
- `canvas.initialZoom`
- `frames[].viewport`
- `frames[].type`

### Frame Contract

Each `frames/<id>.html` must:

- Be a real page prototype, not a slide.
- Load directly from `file://`.
- Include app/page shell context when based on an existing screen.
- Import shared generated assets from `../assets/` when useful.
- Avoid visible prose explaining design rationale unless the user asked for a presentation.
- Include realistic content density, empty/loading/error/overflow states when relevant.
- Preserve responsive behavior at desktop and narrow widths.

### Viewer Contract

The viewer must:

- Load `prototype.json`.
- Render frames as sandboxed iframes or equivalent page surfaces.
- Support pan by pointer drag.
- Support zoom by controls and wheel/trackpad.
- Support fit-to-screen, reset, and direct-open actions.
- Keep frame labels and metadata outside the frame HTML.
- Work from `file://` where browser constraints allow.
- Degrade clearly if the manifest or frames cannot be loaded.

Acceptance target:

- Zoom range: 25% to 400%.
- Keyboard: `0` reset, `+` zoom in, `-` zoom out, arrow keys pan.
- Six 1440px frames render without visible layout collapse in Chrome and Electron external browser.
- Reload preserves transform in the URL hash or another simple local mechanism.

## Functional Requirements

### R1. Page-Context Output

Prototype mode must instruct providers that the default output is a page prototype.

- Component redesigns must remain in the component's real page position.
- Surrounding page chrome and adjacent workflows must be included when known.
- Isolated component frames are allowed only when the user explicitly asks for isolated components or no page context exists.
- Presentation-style sections are disallowed by default.

### R2. Required Reference Capture for Existing Screens

When the user references an existing screen, rendered DOM capture is required before design work.

Required artifacts:

- `.reference/dom.html`
- `.reference/computed-styles.css`
- `.reference/meta.json`
- `.reference/screenshot.png`

The app-owned `DYNAMO_DESIGN_EXTRACT` command is the primary extraction entrypoint. Target repositories should not need their own extraction script.

### R3. Component Targeting

When a user asks to redesign a specific component on an existing page, Prototype mode should identify the target component before generating frames.

V1 behavior:

- Use an explicit selector if provided.
- If no selector is provided, infer from DOM landmarks, text, labels, or component names.
- If inference is ambiguous, ask for a URL and selector or a precise visual description.

Future behavior:

- Add a desktop "click to pick component" affordance that captures selector, bounding box, screenshot crop, and DOM ancestry.

### R4. Stable Canvas Generation

For multi-option or multi-screen outputs, the provider must use the Dynamo-owned canvas template.

- `index.html` is the viewer entrypoint.
- The viewer reads `prototype.json`.
- Providers generate frame pages and assets, not bespoke canvas mechanics.

### R5. Standalone Frames

Every frame must load without the viewer.

- Direct frame links must work.
- Shared generated CSS may live in `assets/`.
- Frames must not depend on canvas-only JavaScript to render their page content.

### R6. Token and Style Reuse

Prototype mode should produce `assets/tokens.css` when a target app has extractable design tokens or obvious computed style patterns.

The first version can be heuristic:

- CSS custom properties for surfaces, text, borders, shadows, spacing, radii, and focus rings.
- Font family and base sizing from computed styles or app config.
- Minimal framework assumptions.

### R7. Multi-Route Extraction

V1 should make multi-route extraction explicit.

Options:

- Support multiple URLs in one extractor command.
- Or document multi-route extraction as a later issue and require one extraction per route.

This PRD chooses the second path for first implementation: one extraction per route, with the manifest able to reference multiple reference directories later.

### R8. Provider Self-Check

Before the final response, providers must verify:

- Reference capture exists when required.
- `prototype.json` exists and has valid frame paths.
- `index.html` is the Dynamo viewer, not a custom presentation.
- Each frame opens directly.
- Component redesigns include page shell context.
- Text and controls do not overlap at desktop and mobile widths.

## Non-Functional Requirements

- Prototype output should be deterministic enough for tests to assert structure.
- Viewer code should be small, dependency-light, and easy to audit.
- DOM extraction should fail fast and explain actionable recovery steps.
- The viewer should work in an external browser and be future-compatible with an in-app preview panel.
- The artifact contract should allow cleanup by deleting `.dynamo/prototypes/<slug>/`.

## Success Metrics

- For existing-screen prompts, 90%+ of successful Prototype outputs include `.reference/dom.html`.
- For component redesign prompts, 90%+ of outputs include page shell context around the target component.
- Multi-option prompts produce `prototype.json`, `frames/*.html`, and a viewer-based `index.html`.
- Provider logs show the app-owned extractor command for existing-screen prompts.
- Manual QA confirms pan, zoom, fit, reset, direct-open links, and six-frame rendering in Chrome and Electron external browser.
- The known topbar redesign failure case produces page-context frames rather than an HTML presentation.

## Open Questions

- Should the viewer initially be copied into each prototype directory, or served from the Dynamo app with the prototype directory as data?
- Should the desktop app expose an "Open Prototype" panel in the same milestone, or should v1 keep launching the external browser?
- How should component selector capture work across Electron, browser, and remote dev URLs?
- Should generated frame screenshots be captured after generation for faster previews?
- Should `prototype.json` eventually live in `packages/contracts`, or stay documented until the viewer lands?

## Issue Plan

### Dependency Graph

```text
Phase 0:
  P0-I1 ─┬─> P1-I5 ─┬─> P2-I9
         │          └─> P3-I14
  P0-I2 ─┼─> P1-I6 ───> P2-I10 ─> P2-I11 ─> P2-I12
  P0-I3 ─┘
  P0-I4 ──────────────> P2-I9

Phase 1:
  P1-I7 ──────────────> P3-I15
  P1-I8 ──────────────> P3-I14

Phase 3:
  P3-I13, P3-I14, P3-I15 can run after their listed dependencies.

Phase 4:
  P4-I16 depends on P2-I9 through P3-I15.
  P4-I17 depends on P4-I16.
```

### Phase 0: Contracts and Decisions

#### P0-I1: Tighten Provider Output Contract

- `Depends on`: none
- `Can parallelize with`: P0-I2, P0-I3, P0-I4
- `Scope`:
  - Update shared Prototype instructions to require page-context output.
  - Ban presentation/deck/hero explanatory layouts unless explicitly requested.
  - Require component redesigns to stay in situ.
  - Require a final "page, not presentation" self-check.
- `Acceptance`:
  - Shared prompt distinguishes page prototypes from presentations.
  - Provider injection tests still pass.
  - Prompt names `DYNAMO_DESIGN_EXTRACT` as the extraction entrypoint.

#### P0-I2: Define Manifest Schema

- `Depends on`: none
- `Can parallelize with`: P0-I1, P0-I3, P0-I4
- `Scope`:
  - Define `prototype.json` schema as a documented type or contract schema.
  - Include required frame fields, source metadata, canvas settings, and viewport hints.
  - Add schema validation tests if implemented in code.
- `Acceptance`:
  - Single-frame and multi-frame manifests validate.
  - Invalid frame paths or missing ids fail validation.
  - The schema is referenced by provider instructions.

#### P0-I3: Lock Output Directory Layout

- `Depends on`: none
- `Can parallelize with`: P0-I1, P0-I2, P0-I4
- `Scope`:
  - Document and test expected output paths.
  - Define `.reference/`, `assets/`, `frames/`, `index.html`, and `prototype.json`.
  - Decide whether single-frame output still uses `frames/`.
- `Acceptance`:
  - The directory tree in this PRD matches implementation docs.
  - Provider instructions require the same layout.

#### P0-I4: Choose Viewer Delivery Model

- `Depends on`: none
- `Can parallelize with`: P0-I1, P0-I2, P0-I3
- `Scope`:
  - Decide whether the viewer is copied into each prototype directory or served by Dynamo.
  - Document external-browser v1 and future in-app preview implications.
  - Define fallback behavior if the viewer cannot be installed.
- `Acceptance`:
  - One viewer delivery approach is selected.
  - Follow-up canvas implementation issues do not need to revisit architecture.

### Phase 1: Extraction and Reference Primitives

#### P1-I5: Verify Reference Capture

- `Depends on`: P0-I1, P0-I3
- `Can parallelize with`: P1-I6, P1-I7, P1-I8
- `Scope`:
  - Update instructions so providers check for `.reference/dom.html`, computed styles, metadata, and screenshot after extraction.
  - Require providers to stop and report extraction failure before falling back to source-only design.
  - Add log-oriented test coverage where practical.
- `Acceptance`:
  - Existing-screen prototype logs show an extraction command attempt.
  - Successful extraction creates all required `.reference` artifacts.
  - Failed extraction produces a clear provider message and does not silently continue as if DOM was captured.

#### P1-I6: Add Selector and Region Metadata

- `Depends on`: P0-I2, P0-I3
- `Can parallelize with`: P1-I5, P1-I7, P1-I8
- `Scope`:
  - Add optional extractor input for `--selector`.
  - Record selector match count, bounding box, DOM ancestry, text labels, and nearest layout landmarks in `meta.json`.
  - Make selector required in instructions only when the component target is ambiguous.
- `Acceptance`:
  - `meta.json` includes selector metadata when provided.
  - Missing selector remains valid for full-page prototypes.
  - Ambiguous component prompts ask for clarification or selector.

#### P1-I7: Document Multi-Route Extraction V1

- `Depends on`: P0-I2
- `Can parallelize with`: P1-I5, P1-I6, P1-I8
- `Scope`:
  - Decide and document that v1 captures one route per extractor invocation.
  - Add manifest guidance for future multiple `referenceDir` entries.
  - Add prompt guidance for one extraction per flow screen when URLs are known.
- `Acceptance`:
  - Multi-step prompts do not imply unsupported scripted browser automation.
  - The limitation and workaround are explicit in docs and prompt instructions.

#### P1-I8: Generate `assets/tokens.css`

- `Depends on`: P0-I3
- `Can parallelize with`: P1-I5, P1-I6, P1-I7
- `Scope`:
  - Add provider guidance to derive CSS custom properties from config and computed styles.
  - Define token names for surfaces, text, borders, spacing, radii, shadows, and focus.
  - Add a small sample `tokens.css`.
- `Acceptance`:
  - Generated frames can import `../assets/tokens.css`.
  - Frames in the same prototype share consistent colors, type, and spacing.

### Phase 2: Dynamo-Owned Viewer

#### P2-I9: Build Static Viewer Scaffold

- `Depends on`: P0-I4, P1-I5
- `Can parallelize with`: P3-I14 after P1-I8
- `Scope`:
  - Create the reusable viewer template.
  - Load and validate `prototype.json`.
  - Render frame cards with labels and direct-open links.
  - Show manifest/frame loading errors clearly.
- `Acceptance`:
  - Viewer opens from `index.html`.
  - Two sample frame pages render from the manifest.
  - Viewer labels are outside frame content.

#### P2-I10: Add Pan, Zoom, Fit, and Keyboard Controls

- `Depends on`: P2-I9
- `Can parallelize with`: none
- `Scope`:
  - Implement pointer drag panning.
  - Implement wheel/trackpad and button zoom.
  - Add fit, reset, and keyboard shortcuts.
  - Preserve transform in URL hash or equivalent local state.
- `Acceptance`:
  - Zoom works from 25% to 400%.
  - `0`, `+`, `-`, and arrow keys work.
  - Reload preserves or restores the last meaningful viewport state.

#### P2-I11: Add Frame Isolation and Lazy Loading

- `Depends on`: P2-I10
- `Can parallelize with`: none
- `Scope`:
  - Render frames in iframes or another isolated surface.
  - Lazy-load offscreen frames.
  - Prevent frame content from resizing the canvas unexpectedly.
- `Acceptance`:
  - Six 1440px frames render without visible layout collapse.
  - Slow frame loads show a stable placeholder.
  - Direct-open links still work.

#### P2-I12: Add Layout Algorithms

- `Depends on`: P2-I11
- `Can parallelize with`: none
- `Scope`:
  - Support grid layout for options.
  - Support flow layout for sequential screens.
  - Read layout hints from `prototype.json`.
- `Acceptance`:
  - Option prompts render as comparable grids.
  - Flow prompts render in screen order.
  - Layout metadata stays outside frame HTML.

### Phase 3: Provider Contract Application

#### P3-I13: Combined Provider Regression Tests

- `Depends on`: P0-I1, P0-I2, P0-I3
- `Can parallelize with`: P3-I14, P3-I15 when dependencies are met
- `Scope`:
  - Add one test suite that verifies Codex, Claude, Cursor, and OpenCode all receive the same page-context, manifest, and viewer instructions.
  - Keep adapter-specific prompt injection tests focused on injection mechanics.
- `Acceptance`:
  - All providers include the same high-level Prototype contract.
  - Cursor/OpenCode one-time synthetic prompt behavior remains intact.
  - Claude Prototype restart behavior remains covered.

#### P3-I14: Page Shell Reconstruction Guidance

- `Depends on`: P1-I8
- `Can parallelize with`: P3-I13, P3-I15 after dependencies
- `Scope`:
  - Add concrete prompt examples for chat, dashboard, settings, modal, and table contexts.
  - Require app shell, neighboring content, data density, and responsive constraints.
  - Clarify when isolated component frames are acceptable.
- `Acceptance`:
  - The topbar redesign prompt is guided toward a full page frame.
  - The instructions avoid creating explanatory sections by default.

#### P3-I15: Standalone Frame and State Guidance

- `Depends on`: P1-I7, P2-I9
- `Can parallelize with`: P3-I13, P3-I14 after dependencies
- `Scope`:
  - Define frame naming conventions.
  - Require empty/loading/error/overflow/mobile states where relevant.
  - Require direct-open frame verification.
- `Acceptance`:
  - Multi-option outputs have `frames/*.html`.
  - Single-frame outputs remain directly openable and page-contextual.

### Phase 4: Validation and Rollout

#### P4-I16: Known-Failure Regeneration Fixture

- `Depends on`: P2-I9, P3-I13, P3-I14, P3-I15
- `Can parallelize with`: none
- `Scope`:
  - Capture the original "topbar design concept options" prompt as a regression fixture.
  - Define expected artifact structure and qualitative checks.
  - Verify the output contains page frames, not a presentation shell.
- `Acceptance`:
  - Generated output includes `.reference/`, `prototype.json`, `index.html`, and multiple `frames/*.html`.
  - Frame HTML includes page shell context around the topbar.
  - Viewer renders the options on a canvas.

#### P4-I17: Manual QA Checklist and PATCH Updates

- `Depends on`: P4-I16
- `Can parallelize with`: none
- `Scope`:
  - Add a manual QA checklist for external browser and Electron external launch.
  - Update `PATCH.md` as each issue lands, with final rollout notes here.
  - Document troubleshooting for missing extractor, missing manifest, and blocked file loading.
- `Acceptance`:
  - `bun fmt`, `bun lint`, `bun typecheck`, and relevant targeted tests pass.
  - `PATCH.md` describes viewer ownership, manifest contract, extractor requirement, and known merge hotspots.
  - Manual QA covers Chrome, Safari if practical, and Electron external browser.

## Parallel Execution Plan

Phase 0 can run in parallel across four small tracks: prompt contract, manifest schema, directory layout, and viewer delivery decision. These should be completed before implementation work starts.

Phase 1 can run in parallel after Phase 0: extraction verification, selector metadata, multi-route documentation, and token generation guidance do not need to block each other.

Phase 2 is intentionally more serialized because viewer behavior is shared infrastructure. Scaffold first, then controls, then isolation/lazy loading, then layout algorithms.

Phase 3 can run mostly in parallel once the relevant contracts exist. Provider regression tests, page-shell guidance, and frame/state guidance are independent enough to split across implementers.

Phase 4 should validate the known failure case and finalize rollout documentation. `PATCH.md` updates should be part of each implementation issue's definition of done, with P4-I17 acting as the final consistency pass.
