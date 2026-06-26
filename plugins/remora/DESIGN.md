# remora 插件设计文档

> 插件名 `remora`（䲟鱼）——一种附着在鲨鱼、鲸身上共生的鱼，靠吃宿主的寄生虫与食物残屑为生。借喻：remora 附着在主 agent（Claude Code）旁，接手它处理不动的残局、做交叉验证与 task。self-contained，无第三方 agent CLI 依赖。

## 1. 背景与动机

现有 `mimo` / `codex` 插件本质是**桥接器**：它们把任务转发给一个外部 agent CLI（`mimo serve` / `codex`），自己只负责进程生命周期管理和 HTTP 通信。用户必须先 `npm i -g` 安装那个第三方 CLI，插件才能工作。

本设计目标：做一个**功能对标 `mimo:rescue` 的自包含插件**（remora 的等价概念是 `task`），agent loop / harness / provider 三件套全部内嵌，用户**无须安装任何第三方 agent CLI**，只需配置一个 model endpoint。

三个动机（已与需求方确认）：

1. **降低安装门槛** —— 团队成员不必各自装 mimo/codex CLI，开箱即用。
2. **真正不同的第二意见** —— task 场景需要一个**非 Claude** 的模型来交叉验证、跳出思维定势。这要求 provider 必须能接非 Claude 模型。
3. **验证可行性** —— 探索"插件自带完整 agent"这条路是否成立。

> **底座选型**：调研 `~/projects/github/pi` 与 `oh-my-pi` 后确定——**pi 本身就是一套库化的 agent harness**（`@earendil-works/pi-agent-core` + `pi-ai`），把我们要写的 ReAct loop、多 provider 抽象、工具系统、事件流、resume、上下文压缩钩子全部做成了成熟 npm 包。因此 remora **以 pi 为底座**（嵌入 pi-agent-core + pi-ai），不再手写 agent 内核。pi/oh-my-pi 是 remora 的 **build-time 库依赖**（随插件 `npm install` 自动拉取），不是要用户手动安装的 CLI。

## 2. 核心架构：无 daemon 的单文件 CLI

### 2.1 为什么不照搬 mimo 的脚手架

mimo 插件那套基础设施——`mimo serve` 常驻 HTTP server、SSE 流、client/server 协议、`server-lifecycle`（启动锁/健康检查/refSession）、跨进程 job 管理——**存在的唯一理由是 mimo 是一个外部 CLI 进程**：必须把它包成常驻 server，Claude Code 才能通过 HTTP 跟它对话。

但在 remora 里，**agent 就是我们自己的一次库调用**（pi `Agent`，进程内）。那个 HTTP 桥、那个 daemon、那套 job 管理——存在的前提在 remora 里根本不成立。照搬等于把别人为了绕开"外部进程"而付的税，原封不动再交一遍。

**关键洞察：Claude Code 的 harness 本身就是 job 系统。** background Bash + `BashOutput` 轮询 + `KillShell` 取消 + Monitor 流式监听——异步任务追踪它全有。在插件里再造一套 job manager 是纯浪费。

> mimo 需要 daemon 是为了"保温"一个 agent 给多次请求复用；remora 每次 task 就是一次自治运行，冷启动完全可接受，**不需要 daemon、不需要 server、不需要自造 job 系统**。

### 2.2 remora 的形态

remora 收缩成三块：

| 组件 | 内容 |
| --- | --- |
| `agents/remora-task.md` | Claude Code 子 agent 定义（thin forwarder：`model: sonnet`、`tools: Bash`） |
| `skills/task/SKILL.md` | 内部运行时契约（`user-invocable: false`）：教子 agent 怎么打包上下文、怎么调起 remora、怎么读进度与结果 |
| `_build/` → `scripts/remora.mjs` | 一个**自包含、预打包（esbuild bundle）**的 Node CLI；pi 库 bundle 进单文件 |

执行模型：

```text
Claude Code（主 agent）
  └─ Agent(remora:remora-task) — 通过 Agent 工具 spawn 子 agent
       └─ subagent（model: sonnet, tools: Bash, thin forwarder）
            └─ Bash（可 run_in_background）: node remora.mjs task  <<<task.json（stdin）
                 └─ remora.mjs  ← 短命进程，跑完即退
                      └─ pi Agent（@earendil-works/pi-agent-core，进程内）
                           ├─ ReAct 循环 / 事件流 / resume / compaction   ← pi 提供
                           ├─ tools：pi-coding-agent 工厂（read/grep/find/ls ± bash/edit/write） ← 规范依赖
                           ├─ beforeToolCall：路径沙箱门（pi 不收口路径逃逸）      ← remora 注入
                           └─ pi-ai Model 字面量 → 任意 provider（含 OpenAI 兼容）
                 ↑ 进度走 stderr(NDJSON)，最终结果走 stdout
            └─ BashOutput / Monitor 读进度，KillShell 取消
```

**没有常驻进程，没有 HTTP，没有自定义 job 系统。** 异步追踪、取消、进度全部复用 Claude Code 既有的 background-shell 能力。

### 2.3 与 mimo 的关键差异

