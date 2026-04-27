# Dynamo

Dynamo is a minimal desktop/web GUI for working with coding agents. It is currently focused on Codex and Claude, with support for running provider sessions, tracking conversation state, coordinating agent work, and managing project worktrees from one interface.

> [!WARNING]
> Dynamo is early alpha software. Expect bugs, rough edges, and occasional breaking changes.

## Install

### Desktop app

Install the latest desktop build from [GitHub Releases](https://github.com/tmacc/agentdynamo/releases).

Unsigned builds may require extra approval from your operating system. Code signing and notarization are still being finalized.

### Run with npx

```bash
npx t3
```

## Provider setup

Dynamo launches provider CLIs locally, so you need at least one supported provider installed and authenticated before starting:

- Codex: install [Codex CLI](https://github.com/openai/codex), then run `codex login`
- Claude: install Claude Code, then run `claude auth login`

## Local development

Prerequisites:

- Bun `1.3.11`
- Node.js `24.13.1` or newer in the Node 24 line

Install dependencies:

```bash
bun install
```

Run the web/server development stack:

```bash
bun dev
```

Run the desktop app in development:

```bash
bun dev:desktop
```

Before submitting changes, run:

```bash
bun fmt
bun lint
bun typecheck
```

Use `bun run test` for the Vitest suite.

## Project layout

- `apps/server`: Node.js WebSocket server and provider/session orchestration
- `apps/web`: React/Vite UI
- `apps/desktop`: Electron desktop shell
- `apps/marketing`: marketing/download site
- `packages/contracts`: shared schemas and TypeScript contracts
- `packages/shared`: shared runtime utilities

## Status

Dynamo is not accepting broad external contributions yet. Small bug reports and focused issues are welcome, but please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support or want to follow development? Join the [Discord](https://discord.gg/jn4EGJjrvv).

Observability guide: [docs/observability.md](./docs/observability.md)
