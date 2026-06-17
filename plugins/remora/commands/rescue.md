---
description: 把卡住的问题委托给 remora rescue agent（自包含、非 Claude 第二意见）
argument-hint: "[--background] [--continue | --resume <id>] [--model <name>] [要 remora 调查或解决的问题]"
allowed-tools: Bash(node:*), BashOutput, KillShell
---

调用 `remora:rescue` skill 处理用户的请求。按 skill 的流程：把上下文组织成 task JSON → 用 heredoc 经 stdin 喂给 `scripts/remora.mjs` → 读 stdout 结果 → 把 `finalMessage` 原样转达给用户。

用户请求：

$ARGUMENTS

执行约定：

- 把用户的自然语言请求提炼成 task JSON 的 `prompt`，连同已知的 `problem`/`files`/`attempted`/`expected` 字段，用 heredoc 经 **stdin** 传给 CLI。**不要 `Write` 任何 task 文件** —— task 不落盘，留痕由 remora 自己的 session（`~/.remora/projects/…/<id>.jsonl`）负责。
- 默认前台运行。请求里出现 `--background` 时用 `run_in_background` 跑，再用 `BashOutput` 轮询 stderr 进度、`KillShell` 取消。
- `--continue`（续当前 cwd 最近 session）/ `--resume <id>`（续指定 session，id 取上次结果里的 `sessionId`）/ `--model` 原样转发给 `remora.mjs`。它们是 Claude Code 风格的 resume flag，不要当作自然语言任务文本。
- `--background` 是 Claude Code 的执行标志，不要转发给 `remora.mjs`。
- 最终给用户的回复 = remora stdout 里的 `finalMessage`，原样转达，不改写、不加评论。若想接着上次继续，记下结果里的 `sessionId`，下次带 `--resume <sessionId>`。
- 若 CLI 非零退出：透传 stderr 末行的 error message，并提示用户运行 `/remora:setup` 检查 provider 配置。
- 若用户没给请求内容，先问清楚要 remora 调查或解决什么。
