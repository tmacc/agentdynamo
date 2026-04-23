# PATCH.md

`PATCH.md` tracks fork-only behavior and upstream-touching local patches that must survive future upstream syncs. This file is the preservation checklist for merges from `upstream/main`.

## Maintenance Rules

- Update this file in the same change whenever we add a fork-only feature or patch behavior in upstream-derived code.
- Do not remove an entry just because a merge dropped the code. Mark its current status instead.
- Keep entries concrete: user-visible behavior, key files, invariants, merge hotspots, and verification steps.
- After every upstream merge, review every entry here before treating the branch as ready.

## Current Baseline

As of merge commit `ed85e9ce` (`Merge upstream/main into t3code/1bed190b`):

- `Multi-provider subagents`: missing on merged baseline
- `Board View`: missing on merged baseline
- `Forking threads`: missing on merged baseline
- `Provider switching / handoff`: missing on merged baseline
- `Saving prompts`: restored on top of merged baseline
- `Worktree readiness / bootstrap`: partially present, but reduced from the fuller fork implementation
- `Project intelligence`: missing on merged baseline

## Fork Feature Inventory

### Multi-provider subagents

- `Status`: Present on the pre-merge fork at `365ae6d9`. Missing on merged baseline `ed85e9ce`.
- `User-visible behavior`: A top-level thread can delegate bounded child tasks to other agent threads, choose provider and model per child, keep children on their own branch/worktree, wait for results, and close children when done. Child progress and summaries show back up in the parent thread.
- `Why it exists`: Lets Dynamo coordinate real parallel agent work inside the product instead of relying on provider-native delegation alone.
- `Key fork files`:
  - `apps/server/src/team/Layers/TeamOrchestrationService.ts`
  - `apps/server/src/team/Layers/TeamTaskReactor.ts`
  - `apps/server/src/team/http.ts`
  - `apps/server/src/provider/teamToolRegistration.ts`
  - `apps/server/src/persistence/Layers/ProjectionThreadTeamTasks.ts`
  - `packages/contracts/src/orchestration.ts`
  - `apps/web/src/components/chat/TeamAgentPills.tsx`
  - `apps/web/src/components/chat/TeamTaskInlineBlock.tsx`
  - `apps/web/src/components/chat/TeamTaskInspector.tsx`
- `Important invariants`:
  - Child threads must remain linked to a parent thread.
  - Child agents must not recursively delegate in v1.
  - Provider session startup must inject the team MCP/coordinator wiring for supported providers.
  - Parent UI must show child status changes and final summaries without requiring a refresh.
- `Merge hotspots`:
  - Orchestration thread schemas and read-model shape
  - Provider session start inputs and provider registration
  - Server HTTP/WebSocket routes for team operations
  - Persistence and projection tables for team task state
  - Chat timeline/sidebar UI that understands child threads
- `Verification`:
  - Spawn a child on the same provider.
  - Spawn a child on a different provider/model.
  - Confirm child gets a distinct branch/worktree.
  - Confirm wait/close flows work and parent thread receives the result summary.

### Board View

- `Status`: Present on the pre-merge fork at `365ae6d9`. Missing on merged baseline `ed85e9ce`.
- `User-visible behavior`: Project-level board with stored columns (`ideas`, `planned`) and derived columns (`in-progress`, `review`, `done`) computed from thread/runtime state. Supports card creation, drag/drop reordering, linked threads, ghost cards, and seeded prompts.
- `Why it exists`: Gives Dynamo a lightweight planning surface tied directly to real agent threads instead of separate project-management tooling.
- `Key fork files`:
  - `packages/contracts/src/board.ts`
  - `apps/server/src/persistence/Layers/ProjectionBoardCards.ts`
  - `apps/server/src/persistence/Layers/ProjectionBoardDismissedGhosts.ts`
  - `apps/server/src/persistence/Migrations/029_ProjectionBoardCards.ts`
  - `apps/server/src/persistence/Migrations/030_ProjectionBoardDismissedGhosts.ts`
  - `apps/web/src/boardProjection.ts`
  - `apps/web/src/boardStore.ts`
  - `apps/web/src/components/board/BoardView.tsx`
  - `apps/web/src/components/board/BoardCardSheet.tsx`