| 维度 | mimo | remora |
| --- | --- | --- |
| 用户侧依赖 | 必装 mimo CLI | 无需装 CLI，只需 provider 配置（pi 作为库随插件安装） |
| 运行形态 | 常驻 HTTP server，多 session 复用 | 短命进程，pi 库 bundle 进单文件，跑完即退 |
| 异步任务追踪 | 自造 job manager（state/tracked-jobs/job-control） | 复用 Claude Code harness（background Bash / BashOutput / KillShell / Monitor） |
| 进程间通信 | HTTP REST + SSE | 标准流：stderr=进度(NDJSON)，stdout=结果 |
| Agent 内核 | mimo serve 内部（不可见、不可控） | pi-agent-core（开源、可读、可定制 tools/钩子） |
| 模型 | mimo 配的 provider | pi-ai：40+ provider + 任意 OpenAI 兼容端点 |
| 失败模式 | 端口占用、孤儿 daemon、健康检查、SSE 协议错 | 基本只有"进程跑挂了" |
| 要写的代码 | 移植多文件 server/client/lifecycle/job 设施 | ~250 行 CLI 胶水 + 一个 subagent + 一个 SKILL.md |
> 唯一值得从 mimo **借鉴**（非复用）的是 mimo rescue prompt 的上下文打包思路与进度渲染格式——这是参考重写，不是搬脚手架。

## 3. 文件结构

```text
plugins/remora/
├── plugin.json                       # Claude Code / Copilot CLI 描述
├── .codex-plugin/plugin.json         # Codex manifest（对齐仓库规范）
├── skills/
│   └── task/
│       └── SKILL.md                  # ★ 内部运行时契约（user-invocable: false）：task JSON schema + CLI 调用约定
├── agents/
│   └── remora-task.md                # ★ Claude Code 子 agent：thin forwarder，spawn 后调一次 remora.mjs task
├── commands/
│   ├── setup.md                      # 检查 Node + 校验 provider 配置连通性
│   └── task.md                       # 通过 Agent 工具调 remora:remora-task 子 agent
├── scripts/
│   └── remora.mjs                    # ★ esbuild bundle 产物（自包含 CLI，含 pi 库）
└── _build/
    ├── package.json    # 依赖 @earendil-works/pi-agent-core + pi-ai + pi-coding-agent（pin 精确版本）
    ├── tsconfig.json
    ├── build.mjs       # esbuild：src/cli.ts → ../scripts/remora.mjs（bundle + minify）
    └── src/
        ├── cli.ts         # ★ CLI 入口：解析参数、从 stdin 读 task JSON、调 runtime、输出流
        ├── runtime.ts     # ★ 薄封装 pi Agent：装配 + 事件→stderr 桥接 + 结果整形
        ├── tools.ts       # ★ buildTools：调 pi-coding-agent 工厂（read/grep/find/ls ± bash/edit/write）
        ├── permissions.ts # ★ beforeToolCall 路径沙箱门（pi 的 resolveToCwd 只解析不收口）
        ├── config.ts      # ★ provider 配置 → 构造 pi-ai Model 字面量 + buildModels（compaction 用）+ getApiKey
        └── session.ts     # ★ resume：AgentMessage[] 持久化到 .remora/sessions/（2MB 上限）
```

> **不移植 mimo 的**：`server-lifecycle`、`mimo-client`、`tracked-jobs`、`job-control`、`state`、HTTP 层、`schemas/`（review）、`prompts/`（review 模板）、stop-review-gate hook。remora 只做 task，且不需要 job 基础设施。

> **依赖说明**：remora 通过 npm **规范依赖**上游 pi 发布包（`@earendil-works/pi-agent-core` + `pi-ai`），**不 vendor 源码、不抄袭**。这些是**库依赖**，由 esbuild 在 build 时 bundle 进 `remora.mjs`——发布产物是单文件，运行时甚至不需要 `node_modules`。对用户是"装插件即可用"。

## 4. 编排层 —— `remora:remora-task` 子 agent + `skills/task/SKILL.md` 运行时契约

remora 的"编排层"是 `agents/remora-task.md` 定义的 Claude Code 子 agent。主 agent 通过 `Agent` 工具 spawn `remora:remora-task`，子 agent 读 `skills/task/SKILL.md`（`user-invocable: false`，内部运行时契约）获取 task JSON schema 与 CLI 调用约定，然后执行一次 Bash 调用 `node remora.mjs task`，原样返回 `finalMessage`。它替代了 mimo 的 subagent 转发 + job 命令面。子 agent 职责：

1. **组织上下文**：把当前卡住的问题、相关文件路径、已尝试的方案、期望产出，表示成一个 task JSON（**不落盘**），用 heredoc 经 stdin 喂给 CLI。借鉴 mimo rescue prompt 的结构化打包思路。task 的持久化由 remora 自己的 session（见 5.5）负责，编排层无须落文件。
2. **调起 CLI**：
   - 前台（短任务）：`node <plugin>/scripts/remora.mjs task <<<task.json`（stdin），直接读 stdout 结果。
   - 后台（长任务）：用 `run_in_background` 跑同一命令，再用 `BashOutput` 轮询 stderr 进度、`Monitor` 流式盯关键事件、`KillShell` 取消。
3. **读结果**：stdout 是结构化结果（诊断/建议/触达文件 diff）；stderr 是 NDJSON 进度流。SKILL 指导 Claude 如何把结果回报给用户。
4. **错误处理**：CLI 非零退出 + stderr 末行的 error 对象，SKILL 指导 Claude 透传原始错误并补一句 actionable next step（"运行 /remora:setup 检查 provider 配置"）。

> 这样异步、取消、进度全部落在 Claude Code 既有能力上，remora 不持有任何跨调用状态——除了 resume 需要的 session 历史文件（见 5.5）。

## 5. CLI 内部模块设计（基于 pi 真实 API）

### 5.1 `cli.ts` —— 入口与 IO 约定

