---
description: Show active and recent MiMo jobs for this repository, including review-gate status
argument-hint: '[job-id] [--wait] [--timeout-ms <ms>] [--all]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/mimo-companion.mjs" status "$ARGUMENTS"`

If no job ID: render as a compact Markdown table (job ID, kind, status, phase, duration, summary, follow-up commands).

If job ID given: present full output without summarizing.
