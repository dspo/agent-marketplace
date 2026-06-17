---
description: 检查 remora 运行环境（Node 版本）并校验 provider 配置的连通性与鉴权
argument-hint: ""
allowed-tools: Bash(node:*), AskUserQuestion
---

运行：

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/remora.mjs" setup
```

它会输出一个 JSON 报告：

- `nodeOk` —— Node 是否 ≥ 22.19（pi 底座要求）。为 false 时引导用户升级 Node。
- `baseUrl` / `model` / `provider` —— 解析到的 provider 配置。
- `ready` + `message` —— 是否能连通端点并通过鉴权。

根据报告给用户清晰反馈：

- `ready: true` —— 告诉用户 remora 已就绪，可以用 `/remora:rescue`。
- 配置缺失（`config error`）—— 提示用户设置 `REMORA_BASE_URL` / `REMORA_MODEL` 和 API key（`REMORA_API_KEY` 或 `.remora/config.json` 的 `apiKeyEnv`），或创建 `.remora/config.json`。
- 鉴权/连通失败 —— 透传 `message` 里的 HTTP 状态或错误，提示检查 baseUrl、model 名、API key 是否正确。

不要把 API key 明文回显给用户。