```ts
// node remora.mjs task [--write] [--resume] [--session <id>] [--model <name>]   ← task JSON 从 stdin 读
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const task = JSON.parse(await readStdin());   // task JSON 从 stdin 读入,不落盘
  const result = await runTurn(process.cwd(), {
    prompt: task.prompt,
    system: buildSystemPrompt(task),
    write: args.write ?? false,
    resumeId: args.resume,
    model: args.model,
    onProgress: (ev) => process.stderr.write(JSON.stringify(ev) + "\n"), // NDJSON
  });
  process.stdout.write(JSON.stringify(result, null, 2));                   // 结果
  process.exit(result.status);
}
```

**IO 分离是契约的核心**：
- **stdout** = 唯一的最终结果（结构化 JSON），主 agent 只 parse 这一份。
- **stderr** = 进度事件流（每行一个 NDJSON 事件），供 BashOutput/Monitor 消费，不污染结果。
- **exit code** = 0 成功 / 非 0 失败，对齐 shell 语义，主 agent 直接判读。

### 5.2 `config.ts` —— provider 配置 → 构造 pi-ai `Model`

配置来源（优先级从高到低）：
1. 命令行 `--model` / 环境变量 `REMORA_BASE_URL` / `REMORA_API_KEY` / `REMORA_MODEL`
2. workspace 配置：`.remora/config.json`（由 `/remora:setup` 写入）
3. 全局配置：`~/.remora/config.json`

> **已验证的关键事实（spike 实测）**：pi-ai 的 `getModel(provider, modelId)` 只接受**两个参数**，且是对静态注册表 `MODELS.generated.ts` 的**强类型查表**——**不接受 baseUrl/apiKey，也不接受表外的任意 model id**。自定义 OpenAI 兼容端点（DashScope 等）不在注册表里，**走不通 `getModel`**。
>
> 正确做法：`Model` 是一个**纯数据对象**（`{id, name, api, provider, baseUrl, reasoning, input, cost, contextWindow, maxTokens, headers?, compat?}`）。pi 的默认 `streamFn = streamSimple` 通过 `resolveApiProvider(model.api)` + `model.baseUrl` dispatch，**完全靠这个数据对象工作，不碰注册表**。所以自定义端点 = **直接构造一个 `Model` 字面量**：

```ts
import type { Model } from "@earendil-works/pi-ai";

export function resolveModel(cfg: ProviderConfig): Model<"openai-completions"> {
  return {
    id: cfg.model,                 // 如 "deepseek-v4-pro"
    name: cfg.model,
    api: "openai-completions",     // streamSimple 据此选 openai-completions provider
    provider: cfg.provider ?? "custom",
    baseUrl: cfg.baseUrl,          // 如 https://dashscope.aliyuncs.com/compatible-mode/v1
    reasoning: cfg.reasoning ?? false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: cfg.contextWindow ?? 128000,
    maxTokens: cfg.maxTokens ?? 8192,
    // compat 留空：pi-ai 从 baseUrl 自动探测（DashScope 不在已知列表，走默认 openai 兼容，实测可用）
  };
}
```

**API key 的接入（已验证）**：`Model` 上**不放 key**。key 通过 `Agent` 的 `getApiKey` 钩子注入——pi-ai 的 `withEnvApiKey` 按 `provider` 名查内置环境变量映射（如 `deepseek`→`DEEPSEEK_API_KEY`），但**自定义 provider 不在映射里**，所以必须显式给：

```ts
new Agent({ /* ... */, getApiKey: async () => readApiKey() });
// readApiKey (config.ts resolveApiKey): 优先级 REMORA_API_KEY > config apiKey spec > legacy apiKeyEnv > DASHSCOPE_API_KEY。
// apiKey spec 支持 keychain:SERVICE[:ACCOUNT] / env:VAR / 裸 VAR(=env)；未知 scheme 抛错。keychain 走 spawnSync("security find-generic-password -s SERVICE -a <当前用户> -w")，仅 darwin 生效，同步不改 loadConfig 签名。
```

**POC 验证配置（已端到端跑通）**——取自 `~/.config/cx/cx.providers.config.yaml` 的「百炼」(阿里云 DashScope)：

```jsonc
{
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "model": "deepseek-v4-pro",   // ★ 实测：裸 id 即可。cx 里标作 deepseek-v4-pro[1m]，[1m] 是 cx 命名约定，API 不认
  "provider": "dashscope"
}
```

- **model id 已实测**：直接 `curl` DashScope `/chat/completions` 用 `deepseek-v4-pro` 返回正常；`[1m]` 是 cx 专属标注，发往真实 API 用裸 id。
- API key 存于 macOS keychain（`security find-generic-password -s DASHSCOPE_API_KEY -w`，实测可读出 `sk-...`）。remora 既可从 `REMORA_API_KEY`（回退 `DASHSCOPE_API_KEY`）取，也支持 config `apiKey: "keychain:DASHSCOPE_API_KEY"` **直接读 keychain**（account 默认当前用户），**不落盘明文**。
- function-calling、流式、重试、错误归类全部由 pi-ai 负责。**spike 已用打包后 bundle + 真实端点跑通**：`agent.prompt()` 正常返回、`agent_end` 触发、`errorMessage` 为空。

### 5.3 `tools.ts` —— `AgentTool[]`（路线 A：依赖 pi-coding-agent）

工具**不自写**——直接 `import` 上游 `@earendil-works/pi-coding-agent` 的工厂（规范 npm 依赖，esbuild bundle 进单文件，不 vendor、不抄袭源码）。pi 的 `AgentTool` 接口（`pi-agent-core` `types.ts`，**已核对真实签名**）：

