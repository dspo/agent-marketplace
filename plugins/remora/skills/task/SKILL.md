---
name: task
description: Delegate a stuck problem to remora — a self-contained, non-Claude task agent for cross-verification and second opinions. No third-party CLI to install; just configure one model endpoint.
user-invocable: false
---

# remora task runtime contract

Internal runtime contract for the `remora:remora-task` subagent. remora runs a non-Claude model (any OpenAI-compatible endpoint) via the pi agent harness embedded in `scripts/remora.mjs` — a single-file, short-lived CLI process.

Prerequisite: Node.js ≥ 22.19. Verify with `/remora:setup`.

## 1. Task JSON (stdin)

Package the request as JSON, pipe via stdin — never write to disk:

```jsonc
{
  "prompt": "(required) what remora should do, in one clear sentence",
  "problem": "(optional) concrete symptom / error",
  "files": ["(optional) relevant paths, relative to workspace root"],
  "attempted": "(optional) what you already tried and why it failed",
  "expected": "(optional) desired output shape"
}
```

Only `prompt` is required.

## 2. CLI invocation

Default to **background + poll** — a task drives many LLM turns and takes minutes:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/remora.mjs" task <<'EOF'
{ "prompt": "…", "files": ["…"] }
EOF
```

`run_in_background: true` → poll `BashOutput` until process exits. Don't give up early; 10+ minute runs are normal.

Foreground only for tasks you know finish in seconds.

### Flags

| Flag | Effect |
|------|--------|
| `--write` | Add `bash`/`edit`/`write` tools. Without it, read-only (`read`/`grep`/`find`/`ls`). Write mode has real disk side effects. |
| `--cwd <path>` | Override workspace root. Position free: before or after `task`. |
| `--worktree <branch>` | Resolved to worktree path via `git worktree list --porcelain`, then passed as `--cwd`. `--cwd` overrides `--worktree`. |
| `--continue` / `-c` | Continue most recent session in current cwd. |
| `--resume <id>` / `-r <id>` | Resume specific session by id. |
| `--model <name>` | Override model name (same provider). |

`--cwd`/`--worktree` are routing flags, not JSON fields. Each task opens a new session by default.

## 3. Result (stdout JSON)

```jsonc
{
  "status": 0,                    // 0 ok / non-zero fail
  "sessionId": "f49ff3e6-…",     // resume with --resume <sessionId>
  "sessionPath": "~/.pi/agent/sessions/…/<ts>_<id>.jsonl",
  "finalMessage": "…",           // core deliverable — return verbatim to user
  "errorMessage": null
}
```

Return `finalMessage` verbatim. stderr is NDJSON progress stream — use for `BashOutput`/`Monitor` progress only, not as result.

## 4. Error handling

Non-zero exit → stderr last line is `{"type":"error","message":"…"}`, stdout carries `errorMessage`. Pass through and suggest: `Run /remora:setup to check provider config.`
