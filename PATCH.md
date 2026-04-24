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
- `Board View`: restored on top of merged baseline
- `Forking threads`: restored on top of merged baseline
- `Provider switching / handoff`: missing on merged baseline
- `Saving prompts`: restored on top of merged baseline
- `Repository/release personalization`: preserved on merged baseline, with follow-up workflow repairs
- `GitHub PR target remote selection`: restored on top of merged baseline with Dynamo config keys and typed selection flow
- `Dynamo branding`: restored, including runtime storage isolation and release/build metadata
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

- `Status`: Present on the pre-merge fork at `365ae6d9`. Restored on top of merged baseline `ed85e9ce`.
- `User-visible behavior`: Project-level board with stored columns (`ideas`, `planned`) and derived columns (`in-progress`, `review`, `done`) computed from thread/runtime state. Supports card creation, drag/drop reordering, linked threads, ghost cards, seeded prompts, board-scoped routing, and adding implementation work from proposed plans directly into the board.
- `Why it exists`: Gives Dynamo a lightweight planning surface tied directly to real agent threads instead of separate project-management tooling.
- `Key fork files`:
  - `packages/contracts/src/board.ts`
  - `apps/server/src/persistence/Layers/ProjectionBoardCards.ts`
  - `apps/server/src/persistence/Layers/ProjectionBoardDismissedGhosts.ts`
  - `apps/server/src/persistence/Migrations/026_ProjectionBoardCards.ts`
  - `apps/server/src/persistence/Migrations/027_ProjectionBoardDismissedGhosts.ts`
  - `apps/web/src/boardProjection.ts`
  - `apps/web/src/boardRouteSearch.ts`
  - `apps/web/src/boardStore.ts`
  - `apps/web/src/boardUiStore.ts`
  - `apps/web/src/components/board/BoardView.tsx`
  - `apps/web/src/components/board/BoardCardSheet.tsx`
  - `apps/web/src/routes/_chat.tsx`
  - `apps/web/src/components/chat/ChatHeader.tsx`
  - `apps/web/src/components/chat/ProposedPlanCard.tsx`
- `Important invariants`:
  - Stored columns are authoritative on the server.
  - Derived columns are recomputed from thread state and git/runtime signals.
  - Card-to-thread linking must stay unique and stable.
  - Ghost-card dismissals must persist across reloads.
  - Board route state must survive thread and draft navigation without leaking board params into normal thread opens.
- `Merge hotspots`:
  - Contracts for board commands/events
  - Persistence migrations and projection tables
  - Thread read-model fields consumed by board projection
  - Sidebar and project routing that expose the board UI
  - Chat/proposed-plan actions that seed new board work
- `Verification`:
  - Create, edit, move, archive, and delete cards.
  - Link a card to a thread and verify the derived columns update as thread state changes.
  - Dismiss and restore ghost cards across reloads.
  - Open the board from the chat header/sidebar/command palette and confirm route state is stable.
  - Add a proposed plan to the board, start the agent from the card, and verify the card links to the promoted thread.

### Forking threads

