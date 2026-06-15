---
name: mimo
description: MiMo 编程助手 — 使用 MiMo 进行代码审查、委托任务和 stop-gate 审查
---

# MiMo Companion

使用 MiMo（小米 AI 编程助手）从 Claude Code 进行代码审查或委托任务。

## 前置条件

- 安装 MiMo CLI: `npm install -g @mimo-ai/cli`
- 运行 `/mimo:setup` 检查环境就绪状态

## 命令

| 命令 | 说明 |
|---|---|
| `/mimo:setup` | 检查 MiMo 可用性，可选启用 stop-time review gate |
| `/mimo:review` | 对工作树或分支 diff 进行结构化代码审查 |
| `/mimo:adversarial-review` | 对抗性审查，质疑设计选择和假设 |
| `/mimo:rescue` | 委托调查或实现任务给 MiMo（通过 subagent） |
| `/mimo:status` | 显示活跃和最近的 MiMo 任务 |
| `/mimo:result` | 显示已完成任务的存储输出 |
| `/mimo:cancel` | 取消活跃的后台任务 |

## 架构

- **服务器生命周期**：第一个命令在后台启动 `mimo serve` HTTP 服务器，解析端口并记录在 workspace 状态目录的 `server.json` 中。后续命令复用同一服务器（通过健康检查确认）。SessionEnd hook 在最后一个引用会话结束时关闭服务器。
- **MiMo 客户端**：通过 REST API 使用 `fetch` 通信。每个请求携带 `x-mimocode-directory` header 以绑定正确的项目。结构化审查输出使用 `format: {type: "json_schema"}` 和 `info.structured` 返回。
- **无人值守安全**：插件创建的会话始终携带显式权限规则（审查为只读，`--write` 任务为 allow-all），不会回退到 "ask"。客户端还监听 `/event` 流并自动拒绝任何会挂起无人值守任务的 `question.asked` / `permission.asked`。
- **任务管理**：`state.json` 加 per-job JSON/log 文件，后台任务在 detached `task-worker` 进程中运行，`--resume-last` 复用持久化的 MiMo session ID。
- **Stop-gate 审查**：可选的 Stop-hook 审查。gate 自身的任何故障路径（MiMo 缺失、服务器宕机、超时、崩溃）都 fail-open，确保不会阻塞 Claude 会话。

## 环境变量

| 变量 | 用途 |
|---|---|
| `MIMO_COMPANION_BIN` | 覆盖 `mimo` 二进制路径 |
| `MIMOCODE_SERVER_PASSWORD` | 如设置，客户端发送匹配的 Basic Auth 到启动的服务器 |
| `MIMO_COMPANION_SESSION_ID` | 由 SessionStart hook 自动设置 |

> ⚠️ 后台任务（`--background`）启动的 detached worker 使用父进程启动时的环境变量。如果中途修改了 API key 等环境变量，worker 不会感知变更——需重启 Claude Code 会话。

## 构建

`_build/` 目录存放 TypeScript 源码、构建配置和测试文件。下划线前缀表示这是开发者工具区，不属于插件运行时分发内容——用户安装插件后只需 `scripts/*.mjs`、`commands/`、`prompts/` 等文件，`_build/` 仅在修改源码时使用。

如需修改插件脚本：

```bash
cd plugins/mimo/_build
npm install
npm run build     # esbuild → ../scripts/*.mjs
npm test          # node --test against a fake in-process MiMo HTTP server
```

编译产物 `scripts/*.mjs` 已提交到仓库，插件以原样从本仓库分发。

> ⚠️ 当前有 7 个集成测试因 Node.js 版本和 macOS 网络环境的兼容性问题持续失败（server 端口检测超时），这是源仓库的预存问题。纯库测试（state、render、mimo-client、server-lifecycle）均正常通过。
