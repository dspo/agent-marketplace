# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

花易项目 Agent Skills 集合 (Huayi Dev Agent Skills) - A multi-platform AI agent skills repository providing database development assistant capabilities. Enables AI coding assistants (Claude Code, OpenAI Codex, GitHub Copilot) to safely connect to MySQL databases, inspect schemas, query table structures, and retrieve sample data.

## Architecture

The project follows a **multi-platform adapter pattern** with three parallel implementations:

```
├── claude/              # Claude Code integration (flag-based CLI)
│   └── skills/huayi-dev/scripts/huayi_db.py
├── codex/               # OpenAI Codex integration (subcommand-based CLI)
│   └── skills/huayi-dev/scripts/huayi_db_tool.py
└── copilot/             # GitHub Copilot integration (hybrid CLI - both styles)
    └── skills/huayi-dev/scripts/huayi_db.py
```

Each platform has its own:
- Installation script (`install_to_<platform>.sh`)
- Skill definition file (`.md` format)
- Python database helper script
- `requirements.txt` for dependencies

## Installation Commands

```bash
# Claude Code (global)
claude/install_to_claude.sh --global

# OpenAI Codex (global)
codex/install_to_codex.sh --global

# GitHub Copilot (global)
copilot/install_to_copilot.sh --global

# Add --local <path> for project-level installation
```

## Dependencies

```bash
pip install pyyaml pymysql
```

Python 3.8+ required (3.10+ recommended).

## CLI Styles

**Claude (flag-based):**
```bash
python3 huayi_db.py --config db.yaml --db <alias> --list-tables
python3 huayi_db.py --config db.yaml --db <alias> --describe <table>
python3 huayi_db.py --config db.yaml --db <alias> --query "SELECT ..."
```

**Codex (subcommand-based):**
```bash
python3 huayi_db_tool.py list-tables --database-config db.yaml --instance <alias>
python3 huayi_db_tool.py describe-table --database-config db.yaml --instance <alias> --table <table>
python3 huayi_db_tool.py query --database-config db.yaml --instance <alias> --sql "SELECT ..."
```

**Copilot (hybrid - supports both styles)**

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