- `Status`: Present on the pre-merge fork at `365ae6d9`. Restored on top of merged baseline `ed85e9ce`.
- `User-visible behavior`: Explicit thread fork flow that clones the relevant thread context into a new thread, preserves fork origin metadata, shows the imported-history boundary in the timeline, and keeps the new thread separate from the source. This is distinct from plan-derived implementation thread creation.
- `Why it exists`: Lets users branch work from an existing conversation without losing provenance or polluting the original thread.
- `Key fork files`:
  - `packages/contracts/src/orchestration.ts`
  - `packages/contracts/src/ipc.ts`
  - `packages/contracts/src/rpc.ts`
  - `apps/server/src/orchestration/contextHandoff.ts`
  - `apps/server/src/orchestration/Layers/ThreadForkDispatcher.ts`
  - `apps/server/src/orchestration/Layers/ThreadForkMaterializer.ts`
  - `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
  - `apps/server/src/persistence/Migrations/029_ProjectionThreadContextHandoffs.ts`
  - `apps/server/src/persistence/Migrations/034_EnsureProjectionThreadContextHandoffs.ts`
  - `apps/server/src/persistence/Services/ProjectionThreadContextHandoffs.ts`
  - `apps/server/src/persistence/Layers/ProjectionThreadContextHandoffs.ts`
  - `apps/server/src/orchestration/forkThreadExecution.ts`
  - `apps/server/src/ws.ts`
  - `apps/server/src/orchestration/projector.ts`
  - `apps/web/src/components/ForkThreadDialog.tsx`
  - `apps/web/src/components/chat/MessagesTimeline.tsx`
  - `apps/web/src/components/ChatView.tsx`
  - `apps/web/src/store.ts`
- `Important invariants`:
  - Source thread and forked thread must remain distinct.
  - Fork origin metadata must survive projection and reload.
  - Timeline UI must show where imported history stops and new fork-local history begins.
  - Fork creation must not break branch/worktree metadata.
  - Fork materialization must reconstruct source history by filtering source-thread aggregate events, so unrelated or legacy orchestration events elsewhere in the event log cannot make fork creation fail with `Failed to read the source thread history`.
  - Fork creation cleanup must only dispatch child-thread deletion after the child thread was actually created.
  - Fork creation prepares a durable `thread.context-handoff-prepared` record; successful provider acceptance marks it delivered, failed sends leave it pending for retry.
  - The first live post-fork provider turn must receive the imported fork transcript, imported proposed plans, attachment metadata, and the new live message in the actual provider-visible input, not just in the UI/read model. This closes the `Fork Context Loss` bug.
  - Once a handoff is delivered and projected, reload/reprojection must not resend the imported context on later turns.
  - Attachments cloned for fork UI continuity must be represented in provider-visible handoff text as metadata only, not binary/image content.
  - Handoff projection DDL must also run at migration id `034` for existing Dynamo databases whose pre-merge fork-only migration history already advanced past id `029`.
  - Known residual race: if a provider accepts the turn but the server crashes before `thread.context-handoff-delivered` is persisted, retry can resend the handoff. Fixing that requires provider-side idempotency or a pre-send marker.
  - Auto-title replacement on the first live post-fork turn must treat the default `Fork of X` title the same way it treats `New thread`, so generated titles can replace the placeholder.
- `Merge hotspots`:
  - Orchestration command/event schemas
  - Projection pipeline and snapshot query shape
  - Server RPC handlers and provider turn bootstrap logic
  - Chat timeline rendering, store normalization, and thread navigation
- `Verification`:
  - Fork a thread with existing history.
  - Fork from a dev database containing unrelated/legacy orchestration events and confirm source history reconstruction still succeeds.
  - Confirm fork origin metadata appears in the new thread.
  - Confirm the timeline shows a `Forked from ...` separator at the imported-history boundary.
  - Confirm new messages only affect the forked thread.
  - Confirm the first live turn in the fork sees the imported transcript/proposed plans/attachment metadata in provider input and the second live turn does not repeat the handoff import.
  - Force a first-send failure and verify retry still includes the pending handoff.
  - Confirm the first live turn can replace the default `Fork of X` title with an auto-generated title.
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

- `Status`: Present on the pre-merge fork at `365ae6d9`. Restored on top of merged baseline `ed85e9ce` using the shared durable context handoff foundation.
- `User-visible behavior`: Users can switch the active provider for an existing idle thread while preserving enough visible context to continue the same conversation on the new provider. The restored implementation prepares a durable full-context provider-switch handoff and sends it with the next live user message to the target provider.
- `Why it exists`: Lets Dynamo treat providers as interchangeable runtimes on one thread instead of forcing the user to create a new thread whenever they want to change provider.
- `Key fork files`:
  - `packages/contracts/src/orchestration.ts`
  - `apps/server/src/orchestration/contextHandoff.ts`
  - `apps/server/src/orchestration/decider.ts`
  - `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
  - `apps/server/src/provider/Layers/ProviderService.ts`
  - `apps/server/src/persistence/Migrations/029_ProjectionThreadContextHandoffs.ts`
  - `apps/server/src/persistence/Migrations/034_EnsureProjectionThreadContextHandoffs.ts`
  - `apps/server/src/persistence/Services/ProjectionThreadContextHandoffs.ts`
  - `apps/server/src/persistence/Layers/ProjectionThreadContextHandoffs.ts`
  - `apps/web/src/components/ChatView.logic.ts`