- `Important invariants`:
  - Stored columns are authoritative on the server.
  - Derived columns are recomputed from thread state and git/runtime signals.
  - Card-to-thread linking must stay unique and stable.
  - Ghost-card dismissals must persist across reloads.
- `Merge hotspots`:
  - Contracts for board commands/events
  - Persistence migrations and projection tables
  - Thread read-model fields consumed by board projection
  - Sidebar and project routing that expose the board UI
- `Verification`:
  - Create, edit, move, archive, and delete cards.
  - Link a card to a thread and verify the derived columns update as thread state changes.
  - Dismiss and restore ghost cards across reloads.

### Forking threads

- `Status`: Present on the pre-merge fork at `365ae6d9`. Missing on merged baseline `ed85e9ce`.
- `User-visible behavior`: Explicit thread fork flow that clones the relevant thread context into a new thread, preserves fork origin metadata, and keeps the new thread separate from the source. This is distinct from plan-derived implementation thread creation.
- `Why it exists`: Lets users branch work from an existing conversation without losing provenance or polluting the original thread.
- `Key fork files`:
  - `packages/contracts/src/orchestration.ts`
  - `packages/contracts/src/ipc.ts`
  - `packages/contracts/src/rpc.ts`
  - `apps/server/src/orchestration/Layers/ThreadForkDispatcher.ts`
  - `apps/server/src/orchestration/Layers/ThreadForkMaterializer.ts`
  - `apps/server/src/orchestration/forkThreadExecution.ts`
  - `apps/server/src/orchestration/http.ts`
  - `apps/server/src/orchestration/projector.ts`
  - `apps/web/src/components/chat/MessagesTimeline.tsx`
  - `apps/web/src/store.ts`
- `Important invariants`:
  - Source thread and forked thread must remain distinct.
  - Fork origin metadata must survive projection and reload.
  - Timeline UI must show where imported history stops and new fork-local history begins.
  - Fork creation must not break branch/worktree metadata.
- `Merge hotspots`:
  - Orchestration command/event schemas
  - Projection pipeline and snapshot query shape
  - Server RPC/HTTP handlers
  - Chat timeline rendering and store normalization
- `Verification`:
  - Fork a thread with existing history.
  - Confirm fork origin metadata appears in the new thread.
  - Confirm new messages only affect the forked thread.
  - Reload and verify provenance is still present.

### Saving prompts

- `Status`: Present on the pre-merge fork at `365ae6d9`. Restored on top of merged baseline `ed85e9ce`.
- `User-visible behavior`: Users can save prompts/snippets locally, scope them to the current project or all projects, reuse them from the composer, rename them, change scope, search them, and track last-used ordering.
- `Why it exists`: Speeds up repeated workflows and keeps high-value prompts close to the composer.
- `Key fork files`:
  - `apps/web/src/savedPromptStore.ts`
  - `apps/web/src/components/chat/ComposerSavedPromptMenu.tsx`
  - `apps/web/src/components/chat/ChatComposer.tsx`
  - `apps/web/src/components/chat/MessagesTimeline.tsx`
  - `apps/web/src/components/ChatView.tsx`
- `Important invariants`:
  - Storage is local-first and survives reloads.
  - Project-scoped snippets must stay isolated by project key.
  - Duplicate snippets within the same scope should be deduped.
  - Composer insertion and "save prompt" actions must operate on the same store shape.
- `Merge hotspots`:
  - Composer UI and message actions
  - Client-side persistence/store structure
  - Project scoping logic tied to environment/project identity
- `Verification`:
  - Save a prompt from a message.
  - Reuse it from the composer.
  - Change scope between project/global.
  - Reload and confirm snippets persist and remain scoped correctly.

