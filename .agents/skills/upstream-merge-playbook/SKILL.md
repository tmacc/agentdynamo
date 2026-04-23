---
name: upstream-merge-playbook
description: Use when merging or rebasing upstream changes into this fork while preserving fork-only behavior documented in PATCH.md. Covers pre-merge inventory review, conflict strategy, post-merge restoration, and PATCH.md maintenance.
---

# Upstream Merge Playbook

Use this skill for any upstream sync, merge, or rebase where fork-only behavior must survive.

## Read First

- Read `PATCH.md` before touching the merge.
- Treat every feature or patch entry in `PATCH.md` as a required preservation checklist.
- Do not assume a green build means feature parity.

## Workflow

1. Create an integration branch from the current target branch unless the user explicitly wants the merge on a specific branch.
2. Fetch `upstream/main` and merge it.
3. During conflicts, favor upstream for shared architecture layers when the fork change is broad or tightly coupled across `packages/contracts`, `apps/server`, and `apps/web`.
4. Keep fork code directly in conflict resolution only when it is isolated and obviously compatible with the new upstream shape.
5. If a fork feature cannot be preserved cleanly in the merge itself, accept the upstream shape, keep the branch buildable, and mark that feature for explicit restoration work right after the merge.
6. Get the merged branch green with `bun fmt`, `bun lint`, and `bun typecheck`.
7. Compare the merged tree against `PATCH.md` and the pre-merge parent. Check each documented feature for actual survival in contracts, server, web, and persistence layers.
8. Reapply missing fork features as explicit follow-up commits on top of the merged baseline.
9. Update `PATCH.md` for every restored feature, deferred feature, and upstream-touching local bugfix.

## Conflict Strategy

- Prefer coherent upstream architecture over half-preserved fork behavior.
- Do not leave mixed contract/server/web shapes in place just because they compile.
- Never delete a `PATCH.md` entry because the code disappeared in a merge. Mark the feature or patch as missing, changed, or needing restoration.
- When a feature spans contracts, persistence, server, and UI, assume "surgical" conflict resolution is risky unless the upstream delta is very small.

## What To Record In PATCH.md

- User-visible behavior
- Why it exists
- Key files and modules
- Merge hotspots
- Tests and manual smoke checks
- Current status after the merge

## Done Criteria

- Merge commit is build-clean.
- `PATCH.md` reflects the post-merge reality.
- Every fork feature is either preserved and verified, or explicitly marked as missing and queued for restoration.
