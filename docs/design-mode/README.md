# T3 Code Design Mode — Handoff Documents

These five documents are designed to be handed to Claude Code (or any capable agent) to produce an atomized issue list with a dependency graph for implementation.

## Reading order

1. **`01-user-stories.md`** — who the user is, what they want, what they don't
2. **`02-prd.md`** — what we're building, success criteria, scope, phasing
3. **`03-architecture.md`** — system shape, components, data flow
4. **`04-tech-spec.md`** — interfaces, schemas, protocols (the contract layer)
5. **`05-task-breakdown-guide.md`** — instructions for the agent on atomizing work

## Suggested handoff prompt

```
Read all five documents in /docs/design-mode/ in order. Then:

1. Produce an atomized issue list following the template in 05-task-breakdown-guide.md
2. Build a dependency graph as a Mermaid diagram
3. Identify the critical path
4. Call out the first 10 issues that should be tackled to unblock the most work
5. List any open questions that surfaced during atomization

Do not invent requirements. If a doc is silent on something, surface it.
```

## What to expect from the agent

- ~80-120 issues
- Each formatted per the template
- A dependency graph showing parallelism opportunities
- An explicit "start here" set
- A list of unresolved questions

If the output deviates significantly (much smaller issue count, vague acceptance criteria, missing dependencies), reject and ask for revision. The signal of good atomization is that two engineers could pick up the issue list and divide work without coordination overhead.