- `Important invariants`:
  - Switching providers must not silently drop the visible thread history.
  - Provider-switch handoff preparation must reuse `thread.context-handoff-prepared`, `apps/server/src/orchestration/contextHandoff.ts`, and the delivered/failed handoff events instead of adding a second runtime-only transfer path.
  - Switching is only allowed between turns; running turns and pending provider approvals/user-input must keep the provider picker locked and server-side switching blocked.
  - The target provider's first switched turn must receive imported transcript/proposed-plan/attachment metadata plus the new live user message in provider-visible input.
  - Successful target-provider acceptance must mark the provider-switch handoff delivered; failed sends must leave it pending for retry.
  - Successful provider switches must append a timeline-visible `provider.session.switched` activity with the source provider, target provider, and target model.
  - Handoff projection DDL must also run at migration id `034` for existing Dynamo databases whose pre-merge fork-only migration history already advanced past id `029`.
  - Handoff state must stay aligned with branch and worktree metadata.
  - A provider switch should preserve resumability and avoid leaving the thread in an unroutable state.
  - Current restored behavior uses a full visible-context handoff. The old incremental provider-slot marker system and migration `033_ProviderSessionRuntimeSlots.ts` are not restored; if provider-native sync markers return later, they should extend the shared handoff state rather than replace it.
- `Merge hotspots`:
  - Orchestration turn-start and provider command flows
  - Provider session persistence and lifecycle state
  - Thread read-model fields consumed by the composer/chat UI
  - Any cleanup or reaper logic that mutates provider session bindings
- `Verification`:
  - Start a thread on provider A and switch to provider B.
  - Confirm the next turn on provider B has enough context to continue correctly.
  - Confirm a successful switched send marks the provider-switch handoff delivered.
  - Confirm thread history shows the provider/model switch marker at the switch point.
  - Confirm switching is blocked while a turn or provider interaction is pending and does not prepare a stray handoff.
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

### Repository/release personalization

- `Status`: Present on the pre-merge fork at `365ae6d9`. Preserved on merged baseline `ed85e9ce`; `.github` files were not lost in the merge. Follow-up workflow repairs keep this branch aligned with the current build output and release scripts.
- `User-visible behavior`: Repository links, marketing download links, release API calls, GitHub Actions, and release publishing target `tmacc/agentdynamo2` and this fork's available CI/release infrastructure rather than upstream `pingdotgg/t3code` assumptions.
- `Why it exists`: This fork publishes, tests, and presents itself from the fork repository. Losing these values sends users to the wrong GitHub releases page or breaks CI/release automation.
- `Key fork files`:
  - `.github/workflows/ci.yml`
  - `.github/workflows/release.yml`
  - `.github/ISSUE_TEMPLATE/bug_report.yml`
  - `.github/ISSUE_TEMPLATE/feature_request.yml`
  - `.github/pull_request_template.md`
  - `.github/workflows/issue-labels.yml`
  - `.github/workflows/pr-size.yml`
  - `.github/workflows/pr-vouch.yml`
  - `.github/VOUCHED.td`
  - `apps/marketing/src/lib/releases.ts`
  - `apps/marketing/src/layouts/Layout.astro`
  - `apps/marketing/src/pages/download.astro`
  - `apps/marketing/src/pages/index.astro`
  - `scripts/merge-update-manifests.ts`
  - `scripts/lib/update-manifest.ts`
  - `AGENTS.md`