```ts
// Tool 基类来自 pi-ai：{ name, description, parameters: TSchema(typebox) }
interface AgentTool<TParams extends TSchema = TSchema, TDetails = any> extends Tool<TParams> {
  label: string;                              // UI 展示名（必填）
  prepareArguments?: (args: unknown) => Static<TParams>;  // schema 校验前的兼容 shim（可选）
  execute: (
    toolCallId: string,                       // ★ 第一参是 toolCallId，不是 args
    params: Static<TParams>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
    ctx: ExtensionContext,                    // pi 传入；remora 只用 execute 路径，不调 render，故 ctx 可空
  ) => Promise<AgentToolResult<TDetails>>;    // 失败时 throw，不要把错误编码进 content
  executionMode?: "sequential" | "parallel";
}
```

> **execute 路径无头可用（已核实）**：pi 工具的 `execute` 只走可插拔 `*Operations`（`ReadOperations`/`BashOperations`/`EditOperations`/`WriteOperations`，默认本地 fs/shell），所有 `ctx.*` 引用都在 `renderCall`/`renderResult`/`preparePreview` 等 UI 方法里——remora 进程内只消费 `AgentToolResult`，从不调 render，故 `ctx` 为 undefined 也能跑。

**依赖路线（已定夺）**：

| 路线 | 依赖 | 工具来源 | 结论 |
| --- | --- | --- | --- |
| **A（采用）** | `@earendil-works/pi-coding-agent` | `import` 现成 `createReadOnlyTools` / `createBashTool` / `createEditTool` / `createWriteTool` 工厂 | **采用**：工具实现归上游、零自写；代价是 bundle 拖进 pi-tui/highlight.js/photon(wasm) 重依赖（见 §8.3） |
| ~~B~~ | 仅 `pi-agent-core` + `pi-ai` | 自写薄 `AgentTool`（各几十行） | 弃用：自写工具与上游重复造轮、且丢失 pi 工具的成熟实现 |

> **oh-my-pi 的工具为何不能用（已核实）**：`@oh-my-pi/pi-coding-agent` 是 bun-native（`main` 指向 `src/index.ts`、无 dist），工具源码首行即 `import { Database } from "bun:sqlite"`，并纠缠 `@oh-my-pi/pi-natives`（~55k 行 Rust）、puppeteer。Node/npm 无法加载，工具也无法单独摘出。故 oh-my-pi 工具一律**不导入**。但**上游** `@earendil-works/pi-coding-agent` 是纯 Node（有 dist、依赖全是普通 npm 包、无 bun:sqlite/Rust），可正常作为依赖引入——这是 remora 走路线 A 的前提。

工具集（与 pi 的 `ToolName` 同名：`read / bash / edit / write / grep / find / ls`）：

```ts
import { createReadOnlyTools, createBashTool, createEditTool, createWriteTool } from "@earendil-works/pi-coding-agent";

export function buildTools(cwd: string, opts: { write?: boolean } = {}) {
  const readOnly = createReadOnlyTools(cwd);     // read / grep / find / ls（pi 预设，无 bash）
  if (!opts.write) return readOnly;              // 只读模式：不注册 bash/edit/write
  return [...readOnly, createBashTool(cwd), createEditTool(cwd), createWriteTool(cwd)];
}
```

> **只读模式不挂 bash**：与 pi 的 `createReadOnlyTools` 一致——读模式只有 `read/grep/find/ls`，没有任何 shell 入口，因此**不再需要** remora 原先的"只读 bash 白名单 + 禁元字符"收口（已随 `permissions.ts` 精简一同移除）。写模式额外注册 `bash/edit/write`，`bash` 放行任意命令（用户已 `--write` opt-in）。路径沙箱由 `beforeToolCall` 单独收口（见 5.4）。

### 5.4 `permissions.ts` + `runtime.ts` —— 权限门与 turn 编排

**权限门用 pi 的 `beforeToolCall` 钩子**：

```ts
function makeBeforeToolCall(workspaceRoot: string) {
  const root = resolve(workspaceRoot);
  return async ({ toolCall, args }) => {
    if (typeof args.path === "string" && escapesRoot(args.path, root))
      return { block: true, reason: "permission denied: path escapes the workspace root" };
  };
}
```

- `block: true` + `reason` 由 pi 自动转成 tool result 喂回模型（无需手写 loop 处理）。
- **写工具不在只读模式注册**（`buildTools` 不挂 `bash/edit/write`），故权限门无需再做 write-gating 或 bash 白名单——这是结构性收口，比运行时拦截更可靠。门只保留**路径沙箱**：pi 的 `resolveToCwd` 只解析（`~/`、绝对、`../` 都不拒），`getCwdRelativePath` 仅用于显示检测逃逸、不阻止；remora 在此补上硬拦截。`bash` 在写模式下放行任意命令（opt-in），不在此门范围。

**`runtime.ts` 编排一个 turn**：

