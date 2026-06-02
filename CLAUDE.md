# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

本仓库的目标已经固定为 **维护 Claude Code Plugin Marketplace**。请把 `.claude-plugin/marketplace.json` 和 `plugins/` 视为唯一长期维护面；`plugins/` 是唯一 source of truth。

不要再把本仓库当成多平台 skill 仓库来维护。`codex/`、`copilot/` 目录不再提交到仓库；如需兼容这两个平台，只能通过导出脚本按需生成外部产物。

## Architecture

```text
├── .claude-plugin/marketplace.json     # Claude Code marketplace 清单
├── plugins/                            # 唯一源文件
├── scripts/sync-skills.py              # Codex/Copilot 兼容导出
└── doc/skills-installation.md          # 兼容导出说明
```

每个 plugin 包含：
- `.claude-plugin/plugin.json`
- `skills/<name>/SKILL.md`
- 支持文件（scripts, references, templates, examples）
- 可选的 `.copilot.yaml`，仅用于生成 Copilot 兼容导出

## Installation

### Claude Code Marketplace

```bash
/plugin marketplace add /path/to/huayi-dev-agent-skills
/plugin install gitlab-dev
```

### Compatibility Export

```bash
python3 scripts/sync-skills.py --target codex --output-dir ~/.codex/skills --all
python3 scripts/sync-skills.py --target copilot --output-dir ~/.copilot/skills --skill gitlab-dev
```

## Maintenance Rules

1. 新增或修改能力时，只改 `plugins/` 与 marketplace 元数据。
2. 不要重新引入已提交的 `codex/`、`copilot/` 目录。
3. Copilot 相关配置只保留在 plugin 内的 `.copilot.yaml`，作为导出时的输入。
4. 如果 plugin 文档里出现平台路径，优先写 `${CLAUDE_PLUGIN_ROOT}`，再由导出脚本做目标平台替换。

## Dependencies

```bash
pip install pyyaml
```

Python 3.10+ required.