- `Important invariants`:
  - Marketing and release API links must point to `https://github.com/tmacc/agentdynamo2`.
  - CI must run on infrastructure available to the fork, not upstream-only runner labels.
  - CI install steps that run in pull requests should avoid lifecycle scripts unless the workflow explicitly needs them.
  - Desktop preload verification must match the actual desktop build output (`apps/desktop/dist-electron/preload.cjs`).
  - Release manifest merge steps must call the script that exists in the current tree: `scripts/merge-update-manifests.ts --platform mac`.
  - Optional release steps such as CLI publishing and release finalization must remain gated by repository variables/secrets.
  - `AGENTS.md` must keep directing agents to update `PATCH.md` for upstream-touching fork behavior.
- `Merge hotspots`:
  - GitHub Actions runner labels, install flags, artifact paths, and release job dependencies
  - Marketing links and release API repository constants
  - Desktop artifact naming and Electron bundle extension changes
  - Update manifest merge script names and CLI arguments
  - Release secrets, repository variables, and app-token publishing behavior
- `Verification`:
  - Run `bun run build:desktop` and confirm `apps/desktop/dist-electron/preload.cjs` exists.
  - Run `node scripts/release-smoke.ts`.
  - Run `bun run test scripts/merge-update-manifests.test.ts`.
  - Review marketing links and release API constants for `tmacc/agentdynamo2`.
  - Dry-run or inspect the release workflow when GitHub runner labels, signing, or artifact names change upstream.

### GitHub PR target remote selection

- `Status`: Present on the pre-merge fork at `365ae6d9`. Restored on top of the current merged branch with an updated typed flow, Dynamo-local config key, and compatibility fallback for the old fork config key.
- `User-visible behavior`: When a project has multiple GitHub remotes that could be valid PR base repositories, Dynamo asks the user which remote should receive PRs, saves that choice, and uses the remembered remote for later `Create PR` / `Push & create PR` actions in that repository.
- `Why it exists`: Repositories that have both a fork remote and an upstream remote can otherwise create PRs against the wrong repository or fail because `gh pr create` infers an ambiguous base repo. The user should make this choice once instead of being surprised on every PR action.
- `Key fork files`:
  - `packages/contracts/src/git.ts`
  - `packages/contracts/src/rpc.ts`
  - `apps/server/src/git/Services/GitManager.ts`
  - `apps/server/src/git/Layers/GitManager.ts`
  - `apps/server/src/ws.ts`
  - `apps/web/src/lib/gitReactQuery.ts`
  - `apps/web/src/components/GitActionsControl.tsx`
  - `apps/web/src/lib/gitReactQuery.ts`
- `Important invariants`:
  - PR creation must not silently choose between multiple different GitHub target repositories.
  - If zero GitHub remotes are detected, preserve the existing GitHub CLI inference path instead of blocking local/test repositories.
  - If exactly one `origin` GitHub remote exists, PR creation should continue without prompting and pass that repo explicitly to `gh`.
  - If multiple remotes point at the same GitHub repo, PR creation should continue without prompting.
  - If multiple different GitHub remotes exist and no preference is saved, PR creation should fail with a typed `GitPullRequestRemoteSelectionRequiredError` and the UI should present an actionable "Choose PR remote" dialog.
  - The selected remote must be validated against the current repository remotes before saving or using it.
  - The remembered choice is repo-local git config stored as `dynamo.pullRequestRemote`; reads fall back to legacy `t3.pullRequestRemote` so pre-merge fork choices still work.
  - `gh pr create` should pass the selected base repository explicitly, not rely on GitHub CLI inference.
  - The selected PR base repository and the current branch's head repository are distinct concepts; fork/head remotes must still produce owner-qualified head selectors such as `owner:branch`.