```ts
export async function runTurn(cwd: string, opts: RunTurnOptions): Promise<TurnResult> {
  const cfg = loadConfig(cwd, opts.model);
  const agent = new Agent({
    initialState: {
      systemPrompt: opts.system,
      model: resolveModel(cfg),               // 构造 Model 字面量（见 5.2）
      tools: buildTools(cwd, { write: Boolean(opts.write) }),  // pi-coding-agent 工厂
      messages: opts.resumeId ? loadSession(cwd, opts.resumeId) : [],
    },
    beforeToolCall: makeBeforeToolCall(cwd),  // 仅路径沙箱
    getApiKey: async () => readApiKey(cfg),   // ★ key 走这里注入，不放 Model 上
  });

  agent.subscribe((ev) => opts.onProgress(bridgeEvent(ev)));   // pi event → NDJSON 进度

  await (opts.resumeId ? agent.continue() : agent.prompt(opts.prompt));
  saveSession(cwd, agent.state.messages);   // 持久化以支持下次 resume
  return {
    status: agent.state.errorMessage ? 1 : 0,
    finalMessage: extractFinalText(agent.state.messages),
    errorMessage: agent.state.errorMessage ?? null,
  };
}
```

> `TurnResult` 不再带 `edits`/`touchedFiles`：pi 的 `write` 不产 diff、`read`/`bash` 大输出走 pi 的 `truncateHead`（截断，不外化）。这是"全面转向 pi 工具"的取舍——remora 不再自写 diff/artifact 封装层（`diff.ts`/`artifacts.ts`/`capture-output.ts` 已删除），结果只回 `finalMessage` + 错误状态。

> `beforeToolCall` 的回调签名是 `({ assistantMessage, toolCall, args, context }, signal?) => Promise<{block?, reason?} | undefined>`（已核对）。`toolCall.name` 取工具名，`args` 是 schema 校验后的参数对象。`subscribe` 返回一个 unsub 函数。

**上下文管理由 pi 负责**——流式、`transformContext` 压缩钩子均为 pi 内建。`pi-agent-core` 直接导出了一套 compaction 工具：`compact` / `shouldCompact` / `estimateContextTokens` / `generateSummary` / `DEFAULT_COMPACTION_SETTINGS` / `serializeConversation`（已核对导出）。**阶段三已接入**：注意 `compact`/`prepareCompaction` 走 `SessionTreeEntry[]`（会话树），而 remora 用扁平 `AgentMessage[]`；正好 `generateSummary` 基于扁平数组、匹配 `transformContext(messages, signal?)` 钩子签名。故 `compaction.ts` 用 `generateSummary` 而非 `compact`，避免引入会话树。这是相对手写方案最大的减负。

> **0.80.2 签名变更**：`generateSummary` 从 `(messages, model, reserveTokens, apiKey, …)` 改为 `(messages, models, model, reserveTokens, signal, …)`——不再收 `apiKey`，鉴权与流式改走 `Models` 注册表（`models.getAuth(model)` 取 key、`models.stream(model, …)` 发摘要请求）。Agent 自身仍用 `model` + `getApiKey` 路径（0.80.2 未变），但 `generateSummary` 要单独的 `Models`。故 `config.ts` 增 `buildModels(cfg, model)`：`createModels()` + `setProvider(createProvider({ id, baseUrl, auth: { apiKey: envApiKeyAuth(...) }, models:[model], api: { stream, streamSimple } }))`，stream 取自公开子路径 `@earendil-works/pi-ai/api/openai-completions`。key 若来自 keychain 则镜像进 `REMORA_API_KEY` env 供 `envApiKeyAuth` 解析。已功能验证：`getAuth(model)` 返回 `{auth:{apiKey}, source}` 正确。

### 5.5 `session.ts` —— 可 replay 的 JSONL session（pi repo + Claude Code 风格 resume）

remora 的 session 留痕**直接复用上游 pi 自带的 session 体系**（`@earendil-works/pi-agent-core` 已导出，零新增依赖）——与 oh-my-pi 同源（同一 pi 血脉）：

- `JsonlSessionRepo` + `JsonlSessionStorage`：写 `{type:"session", version:3, id, timestamp, cwd}` 头行 + 逐行 typed entry 的 JSONL（`writeFile` 头行、`appendFile` 每 entry 一行，增量原子）。
- `Session` 类：`appendMessage` / `appendModelChange` / `appendCompaction` / `appendSessionName` / `appendCustomEntry` 等方法；`buildContext()` 按 entry 重建 `AgentMessage[]`（resume 时应用 compaction entry）。
- `NodeExecutionEnv`（`@earendil-works/pi-agent-core/node` 子路径）：Node 上的 `FileSystem` 实现，喂给 `JsonlSessionRepo`。

**存储布局**（Claude Code 风格）：集中存放在 `~/.remora/projects/<encoded-cwd>/` 下（`encoded-cwd` 由 pi 的 `encodeCwd` 即 `--<cwd 中 /\:→->--` 生成），每 session 一个 `{ISO时间戳}_{sessionId}.jsonl`；`REMORA_SESSIONS_DIR` 可覆盖根目录。**不再**写入项目内 `.remora/sessions/`，旧的扁平 JSON + 2MB 丢消息方案已废弃。

**resume 命令面**（Claude Code 风格）：`--continue`/`-c`（当前 cwd 最近一个）、`--resume <id>`/`-r <id>`（指定 session）。**废弃** 旧的 `--session <name>` 与 `"default"` 字符串 id；新 session 总是拿一个 UUIDv4（`node:crypto.randomUUID()`）。turn 结果与 stderr 进度流都带 sessionId，主 agent 据此续接——对齐 Claude Code `--output-format json` 返 `session_id` 的用法。

