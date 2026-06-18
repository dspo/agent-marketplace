# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

本仓库是花易项目的**统一 Plugin Marketplace**，同时兼容 Claude Code、Copilot CLI 和 Codex。

- `.claude-plugin/marketplace.json` — Claude Code + Copilot CLI 共享索引
- `.agents/plugins/marketplace.json` — OpenAI Codex 索引
- `plugins/` — 唯一插件源码目录

## Architecture

```text
├── .claude-plugin/marketplace.json
├── .agents/plugins/marketplace.json
└── plugins/<name>/
    ├── plugin.json                  # Claude Code / Copilot CLI 描述文件
    ├── .codex-plugin/plugin.json    # Codex manifest
    ├── skills/<skill>/SKILL.md      # Claude Code + Codex 共享 skill 入口
    └── [references|templates|examples]/  # 可选支持文件
```

## Installation

```bash
/plugin marketplace add https://<user>:<token>@git.huayi.tech/huayi/shared/agent-marketplace.git
/plugin install gitwork
```

## Maintenance Rules

1. 新增或修改插件时，只改 `plugins/<name>/` 和两份 `marketplace.json`。
2. Claude Code / Copilot CLI 和 Codex 共享 `skills/<skill>/SKILL.md`，不再使用根级 `SKILL.md`。
3. Codex 使用 `.codex-plugin/plugin.json`（其中 `"skills": "./skills/"` 指向插件根目录下的 `skills/`）。
4. `.claude-plugin/marketplace.json` 与 `.agents/plugins/marketplace.json` 需要分别维护各自 schema。
5. 多 skill 插件的每个 skill 独立维护，引用共享原则文件用相对 skill 自身目录的路径（`../../references/principles.md`）而非互相复制内容。
