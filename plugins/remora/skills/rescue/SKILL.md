---
name: rescue
description: 把卡住的问题委托给 remora —— 一个自包含的非 Claude rescue agent，做交叉验证与第二意见。无须安装第三方 CLI，只需配置一个 model endpoint。
---

# remora rescue

当主 agent（Claude Code）在某个问题上卡住、需要一个**真正不同的第二意见**时，把问题打包交给 remora。remora 内嵌 pi agent harness，用一个**非 Claude 模型**（如 DeepSeek/Qwen 等任意 OpenAI 兼容端点）独立调查、交叉验证、跳出思维定势。

remora 是一个**自包含单文件 CLI**（`scripts/remora.mjs`，pi 库已打包进去）。它不是常驻服务，每次 rescue 就是一次短命进程：跑完即退。异步追踪、取消、进度全部复用 Claude Code 既有的 background-shell 能力。

## 前置条件

- Node.js ≥ 22.19（pi 底座要求）。
- 配置一个 OpenAI 兼容的 model endpoint，运行 `/remora:setup` 校验连通性。

## 何时用 remora

- 一个 bug 反复修不好，想要一个独立视角重新诊断根因。
- 怀疑自己陷入思维定势，需要非 Claude 模型交叉验证某个设计或结论。
- 一段不熟悉的代码，想让另一个 agent 并行调查、给出摘要。

## 使用流程

### 1. 把上下文组织成 task JSON

把卡住的问题表示成一个 JSON 对象（**不落盘**，下一步直接从 stdin 喂给 CLI）。字段：

```jsonc
{
  "prompt": "（必填）你要 remora 做什么，一句话说清楚",
  "problem": "（可选）现象/报错的具体描述",
  "files": ["（可选）相关文件路径，相对工作区根"],
  "attempted": "（可选）你已经试过哪些方案、为什么没成",
  "expected": "（可选）期望的产出形态"
}
```

只有 `prompt` 是必填的；其余字段会被拼进 remora 的 system prompt，给得越具体，诊断越准。**不要用 `Write` 落一个 task 文件** —— remora 自己会把这次任务持久化成 JSONL session（见下「session 留痕」），编排层无须代劳。

### 2. 调起 CLI（task JSON 走 stdin）

task JSON 通过 **stdin** 传入（用 heredoc），不经过 shell argv，天然免转义、不落盘：

