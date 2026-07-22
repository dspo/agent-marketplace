---
description: Delegate a stuck problem to the remora task agent (self-contained, non-Claude second opinion)
argument-hint: "[--background] [--continue | --resume <id>] [--model <name>] [--write] [problem for remora to investigate or solve]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke `remora:remora-task` via `Agent` (`subagent_type: "remora:remora-task"`). Do not call `Skill(remora:task)` or `Skill(remora:remora-task)`. Return `finalMessage` verbatim.

Raw request: `$ARGUMENTS`

## Execution mode

- `--background` → run subagent in background.
- `--wait` → run in foreground.
- Neither → default foreground.
- `--background` and `--wait` are Claude Code flags — do not forward to remora CLI.
- `--model` preserve for forwarded call; `--write` only when user explicitly wants code changes. **In write mode `bash` is unrestricted.**

## Session routing

- `--continue` / `--resume <id>` given → skip check, route directly.
- Otherwise, check for resumable sessions:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/remora.mjs" sessions list
```

If output lists a session, use `AskUserQuestion` once:
- `Continue current remora session` / `Start a new remora session`.
- Follow-up cue ("continue", "dig deeper", …) → put Continue first. Otherwise Start new first.
- Continue → add `--continue`. New → no flag.
- No sessions (`(no sessions in this cwd)`) → don't ask.

Skip pre-check entirely when routing to non-current workspace (`--worktree`/`--cwd`).

## Workspace routing

When target is not current cwd, pass `--worktree <branch>` or `--cwd <path>` in the subagent prompt (not in task text). These are routing controls.