### Provider switching / handoff

- `Status`: Present on the pre-merge fork at `365ae6d9`. Missing on merged baseline `ed85e9ce`.
- `User-visible behavior`: Users could switch the active provider for an existing thread while preserving enough context to continue the same conversation on the new provider. The fork implementation built explicit full/delta handoff text, tracked provider sync markers, and attempted to preserve branch/worktree continuity across the switch.
- `Why it exists`: Lets Dynamo treat providers as interchangeable runtimes on one thread instead of forcing the user to create a new thread whenever they want to change provider.
- `Key fork files`:
  - `apps/server/src/orchestration/providerSwitchHandoff.ts`
  - `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
  - `apps/server/src/provider/Layers/ProviderService.ts`
  - `apps/server/src/provider/providerSlotState.ts`
  - `apps/server/src/persistence/Migrations/033_ProviderSessionRuntimeSlots.ts`
  - `packages/contracts/src/orchestration.ts`
  - `apps/web/src/components/ChatView.tsx`
- `Important invariants`:
  - Switching providers must not silently drop the visible thread history.
  - Handoff state must stay aligned with branch and worktree metadata.
  - A provider switch should preserve resumability and avoid leaving the thread in an unroutable state.
  - Full handoff fallback must be available when incremental markers are stale or invalid.
- `Merge hotspots`:
  - Orchestration turn-start and provider command flows
  - Provider session persistence and lifecycle state
  - Thread read-model fields consumed by the composer/chat UI
  - Any cleanup or reaper logic that mutates provider session bindings
- `Verification`:
  - Start a thread on provider A and switch to provider B.
  - Confirm the next turn on provider B has enough context to continue correctly.
  - Switch back and verify the thread remains resumable.
  - Reload and confirm the thread still routes to a valid provider session.

### Worktree readiness / bootstrap

- `Status`: Present on the pre-merge fork at `365ae6d9`. Still partially present on merged baseline `ed85e9ce`.
- `User-visible behavior`: Projects can scan for worktree readiness, approve managed bootstrap behavior, generate managed setup/dev scripts, configure env handling, and run setup automatically when a new worktree thread is created. The merged baseline still has the setup-script slice, but most of the readiness scan/apply flow is gone.
- `Why it exists`: New worktree threads should come up ready to use without repeated manual environment setup.
- `Key fork files`:
  - `apps/web/src/components/ProjectScriptsControl.tsx`
  - `apps/web/src/hooks/useEnsureWorktreeReadiness.tsx`
  - `apps/web/src/components/WorktreeReadinessDialog.tsx`
  - `apps/server/src/project/Layers/ProjectSetupScriptRunner.ts`
  - `apps/server/src/project/Layers/WorktreeReadinessApplicator.ts`
  - `apps/server/src/project/Layers/WorktreeReadinessScanner.ts`
  - `apps/server/src/orchestration/Layers/ThreadBootstrapDispatcher.ts`
  - `apps/server/src/git/Layers/GitManager.ts`
  - `packages/contracts/src/project.ts`
  - `packages/shared/src/projectScripts.ts`
- `Important invariants`:
  - Worktree setup scripts should only fire when creating a new worktree flow that needs them.
  - Generated or managed setup files must not clobber tracked project files unexpectedly.
  - Runtime env handling must stay scoped to the worktree, not the root repo.
  - Setup failures should be visible without blocking the entire thread forever.
- `Merge hotspots`:
  - Project/worktree readiness RPC contracts
  - Git worktree creation/bootstrap flow
  - Terminal launch context and runtime env handling
  - Project metadata persistence for readiness profiles and scripts
- `Verification`:
  - Scan a project for worktree readiness and review the proposed config.
  - Apply readiness and confirm managed files/scripts are generated as expected.
  - Configure a setup script with `Run automatically on worktree creation`.
  - Create a new worktree thread and confirm the setup terminal launches automatically.
  - Verify env/runtime setup is scoped to the worktree.
  - Verify existing worktrees do not rerun setup unexpectedly.

### Project intelligence

- `Status`: Present on the pre-merge fork at `365ae6d9`. Missing on merged baseline `ed85e9ce`.
- `User-visible behavior`: A project intelligence surface summarized important project artifacts and agent surfaces, including runtime config, memory, provider layers, warnings, and code stats. It exposed a navigable UI with sectioned summaries and surface previews.
- `Why it exists`: Gives users a structured operational overview of how a project is configured for agent work, reducing guesswork and making hidden repo/runtime surfaces discoverable.
- `Key fork files`:
  - `apps/server/src/project/Layers/ProjectIntelligenceResolver.ts`
  - `apps/server/src/project/Services/ProjectIntelligenceResolver.ts`
  - `apps/web/src/components/project-intelligence/ProjectIntelligenceLayout.tsx`
  - `apps/web/src/components/project-intelligence/ProjectIntelligenceNav.tsx`
  - `apps/web/src/components/project-intelligence/ProjectIntelligenceOverviewSection.tsx`
  - `apps/web/src/components/project-intelligence/ProjectIntelligenceProviderLayerSection.tsx`
  - `apps/web/src/components/project-intelligence/ProjectIntelligenceWarningsSection.tsx`
  - `apps/web/src/projectIntelligencePresentation.ts`
  - `apps/web/src/projectIntelligenceRouteSearch.ts`
  - `packages/shared/src/codeStatsPolicy.ts`
- `Important invariants`:
  - Surface discovery must be deterministic enough to be useful across reloads.
  - Summaries must avoid leaking secrets while still surfacing relevant configuration.
  - Project intelligence navigation must stay aligned with the resolver’s section and surface IDs.
  - Code stats and warnings must be understandable as operational guidance, not raw internal state.
- `Merge hotspots`:
  - Project contracts and resolver output shape
  - Shared code-stats and filtering utilities
  - Route search/navigation integration in the web app
  - Provider registry and server settings summaries
- `Verification`:
  - Open the project intelligence view for a populated project.
  - Confirm the main sections render with non-empty summaries.
  - Open an individual surface preview and verify the content is relevant and sanitized.
  - Reload and confirm navigation/section state still matches the resolver output.

### 2026-04-23 - Restore upstream macOS dev Electron launcher bypass

- `Status`: active
- `Area`: desktop
- `User-visible impact`: Prevents the desktop dev app from launching through the fork-specific renamed `.electron-runtime` app bundle on macOS, which was causing Electron helper/resource lookup failures, repeated crash loops, and backend port collisions.
- `Why this patch exists`: Upstream already avoids renamed app-bundle launches in macOS development because helper/resource lookup is fragile there. The fork had removed that safeguard while keeping custom dev branding, and the merged desktop runtime now crashes during startup with ICU/GPU/network-service failures unless we restore the upstream bypass.
- `Key files`:
  - `apps/desktop/scripts/electron-launcher.mjs`
- `Merge hotspots`:
  - macOS desktop dev launcher path
  - any future branding or helper-bundle plist customization in development mode
  - Electron version bumps that change bundle/framework resource lookup
- `Verification`:
  - Launch `bun run dev:desktop` on macOS.
  - Confirm the app launches without `icudtl.dat not found in bundle`.
  - Confirm the app does not enter a relaunch loop or leave `127.0.0.1:13774` orphaned after a failed boot.

## Upstream-Touching Patch Entry Template

Use this template for future bugfixes or behavioral patches that modify upstream-derived code:

### YYYY-MM-DD - Short patch title

- `Status`: active | replaced upstream | obsolete
- `Area`: provider | orchestration | web | desktop | contracts | shared
- `User-visible impact`:
- `Why this patch exists`:
- `Key files`:
- `Merge hotspots`:
- `Verification`:
