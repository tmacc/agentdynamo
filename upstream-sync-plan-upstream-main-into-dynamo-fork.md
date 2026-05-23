# Upstream Sync Plan: `upstream/main` into Dynamo Fork

## Summary

Merge upstream `pingdotgg/t3code` into the current branch `t3code/upstream-commit-review` using the repo’s `upstream-merge-playbook`.

Authoritative upstream range:

```text
35721d9a08b225c4a3752f322ae4daccbeaa564e..d1e85c4e8fdef82fbaded9539532b754080419e0
```

This is 57 upstream commits, from upstream `v0.0.22` through `v0.0.24`. The sync marker `origin/upstream-sync-base` is a direct ancestor of `upstream/main`, so no rewritten-history recovery is needed.

Strategy chosen:

- Target branch: current branch, `t3code/upstream-commit-review`.
- Restoration style: preserve critical fork behavior first, then restore UI/features by `PATCH.md` priority.
- Acceptance: merge is not complete until `bun fmt`, `bun lint`, and `bun typecheck` all pass, `PATCH.md` reflects the result, and `upstream-sync-base` is advanced only after verification.

## Important Constraints

- Use `origin/upstream-sync-base..upstream/main`, not `HEAD..upstream/main`, as the upstream delta.
- Do not treat compile success as feature preservation.
- Prefer upstream architecture in broad conflict areas, then restore Dynamo fork behavior as explicit follow-up commits.
- Preserve Dynamo ownership of branding, release metadata, storage isolation, telemetry defaults, and fork-specific workflows.
- Never delete `PATCH.md` entries just because upstream moved or deleted the old implementation. Mark status accurately and restore or defer explicitly.
- Use `bun run test`, never `bun test`.

## Pre-Merge Preparation

1. Confirm clean working tree:

   ```bash
   git status --short --branch
   ```

2. Refresh remotes with explicit refspecs so the remote-tracking refs that later commands read (`upstream/main`, `origin/upstream-sync-base`) are guaranteed to be updated, not just `FETCH_HEAD`:

   ```bash
   git fetch upstream main:refs/remotes/upstream/main
   git fetch origin upstream-sync-base:refs/remotes/origin/upstream-sync-base

   # Sanity-check that the local remote-tracking refs now match what was fetched.
   git rev-parse upstream/main origin/upstream-sync-base
   ```

3. **Pin the merge target first**, then reconfirm the authoritative range and ancestry against the pinned commit (not the moving `upstream/main` ref). The merge in this plan integrates exactly `d1e85c4e8fdef82fbaded9539532b754080419e0`, not whatever `upstream/main` happens to be at merge time:

   ```bash
   PINNED_UPSTREAM=d1e85c4e8fdef82fbaded9539532b754080419e0
   git rev-parse --verify "$PINNED_UPSTREAM^{commit}"

   # Sync marker must be ancestor of pinned tip, and pinned tip must be ancestor of upstream/main.
   git merge-base --is-ancestor origin/upstream-sync-base "$PINNED_UPSTREAM" || {
     echo "ERROR: origin/upstream-sync-base is not an ancestor of $PINNED_UPSTREAM — re-plan." >&2
     exit 1
   }
   git merge-base --is-ancestor "$PINNED_UPSTREAM" upstream/main || {
     echo "ERROR: upstream/main no longer contains $PINNED_UPSTREAM — re-fetch and re-plan." >&2
     exit 1
   }

   # Authoritative range commands — bounded by the pinned commit, NOT upstream/main.
   git log --reverse --oneline "origin/upstream-sync-base..$PINNED_UPSTREAM"
   git rev-list --count "origin/upstream-sync-base..$PINNED_UPSTREAM"   # expected: 57

   # Drift report only — describes commits NOT in this sync.
   if [ "$(git rev-parse upstream/main)" != "$PINNED_UPSTREAM" ]; then
     echo "WARN: upstream/main has advanced past pinned tip $PINNED_UPSTREAM."
     echo "      Newer commits will NOT be merged in this sync:"
     git log --oneline "$PINNED_UPSTREAM..upstream/main"
     echo "      To integrate them, finish this sync, then plan a follow-up sync."
   fi
   ```

   If upstream has advanced and the team decides to extend the range, **stop, update this plan's range/marker/inventory to the new tip, and re-run the iterate-plan loop**. Do not silently absorb extra commits.

4. Record starting facts in the eventual `PATCH.md` sync log:
   - Previous marker: `35721d9a08b225c4a3752f322ae4daccbeaa564e`
   - Integrated upstream tip: `d1e85c4e8fdef82fbaded9539532b754080419e0`
   - Range count: 57 commits
   - Branch: `t3code/upstream-commit-review`
   - Sync marker is a direct ancestor.

5. Regenerate the conflict / file-touch inventory immediately before merging. **All inventory commands use the pinned commit as the upper bound** so the inventory matches exactly the commits being merged:

   ```bash
   # Assumes PINNED_UPSTREAM is exported from step 3 (export it if running steps in separate shells).
   : "${PINNED_UPSTREAM:=d1e85c4e8fdef82fbaded9539532b754080419e0}"

   # File-touch inventory (which paths the pinned upstream range modifies)
   git diff --name-status "origin/upstream-sync-base..$PINNED_UPSTREAM" | sort

   # Conflict preview using a non-mutating merge-tree (Git 2.38+) against the pinned commit
   git merge-tree --write-tree --name-only HEAD "$PINNED_UPSTREAM" || true

   # If on older Git, fall back to a throwaway merge probe in a temp branch:
   #   git switch -c _merge-probe
   #   git merge --no-commit --no-ff "$PINNED_UPSTREAM" || true
   #   git diff --name-only --diff-filter=U
   #   git merge --abort && git switch - && git branch -D _merge-probe
   ```

   Only the ancestry/drift commands in step 3 reference `upstream/main`; everything that describes the _scope of this sync_ (range, log, count, file-touch inventory, conflict preview) must use `$PINNED_UPSTREAM`. The Expected Conflict Clusters section below was generated from this inventory at plan-writing time. If the refreshed inventory shows materially different hotspots, update the cluster list before proceeding.

## Merge Execution Plan

1. Run the merge on the current branch against the **pinned** upstream commit, not the moving `upstream/main` ref:

   ```bash
   git merge d1e85c4e8fdef82fbaded9539532b754080419e0
   ```

   Using the explicit SHA is required so the merge stays aligned with the authoritative range, the cluster inventory, the `PATCH.md` sync log, and the final `upstream-sync-base` marker. Do not substitute `upstream/main` here, even if it currently points at the same commit.

2. Resolve conflicts in clusters, not file-by-file randomly. Stage each cluster as it stabilizes (`git add <files>`) and verify the cluster contains no remaining conflict markers, but defer the merge commit itself until **all** unmerged paths are resolved — Git rejects a commit while any path remains unmerged. The single conflict-resolution merge commit is item 1 of the Commit Structure; all subsequent restoration work goes into the normal post-merge commits that follow.

3. Use this conflict policy:
   - For broad upstream architecture refactors, accept upstream shape first.
   - Restore Dynamo behavior through explicit adaptation commits.
   - For isolated fork patches that still cleanly fit the new upstream structure, keep them during conflict resolution.
   - For generated files, prefer the upstream generated structure, then reapply fork schema widenings or regenerate only if the repo workflow supports it.

## Expected Conflict Clusters

Conflict preview shows these high-risk areas.

### 1. Release, Branding, Marketing

Likely files:

- `.github/workflows/release.yml`
- `docs/release.md`
- `scripts/resolve-nightly-release.ts`
- `apps/web/src/branding.ts`
- `apps/marketing/src/layouts/Layout.astro`
- `apps/marketing/src/pages/index.astro`
- `apps/marketing/src/pages/download.astro`
- `apps/marketing/public/screenshot.jpeg`

Resolution:

- Preserve Dynamo branding, app identity, package ownership, release channels, and telemetry ownership.
- Do not blindly adopt upstream package version bumps from `v0.0.23` or `v0.0.24`.
- Adopt upstream workflow hardening only where it does not change Dynamo release ownership.
- Keep PR-size retry resilience and combine it with upstream workflow permission hardening.

Verification:

```bash
git diff -- .github/workflows/pr-size.yml .github/workflows/release.yml docs/release.md apps/web/src/branding.ts
```

Confirm:

- Dynamo names/domains/storage paths remain fork-owned.
- PR-size workflow still retries transient GitHub label API failures.
- Release workflow does not publish under upstream ownership.

### 2. Desktop Effect Port and Packaging

Likely files:

- `apps/desktop/package.json`
- `apps/desktop/src/main.ts`
- `apps/desktop/src/preload.ts`
- deleted/moved desktop helpers:
  - `apps/desktop/src/appBranding.ts`
  - `apps/desktop/src/backendReadiness.ts`
  - `apps/desktop/src/clientPersistence.ts`
  - `apps/desktop/src/serverListeningDetector.ts`
