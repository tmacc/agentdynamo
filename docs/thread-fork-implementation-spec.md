# Thread Fork Implementation Spec

## Summary

Add a first-class thread fork feature to T3 Code that creates a new thread from an existing thread's conversation state. The new thread must preserve enough history to behave as an independent continuation while retaining explicit ancestry metadata for UI and future tooling.

This should be implemented as an orchestration-level capability, not as a web-only shortcut.

## Context

T3 Code already models threads as event-sourced aggregates with projected:

- thread metadata
- messages
- activities
- checkpoints
- provider session state

Today, the app can:

- create a new empty thread
- create plan implementation threads
- revert a thread to a checkpoint
- spawn team child threads

But it cannot create a sibling thread that branches from an existing thread's conversation state.

Upstream Codex desktop/app-server implements fork as a first-class thread operation. The shared behavior is:

- create a new thread id
- copy stored history into the new thread
- preserve ancestry via `forkedFromId`
- avoid mutating the source thread
- support a future distinction between persistent and ephemeral forks

This spec proposes the T3-native version of that feature.

## Goals

- Add a reliable "fork thread" action for existing threads.
- Preserve source ancestry explicitly in the domain model.
- Materialize copied conversation history into the forked thread so provider/session behavior remains predictable.
- Keep source and fork independent after creation.
- Fit the feature into the existing orchestration/event/projection architecture.

## Non-Goals

- No ephemeral in-memory fork in v1.
- No arbitrary "fork from any historical message" in v1.
- No provider-native fork API integration in v1.
- No automatic worktree cloning in v1.
- No copying of provider session runtime state into the fork.

## User Experience

### Primary UX

Users can fork a non-running thread from:

- the chat header action menu
- the sidebar thread context menu

When a fork succeeds:

- a new thread is created in the same project
- the app navigates to the new thread
- the new thread shows a small ancestry banner such as `Forked from <thread title>`
- the source thread remains unchanged

### Behavior

- Fork is disabled while the source thread session is actively running.
- Fork creates a new idle thread with copied messages and thread metadata.
- The new thread does not inherit active session state.
- The new thread can immediately accept a new user turn.

## Product Semantics

### Fork Definition

A fork is a new thread that:

- has a new `threadId`
- references the source via `forkedFromThreadId`
- starts with copied conversation history from the source
- copies thread configuration defaults needed for future turns
- does not share future message history, checkpoints, or sessions with the source

### Initial Scope

V1 forks the full retained thread history as currently projected in the source thread.

This means:

- all existing persisted messages are copied
- title is derived for the new thread rather than reused verbatim
- branch and `worktreePath` are copied as metadata only
- latest turn summary is copied only insofar as it is implied by copied messages and turn projection rows

### Session Semantics

The fork starts with no active provider session.

Rationale:

- current provider command flow relies on projected thread messages, not shared provider state
- copying provider session runtime state would create correctness risks during reconnects and failures

## Architecture

## Overview

Implement fork as:

1. new orchestration command: `thread.fork`
2. new orchestration event: `thread.forked`
3. ancestry field added to thread contract and projection state
4. server-side fork materialization logic that copies source thread data into the new thread aggregate
5. web actions and UI affordances on top of the new command

This avoids overloading `thread.create` with fork-only semantics and keeps ancestry explicit.

## Domain Model Changes

### Contracts

Add `forkedFromThreadId` to:

- `OrchestrationThread`
- `OrchestrationThreadShell`
- thread create/fork event payloads as appropriate
- web thread types

### Commands

Add:

```ts
{
  type: "thread.fork";
  commandId: CommandId;
  sourceThreadId: ThreadId;
  threadId: ThreadId;
  title?: string;
  createdAt: IsoDateTime;
}
```

Recommended semantics:

- `sourceThreadId` identifies the source
- `threadId` is the new thread id
- optional `title` allows future caller override, but v1 callers can omit it

### Events

Add:

```ts
{
  type: "thread.forked";
  payload: {
    threadId: ThreadId;
    sourceThreadId: ThreadId;
    projectId: ProjectId;
    title: string;
    modelSelection: ModelSelection;
    runtimeMode: RuntimeMode;
    interactionMode: ProviderInteractionMode;
    branch: string | null;
    worktreePath: string | null;
    forkedFromThreadId: ThreadId;
    createdAt: IsoDateTime;
    updatedAt: IsoDateTime;
  }
}
```

This should be treated as the source of truth for new forked thread creation in projections.

## Decider Rules

`thread.fork` must:

- require source thread exists
- reject archived or deleted source threads only if that is already a project-wide invariant
- reject source threads with active running session state in v1
- generate one `thread.forked` event

The decider should not itself copy messages. Message and turn duplication should happen in a reactor/service layer that issues server-owned follow-up commands or writes derived events.

## Materialization Strategy

### Recommendation

Use a server-side fork service or reactor that, after `thread.forked`, copies source aggregate data into the new aggregate by issuing domain events for the new thread.

At minimum for v1:

- copy messages
- copy latest-turn/turn rows needed for consistent projection state

Defer copying these until phase 2 if needed:

- activities
- checkpoints
- proposed plans

### Why Materialize

Current provider turn startup logic resolves the user message from the target thread's projected messages. A lazy ancestry-only approach would require broad changes across:

- projection snapshot query
- provider turn dispatch
- diff/checkpoint lookup
- message rendering

Materializing copied history is lower risk and better aligned with current architecture.

### Suggested Internal Flow

1. User dispatches `thread.fork`.
2. Engine emits `thread.forked`.
3. Fork reactor reads source thread snapshot from projection query.
4. Reactor emits follow-up server-owned commands/events to copy source messages into the new thread.
5. Web receives the new thread and copied history through normal subscriptions.

## Data Copy Rules

### Copy In V1

- `projectId`
- `modelSelection`
- `runtimeMode`
- `interactionMode`
- `branch`
- `worktreePath`
- message history
- `forkedFromThreadId`

### Do Not Copy In V1

- active provider session
- pending approvals
- pending user input
- active turn in progress
- team task parent/child links
- team status

### Title Rules

Do not blindly reuse the source title.

Recommended title generation:

- `Fork of <source title>` if source title is user-authored and non-empty
- fallback to `New thread`

If title length needs truncation, reuse existing title truncation helpers.

## Persistence and Projection Changes

### Projection Threads Table

Add `forked_from_thread_id` column to projected thread storage.

Update:

- `ProjectionThread` schema
- migrations
- repository layer reads/writes
- snapshot query mapping

### Projection Pipeline

Add `thread.forked` handling that creates the target thread row with ancestry.

If message copy is event-driven, ensure thread row exists before copy events are projected.

### Snapshot Query

Expose `forkedFromThreadId` in:

- full thread snapshots
- shell snapshots

## Web App Changes

### Types and Store

Add `forkedFromThreadId?: ThreadId | null` to:

- `Thread`
- `ThreadShell`
- `SidebarThreadSummary`

Update store reducers for:

- `thread.forked`
- any follow-up copied-message events

### Actions

Add `forkThread(threadRef)` to `useThreadActions`.

Behavior:

- resolve source thread
- reject if source session is running
- dispatch `thread.fork`
- wait for created thread to appear
- navigate to the fork

### UI Entry Points

Add `Fork Thread` to:

- sidebar context menu
- chat header menu

Optional phase 2:

- command palette action

### Thread Banner

When `forkedFromThreadId` is present, render a lightweight banner near the top of the chat:

- `Forked from <title>`
- clickable navigation to the source thread when available locally

## Error Handling

The server should return clear failures for:

- source thread not found
- source thread currently running
- source thread deleted
- failure while reading source snapshot
- failure while copying source messages

The web app should surface a toast:

- title: `Failed to fork thread`
- description: server error message

If fork creation succeeds but message-copy materialization fails, the server should:

- leave the forked thread intact
- append a thread activity error to the new thread
- avoid deleting the fork automatically unless partial forks are deemed invalid

Recommendation for v1:

- treat fork creation plus message-copy as all-or-nothing at the orchestration level if practical
- otherwise, clearly mark partial failure in the new thread

## Concurrency and Reliability

### V1 Guardrails

- Only allow forking idle/non-running threads.
- Fork from the latest projected stable state.
- Do not attempt to mirror source thread writes after fork creation.

### Why

This repo prioritizes predictable behavior under reconnects and failures. Forking from a running thread introduces races around:

- active turn message streaming
- pending approvals
- checkpoint generation
- latest turn reconciliation

Rejecting running threads in v1 keeps semantics clean.

## Testing Plan

### Server

Add tests for:

- `thread.fork` decider emits `thread.forked`
- running source thread is rejected
- projection pipeline stores `forkedFromThreadId`
- snapshot query returns `forkedFromThreadId`
- source messages are copied to the new thread
- source thread remains unchanged after fork

### Web

Add tests for:

- store handles `thread.forked`
- fork action dispatches command and navigates to new thread
- fork banner renders for forked threads
- running-thread fork action surfaces error

### Manual Verification

1. Create a thread with several turns.
2. Fork it from the sidebar.
3. Confirm new thread contains copied history.
4. Send a new message in the fork.
5. Confirm source thread is unchanged.
6. Confirm fork is blocked while source is running.

## Rollout Plan

### Phase 1

- full-thread fork for idle threads
- ancestry metadata
- copied messages
- sidebar and header actions
- fork banner

### Phase 2

- copy checkpoints and selected activities
- better title generation
- command palette support

### Phase 3

- fork from checkpoint/turn
- optional new-worktree-on-fork mode

## Open Questions

- Should v1 copy proposed plans into the fork, or should those remain source-only?
- Should checkpoints be copied in v1 for diff continuity, or deferred?
- Should worktree metadata be copied if forking later gains a dedicated "new worktree" mode?
- Should archived threads be forkable?

## Recommendation

Implement v1 as a conservative, fully materialized fork of idle threads only.

That gives the product a useful and understandable fork feature quickly while preserving the repo's current performance and reliability priorities. It also sets up the right primitives for a later checkpoint-based branch/fork UX without forcing a rewrite of the existing thread runtime model.
