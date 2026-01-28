# huayi-dev Copilot Skill

This directory contains a Copilot CLI-compatible skill for the huayi-dev project.

Requirements:
- Python 3
- Dependencies: `scripts/requirements.txt` (pyyaml, pymysql)

Install:

Global:

```bash
./install_to_copilot.sh --global
```

Local:

```bash
./install_to_copilot.sh --local /path/to/project
```

Files:
- skill.md - Copilot skill definition
- scripts/ - helper scripts and dependencies

Usage examples:

```bash
# Subcommands (Codex-style)
huayi-db --database-config db.yaml list-instances
huayi-db --database-config db.yaml list-schemas --instance prod
huayi-db --database-config db.yaml list-tables --instance prod --database app
huayi-db --database-config db.yaml describe-table --instance prod --database app --table users
huayi-db --database-config db.yaml sample-data --instance prod --database app --table users --limit 10
huayi-db --database-config db.yaml query --instance prod --database app --sql "SELECT * FROM users"
huayi-db --database-config db.yaml export-schema --instance prod --database app --output schema.json
huayi-db --database-config db.yaml export-data --instance prod --database app --table users --limit 100 --output users.json

# Legacy flags (Claude-style)
huayi-db --config db.yaml --list-databases
huayi-db --config db.yaml --db prod --list-schemas
huayi-db --config db.yaml --db prod --list-tables --database app
huayi-db --config db.yaml --db prod --describe users
huayi-db --config db.yaml --db prod --sample users --limit 5
huayi-db --config db.yaml --db prod --query "SELECT * FROM users"
huayi-db --config db.yaml --db prod --export-schema schema.json
huayi-db --config db.yaml --db prod --export-data users --output users.json
```