**前台（短任务，推荐默认）** —— 直接读结果：

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/remora.mjs" rescue <<'EOF'
{ "prompt": "……", "files": ["……"], "expected": "……" }
EOF
```

**后台（长任务）** —— 用 `run_in_background` 跑同一命令，再用 `BashOutput` 轮询进度、`KillShell` 取消。

可选 flag（resume 采用 Claude Code 风格）：

- `--continue` / `-c` —— 在**当前 cwd 的最近一个 session** 上继续（追问、深入）。没有历史时等价于新建。
- `--resume <id>` / `-r <id>` —— 续接指定的 session id（id 就是上一次结果里的 `sessionId`，或 stderr 进度流里 `session` 事件的 `id`）。
- `--model <name>` —— 临时覆盖模型名（同一 provider 下切换）。
- `--write` —— 允许 remora 写盘：开启 `write_file` / `edit_file` 工具，让它直接落地修复。不带此 flag 时为只读调查模式。**写模式有实际改盘副作用,仅在你确实想让 remora 动手修改时使用**；改动会以 unified diff 形式记在结果的 `edits` 字段里。

> 默认每次 rescue 都开一个**新 session**（新 UUID）。要"接着上一次聊"就用 `--continue`（省事）或 `--resume <上次的 sessionId>`（精确）——和 `claude -c` / `claude -r <id>` 一致。

### 3. 读取结果

- **stdout** 是唯一的结构化结果（JSON）：

  ```jsonc
  {
    "status": 0,                  // 0 成功 / 非 0 失败
    "sessionId": "f49ff3e6-…",    // 本次 session 的 UUID；下次 --resume <sessionId> 续接
    "sessionPath": "~/.remora/projects/…/<ts>_<id>.jsonl",
    "finalMessage": "...",        // remora 的最终回答（Markdown），这是给用户的核心交付
    "touchedFiles": [],           // 写模式下触达的文件
    "edits": [                    // 写模式下每次改动的 unified diff
      { "path": "sum.js", "added": 1, "removed": 1, "diff": "--- sum.js\n+++ sum.js\n..." }
    ],
    "errorMessage": null
  }
  ```

  把 `finalMessage` 原样转达给用户（它是完整自包含的诊断/建议）。不要改写或加戏。写模式下还应把 `edits` 里的改动摘要呈现给用户(改了哪些文件、增删行数),让用户能 review remora 动了什么。若想接着上次继续，记下 `sessionId`，下次带 `--resume <sessionId>`。

- **stderr** 是 NDJSON 进度流，每行一个事件。**第一行总是** `{"type":"session","id":"…","path":"…"}`（后台跑时据此尽早拿到 sessionId，供后续 `--resume`）；其后是 `agent_start` / `turn_start` / `tool_start` / `tool_end` / `turn_end` / `agent_end`。用于 `BashOutput`/`Monitor` 观察进度，不要当结果解析。

### 4. 错误处理

CLI 非零退出时，stderr 末行是一个 `{"type":"error","message":"..."}` 对象，stdout 也会带 `errorMessage`。把原始错误透传给用户，并补一句 actionable next step：

> remora 报错：`<message>`。请运行 `/remora:setup` 检查 provider 配置（baseUrl / model / API key）。

## 配置来源（优先级高 → 低）

1. 环境变量：`REMORA_BASE_URL` / `REMORA_MODEL` / `REMORA_API_KEY`
2. 工作区：`.remora/config.json`
3. 全局：`~/.remora/config.json`

`.remora/config.json` 示例：

```jsonc
{
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "model": "deepseek-v4-pro",
  "provider": "dashscope",
  "apiKey": "keychain:DASHSCOPE_API_KEY"   // 来源 spec，见下
}
```

`apiKey` 是一个**来源 spec 字符串**，声明 key 从哪取：

- `keychain:SERVICE` —— 从 macOS keychain 读（`security find-generic-password -s SERVICE -a <当前用户> -w`）。account 默认当前登录用户；要指定别的 account 用 `keychain:SERVICE:ACCOUNT`。
- `env:VAR` —— 从环境变量 `VAR` 读。
- 裸 `VAR`（无前缀）—— 默认 env。

API key **不落盘明文**：优先级 `REMORA_API_KEY` 环境变量 > config `apiKey` spec > legacy `apiKeyEnv`（env-only，向后兼容）> `DASHSCOPE_API_KEY` 环境变量兜底。keychain 只在 macOS 生效。

## 安全模型

- 默认**只读**：不带 `--write` 时只有 read/grep/find/ls 工具，外加受白名单限制的 `bash`（只放行 `ls`/`cat`/`grep`/`git log|diff|status` 等调查类命令，任何含 `;`、`|`、`&`、`` ` ``、`$()` 等链式/替换字符的命令一律拒绝）。
- 带 `--write` 时额外开启 `write_file` / `edit_file`，可改盘；改动记入 `edits`。单次写入上限 1 MiB。
- 所有文件操作限制在工作区根目录内，路径逃逸被硬拦截。
- pi 本身不内置权限沙箱，remora 的 `beforeToolCall` 是软门。`bash` 在写模式下放行任意命令；需要强隔离请在容器内运行。

## session 留痕

remora 像一个正经 agent 一样，把每次会话记成一条**可 replay 的 JSONL**（底层直接用 pi 自带的 `JsonlSessionRepo`，与 oh-my-pi 同源），而不是把消息数组塞进一个扁平 JSON。

- **位置**：集中存放在 `~/.remora/projects/<encoded-cwd>/` 下（`encoded-cwd` 由 pi 按 cwd 编码），每个 session 一个 `{ISO时间戳}_{sessionId}.jsonl`，可被 `REMORA_SESSIONS_DIR` 覆盖根目录。**不再**写入项目内的 `.remora/sessions/`。
- **格式**：首行是 session 头 `{type:"session", version:3, id, timestamp, cwd}`；其后每行一个 typed entry：
  - `message` —— 每条 user/assistant/tool 消息，**增量追加**（逐条原子写入，跑挂了已落盘的不丢）。
  - `model_change` —— 起始时记一次 provider/model。
  - `session_info` —— 从首条 prompt 派生的自动 title。
  - `compaction` —— 上下文真正压缩时记一条（含 summary / tokensBefore），resume 时由 pi 重建为摘要。
  - `custom`(`remora:lineage`) —— 记录**派生这次 rescue 的宿主 Claude Code session id**（取自 `CLAUDE_CODE_SESSION_ID`），建立可追溯链；remora 在 CC 外手动跑时该 entry 不写。
- **resume**：`--continue` 取该 cwd 最近一个；`--resume <id>` 取指定 id；续接时读回历史 entry 重建 `AgentMessage[]`，新轮次消息继续增量追加（不重写整个文件）。
