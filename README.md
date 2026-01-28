# huayi-dev-agent-skills

花易项目 Agent Skills 集合，提供针对 Claude Code、OpenAI Codex 与 GitHub Copilot 的数据库开发助手 Skill（huayi-dev），用于连接 MySQL、查看表结构、取样数据与安全的 SELECT 查询。

本 README 先介绍如何将 skills 安装到各平台（Claude / Codex / Copilot），接着给出数据库配置文件格式，然后分别说明在各平台或命令行下如何使用本仓库提供的 skills。

## 快速安装（概览）

下面的快速安装示例将本仓库的 skill 安装到用户主目录下的对应平台目录（全局安装）；也支持项目级安装（--local <path>）。如果脚本提供了 --deps 或类似参数，可在安装时同时安装 Python 依赖。

```bash
git clone <repo-url> huayi-dev-agent-skills
```

以下示例都是全局安装，更多安装细节（仅为指定项目仓库安装、手动安装等）请自行探索。

#### Claude Code

```bash
claude/install_to_claude.sh --global
```

#### Codex Cli

```bash
codex/install_to_codex.sh --global
```

####  Copilot

```bash
opilot/install_to_copilot.sh --global
```

---

## 数据库配置文件（立即介绍）

在使用任一平台的脚本前，你需要准备一个 YAML 格式的数据库配置文件（示例名：`config.yaml`）。配置支持通过环境变量引用密码（推荐），以避免将明文密码写入仓库。

示例：

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

设置环境变量示例：

```bash
export DB_PROD_PASSWORD="your_password"
export DB_DEV_PASSWORD="your_dev_password"
```

脚本通常接受 `--config` 等参数来指定配置文件路径。
不同的 Agent 请在使用 `huayi-dev` skill 时传入 `--help` 参数获取帮助细节。

---

## 想要了解更多?

下面分别说明在 Claude Code、OpenAI Codex 和 GitHub Copilot 环境或命令行中如何调用本仓库的 huayi-dev skill。

### Claude Code 使用方法

在 Claude Code 中可通过命令调用已安装的 skill（示例）:

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

安装位置说明：

- 全局：`~/.claude/commands/`（commands）与 `~/.claude/scripts/`（脚本）
- 项目级：`<project>/.claude/commands/` / `<project>/.claude/scripts/`


### OpenAI Codex 使用方法

Codex 风格的脚本使用子命令形式（安装到 `~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py` 后）：

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

安装位置说明：

- 全局：`~/.codex/skills/huayi-dev/`
- 项目级：`<project>/.codex/skills/huayi-dev/`


### GitHub Copilot 使用方法

Copilot CLI 风格的 skill（安装到 `~/.copilot/skills/huayi-dev/` 后）示例如下：

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

安装位置说明：

- 全局：`~/.copilot/skills/huayi-dev/`
- 项目级：`<project>/.copilot/skills/huayi-dev/`

---

## 通用注意事项与依赖

- 本仓库脚本使用 Python（>=3.8 / 3.10+ 推荐），并依赖 `pyyaml`、`pymysql` 等库。
- 安装依赖示例：

```bash
pip install pyyaml pymysql
```

- 安全限制：脚本仅允许执行 SELECT 查询以避免误操作（默认 LIMIT 10）。密码建议通过环境变量传递。

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

---

## License

MIT
