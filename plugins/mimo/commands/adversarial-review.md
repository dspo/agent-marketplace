---
description: Run a MiMo review that challenges the implementation approach and design choices
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [focus ...]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run an adversarial MiMo review — challenges implementation approach, design choices, tradeoffs, and assumptions.

Raw arguments: `$ARGUMENTS`

**Review-only**: don't fix issues or apply patches. Return MiMo's output verbatim.

## Execution mode

- `--wait` → foreground.
- `--background` → background.
- Neither → estimate scope via `git diff --shortstat`; use `AskUserQuestion` once (`Wait for results` / `Run in background`). Recommend background for anything beyond ~2 files.

## Run

Foreground:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mimo-companion.mjs" adversarial-review "$ARGUMENTS"
```

Background: `Bash` with `run_in_background: true`, same command. Tell user "MiMo adversarial review started. Check `/mimo:status`."

Preserve user arguments exactly. Supports `--base <ref>`, working-tree/branch review, and focus text. Does not support `--scope staged`/`--scope unstaged`.
