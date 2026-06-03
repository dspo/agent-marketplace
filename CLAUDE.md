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
    ├── SKILL.md                     # Claude Code / Copilot CLI 主 skill 文档
    ├── .codex-plugin/plugin.json    # Codex manifest
    ├── skills/<skill>/SKILL.md      # Codex skill 入口
    └── [references|templates|examples]/  # 可选支持文件
```

## Installation

```bash
/plugin marketplace add /path/to/huayi-dev-agent-skills
/plugin install gitlab-dev
```

## Maintenance Rules

1. 新增或修改插件时，只改 `plugins/<name>/` 和两份 `marketplace.json`。
2. Claude Code / Copilot CLI 使用根级 `plugin.json` 和 `SKILL.md`。
3. Codex 使用 `.codex-plugin/plugin.json` 和 `skills/<skill>/SKILL.md`。
4. `.claude-plugin/marketplace.json` 与 `.agents/plugins/marketplace.json` 需要分别维护各自 schema。
5. 若根级 `SKILL.md` 与 Codex `skills/<skill>/SKILL.md` 表达同一能力，修改时必须同步两份内容，并检查 Codex 版相对链接是否仍然正确。
