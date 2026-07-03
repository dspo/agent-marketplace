---
name: task
description: Delegate a stuck problem to remora — a self-contained, non-Claude task agent for cross-verification and second opinions. No third-party CLI to install; just configure one model endpoint.
user-invocable: false
---

# remora task runtime contract

> Internal runtime contract for the `remora:remora-task` subagent. Not user-invocable — the
> subagent reads this to build the task JSON and drive the remora CLI.

When `remora:remora-task` receives a task, package the request into task JSON, run the CLI, and
return the result. remora embeds the pi agent harness and runs a **non-Claude model** (any
OpenAI-compatible endpoint, e.g. DeepSeek/Qwen) to investigate independently and cross-check.

remora is a **self-contained single-file CLI** (`scripts/remora.mjs`, pi bundled in). Not a
daemon — each task is one short-lived process. Async tracking, cancel, and progress reuse Claude
Code's own background-shell tools.

## Prerequisites

- Node.js ≥ 22.19 (pi requirement).
- An OpenAI-compatible model endpoint configured; run `/remora:setup` to verify.

## Steps

### 1. Build the task JSON

Represent the stuck problem as one JSON object (**never write it to disk** — pipe it via stdin in
the next step). Fields:

```jsonc
{
  "prompt": "(required) what remora should do, in one clear sentence",
  "problem": "(optional) concrete symptom / error",
  "files": ["(optional) relevant paths, relative to workspace root"],
  "attempted": "(optional) what you already tried and why it failed",
  "expected": "(optional) desired output shape"
}
```

Only `prompt` is required; the rest are folded into remora's system prompt — the more specific,
the better the diagnosis. Do NOT `Write` a task file — remora persists the session itself (see
Session persistence).

### 2. Run the CLI (task JSON via stdin)

Pass the task JSON via **stdin** (heredoc) — no shell argv, no escaping, no disk write.

A task drives a full non-Claude agent through many LLM turns; it **usually takes minutes**, often
past the single-call `Bash` timeout ceiling. A foreground call would time out before remora
finishes. So **default to background + poll**:

