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
    ├── plugin.json          # 描述文件（name, description, version）
    ├── SKILL.md             # 主 skill 文档
    └── [references|templates|examples]/  # 可选支持文件
```

## Installation

```bash
/plugin marketplace add /path/to/huayi-dev-agent-skills
/plugin install gitlab-dev
```

## Maintenance Rules

1. 新增或修改插件时，只改 `plugins/<name>/` 和两份 `marketplace.json`。
2. 每个插件必须有 `plugin.json` 和 `SKILL.md`。
3. 不维护平台专属导出目录或脚本。
