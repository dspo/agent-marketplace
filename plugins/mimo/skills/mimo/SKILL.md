---
name: mimo
description: MiMo Programming Assistant — code review, task delegation, and stop-gate review using MiMo
---

# MiMo Companion

Use MiMo (Xiaomi AI Programming Assistant) for code review or task delegation from Claude Code.

## Prerequisites

- Install MiMo CLI: `npm install -g @mimo-ai/cli`
- Run `/mimo:setup` to check environment readiness

## Commands

| Command | Description |
|---------|-------------|
| `/mimo:setup` | Check MiMo availability, optionally enable stop-time review gate |
| `/mimo:review` | Structured code review on working tree or branch diff |
| `/mimo:adversarial-review` | Adversarial review, questioning design choices and assumptions |
| `/mimo:rescue` | Delegate investigation or implementation to MiMo (via subagent) |
| `/mimo:status` | Show active and recent MiMo tasks |
| `/mimo:result` | Show stored output of completed tasks |
| `/mimo:cancel` | Cancel active background tasks |

## Architecture

- **Server Lifecycle**: The first command starts `mimo serve` HTTP server in background, parses the port and records it in workspace state directory's `server.json`. Subsequent commands reuse the same server (confirmed via health check). The SessionEnd hook closes the server when the last referencing session ends.
- **MiMo Client**: Communicates via REST API using `fetch`. Each request carries `x-mimocode-directory` header to bind the correct project. Structured review output uses `format: {type: "json_schema"}` and `info.structured` return.
- **Unattended Security**: Sessions created by the plugin always carry explicit permission rules (review is read-only, `--write` tasks are allow-all) and never fall back to "ask". The client also listens to `/event` stream and automatically rejects any `question.asked` / `permission.asked` that would suspend an unattended task.
- **Task Management**: `state.json` plus per-job JSON/log files. Background tasks run in detached `task-worker` processes. `--resume-last` reuses the persisted MiMo session ID.
- **Stop-gate Review**: Optional Stop-hook review. Any failure path in the gate itself (MiMo missing, server down, timeout, crash) fails-open, ensuring it never blocks the Claude session.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `MIMO_COMPANION_BIN` | Override `mimo` binary path |
| `MIMOCODE_SERVER_PASSWORD` | If set, client sends matching Basic Auth to started server |
| `MIMO_COMPANION_SESSION_ID` | Auto-set by SessionStart hook |

> ⚠️ Background tasks (`--background`) started in detached worker processes use environment variables from the parent process startup. If API keys or other env vars change mid-session, the worker won't perceive the changes — restart Claude Code session is needed.

## Build

The `_build/` directory contains TypeScript source code, build configuration, and test files. The underscore prefix indicates this is a developer tool area and does not belong to plugin runtime distribution — when users install the plugin, only `scripts/*.mjs`, `commands/`, `prompts/` etc. are needed. `_build/` is only used when modifying source code.

To modify plugin scripts:

```bash
cd plugins/mimo/_build
npm install
npm run build     # esbuild → ../scripts/*.mjs
npm test          # node --test against a fake in-process MiMo HTTP server
```

Compiled output `scripts/*.mjs` is already committed to the repository. The plugin distributes as-is from this repository.