- `scripts/build-desktop-artifact.ts`
- `scripts/build-desktop-artifact.test.ts`
- `scripts/dev-runner.ts`

Resolution:

- Accept upstream’s Effect-based desktop architecture as the baseline.
- Reattach Dynamo-specific behavior into upstream’s new modules rather than preserving deleted old modules:
  - branding moves into upstream desktop identity/config modules.
  - backend readiness gate moves into `DesktopBackendManager`/`DesktopLifecycle`.
  - client persistence maps to upstream desktop settings/saved environment services.
  - runtime dependency packaging is reconciled with upstream’s workspace package exclusion fix.
- Preserve:
  - desktop dev backend readiness gate.
  - desktop main-process workspace dependency packaging invariant.
  - dev runner telemetry default behavior.
  - macOS notarization retry resilience.
  - publish autodetection guard.

Verification:

```bash
bun run test apps/desktop/src/app/DesktopAppIdentity.test.ts apps/desktop/src/backend/DesktopBackendManager.test.ts apps/desktop/src/settings/DesktopClientSettings.test.ts
bun run test scripts/build-desktop-artifact.test.ts scripts/dev-runner.test.ts
```

Manual smoke after build checks:

```bash
bun dev:desktop
```

Confirm the desktop window waits for backend readiness and does not crash on unresolved workspace package imports.

### 3. Contracts, Migrations, Orchestration, Team Features

Likely files:

- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/project.ts`
- `packages/contracts/src/settings.ts`
- `apps/server/src/persistence/Migrations.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/commandInvariants.ts`
- `apps/server/src/ws.ts`

Resolution:

- Accept upstream additions for diagnostics, keybindings settings, provider update advisories, archived shell snapshots, and hosted/remote APIs.
- Preserve Dynamo additions:
  - multi-provider subagents.
  - board view projections/contracts.
  - thread forking and context handoffs.
  - provider switching/handoff.
  - team task projections and coordinator access.
  - worktree setup runtime profile.
  - project intelligence exports.
- Migration numbering must be handled manually:
  - Do not reuse an ID already owned by Dynamo migrations.
  - If upstream adds migration `030_ProjectionThreadShellArchiveIndexes`, map it to the next safe Dynamo migration ID if `030` is already used locally.
  - Register the mapped migration in `Migrations.ts`.
  - Add a `PATCH.md` merge note explaining any migration ID remap.

Verification:

```bash
bun run test packages/contracts/src/orchestration.test.ts packages/contracts/src/server.test.ts packages/contracts/src/settings.test.ts
bun run test apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts
bun run test apps/server/src/persistence/Migrations/*.test.ts
```

Acceptance:

- Existing Dynamo databases boot.
- Board/team/context-handoff rows still project correctly.
- New upstream archived shell snapshot queries are present without breaking Dynamo projection shapes.

### 4. VCS, Git Workflow, Source Control, PR Target Remote

Likely files:

- `apps/server/src/vcs/GitVcsDriverCore.ts`
- `apps/server/src/checkpointing/Layers/CheckpointStore.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `apps/server/src/git/GitManager.test.ts`
- source-control provider files touched by upstream VCS changes

Resolution:

- Accept upstream VCS performance work:
  - faster diff loading.
  - archived shell snapshot lookup.
  - configurable automatic git fetch interval.
  - backoff for remote refresh failures.
- Preserve Dynamo behavior:
  - child worktree seed/snapshot/review/apply helpers.
  - GitHub PR target remote selection.
  - ignore temporary worktree branch updates.
  - current project/repo identity behavior used by project intelligence.
- Adapt fork helpers onto upstream `VcsDriver`/`GitVcsDriverCore` APIs instead of restoring old Git manager surfaces.

Verification:

```bash
bun run test apps/server/src/vcs/GitVcsDriverCore.test.ts apps/server/src/vcs/GitVcsDriver.test.ts apps/server/src/vcs/VcsStatusBroadcaster.test.ts
bun run test apps/server/src/sourceControl/GitHubSourceControlProvider.test.ts apps/server/src/sourceControl/GitHubCli.test.ts
```

Manual smoke:

- Create/list PR target remote from a non-`origin` target.
- Launch a child worktree task and confirm review/apply stays isolated to the child worktree.
- Confirm remote refresh failures back off rather than creating noisy polling loops.

### 5. Provider Runtime, Codex Schema, Auth Probes

Likely files:

- `packages/effect-codex-app-server/src/_generated/schema.gen.ts`
- `apps/server/src/provider/Layers/CodexProvider.ts`
- `apps/server/src/provider/Layers/ClaudeProvider.ts`
- `apps/server/src/provider/Layers/CursorProvider.ts`
- `apps/server/src/provider/Layers/OpenCodeProvider.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`

Resolution:

- Accept upstream:
  - provider update advisories.
  - Codex protocol refresh.
  - longer Codex auth probe timeout.
  - preserved Codex probe results across scoped teardown.
  - OpenCode raw text delta fix.
  - SSH reconnect/node path fixes.
- Reapply Dynamo Codex priority service-tier compatibility:
  - Read-side schemas must accept `"priority"` for Codex config/thread start/resume/fork responses.
  - Request-side schemas stay as upstream supports them unless upstream explicitly changes request tiers.
- Preserve provider account identity labels and Dynamo team provider routing.

Verification:

```bash
bun run test packages/effect-codex-app-server/src/client.test.ts
bun run test apps/server/src/provider/Layers/CodexAdapter.test.ts apps/server/src/provider/Layers/CodexSessionRuntime.test.ts apps/server/src/provider/Layers/ProviderRegistry.test.ts
```

`CodexProvider.ts` has no direct unit test; its behavior is exercised through `CodexAdapter.test.ts`, `CodexSessionRuntime.test.ts`, and the `ProviderRegistry` wiring tests. If new direct coverage is added during the merge, list it here.

Acceptance:

- Codex Fast Mode sessions that report `serviceTier: "priority"` validate.
- Provider status checks do not regress into false unavailable states.
- Team coordinator routing still understands provider driver/instance identity.

### 6. Web Composer, Timeline, Sidebar, Tiled View

Likely files:

- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/chat/MessagesTimeline.logic.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/ChatView.browser.tsx`
- `apps/web/src/components/ChatMarkdown.tsx`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/components/ui/sidebar.tsx`
- `apps/web/src/routeTree.gen.ts`
- `apps/web/src/rpc/wsRpcClient.ts`

Resolution:

- Accept upstream performance refactors where possible:
  - timeline row rerender reductions.
  - timer rerender avoidance.
  - activity rerender reductions.
  - composer refs/context provider refactor.
  - sidebar selection rerender reductions.
- Restore Dynamo UX:
  - tiled multi-thread view route and sidebar workspace.
  - saved prompt menu and dialog.
  - composer pending prompt single-render behavior.
  - explicit assistant render mode.
  - slash-command preformatted output rendering.
  - assistant file-path autolinking.
  - newest child agents first in subagent panel.
  - saved prompts visible and stable in composer menu.
- Route tree must be regenerated or manually reconciled after route files are restored.

Verification:

```bash
bun run test apps/web/src/tileViewStore.test.ts apps/web/src/tileRouteSearch.test.ts
bun run test apps/web/src/components/chat/MessagesTimeline.test.tsx apps/web/src/components/chat/MessagesTimeline.logic.test.ts
bun run test:browser apps/web/src/components/ChatMarkdown.browser.tsx
```

Manual smoke:

- Open `/tiled?threads=...&focus=...`; URL state wins over stale in-memory tile state.
- Use split picker to add/focus tiles without duplication.
- Send prompt from shared composer and confirm only focused tile receives it.
- Confirm `/usage` and other preformatted slash-command output retains layout.
- Confirm bare assistant file paths open in editor.
- Confirm saved prompt menu opens from the composer header and dialog still renders.

### 7. Settings, Diagnostics, Keybindings

Likely files:

- `packages/contracts/src/settings.ts`
- `packages/contracts/src/server.ts`
- `apps/server/src/keybindings.ts`
- `apps/server/src/server.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/rpc/wsRpcClient.ts`
- `apps/web/src/environmentApi.ts`

Resolution:

- Adopt upstream:
  - keybindings settings editor.
  - diagnostics process/trace views.
  - diagnostics resource history.
  - sidebar thread preview count setting.
  - automatic git fetch interval setting.
- Preserve Dynamo settings:
  - tiled view keybindings.
  - team/subagent defaults.
  - provider account label behavior.
  - Dynamo telemetry defaults.

Verification:

```bash
bun run test apps/server/src/keybindings.test.ts packages/contracts/src/settings.test.ts
bun run test apps/web/src/components/settings/KeybindingsSettings.logic.test.ts apps/web/src/components/settings/SettingsPanels.logic.test.ts
```

Acceptance:

- Existing user settings decode.
- New upstream settings have defaults.
- Dynamo-specific settings are still present and exposed.

## Public APIs, Interfaces, and Types To Reconcile

Upstream introduces or changes these public-ish surfaces:

- `packages/contracts/src/server.ts`
  - provider maintenance/update advisory RPCs.
  - diagnostics RPCs.
  - archived shell snapshot/resource history RPCs.
  - git fetch interval settings.
- `packages/contracts/src/settings.ts`
  - sidebar preview count.
  - keybindings settings editor support.
  - source control refresh interval.
- `packages/contracts/src/ipc.ts`
  - desktop Effect IPC method reshaping.
  - desktop bootstrap settings/env methods.
- `packages/contracts/src/orchestration.ts`
  - archived shell snapshot fields.
  - projection snapshot changes.
- `packages/contracts/src/vcs.ts`
  - faster diff loading contracts and VCS process abstractions.
- `packages/effect-codex-app-server/src/_generated/schema.gen.ts`
  - refreshed Codex protocol bindings.

Dynamo must preserve these fork interfaces:

- Board projection contracts and route exports.
- Team coordinator task/projection contracts.
- Context handoff and thread fork contracts.
- PR target remote selection contracts.
- Tiled view keybinding commands and route search shape.
- Codex read-side `serviceTier: "priority"` compatibility.
- Runtime storage/branding/release identity constants.

## Commit Structure

Use small, reviewable commits after the initial merge conflict resolution.

Recommended sequence:

1. `Merge upstream/main into t3code/upstream-commit-review`
   - Conflict-resolved but may temporarily mark some fork features as needing restoration.
   - No known conflict markers.
   - Builds should be close but not necessarily fully green yet.

2. `Restore Dynamo release, branding, and telemetry ownership`
   - Release workflows, docs, branding constants, marketing ownership, PostHog defaults.

3. `Adapt desktop fork behavior to upstream Effect desktop runtime`
   - Backend readiness, packaging, dev runner, desktop identity, client persistence equivalents.

4. `Restore Dynamo orchestration, team, board, and context handoff contracts`
   - Contracts, migrations, server orchestration, projections.

5. `Adapt Dynamo VCS and PR target remote behavior to upstream VCS performance changes`
   - Child worktree helpers, PR target remote selection, project intelligence hooks.

6. `Restore provider compatibility and Codex priority service-tier schema`
   - Provider account labels, team provider routing, Codex schema widening.

7. `Restore Dynamo web UX on top of upstream composer/timeline refactors`
   - Tiled view, saved prompts, markdown/path autolinking, slash-command preformatting.

8. `Update PATCH.md for upstream sync through d1e85c4e8`
   - Sync log, adopted upstream behavior, restored behavior, deferred behavior if any, verification.

After commit 8 lands and all verification passes, perform the **operational step** of advancing `upstream-sync-base`. This is a branch-pointer update and push (see the Sync Marker Advancement section), **not** a reviewable commit on the integration branch — do not list it as item 9 in PR review.

## Verification Plan

Run focused tests after each restoration cluster, then final checks.

Focused tests:

```bash
bun run test packages/contracts/src/orchestration.test.ts packages/contracts/src/server.test.ts packages/contracts/src/settings.test.ts
bun run test apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts
bun run test apps/server/src/vcs/GitVcsDriverCore.test.ts apps/server/src/vcs/VcsStatusBroadcaster.test.ts
bun run test apps/server/src/provider/Layers/CodexAdapter.test.ts apps/server/src/provider/Layers/ProviderRegistry.test.ts
bun run test apps/server/src/keybindings.test.ts
bun run test apps/web/src/tileViewStore.test.ts apps/web/src/tileRouteSearch.test.ts
bun run test apps/web/src/components/chat/MessagesTimeline.test.tsx apps/web/src/components/chat/MessagesTimeline.logic.test.ts
bun run test:browser apps/web/src/components/ChatMarkdown.browser.tsx
bun run test scripts/build-desktop-artifact.test.ts scripts/dev-runner.test.ts
```

**Test scope**: the focused `bun run test` invocations above are run during restoration to fail fast on the specific clusters touched. They do **not** replace a full-suite run for a sync of this size. Run the full suite as the final gate before completion and marker advancement.

Final required checks:

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

Notes:

- The full `bun run test` is required, not optional, for this 57-commit sync. The focused tests above are early signals, not the completion gate.
- Use `bun run test`, never `bun test`.
- Run the four checks in parallel where the execution environment supports it, but inspect all failures before considering the sync complete.

Manual smoke checks:

- Start web/server normally and open an existing thread.
- Start desktop dev and confirm backend readiness gate works.
- Start a Codex thread with Fast Mode and confirm `priority` service-tier responses decode.
- Open a tiled view with multiple threads and send to the focused tile only.
- Open saved prompts from composer and from timeline surfaces.
- Confirm bare assistant file paths open in the preferred editor.
- Confirm team/subagent child worktree launch, visibility, and review/apply flow.
- Confirm board view still loads cards/projections.
- Confirm PR creation/listing uses the selected GitHub target remote.
- Confirm `/usage` or slash-command TUI output renders preformatted.

## PATCH.md Update Requirements

Add a new sync log entry:

```text
### 2026-05-22 - Merge upstream `35721d9a..d1e85c4e8`
```

Include:

- Status.
- Range integrated.
- Previous marker.
- New marker after verification.
- Ancestor status.
- Integration method.
- Adopted upstream behavior:
  - provider update advisories.
  - keybindings settings editor.
  - diagnostics views and resource history.
  - desktop Effect port.
  - VCS diff performance and remote refresh backoff.
  - archived shell snapshots.
  - hosted web/release changes selectively adopted.
  - SSH/OpenCode/Codex reliability fixes.
- Fork behavior preserved:
  - Dynamo branding/release/storage/telemetry ownership.
  - multi-provider subagents.
  - board view.
  - thread forking/context handoffs.
  - provider switching.
  - saved prompts.
  - tiled view.
  - file-path autolinking.
  - slash-command preformatted rendering.
  - PR target remote selection.
  - desktop readiness/packaging patches.
  - Codex priority service-tier compatibility.
- Merge hotspots encountered.
- Migration remaps, if any.
- Verification commands and results.

Update individual feature entries if their implementation files move because of upstream refactors, especially:

- Desktop readiness and packaging.
- Saved prompts.
- Tiled view.
- Team/subagent orchestration.
- Board view.
- Project intelligence.
- PR target remote selection.
- Codex service-tier compatibility.

## Sync Marker Advancement

Only after the merge, restorations, `PATCH.md`, focused tests, manual smoke checks, and final required checks are complete:

```bash
git branch -f upstream-sync-base d1e85c4e8fdef82fbaded9539532b754080419e0
git push origin upstream-sync-base
```

Do not advance `origin/upstream-sync-base` if any fork feature is only partially restored unless `PATCH.md` explicitly marks that feature as deferred and the team accepts that state.

**Deferral acceptance gate** (required when any fork feature is deferred):

- **Eligibility:** Only LOW or MEDIUM priority `PATCH.md` features are eligible for deferral with marker advancement. Any HIGH priority `PATCH.md` feature (board view, team coordinator, context handoffs, tiled view, PR target remote, desktop readiness/packaging, Codex priority service-tier) **must be fully restored** before the marker moves — no deferral is accepted for these.
- **Who accepts:** Tim Macchi (repo owner), and the engineer driving the merge must agree in writing.
- **Where recorded:** In the new `PATCH.md` sync log entry, under a `Deferred features` subsection that names the feature, the priority, the reason for deferral, the follow-up issue/PR link, and the explicit acceptance ("Accepted by: <names>, <YYYY-MM-DD>").
- **Follow-up tracking:** A follow-up restoration item must exist (issue, task, or PR) and be referenced from the `PATCH.md` entry before the marker advances.
- **Without acceptance:** Stop. Do not advance the marker. Either restore the feature or document the deferral acceptance per the rules above.

## Assumptions and Defaults

- The current branch `t3code/upstream-commit-review` is the intended integration branch.
- The merge should include all upstream commits through `d1e85c4e8`, but Dynamo should not blindly adopt upstream package version ownership.
- Critical-first restoration means build/runtime safety, contracts, migrations, provider startup, desktop startup, and release ownership come before UI polish.
- Upstream architecture should win in broad refactors; Dynamo behavior should be reattached intentionally.
- Any migration ID collision is resolved by remapping upstream migrations to the next safe Dynamo ID and documenting it in `PATCH.md`.
- If a fork feature cannot be restored cleanly during the merge, keep the app buildable, mark the feature as deferred in `PATCH.md`, and create a follow-up restoration item. Marker advancement after any such deferral is governed by the Deferral acceptance gate under Sync Marker Advancement — in particular, **HIGH-priority `PATCH.md` features cannot be deferred before advancing the marker** and must be fully restored first.

## Codex review pass 1 — answers (2026-05-22) [HISTORICAL]

### Verdict

REVISE

### Findings

1. **Cluster commits during unresolved merge are not executable** — HIGH: Merge Execution Plan step 2 said to commit per conflict cluster, but Git refuses commits while any unmerged paths remain, and the Commit Structure section already assumes one initial merge commit.
   → Opus: incorporated — rewrote step 2 to stage clusters incrementally but commit the merge only after all conflicts are resolved, and cross-referenced Commit Structure item 1.
2. **Verification commands include invalid TypeScript file test target** — HIGH: `bun run test apps/server/src/provider/Layers/CodexProvider.ts` targets a source file, not a test.
   → Opus: incorporated — replaced with `CodexSessionRuntime.test.ts` (the adjacent runtime test), kept `CodexAdapter.test.ts` and `ProviderRegistry.test.ts`, and noted that `CodexProvider.ts` has no direct unit test.
3. **Sync marker advancement is listed as a commit** — MEDIUM: Commit Structure item 9 described a branch-pointer operation as a reviewable commit.
   → Opus: incorporated — removed item 9 from the commit list, kept the operational step in the Sync Marker Advancement section, and added a one-line note clarifying it is not a PR-review commit.
4. **Deferred fork features need an explicit acceptance gate** — MEDIUM: Plan referenced "team acceptance" without defining the mechanism.
   → Opus: incorporated — added an explicit Deferral acceptance gate under Sync Marker Advancement: HIGH-priority `PATCH.md` features cannot be deferred, deferrals require Tim Macchi + the merge engineer's written acceptance, and the acceptance + follow-up link must be recorded in the `PATCH.md` sync entry.
5. **Conflict preview source is not reproducible** — LOW: Plan referenced a conflict preview without showing how to regenerate it.
   → Opus: incorporated — added Pre-Merge step 5 with concrete `git diff --name-status` and `git merge-tree`/probe commands to refresh the inventory, and noted that the cluster list must be updated if the refreshed inventory diverges.

### Plan corrections applied

- Merge Execution Plan step 2: rewrote cluster-commit semantics to align with how `git merge` actually behaves.
- Provider Runtime, Codex Schema, Auth Probes — Verification: swapped `CodexProvider.ts` for `CodexSessionRuntime.test.ts` and documented the indirect coverage.
- Commit Structure item 9: removed from commit sequence; preserved Sync Marker Advancement section as the operational source of truth.

### Open-question answers

None — Codex returned no answers to prior open questions (the plan did not carry forward an Open Questions section).

### New questions Codex raised

- If any PATCH.md-preserved feature is deferred, what exact acceptance mechanism lets the team approve advancing `origin/upstream-sync-base` despite the deferral?
  → Addressed in this revision via the Deferral acceptance gate under Sync Marker Advancement.

## Codex review pass 2 — answers (2026-05-22) [HISTORICAL]

### Verdict

REVISE

### Findings

1. **Merge target can drift beyond the stated upstream range** — HIGH: Pre-Merge step 3 and Merge Execution step 1 both used the moving `upstream/main` ref while the plan named `d1e85c4e8` as the authoritative tip, so a late fetch could silently extend the range.
   → Opus: incorporated — added a "pin the merge target" sub-step in Pre-Merge step 3 that resolves `d1e85c4e8`, verifies it is still an ancestor of fetched `upstream/main`, warns (does not auto-extend) if upstream has advanced, and instructs the operator to re-run the iterate-plan loop if the range needs to grow. Merge Execution step 1 now merges the explicit SHA, with a note that `upstream/main` must not be substituted.
2. **Deferral policy conflicts with assumptions for high-priority features** — MEDIUM: The final Assumptions and Defaults bullet read literally as a blanket deferral default, contradicting the Sync Marker Advancement gate that bans HIGH-priority deferrals.
   → Opus: incorporated — rewrote the bullet to defer to the Deferral acceptance gate and to repeat the HIGH-priority no-deferral rule explicitly.
3. **Verification omits final test command despite completion requirements** — MEDIUM: Plan listed many focused `bun run test` blocks but no final-suite gate, leaving ambiguity for a 57-commit sync.
   → Opus: incorporated — added `bun run test` to the Final required checks list as a mandatory completion gate, plus a Test-scope statement that frames focused tests as early signals and the full suite as the completion gate. Reinforced "use `bun run test`, never `bun test`."

### Plan corrections applied

- Pre-Merge Preparation step 3: added merge-target pinning + drift verification.
- Merge Execution Plan step 1: changed `git merge upstream/main` to merge the explicit SHA.
- Assumptions and Defaults final bullet: now references the Deferral acceptance gate and HIGH-priority exclusion.
- Verification Plan: added Test-scope intro and `bun run test` as a final gate.

### Open-question answers

None — Codex returned no answers to prior open questions.

### New questions Codex raised

- Should the execution plan merge the immutable commit `d1e85c4e8fdef82fbaded9539532b754080419e0` directly, or should it intentionally track the current fetched `upstream/main` and update the stated range if upstream has advanced?
  → Answered in plan: merge the immutable commit. Drift to `upstream/main` is reported but not auto-absorbed; extending the range requires re-planning.
- For this upstream sync, is a full `bun run test` expected before completion, or is the focused test matrix plus required fmt/lint/typecheck the accepted verification scope?
  → Answered in plan: full `bun run test` is required for this 57-commit sync. Focused tests run earlier as fail-fast signals.

## Codex review pass 3 — answers (2026-05-22) [HISTORICAL]

### Verdict

REVISE

### Findings

1. **Pre-merge inventory still uses moving `upstream/main`** — HIGH: Pass 2 pinned the merge itself, but the range/log/count commands in Pre-Merge step 3 and the file-touch / merge-tree commands in step 5 still bounded against `upstream/main`. If upstream advances past the pin, the inventory and conflict preview would describe out-of-scope commits and could mislead the operator.
   → Opus: incorporated — restructured Pre-Merge step 3 so `PINNED_UPSTREAM` is defined first; ancestry checks now verify both that `origin/upstream-sync-base` is an ancestor of the pin and that the pin is reachable from `upstream/main`. Authoritative log/count commands use `origin/upstream-sync-base..$PINNED_UPSTREAM`. Step 5's file-touch diff and `git merge-tree` conflict preview both use `$PINNED_UPSTREAM` (with a `: "${PINNED_UPSTREAM:=…}"` default for separate shells). Drift reporting stays as the only place `upstream/main` appears, with an explicit "describes commits NOT in this sync" comment. Added a closing sentence to step 5 stating the rule: ancestry/drift use `upstream/main`; everything describing this sync's scope uses `$PINNED_UPSTREAM`.

### Plan corrections applied

- Pre-Merge step 3: defined `PINNED_UPSTREAM` first; switched authoritative range commands to use it; expanded ancestry check to cover both directions.
- Pre-Merge step 5: bounded file-touch inventory and merge-tree preview by `$PINNED_UPSTREAM`; added shell-safe default for `PINNED_UPSTREAM`.

### Open-question answers

None — Codex returned no answers to prior open questions.

### New questions Codex raised

None.

## Codex review pass 4 — answers (2026-05-22) [HISTORICAL]

### Verdict

APPROVE

### Findings

1. **Fetch commands may leave remote-tracking refs stale** — LOW: `git fetch upstream main` and `git fetch origin upstream-sync-base` can update only `FETCH_HEAD` under some Git configs, while later commands read `upstream/main` and `origin/upstream-sync-base`. Operational reproducibility risk, not a structural flaw.
   → Opus: incorporated — changed Pre-Merge step 2 to use explicit refspecs (`main:refs/remotes/upstream/main` and `upstream-sync-base:refs/remotes/origin/upstream-sync-base`) so the remote-tracking refs are guaranteed to update, and added a `git rev-parse` sanity check.

### Plan corrections applied

- Pre-Merge step 3 comment: replaced "reachable from upstream/main" with "ancestor of upstream/main" so the comment matches the `git merge-base --is-ancestor` semantics of the command below it.

### Open-question answers

None — Codex returned no answers to prior open questions.

### New questions Codex raised

None.

### Convergence note

Codex returned APPROVE on pass 4 with only a LOW finding and a wording correction, both of which were folded. Opus reports no further changes pending. Per the iterate-plan skill rules, this is the recommended convergence point: one APPROVE plus no further Opus changes.
