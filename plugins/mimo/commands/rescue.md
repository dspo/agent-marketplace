---
description: Delegate investigation, an explicit fix request, or follow-up rescue work to the MiMo rescue subagent
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <ref>] [what MiMo should investigate, solve, or continue]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke `mimo:mimo-rescue` via `Agent` (`subagent_type: "mimo:mimo-rescue"`). Do not call `Skill(mimo:rescue)`. Return MiMo's output verbatim.

Raw request: `$ARGUMENTS`

## Execution mode

- `--background` → background.
- `--wait` → foreground.
- Neither → default foreground.
- `--background`/`--wait` are Claude Code flags — don't forward to task CLI.

## Session routing

- `--resume` or `--fresh` given → skip check.
- Otherwise, check for resumable session:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mimo-companion.mjs" task-resume-candidate --json
```

If `available: true`, use `AskUserQuestion` once: `Continue current MiMo session` / `Start a new MiMo session`. Follow-up cue → Continue first. Continue → add `--resume`. New → add `--fresh`. If `available: false`, don't ask.

Leave `--model` unset unless user asks. Treat `--resume`/`--fresh`/`--model` as routing controls — don't include in task text.
