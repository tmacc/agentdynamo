---
name: upstream-merge-playbook
description: Use only when explicitly syncing, merging, or rebasing from the `upstream` remote, such as `upstream/main` or another `upstream/*` ref, into this fork while preserving fork-only behavior documented in PATCH.md. Do not use for updating a branch from `origin/main`, merging fork PR branches, or other fork-internal branch maintenance.
---

# Upstream Merge Playbook

Use this skill only for syncs from the `upstream` remote. Branch updates from `origin/main` are fork-internal maintenance and should not run this playbook, update `PATCH.md`, or move `upstream-sync-base` unless they also include an explicit upstream sync.

## Read First

- Read `PATCH.md` before touching the merge.
- Treat every feature or patch entry in `PATCH.md` as a required preservation checklist.
- Fetch `upstream/main` and `origin/upstream-sync-base` before calculating the upstream range.
- Treat `origin/upstream-sync-base..upstream/main` as the authoritative upstream delta. Do not rely on `HEAD..upstream/main` in this fork because upstream history may be replayed under different commit hashes.
- If the requested operation is only "update from origin/main", "merge origin/main", "catch this branch up with origin", or a PR-branch merge inside the fork, stop using this skill and do the normal fork branch update instead.
- Do not assume a green build means feature parity.

## Workflow

1. Create an integration branch from the current target branch unless the user explicitly wants the merge on a specific branch.
2. Fetch `upstream/main` and `origin/upstream-sync-base`.
3. Inspect `origin/upstream-sync-base..upstream/main` and record the range that will be integrated. If `origin/upstream-sync-base` is missing, initialize it only after identifying the last upstream commit already integrated in the fork.
4. Confirm `origin/upstream-sync-base` is an ancestor of `upstream/main`. If it is not, upstream likely rewrote or replayed history; find the equivalent upstream commit by PR number, subject, or `git patch-id`, then use that equivalent commit as the range start and record the mismatch in `PATCH.md`.
5. Merge `upstream/main` into the integration branch. The expected upstream delta is the commits after the sync marker, not every commit Git reports as ahead of the fork branch.
6. During conflicts, favor upstream for shared architecture layers when the fork change is broad or tightly coupled across `packages/contracts`, `apps/server`, and `apps/web`.
7. Keep fork code directly in conflict resolution only when it is isolated and obviously compatible with the new upstream shape.
8. If a fork feature cannot be preserved cleanly in the merge itself, accept the upstream shape, keep the branch buildable, and mark that feature for explicit restoration work right after the merge.
9. Get the merged branch green with `bun fmt`, `bun lint`, and `bun typecheck`.
10. Compare the merged tree against `PATCH.md` and the pre-merge parent. Check each documented feature for actual survival in contracts, server, web, and persistence layers.
11. Reapply missing fork features as explicit follow-up commits on top of the merged baseline.
12. Update `PATCH.md` for every restored feature, deferred feature, and upstream-touching local bugfix. Include the upstream range merged and the new sync marker.
13. After the merge, restoration work, and verification are complete, advance the local `upstream-sync-base` branch to the integrated upstream tip and push it to `origin`.

## Conflict Strategy

- Prefer coherent upstream architecture over half-preserved fork behavior.
- Do not leave mixed contract/server/web shapes in place just because they compile.
- Never delete a `PATCH.md` entry because the code disappeared in a merge. Mark the feature or patch as missing, changed, or needing restoration.
- When a feature spans contracts, persistence, server, and UI, assume "surgical" conflict resolution is risky unless the upstream delta is very small.

## What To Record In PATCH.md

- Upstream range merged, in the form `<previous-sync-marker>..upstream/main@<integrated-tip>`
- Whether the sync marker was a direct ancestor or was matched by equivalent commit because upstream history changed
- New `upstream-sync-base` value after successful verification
- User-visible behavior
- Why it exists
- Key files and modules
- Merge hotspots
- Tests and manual smoke checks
- Current status after the merge

## Done Criteria

- Merge commit is build-clean.
- `PATCH.md` reflects the post-merge reality.
- `upstream-sync-base` points at the verified upstream tip and has been pushed to `origin`.
- Every fork feature is either preserved and verified, or explicitly marked as missing and queued for restoration.
