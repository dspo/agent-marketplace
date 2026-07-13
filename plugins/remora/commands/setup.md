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
- `build` — the running bundle's identity: `{ rev, date, version }`. `rev` is the git short SHA the bundle was built from. If `setup` reports `config error` or an error that points at a stale config path, compare `build.rev` against the marketplace repo's latest commit — a stale cached bundle (Claude Code loaded an old SHA) is the likely cause; tell the user to reinstall/update the remora plugin and re-run `setup`.

Report back based on the JSON:

- `ready: true` — tell the user remora is ready; they can run `/remora:task`.
- `config error` — tell the user to set `REMORA_BASE_URL` / `REMORA_MODEL` and an API key, or create `~/.pi/remora.config.yaml`. The API key comes from an `apiKey` spec (`keychain:SERVICE` / `env:VAR` / bare `VAR`; legacy `apiKeyEnv` still works) or the `REMORA_API_KEY` env var. If `build.rev` is behind the marketplace's latest commit, suspect a stale cached bundle first.
- auth/connectivity failure — pass through the HTTP status or error in `message`; tell the user to check baseUrl, model name, and API key.

NEVER echo the API key value back to the user.
