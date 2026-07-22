---
description: Check whether the local MiMo CLI is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), Bash(npm:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mimo-companion.mjs" setup --json $ARGUMENTS
```

If MiMo is unavailable and npm is available, use `AskUserQuestion` once: `Install MiMo (Recommended)` / `Skip for now`. If install chosen: `npm install -g @mimo-ai/cli`, then rerun setup.

Present the final setup output. If server check failed, preserve guidance about checking server logs.