**Background + poll (default)** — start with `run_in_background: true`, then `BashOutput` the same
shell repeatedly until the process exits, then read the final stdout:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/remora.mjs" task <<'EOF'
{ "prompt": "…", "files": ["…"], "expected": "…" }
EOF
```

Poll until it exits — a 10+ minute run is normal. Do NOT give up early, and NEVER return a
progress line ("still running") as the result. Use `KillShell` to cancel.

**Foreground** — only for tasks you know finish in seconds; otherwise always background + poll.

Optional flags (Claude Code-style resume):

- `--continue` / `-c` — continue the **most recent session in the current cwd** (follow-up, deeper
  dig). Equivalent to a new session when there's no history.
- `--resume <id>` / `-r <id>` — resume a specific session id (the `sessionId` from the last result,
  or the `session` event's `id` in the stderr stream).
- `--model <name>` — temporarily override the model name (same provider).
- `--write` — let remora write: adds `bash` / `edit` / `write` tools so it can land fixes directly.
  Without it, read-only mode (`read` / `grep` / `find` / `ls`, no `bash`). **Write mode has real
  disk side effects — use only when you actually want remora to make changes.**

> Each task opens a **new session** (new UUID) by default. To continue the last one, use
> `--continue` (easy) or `--resume <sessionId>` (precise) — same as `claude -c` / `claude -r <id>`.

### 3. Read the result

- **stdout** is the only structured result (JSON):

  ```jsonc
  {
    "status": 0,                  // 0 ok / non-zero fail
    "sessionId": "f49ff3e6-…",    // this session's UUID; resume with --resume <sessionId>
    "sessionPath": "~/.pi/agent/sessions/…/<ts>_<id>.jsonl",
    "finalMessage": "...",        // remora's final answer (Markdown) — the core deliverable
    "errorMessage": null
  }
  ```

  Return `finalMessage` to the user verbatim (it's a complete, self-contained diagnosis). Do not
  rewrite or embellish. To continue later, keep the `sessionId` and pass `--resume <sessionId>`.

- **stderr** is an NDJSON progress stream, one event per line. The **first line is always**
  `{"type":"session","id":"…","path":"…"}` (grab the sessionId early when running in background, for
  later `--resume`); then `agent_start` / `turn_start` / `tool_start` / `tool_end` / `turn_end` /
  `agent_end`. For `BashOutput`/`Monitor` progress only — do not parse as the result.

### 4. Error handling

On non-zero exit, the stderr last line is `{"type":"error","message":"..."}` and stdout carries
`errorMessage`. Pass the raw error through, plus an actionable next step:

> remora error: `<message>`. Run `/remora:setup` to check provider config (baseUrl / model / API key).

## Config sources (high → low precedence)

1. Env vars: `REMORA_BASE_URL` / `REMORA_MODEL` / `REMORA_API_KEY`
2. Workspace: `.remora/config.json` (legacy, still supported)
3. Global: `~/.pi/remora.config.yaml` (unified location, YAML)
4. Global legacy: `~/.remora/config.json` (back-compat)

`~/.pi/remora.config.yaml` example:

```yaml
baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"
model: "deepseek-v4-pro"
provider: "dashscope"
apiKey: "keychain:DASHSCOPE_API_KEY"
```

`apiKey` is a **source spec string** declaring where the key comes from:

- `keychain:SERVICE` — read from macOS keychain (`security find-generic-password -s SERVICE -a
  <current user> -w`). Account defaults to the login user; use `keychain:SERVICE:ACCOUNT` to override.
- `env:VAR` — read from env var `VAR`.
- bare `VAR` (no prefix) — defaults to env.

The API key is **never persisted in plaintext**: precedence `REMORA_API_KEY` env > config `apiKey`
spec > legacy `apiKeyEnv` (env-only, back-compat) > `DASHSCOPE_API_KEY` env fallback. keychain is
macOS-only.

## Security model

- **Read-only by default**: without `--write`, only pi's read-only tools `read` / `grep` / `find` /
  `ls` — no `bash` (matches pi's `createReadOnlyTools`).
- With `--write`, adds `bash` / `edit` / `write` (can modify disk). Tool impls come straight from
  `@earendil-works/pi-coding-agent` (a proper dependency, not hand-rolled).
- All file ops are confined to the workspace root; path escape is hard-blocked in `beforeToolCall`:
  the guard expands `~/` to homedir the pi way, resolves, and `realpath`s existing paths (defeats
  in-root symlinks pointing outside). pi's `resolveToCwd` only resolves; remora injects the sandbox.
- pi has no built-in permission sandbox — remora's `beforeToolCall` is a soft gate. In write mode
  `bash` allows arbitrary commands; run in a container if you need hard isolation.

## Session persistence

remora records each session as a **replayable JSONL** (via pi's own `JsonlSessionRepo`, same as
oh-my-pi), not a flat JSON blob.

- **Location**: `~/.pi/agent/sessions/<encoded-cwd>/` (shared layout with Pi — `pi --session` can
  restore a remora session), one `{ISO-ts}_{sessionId}.jsonl` per session; root overridable via
  `REMORA_SESSIONS_DIR`. No longer written to the in-project `.remora/sessions/`. Old sessions under
  `~/.remora/projects/` must be moved manually (same layout, just `mv`).
- **Format**: first line is the session header `{type:"session", version:3, id, timestamp, cwd}`;
  then one typed entry per line:
  - `message` — each user/assistant/tool message, **appended incrementally** (atomic per-line write,
    so a crash keeps what's already flushed).
  - `model_change` — provider/model recorded once at start.
  - `session_info` — auto title derived from the first prompt.
  - `compaction` — recorded when context is actually compacted (with summary / tokensBefore); pi
    rebuilds it as a summary on resume.
  - `custom`(`remora:agent`) — marks the session as **remora-created** (value `"remora"`), to tell
    remora vs pi sessions apart in Pi's resume UI.
  - `custom`(`remora:lineage`) — records the **host Claude Code session id** that spawned this task
    (from `CLAUDE_CODE_SESSION_ID`) for a traceable chain; not written when remora runs outside CC.
- **Resume**: `--continue` takes the most recent in the cwd; `--resume <id>` takes a specific id;
  resuming replays history entries into `AgentMessage[]`, then new turns keep appending (no full
  rewrite).
- **Large-image externalization**: image-block base64 (≥ 1 KiB) is not inlined into JSONL — it lands
  in a content-addressed blob store (`~/.pi/remora/blobs/<sha256>`, auto-deduped); JSONL stores only
  a `blob:sha256:<hash>` reference, restored to base64 on resume (matches oh-my-pi).
