---
description: Check the remora runtime (Node version) and verify provider config connectivity and auth
argument-hint: ""
allowed-tools: Bash(node:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/remora.mjs" setup
```

JSON report fields:

- `nodeOk` — Node ≥ 22.19. If false, tell user to upgrade.
- `baseUrl` / `model` / `provider` — resolved provider config.
- `ready` + `message` — endpoint reachable and auth passed.
- `build` — `{ rev, date, version }`. If `config error` and `rev` is stale, suspect cached bundle → tell user to reinstall/update remora.

Report:

- `ready: true` → remora ready.
- `config error` → set `REMORA_BASE_URL` / `REMORA_MODEL` and API key (via `keychain:SERVICE` / `env:VAR` / bare `VAR`), or create `~/.pi/remora.config.yaml`.
- auth/connectivity failure → pass through HTTP status/error; check baseUrl, model, API key.

NEVER echo the API key.
