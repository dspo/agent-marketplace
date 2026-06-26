---
description: 把卡住的问题委托给 remora task agent（自包含、非 Claude 第二意见）
argument-hint: "[--background] [--continue | --resume <id>] [--model <name>] [--write] [要 remora 调查或解决的问题]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `remora:remora-task` subagent via the `Agent` tool (`subagent_type: "remora:remora-task"`), forwarding the raw user request as the prompt.
`remora:remora-task` is a subagent, not a skill — do not call `Skill(remora:remora-task)` (no such skill) or `Skill(remora:task)` (that re-enters this command and hangs the session). The command runs inline so the `Agent` tool stays in scope; forked general-purpose subagents do not expose it.
The final user-visible response must be remora's `finalMessage` verbatim.

Raw user request:

$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `remora:remora-task` subagent in the background.
- If the request includes `--wait`, run the `remora:remora-task` subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags for Claude Code. Do not forward them to the `task` CLI, and do not treat them as part of the natural-language task text.
- `--model` is a runtime-selection flag. Preserve it for the forwarded `task` call, but do not treat it as part of the natural-language task text.
- `--write` enables write mode in remora (registers `bash`/`edit`/`write` tools). Only forward it when the user explicitly asks remora to make changes. **In write mode `bash` is unrestricted — there is no command sandbox; forwarding `--write` is equivalent to handing remora a shell.**

Session routing:

- `--continue` / `-c` means continue the most recent session in the current cwd.
- `--resume <id>` / `-r <id>` means resume a specific session by id.
- If the request includes `--continue` or `--resume`, do not ask whether to continue. The user already chose.
- Otherwise, before starting remora, check for a resumable session in this repo by running:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/remora.mjs" sessions list
```

- If the output lists any session (i.e. it does not print `(no sessions in this cwd)`), use `AskUserQuestion` exactly once to ask whether to continue the current remora session or start a new one.
- The two choices must be:
  - `Continue current remora session`
  - `Start a new remora session`
- If the user is clearly giving a follow-up instruction such as "continue", "keep going", "resume", "apply the top fix", or "dig deeper", put `Continue current remora session (Recommended)` first.
- Otherwise put `Start a new remora session (Recommended)` first.
- If the user chooses continue, add `--continue` before routing to the subagent.
- If the user chooses a new session, do not add `--continue` or `--resume`.
- If the helper reports no sessions available (prints `(no sessions in this cwd)`), do not ask. Route normally.

Operating rules:

- The subagent is a thin forwarder only. It should use one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/remora.mjs" task` with the task JSON fed via stdin (heredoc), and return the `finalMessage` field from the stdout JSON as-is.
- Return remora's `finalMessage` verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- Do not ask the subagent to inspect files, monitor progress, poll output, fetch results, cancel jobs, summarize output, or do follow-up work of its own.
- Leave `--model` unset unless the user explicitly asks for one.
- Treat `--continue`, `--resume <id>`, and `--model <value>` as routing controls and do not include them in the task text you pass through.
- If remora fails (non-zero exit), tell the user to run `/remora:setup` to check provider configuration.
- If the user did not supply a request, ask what remora should investigate or solve.