- `Merge hotspots`:
  - Git contracts and WebSocket/RPC method lists for PR remote option reads/writes
  - `GitManager` PR creation flow, especially base repository, head selector, existing PR lookup, and base branch resolution
  - Git action UI/dialog state and React Query mutations
  - Tests around repositories with `origin` plus `upstream` or fork remotes
- `Verification`:
  - Create a repo with two GitHub remotes, run `Create PR`, and confirm Dynamo prompts for the PR target remote.
  - Pick a remote, retry PR creation, and confirm `gh pr create` targets that repository.
  - Run PR creation again and confirm the saved choice is reused without asking.
  - Change/remove the saved remote and confirm Dynamo asks again or reports an actionable validation error.
  - Confirm a single-origin repository and a multi-remote same-repository checkout still create PRs without extra UI.
  - Confirm a fork-head branch still uses an owner-qualified `--head` selector while targeting the selected base repo.

### Dynamo branding

- `Status`: Active fork customization restored after the merge onto `ed85e9ce`.
- `User-visible behavior`: The app should present as Dynamo in the desktop shell, web boot/splash surfaces, update prompts, release names, release artifacts, and desktop package metadata. Dynamo must be able to run alongside upstream T3 Code on the same machine without sharing default runtime state.
- `Why it exists`: This fork is branded as Dynamo. Losing this customization creates mixed product identity: the desktop title can say Dynamo while splash screens, update prompts, artifact names, marketing copy, and release metadata still say T3 Code.
- `Current audit notes`:
  - Preserved: `apps/desktop/package.json` still has `productName: "Dynamo (Alpha)"`.
  - Preserved: `apps/desktop/src/appBranding.ts` still uses `Dynamo`.
  - Preserved: `apps/web/index.html` boot shell still says `Dynamo (Alpha)`.
  - Restored: shared branding constants live in `packages/shared/src/branding.ts`.
  - Restored: fallback web branding in `apps/web/src/branding.ts` uses `Dynamo`.
  - Restored: `apps/web/src/components/SplashScreen.tsx` alt/aria labels use `Dynamo`.
  - Restored: `apps/web/src/components/Sidebar.tsx` shows the Dynamo wordmark instead of the T3 vector plus `Code`.
  - Restored: desktop update, settings, connection, startup, and provider-disabled app copy use `Dynamo`.
  - Restored: server defaults use `~/.dynamo`; desktop passes `DYNAMO_HOME` and keeps `T3CODE_HOME` only as an explicit compatibility alias for internal consumers.
  - Restored: desktop userData/profile folders use `dynamo` and `dynamo-dev`, not `t3code` and `t3code-dev`.
  - Restored: browser persistence keys use the `dynamo:*` namespace; Dynamo should not import or remove upstream `t3code:*` browser state.
  - Restored: release/nightly names in `scripts/resolve-nightly-release.ts` and `scripts/release-smoke.ts` use `Dynamo`.
  - Restored: `scripts/build-desktop-artifact.ts` derives product name, artifact name, bundle id, executable name, staged package name, commit hash field, author, and description from shared Dynamo branding.
  - Icon files under `apps/desktop/resources`, `apps/web/public`, and `apps/marketing/public` currently match both the pre-merge fork and upstream; if there were newer custom icon edits, they were not present as tracked differences in `365ae6d9`.
  - Ignored dev runtime assets under `apps/desktop/.electron-runtime` currently contain Dynamo dev icon/name data, but those are generated/ignored and must not be treated as merge-preserved source of truth.