**entry 完整度**（标准档）：`message`（每条消息，**引用集合幂等 + 增量追加**；compaction 时由回调先把被摘要的原始消息落盘再记 `compaction` entry，跑挂了已落盘的不丢）、`model_change`（起始记 provider/model）、`session_info`（首条 prompt 派生 title）、`compaction`（`transformContext` 真正压缩时记，带**精确的** `firstKeptEntryId`——= 第一个被保留消息的 entry id，由 load 时建立的 `WeakMap<message, entryId>` 在压缩回调里查出；resume 时 `loadMessages` 按 pi `buildSessionContext` 同款语义切片：drop 掉该 compaction entry 之前、`firstKeptEntryId` 之前的全部 message，前插一条 synthetic summary，保留其后的 recent tail + compaction entry 之后的新消息，精确重建 `[summary, ...recent]`。`firstKeptEntryId=""` 退化成"从 session 起点全部摘要"——当被保留的首条消息是本 turn 新消息、尚无 entry id 时才出现，语义仍正确）、`custom`(`remora:lineage`，见下)。多轮 compaction 由"取最后一条 compaction entry"保证正确（每条 summary 已吸收到它为止的历史）。`loadAllMessages`（dump 用）读**全部**原始 message entry 不切片，供人工复盘看完整 transcript。

**记录宿主 Claude Code session id**：remora 是 Claude Code spawn 的子进程，CC 给子进程注入 `CLAUDE_CODE_SESSION_ID`（UUIDv4，已实测）。新建 session 时用 `appendCustomEntry("remora:lineage", { claudeCodeSessionId })` 记下 parent CC session（pi 的 custom entry 是"扩展私有数据"的官方逃生口，不占用 header 的 `parentSessionPath` 字段——后者语义是 parent session 文件路径，与"一个 CC session id"不符）。CC 外手动跑时该 env 不存在则跳过；resume 同一 session 不重复记。

> **持久化保护 = 截断 + Blob 外化**（对齐 oh-my-pi）：`prepareForPersistence` 递归处理每条消息——(1) `content` 数组里 base64 ≥ 1 KiB 的图片块外化到内容寻址 blob store（`~/.remora/blobs/<sha256>`，SHA-256 over raw bytes，自动去重），JSONL 里只存 `blob:sha256:<hash>` 引用；(2) `image_url` data URL 同理外化；(3) 其余 > 500 000 字符的字符串截断（带 `[truncated]` 标记，crypto 签名字段清空而非截断）。blob 写同步落盘（page cache）后才写引用它的 JSONL 行——OOM/SIGKILL 不会留悬空 ref。**读路径**（`loadMessages`）在 resume 时把 `blob:` ref 还原回 base64/data URL，blob 缺失则优雅降级（保留 ref 字符串）。见 `blob-store.ts`。

## 6. 命令面

| 命令 | 行为 |
| --- | --- |
| `/remora:setup` | 检查 Node 版本 + 校验 `REMORA_*` / `.remora/config.json` + 用 pi-ai 试发一次最小请求验证连通性与鉴权 |
| `/remora:task` | 触发 task skill（打包上下文 → 调 CLI → 读结果） |

> 不再需要 `status` / `result` / `cancel` 命令——这些在 mimo 里是自造 job 系统的查询接口。remora 复用 Claude Code 的 background-shell：进度看 `BashOutput`、取消用 `KillShell`，无需插件自己实现。

`task` 的能力开关由 CLI flag 承载：`--write`（开启写盘）/ `--resume <id>`（续上一轮）/ `--model <name>`（同 provider 切模型）。

> **范围**：remora 只做 task，不做 mimo 的 `review` / `adversarial-review`，相应模板/schema/hook 一律不移植。

## 7. 可行性验证结论（spike 实测）

设计中所有关键假设已在临时目录用 **pinned 包 + esbuild + 真实 DashScope 端点**逐项验证通过（验证后已清理）：

| 假设 | 结论 |
| --- | --- |
| npm 上有发布包、可 pin | ✅ `@earendil-works/pi-agent-core` / `pi-ai` / `pi-coding-agent` 均 `0.80.2` latest（另有 `legacy-node20` tag）；`npm i @...@0.80.2` 成功（含传递依赖共 240 包） |
| pi 包是 ESM + 有 dist + Node 可用 | ✅ 两包 `main: ./dist/index.js`、`exports` ESM、`engines.node >=22.19.0` |
| `Agent` 构造/API 与设计一致 | ✅ `new Agent({initialState:{systemPrompt,model,tools,messages}, beforeToolCall, getApiKey})`；`agent.prompt()` / `agent.continue()` / `agent.subscribe()`(返回 unsub) / `agent.state.{messages,errorMessage}` 全部存在 |
| 自定义 OpenAI 兼容端点接入方式 | ⚠️ **修正**：`getModel` 是两参注册表查表、**不能传 baseUrl/apiKey**。改为**直接构造 `Model` 字面量**（`api:"openai-completions"`+`baseUrl`），key 走 `Agent.getApiKey`。已实测可用 |
| `beforeToolCall` 返回 `{block,reason}` 拦截 | ✅ 接口 `{block?:boolean, reason?:string}`，ctx 含 `{toolCall, args, assistantMessage, context}` |
| `AgentTool` 签名 | ⚠️ **修正**：`execute(toolCallId, params, signal?, onUpdate?)`（首参是 toolCallId），且有必填 `label`；`Tool={name,description,parameters:TSchema}` |
| esbuild bundle 成单文件可跑 | ✅ 单文件可跑（转向 pi 工具后 ~8.7 MB；**需加 `createRequire` banner** 解决依赖里的 `require("process")`，否则运行时报 "Dynamic require not supported" |
| DashScope model id | ✅ `curl` 实测 `deepseek-v4-pro` 正常返回；`[1m]` 是 cx 命名约定，API 用裸 id |
| 端到端 agent loop | ✅ 真实端点跑通 `agent.prompt()`，`agent_end` 触发、`errorMessage` 空、返回内容（含 thinking） |

