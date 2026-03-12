# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

花易项目 AI 开发工具集 (Huayi Dev Agent Skills) - 提供 Claude Code Plugin Marketplace 和多平台 AI Agent Skills。包含数据库访问、GitLab 助手、Go 规范审查、试卷生成、浏览器自动化等能力。

## Architecture

项目采用 **Plugin Marketplace + 多平台适配** 架构：

```
├── .claude-plugin/marketplace.json     # Plugin Marketplace 目录
├── plugins/                            # Plugin 集合（Claude Code 推荐）
│   ├── database-access/                # 数据库访问（含 MCP 配置）
│   ├── gitlab-dev/                     # GitLab 助手
│   ├── go-spec-review/                 # Go 规范审查
│   ├── exam-generator/                 # 试卷生成器
│   └── playwright-cli/                 # 浏览器自动化
├── database-access-mcp/                # 独立 MCP Server（通用）
├── claude/                             # Claude Code Skills（传统方式）
├── codex/                              # OpenAI Codex Skills
└── copilot/                            # GitHub Copilot Skills
```

每个 plugin 包含：
- `.claude-plugin/plugin.json` — 名称、描述、版本
- `skills/<name>/SKILL.md` — Skill 定义（frontmatter + 使用说明）
- 支持文件（scripts, references, templates, examples）

## Installation

### Plugin Marketplace（Claude Code 推荐）

```bash
/plugin marketplace add /path/to/huayi-dev-agent-skills
/plugin install database-access
```

### MCP Server（通用）

```bash
pip install -e database-access-mcp
claude mcp add --transport stdio database-access -- python -m database_access_mcp
```

### Skills（传统方式）

```bash
claude/install_to_claude.sh --global
codex/install_to_codex.sh --global
copilot/install_to_copilot.sh --global
```

## Dependencies

```bash
pip install pyyaml pymysql
```

Python 3.8+ required (3.10+ recommended).

## Database Configuration Format

```yaml
databases:
  <alias>:
    description: Database description
    driver: mysql
    host: "hostname"
    port: 3306
    username: user
    password: ${ENV_VAR_NAME}  # Environment variable substitution
    database: database_name
```

## Security Constraints

All implementations enforce:
- **Read-only**: Only SELECT queries allowed (DDL/DML blocked)
- **Automatic LIMIT**: Default LIMIT 10 on all queries
- **Password protection**: Environment variable substitution for secrets
- **SQL injection prevention**: Parameterized queries, identifier quoting, multi-statement blocking
