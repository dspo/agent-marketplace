# Skills 安装指南（传统方式）

本文档介绍如何将 huayi-dev 作为 Skill 安装到各 AI 编码助手。

> **推荐**: 优先使用 [MCP 方式](../README.md) 安装，MCP 提供更好的工具集成体验。

---

## 快速安装

```bash
git clone <repo-url> huayi-dev-agent-skills
cd huayi-dev-agent-skills
```

### Claude Code

```bash
claude/install_to_claude.sh --global
```

### Codex CLI

```bash
codex/install_to_codex.sh --global
```

### Copilot CLI

```bash
copilot/install_to_copilot.sh --global
```

---

## 数据库配置文件

在使用 Skill 前，需要准备 YAML 格式的数据库配置文件：

```yaml
databases:
  production:
    description: 生产环境数据库
    driver: mysql
    host: "db.example.com"
    port: 3306
    username: readonly_user
    password: ${DB_PROD_PASSWORD}  # 使用环境变量
    database: myapp

  development:
    description: 开发环境数据库
    driver: mysql
    host: "localhost"
    port: 3306
    username: dev_user
    password: ${DB_DEV_PASSWORD}
    database: myapp_dev
```

设置环境变量：

```bash
export DB_PROD_PASSWORD="your_password"
export DB_DEV_PASSWORD="your_dev_password"
```

---

## Claude Code 使用方法

在 Claude Code 中调用已安装的 skill：

```
/huayi-dev --database-config ./db-config.yaml
```

命令行直接使用（安装到 `~/.claude/scripts/huayi_db.py` 后）：

```bash
# 列出配置的所有数据库
python3 ~/.claude/scripts/huayi_db.py --config db-config.yaml --list-databases

# 列出数据库中的所有表
python3 ~/.claude/scripts/huayi_db.py --config db-config.yaml --db production --list-tables

# 查看表结构
python3 ~/.claude/scripts/huayi_db.py --config db-config.yaml --db production --describe users

# 获取示例数据
python3 ~/.claude/scripts/huayi_db.py --config db-config.yaml --db production --sample users --limit 5

# 执行 SELECT 查询（仅允许 SELECT）
python3 ~/.claude/scripts/huayi_db.py --config db-config.yaml --db production --query "SELECT id, name FROM users WHERE status='active'"

# 导出表结构到 JSON
python3 ~/.claude/scripts/huayi_db.py --config db-config.yaml --db production --export-schema schema.json
```

安装位置：
- 全局：`~/.claude/commands/` 与 `~/.claude/scripts/`
- 项目级：`<project>/.claude/commands/` 与 `<project>/.claude/scripts/`

---

## OpenAI Codex 使用方法

Codex 风格使用子命令形式（安装到 `~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py` 后）：

```bash
# 列出配置的所有数据库实例
python3 ~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py list-instances --database-config db-config.yaml

# 列出数据库实例中的所有 schemas
python3 ~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py list-schemas --database-config db-config.yaml --instance production

# 列出所有表
python3 ~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py list-tables --database-config db-config.yaml --instance production --database myapp

# 查看表结构
python3 ~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py describe-table --database-config db-config.yaml --instance production --database myapp --table users

# 获取示例数据
python3 ~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py sample-data --database-config db-config.yaml --instance production --database myapp --table users --limit 20

# 执行 SELECT 查询
python3 ~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py query --database-config db-config.yaml --instance production --database myapp --sql "SELECT id, name FROM users WHERE status='active'"

# 导出表结构到 JSON
python3 ~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py export-schema --database-config db-config.yaml --instance production --database myapp --output schema.json

# 导出数据到 JSON
python3 ~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py export-data --database-config db-config.yaml --instance production --database myapp --table users --limit 100 --output users.json
```

安装位置：
- 全局：`~/.codex/skills/huayi-dev/`
- 项目级：`<project>/.codex/skills/huayi-dev/`

---

## GitHub Copilot 使用方法

Copilot CLI 支持两种风格（安装到 `~/.copilot/skills/huayi-dev/` 后）：

### Subcommands (Codex-style)

```bash
huayi-db --database-config db.yaml list-instances
huayi-db --database-config db.yaml list-schemas --instance prod
huayi-db --database-config db.yaml list-tables --instance prod --database app
huayi-db --database-config db.yaml describe-table --instance prod --database app --table users
huayi-db --database-config db.yaml sample-data --instance prod --database app --table users --limit 10
huayi-db --database-config db.yaml query --instance prod --database app --sql "SELECT * FROM users"
huayi-db --database-config db.yaml export-schema --instance prod --database app --output schema.json
huayi-db --database-config db.yaml export-data --instance prod --database app --table users --limit 100 --output users.json
```

### Legacy flags (Claude-style)

```bash
huayi-db --config db.yaml --list-databases
huayi-db --config db.yaml --db prod --list-schemas
huayi-db --config db.yaml --db prod --list-tables --database app
huayi-db --config db.yaml --db prod --describe users
huayi-db --config db.yaml --db prod --sample users --limit 5
huayi-db --config db.yaml --db prod --query "SELECT * FROM users"
huayi-db --config db.yaml --db prod --export-schema schema.json
huayi-db --config db.yaml --db prod --export-data users --output users.json
```

安装位置：
- 全局：`~/.copilot/skills/huayi-dev/`
- 项目级：`<project>/.copilot/skills/huayi-dev/`

---

## 依赖安装

```bash
pip install pyyaml pymysql
```

Python 3.8+ 必需（推荐 3.10+）。

---

## 常见问题

### Q: 安装后找不到 skill?

确保 skill 文件安装到了正确的位置:
- Claude 全局: `~/.claude/commands/huayi-dev.md`
- Claude 项目级: `<project>/.claude/commands/huayi-dev.md`
- Codex 全局: `~/.codex/skills/huayi-dev/SKILL.md`
- Codex 项目级: `<project>/.codex/skills/huayi-dev/SKILL.md`
- Copilot 全局: `~/.copilot/skills/huayi-dev/skill.md`
- Copilot 项目级: `<project>/.copilot/skills/huayi-dev/skill.md`

### Q: 提示缺少依赖?

运行以下命令安装依赖:

```bash
pip install pyyaml pymysql
```

### Q: 如何安全地存储数据库密码?

推荐使用环境变量: 在配置文件中使用 `${ENV_VAR_NAME}` 语法，并在 shell 中设置对应环境变量，或使用 direnv 等工具管理环境变量。