> **新增硬约束**：pi 0.80.x `engines.node >=22.19.0`。remora 的 `setup` 必须校验 Node 版本；低于 22.19 时引导用户升级，或退到 `legacy-node20` tag（0.74.2）。

## 8. 风险与已知局限

1. **Node 版本门槛**。pi 0.80.x 要求 Node ≥ 22.19。**缓解**：setup 检测 + 提示；必要时 pin `legacy-node20`(0.74.2)。
2. **pi 库版本**。绑定 `@earendil-works/*`（仍快速迭代），API 可能变动。**缓解**：pin 精确版本（符合 supply-chain 规范），升级当作 reviewed change；接口收口在 `runtime.ts`/`config.ts` 隔离变化（自定义 Model 构造、getApiKey 注入都已收口）。
3. **bundle 体积（转向 pi 工具后显著增大）**。单文件 ~8.7 MB（原自写工具时 2.36 MB）。增量主因是 `@earendil-works/pi-coding-agent` 把工具与交互式 TUI 渲染器耦合——`edit.ts`/`write.ts` 顶层 `import` 了 `modes/interactive/...` 的 diff/theme 渲染，esbuild 无法 tree-shake，连带拉入 `pi-tui`、`highlight.js`、`@silvia-oddyer/photon-node`(wasm)。这些对 remora（只用 execute 路径、从不调 render）是死重，但 pi 的工具/渲染未解耦，无法在不 fork 的前提下剔除。**取舍**：为"全面转向 pi 工具、不自写"接受体积；强 `--external` 会破坏单文件自包含发布，暂不动。
4. **"无第三方"是相对的**。去掉了用户手装的 CLI binary，但引入 pi 库依赖 + 一个 model API。门槛大幅降低（装插件即可），但依赖未归零。
5. **弱模型表现**。非 Claude 模型若较弱，工具调用/编辑命中率可能差。**缓解**：工具的 schema/描述直接用 pi 的成熟实现（含其 benchmaxxed 提示），remora 不再自写工具描述。
6. **安全面**。`bash` 仅在 write 模式注册并放行任意命令（用户 `--write` opt-in）；**只读模式不挂 bash**（pi 的 `createReadOnlyTools` 无 bash），无 shell 入口。文件操作限制在 workspace root 内（`beforeToolCall` 路径沙箱；pi 的 `resolveToCwd` 只解析不收口）。**pi 本身不内置权限沙箱**，`beforeToolCall` 是唯一软门，强隔离需靠容器。
7. **大输出截断（接受 pi 默认）**。pi 的 `read` 用 `truncateHead`、`bash` 同样截断超长输出——**会丢尾部数据**。这是"全面转向 pi 工具、不自写封装层"的明确取舍：remora 不再维护 `artifacts.ts`/`capture-output.ts` 的零丢失外化方案（已删除）。`read` 支持 `offset`/`limit` 分页续读，模型可主动翻页补全；`bash` 超长输出模型可重定向到文件再 `read` 分段。

## 9. 落地路径

1. **阶段一（POC，read-only task）**：scaffold `plugins/remora/`，写 `cli.ts` + `config.ts` + `runtime.ts` + `tools.ts` + `permissions.ts`，依赖 `pi-agent-core` + `pi-ai` + `pi-coding-agent`（路线 A）。bundle 链路与 API 已验证，直接落地：构造自定义 Model、getApiKey 注入 key、`buildTools` 调 pi 工厂、beforeToolCall 路径沙箱门、事件→stderr 桥接、stdout 结果契约。esbuild build 脚本带 `createRequire` banner。
2. **阶段二（✅ 已完成，write task）**：`buildTools` 在 `--write` 时追加 `createBashTool`/`createEditTool`/`createWriteTool`（pi 工厂），打通 `--write`；只读模式不挂 bash（结构性收口，替代原白名单）。已用真实端点端到端验证。bundle 体积（~8.7 MB，pi-coding-agent 拖入 TUI 重依赖）评估为非阻塞，留待上游解耦工具/渲染后再减。
3. **阶段三（✅ 已完成）**：`session.ts` resume（2MB 上限）+ `/remora:setup`（Node 版本 + provider 连通性探测）已在前期落地；本阶段补齐**上下文压缩**——`compaction.ts` 用 pi 的 `transformContext` 钩子接 `generateSummary`：低于 `shouldCompact` 阈值零开销返回原 messages（单轮 task 常态），超阈值则保留最近窗口（`keepRecentTokens`）、把中段历史压成一条摘要消息，`generateSummary` 失败降级为原样不崩。已用真实端点验证：600 条消息（~164k tokens）压成 74 条、低阈值不触发。同时修正 `session.ts` 里"保留 system 消息"的死注释（system 是 Agent 独立字段、不在 messages 数组内）。
4. **阶段四（可选）**：借鉴 oh-my-pi 的哈希编辑 / benchmaxxed 提示思路自写增强。

可行性已验证，阶段一是纯落地工作，预计 **0.5 天**出可跑原型。

## 10. 决策点（全部已定）

