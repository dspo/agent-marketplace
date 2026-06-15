---
description: Check whether the local MiMo CLI is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), Bash(npm:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mimo-companion.mjs" setup --json $ARGUMENTS
```

If the result says MiMo is unavailable and npm is available:
- Use `AskUserQuestion` exactly once to ask whether Claude should install MiMo now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install MiMo (Recommended)`
  - `Skip for now`
- If the user chooses install, run:

```bash
npm install -g @mimo-ai/cli
```

- Then rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mimo-companion.mjs" setup --json $ARGUMENTS
```

If MiMo is already installed or npm is unavailable:
- Do not ask about installation.

Output rules:
- Present the final setup output to the user.
- If installation was skipped, present the original setup output.
- If MiMo is installed but the server check failed, preserve the guidance about checking the server log.
