# huayi-dev-agent-skills

花易项目 AI 编码助手数据库开发工具，为 Claude Code、OpenAI Codex CLI 和 GitHub Copilot CLI 提供安全的 MySQL 数据库只读访问能力。

## 功能特性

- **只读访问**: 仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN 查询
- **自动限制**: 默认 LIMIT 10，防止数据过载
- **密码保护**: 支持环境变量替换，密码显示时自动掩码
- **SQL 注入防护**: 参数化查询、标识符转义、多语句阻止

## 安装方式

**推荐使用 MCP 方式安装**，提供更好的工具集成体验。

本仓库提供 MCP 和 Skills 两种方式来集成访问花易开发环境数据库的能力，但优先推荐使用 MCP。
为什么优先推荐使用 MCP？因为 MCP 更加标准和通用，几乎所有 Agent 都支持 MCP，无需额外配置。
除了 Claude Code、OpenAI Codex CLI 和 GitHub Copilot CLI，主流的编辑器、IDE 如 VS Code、JetBrains 家族、Trae、Zed 等都能轻易接入。
而不同的 Agent 对 Skills 的支持方式和支持程度不同，就本仓库而言，已对接且必须分别对接 Claude Code、OpenAI Codex CLI 和 GitHub Copilot CLI，维护了多份功能几乎一模一样的代码。
如果要对接更多 Agent，则还要维护更多代码。

### 1. 安装 MCP Server

```bash
pip install -e database-access-mcp
```

### 2. 为 Agent 配置 MCP

#### Claude Code

参见
[Claude Code install MCP](https://code.claude.com/docs/zh-CN/mcp)

```bash
# 使用 CLI 添加（推荐）
claude mcp add --transport stdio database-access -- python -m database_access_mcp

# 或指定 Python 路径
claude mcp add --transport stdio database-access -- /path/to/python -m database_access_mcp
```

#### OpenAI Codex CLI

参见
[Codex install MCP](https://developers.openai.com/codex/mcp)

```bash
# 使用 CLI 添加
codex mcp add database-access -- python -m database_access_mcp

# 或指定 Python 路径
codex mcp add database-access -- ~/python-3.13/bin/python -m database_access_mcp
```

#### GitHub Copilot CLI

参见
[install-copilot-cli](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-copilot-cli.md)

### 2. 准备数据库配置文件

在安装时不必准备好配置文件，但在使用 MCP 能力时需要提供配置文件以让 MCP 知道如何访问数据库。
默认配置文件路径为运行 Agent 的当前工作目录下的 `config/config.yaml`，也可通过环境变量 `DATABASE_ACCESS_MCP_CONFIG` 指定其他路径。

```yaml
databases:
  production:
    description: 生产环境数据库
    driver: mysql
    host: "db.example.com"
    port: 3306
    username: readonly_user
    # 支持在配置文件中引用环境变量, 启动 Claude/Codex/Copilot 时提供即可, 避免明文配置密码
    password: ${DB_PROD_PASSWORD}
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

### 4. 设置环境变量

如果配置文件中引用了环境变量，应当在启动 Agent(Claude, Codex, Copilot 等)时传递：

```bash
export DB_PROD_PASSWORD="your_password"
export DB_DEV_PASSWORD="your_dev_password"
```
---

## MCP 工具列表

| 工具 | 说明 |
|------|------|
| `list_instances` | 列出所有配置的数据库实例 |
| `list_schemas` | 列出数据库实例中的所有 schema |
| `list_tables` | 列出数据库中的所有表 |
| `describe_table` | 获取表的详细结构信息 |
| `sample_data` | 获取表的示例数据 |
| `query` | 执行只读 SQL 查询 |
| `export_schema` | 导出数据库的完整 schema 结构 |
| `export_data` | 导出表数据 |

详细参数说明请参考 [database-access-mcp/README.md](database-access-mcp/README.md)。

---

## 其他安装方式

除了 `python -m database_access_mcp`，还支持：

- **database-access-mcp 命令**: `pip install -e .` 后直接使用 `database-access-mcp`
- **uvx**: 先安装到 uv 环境，然后使用 uvx 运行
```bash
uv pip install -e database-access-mcp
claude mcp add --transport stdio database-access -- uvx database-access-mcp
```
- **直接脚本**: `python /path/to/database-access-mcp/src/database_access_mcp/server.py`

---

## Skills 安装

如果你的环境不支持 MCP，可以使用传统的 Skills 方式安装。

详细说明请参考 [doc/skills-installation.md](doc/skills-installation.md)。

---

## 依赖

```bash
pip install mcp pyyaml pymysql
```

Python 3.10+ 必需。

---