- [x] **命名 = `remora`**（䲟鱼，与鲨鲸共生、清理残屑的借喻）。
- [x] **架构 = 无 daemon 单文件 CLI + subagent 编排**：不照搬 mimo 脚手架（无 server/HTTP/自造 job 系统）；异步追踪复用 Claude Code 的 background Bash / BashOutput / KillShell / Monitor。编排层是 `agents/remora-task.md` 子 agent + `skills/task/SKILL.md` 运行时契约（对齐 codex-plugin-cc 的 `codex-rescue` 模式）。
- [x] **provider 接入 = 直接构造 `Model` 字面量**（不走 `getModel` 注册表），key 经 `Agent.getApiKey` 注入。已实测。
- [x] **工具依赖路线 = A**：依赖 `pi-agent-core` + `pi-ai` + `pi-coding-agent`，工具直接 `import` 上游工厂（不自写）。oh-my-pi 工具经核实为 bun-native + Rust，不可导入；**上游** `@earendil-works/pi-coding-agent` 是纯 Node（有 dist、无 bun/Rust），作为规范依赖引入。
- [x] **POC endpoint = 百炼/DashScope**：`https://dashscope.aliyuncs.com/compatible-mode/v1`，model `deepseek-v4-pro`（实测裸 id 可用），key 取 keychain 的 `DASHSCOPE_API_KEY`。
- [x] **pi 包版本 = pin `0.80.2`，手动更新**（不用 `^`/`~`）。要求 Node ≥ 22.19；低版本退 `legacy-node20`(0.74.2)。
- [x] **能力范围 = 仅 `task`**：不做 review。命令面只有 `setup` / `task`。
- [x] **发布形态 = esbuild bundle 单文件**（~8.7 MB，带 `createRequire` banner，已验证可跑）。
- [x] **session 存储 = pi `JsonlSessionRepo` + Claude Code 风格**：复用上游 pi 自带的 JSONL session 体系（零新增依赖），集中存放于 `~/.remora/projects/<encoded-cwd>/<ts>_<id>.jsonl`；resume 用 `--continue`/`--resume <id>`（废弃 `--session`/`default` id），session-id 用 UUIDv4；entry 做到标准档（message/model_change/session_info/compaction）；用 `remora:lineage` custom entry 记录派生自宿主 CC 的 `CLAUDE_CODE_SESSION_ID`。旧的扁平 JSON + 2MB 丢消息方案废弃。

> **依赖纪律已定**：只通过 npm 规范依赖上游发布包，不 vendor、不抄袭；底座先用上游 pi，oh-my-pi 留待后续按需引入其独立 npm 子包。

## 11. 扩展 seam（留口子，对齐 oh-my-pi 的能力面，现在不实现）

remora 的目标是 pi 系完整 coding agent，但当前形态短命、无 daemon。以下能力**对齐到 seam、不实现**——能力已在 pi/oh-my-pi 里存在但因 bun/Rust 重耦合无法移植；seam 在，未来 remora 获得 vision input / cloud 后端 / 多设备时一个适配 drop-in。

1. **存储后端 seam = 上游 `SessionRepo` 接口**（不另造接口）。pi 已导出 `SessionRepo<TMetadata, TCreateOptions, TListOptions>`（`create`/`open`/`list`/`delete`/`fork`），`JsonlSessionRepo` 与 `InMemorySessionRepo` 都实现它。remora 当前用 `JsonlSessionRepo`（JSONL-via-NodeExecutionEnv）。未来 cloud/multi-device 时一个实现 `SessionRepo` 的 ioredis/pg 适配器即可 drop-in，**无需** remora 自己再定义 `SessionStorageBackend` 平行接口（那是 oh-my-pi 在 bun:sqlite 之上的抽象，与 pi 重复）。oh-my-pi 的 `agent-storage`(bun:sqlite) / `history-storage`(FTS5) / `snapcompact`(Rust) 是它的分叉，无 Node 等价且 remora 短命 CLI 无此需求。
2. **视觉压缩 seam = `transformContext` 钩子**。remora 的 `compaction.ts` 已通过 pi 的 `transformContext` 接入文本压缩（`makeTransformContext`，见 `runtime.ts`）。未来 remora 支持 image/vision input 后，文本→token 的视觉压缩（oh-my-pi 的 `snapcompact`，依赖 Rust `countTokens` + 文本→PNG 渲染）走**同一钩子**——`transformContext` 是 pi 的官方 context 变换点，视觉压缩是一个额外的 transform provider。现在无 vision input，seam 形态即文本 compaction（已落地）。
3. **terminal breadcrumb（低优先）**。`--continue` 在 TTY 场景下需要找"当前终端的上次 session"——oh-my-pi 用 `@oh-my-pi/pi-tui` 的 `getTerminalId`。remora 的调用方是 Claude Code（不是人 TTY），主 agent 已持 sessionId 并经 `--resume <id>` 显式续接，故**不需要** breadcrumb。未来若 remora 直接面向人 TTY，用 `process.stdout` 的 tty id 或 CC 注入的 id 替代。
4. **lineage / 派生数据 = `custom` entry**。`remora:lineage` 是 remora 用 pi 的 `appendCustomEntry`（扩展私有数据官方逃生口）记 CC session id 的首例。future ttsr / mcp / mode 切换走同条路（pi 不解释 remora 的 custom entry，只原样落盘）。

> **不做清单**（诚实记录理由）：mimo 的 SQLite + drizzle + 30 迁移（常驻 coding-agent 的数据库思维，remora 短命 CLI 用 JSONL-via-pi 是对的）；`agent-session.ts` 的 11.7k 编排（remora 有自己的薄 `runtime.ts`，Rust countTokens/MacOSPowerAssertion 无 Node 等价且 macOS-only native 不该进跨平台 CLI）；FTS5 全文检索历史 prompt（remora 不搜 session，真要搜时上 better-sqlite3 单独建，不进 session 层）。