- `Key fork files`:
  - `packages/shared/src/branding.ts`
  - `packages/shared/package.json`
  - `apps/desktop/package.json`
  - `apps/desktop/src/appBranding.ts`
  - `apps/desktop/src/main.ts`
  - `apps/desktop/scripts/electron-launcher.mjs`
  - `apps/web/index.html`
  - `apps/web/src/branding.ts`
  - `apps/web/src/components/SplashScreen.tsx`
  - `apps/web/src/components/desktopUpdate.logic.ts`
  - `scripts/build-desktop-artifact.ts`
  - `scripts/dev-runner.ts`
  - `scripts/resolve-nightly-release.ts`
  - `scripts/release-smoke.ts`
  - `apps/server/src/cli.ts`
  - `apps/server/src/os-jank.ts`
  - `apps/server/src/checkpointing/Layers/CheckpointStore.ts`
  - `README.md`
  - `AGENTS.md`
  - `.github/workflows/release.yml`
  - `apps/marketing/src/layouts/Layout.astro`
  - `apps/marketing/src/pages/index.astro`
  - `apps/marketing/src/pages/download.astro`
  - `apps/desktop/resources/icon.icns`
  - `apps/desktop/resources/icon.ico`
  - `apps/desktop/resources/icon.png`
  - `apps/web/public/apple-touch-icon.png`
  - `apps/web/public/favicon.ico`
- `Important invariants`:
  - Desktop display names should resolve to `Dynamo (Dev)`, `Dynamo (Alpha)`, or `Dynamo (Nightly)`.
  - Release artifact names should use `Dynamo-${version}-${arch}.${ext}` unless we intentionally keep an old filename for updater compatibility.
  - Bundle id, protocol, Linux executable/WM class, staged package name, and commit-hash metadata should come from one shared branding source instead of scattered literals.
  - User-facing update, splash, connection, and release text should say Dynamo.
  - Repository-facing context that agents read first, especially `README.md` and `AGENTS.md`, should identify the product as Dynamo so local AI does not infer the project is named T3 Code.
  - Marketing page titles, release names, and generated checkpoint commit author/committer names should say Dynamo.
  - Default runtime state should live under `~/.dynamo`, including `userdata/state.sqlite`, logs, settings, keybindings, and worktrees.
  - `DYNAMO_HOME` is the primary home override. `T3CODE_HOME` remains a fallback alias and is set to the same path for child processes that still expect it.
  - Desktop Chromium profile/userData should use Dynamo-specific folders so upstream T3 Code and Dynamo do not share local profile state.
  - Browser local-storage keys should use `dynamo:*`. Do not read, migrate, or remove upstream `t3code:*` keys unless we intentionally add a user-approved migration path.
- `Merge hotspots`:
  - Desktop app branding, bundle metadata, and Electron builder config
  - Desktop userData/profile path setup and custom protocol registration
  - Server CLI/config defaults, dev runner home handling, state/log/keybinding paths
  - Web local-storage keys for theme, UI state, saved prompts, editor preferences, terminal state, and client settings
  - Web boot shell, branding fallback, splash, settings, update prompts, and connection error copy
  - README/agent instructions and marketing copy
  - Checkpoint commit metadata and release workflow display names
  - Release scripts, artifact names, updater manifests, and nightly release metadata
  - Icon generation/input assets and ignored dev `.electron-runtime` bundle output
- `Verification`:
  - Run `bun run test src/appBranding.test.ts` in `apps/desktop`.
  - Run `bun run test src/branding.test.ts src/components/desktopUpdate.logic.test.ts src/savedPromptStore.test.ts src/clientPersistenceStorage.test.ts src/uiStateStore.test.ts` in `apps/web`.
  - Run `bun run test scripts/build-desktop-artifact.test.ts scripts/resolve-nightly-release.test.ts scripts/dev-runner.test.ts`.
  - Run `bun run test src/cli-config.test.ts` in `apps/server`.
  - Run `bun run build:desktop` and inspect staged builder metadata/artifact names for Dynamo.
  - Launch `bun run dev:desktop` and confirm the window title, splash, dock/app display name, and update prompts use Dynamo.

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
