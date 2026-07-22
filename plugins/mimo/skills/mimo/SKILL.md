---
name: mimo
description: MiMo 编程助手 — 使用 MiMo 进行代码审查、委托任务和 stop-gate 审查
---

# MiMo Companion

使用 MiMo（小米 AI 编程助手）进行代码审查或委托任务。

前置：`npm install -g @mimo-ai/cli`，运行 `/mimo:setup` 检查环境。

## 命令

| 命令 | 说明 |
|------|------|
| `/mimo:setup` | 检查 MiMo 可用性，可选启用 stop-time review gate |
| `/mimo:review` | 对工作树或分支 diff 进行结构化代码审查 |
| `/mimo:adversarial-review` | 对抗性审查，质疑设计选择和假设 |
| `/mimo:rescue` | 委托调查或实现任务给 MiMo（通过 subagent） |
| `/mimo:status` | 显示活跃和最近的 MiMo 任务 |
| `/mimo:result` | 显示已完成任务的存储输出 |
| `/mimo:cancel` | 取消活跃的后台任务 |

## 架构

- **Server 生命周期**：首个命令在后台启动 `mimo serve` HTTP 服务器，后续命令复用。SessionEnd hook 在最后关闭服务器。
- **任务管理**：`state.json` + per-job JSON/log 文件。`--resume-last` 复用持久化的 MiMo session ID。
- **Stop-gate 审查**：可选 Stop-hook 审查。gate 任何故障路径都 fail-open（MiMo 缺失、服务器宕机、超时、崩溃）。

## 环境变量

| 变量 | 用途 |
|------|------|
| `MIMO_COMPANION_BIN` | 覆盖 `mimo` 二进制路径 |
| `MIMOCODE_SERVER_PASSWORD` | 如设置，客户端发送 Basic Auth |
| `MIMO_COMPANION_SESSION_ID` | 由 SessionStart hook 自动设置 |

后台任务（`--background`）的 detached worker 使用父进程启动时的环境变量。
