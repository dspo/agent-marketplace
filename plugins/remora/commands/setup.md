---
description: Check the remora runtime (Node version) and verify provider config connectivity and auth
argument-hint: ""
allowed-tools: Bash(node:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/remora.mjs" setup
```

It prints a JSON report:

- `nodeOk` — Node ≥ 22.19 (required by the pi runtime). If false, tell the user to upgrade Node.
- `baseUrl` / `model` / `provider` — the resolved provider config.
- `ready` + `message` — whether the endpoint is reachable and auth passed.

Report back based on the JSON:

- `ready: true` — tell the user remora is ready; they can run `/remora:task`.
- `config error` — tell the user to set `REMORA_BASE_URL` / `REMORA_MODEL` and an API key, or create `~/.pi/remora.config.yaml`. The API key comes from an `apiKey` spec (`keychain:SERVICE` / `env:VAR` / bare `VAR`; legacy `apiKeyEnv` still works) or the `REMORA_API_KEY` env var.
- auth/connectivity failure — pass through the HTTP status or error in `message`; tell the user to check baseUrl, model name, and API key.

NEVER echo the API key value back to the user.
