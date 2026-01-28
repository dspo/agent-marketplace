# huayi-dev Copilot Skill

name: huayi-dev
description: 花易项目数据库开发助手 - Copilot CLI skill
commands:
  - name: huayi-db
    description: Config-aware MySQL inspection and safe queries
    usage: |
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
    script: scripts/huayi_db.py
    args:
      - --database-config
      - --config
      - list-instances
      - list-schemas
      - list-tables
      - describe-table
      - sample-data
      - query
      - export-schema
      - export-data
      - --instance
      - --db
      - --database
      - --table
      - --columns
      - --where
      - --order-by
      - --limit
      - --offset
      - --no-limit
      - --include-indexes
      - --include-system
      - --table-type
      - --like
      - --format
      - --output
      - --sql
      - --sql-file
      - --list-databases
      - --list-schemas
      - --list-tables
      - --describe
      - --sample
      - --query
      - --export-schema
      - --export-data
      - --json
