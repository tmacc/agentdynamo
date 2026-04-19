# TODO

## Small things

- [ ] Submitting new messages should scroll to bottom
- [ ] Only show last 10 threads for a given project
- [ ] Thread archiving
- [ ] New projects should go on top
- [ ] Projects should be sorted by latest thread update

## Bigger things

- [ ] Queueing messages

## Agent And Composer Work

### 1. Task lists can stay stale after the agent finishes

- [ ] Investigate and fix cases where the plan/task sidebar still shows the first or an `inProgress` step after the agent has already completed.

Current code paths:
`apps/web/src/session-logic.ts` derives the sidebar plan state entirely from `turn.plan.updated` activities.
`apps/web/src/components/PlanSidebar.tsx` renders that derived state verbatim.
`apps/server/src/provider/Layers/CodexAdapter.ts` and `apps/server/src/provider/Layers/ClaudeAdapter.ts` emit plan updates, but there is no obvious fallback that finalizes the last seen plan when the turn settles.

Working hypothesis:
If the provider never emits one final "all steps completed" update, the UI keeps the last stale snapshot forever even though the turn is done.

Acceptance:
When a turn settles successfully, the sidebar should never remain stuck on stale `inProgress` steps.
Add regression coverage for "final turn completion without a final plan delta."

### 2. Team agent threads should not pollute the sidebar

- [ ] Revisit how team child threads surface in navigation and brainstorm a cleaner UX.

Current code paths:
The main sidebar already filters out `teamParentThreadId != null` threads in `apps/web/src/components/Sidebar.tsx`, so if child threads are still showing up the likely issue is metadata timing or another surface consuming unfiltered thread summaries.
Board projection already treats child threads as pills rather than top-level cards in `apps/web/src/boardProjection.ts`.

Ideas to evaluate:

1. Keep child threads fully out of the main sidebar and expose them only as inline task pills plus a parent-thread inspector.
2. Add a dedicated "Agents" drawer or panel scoped to the active parent thread.
3. Hide child threads by default but allow opening them from a debug toggle or search.
4. Represent child work as timeline events with drill-in links, not first-class peer threads.

Acceptance:
Normal sidebar/project navigation should only show user-facing top-level threads.
Agent work should remain inspectable without competing with primary thread navigation.

### 3. Decide whether child worktrees are ever merged back automatically

- [ ] Investigate current merge/handoff semantics for team agents and compare them with harness/native subagent best practices.

Current code paths:
`apps/server/src/team/Layers/TeamOrchestrationService.ts` explicitly tells child agents: "Deliver your changes in your own branch/worktree. Do not merge or apply changes back into the coordinator workspace."
There is no parent-side merge, cherry-pick, or patch-application flow today; the system tracks task status and summaries only.

Questions to answer:
Should the parent agent apply child diffs automatically, cherry-pick commits, or only summarize branch handoff details?
How do we avoid race conditions, merge conflicts, and partial application when multiple children finish near the same time?
What should happen in `shared` workspace mode vs `worktree` mode?

Working direction:
Favor explicit parent-side integration over blind auto-merge.
If we want first-class integration, model it as a deliberate handoff/apply step with conflict handling and auditability.

Acceptance:
Document the product decision clearly and either implement the integration path or mark "auto-merge child worktrees" as an explicit non-goal.

### 4. Anchor subagent status at the launch point in the timeline

- [ ] Stop pinning team task status to the bottom of the thread and instead attach it to the moment the task was launched.

Current code paths:
`apps/web/src/components/chat/MessagesTimeline.logic.ts` appends a synthetic `team-tasks` row after the rest of the timeline, which explains the current bottom-pinned behavior.
`apps/server/src/team/Layers/TeamTaskReactor.ts` already appends parent activities like `team.task.spawned`, `team.task.completed`, and `team.task.failed`.

Likely direction:
Create a durable timeline anchor from the spawn activity and update that row in place as task state changes.
Make team tasks behave more like tool use: launched in chronological context, updated over time, expandable for details.

Acceptance:
A spawned subagent appears where it was launched, not as a floating footer-like status block at the end of the thread.

### 5. Saved prompts should reuse provider-native workflow concepts where possible

- [ ] Design a saved-prompts feature for the composer, including a dropdown in the input and a "save prompt" affordance on prior user messages.

Requirements:
Saved prompts should appear in a dropdown in the composer.
Users should be able to save a prompt by hovering a previous user input and choosing save.
We should not reinvent provider-native reusable workflow systems when a skill/command model already exists.

Current state:
There is no saved prompt or prompt preset system in the app today.
The composer already supports built-in slash commands, provider slash commands, and Codex skills in discovery flows.

Design direction:
Keep lightweight saved prompts as local text snippets for simple reuse.
When a saved prompt grows into a reusable workflow with arguments, tools, sharing, or review requirements, promote it to a skill/command-backed capability instead of inventing a second workflow abstraction.

Acceptance:
Clear separation between "saved text snippet" and "reusable workflow capability."
The composer UX makes both easy to discover without duplicating the same concept in multiple menus.

### 6. Bring slash commands, skills, and custom agents into one capability model

- [ ] Research how to surface the full provider capability set inside T3 Code.

Current state:
Codex: `apps/server/src/provider/codexAppServer.ts` probes `skills/list`, and the web composer exposes those via `$` skill search.
Claude: the server probes slash commands during initialization, and the composer exposes them as `/` provider slash commands.
The server contract already has both `slashCommands` and `skills`, but the app does not normalize everything into one shared capability registry.

Research targets:
Codex repo/user/system skills and plugin-distributed skills.
Codex custom agents from `.codex/agents/` and `~/.codex/agents/`.
Codex app/CLI slash-command concepts and whether enabled skills should also surface in `/` menus.
Claude skills from `.claude/skills/`, legacy `.claude/commands/`, and MCP-exposed `/mcp__...` prompts.

Potential UX:
One capability registry with kinds such as `command`, `skill`, `agent`, and `resource`.
Composer autocomplete can then group results by Built-in, Provider, Skills, Agents, and MCP instead of hard-coding separate paths per provider.

Acceptance:
One source of truth for discoverable reusable capabilities across Codex and Claude.
Provider-specific adapters should feed that model without forcing the web app to understand every provider-specific storage convention directly.

## External Notes

These docs are worth keeping in mind while doing the work above:

- OpenAI Codex docs: subagents, skills, CLI slash commands, and app commands.
- Claude Code docs: skills/custom commands, invocation control, forked subagent execution, and MCP prompts as slash commands.
