# huayi-dev-agent-skills

华艺项目 AI 编码助手数据库开发工具，为 Claude Code、OpenAI Codex CLI 和 GitHub Copilot CLI 提供安全的 MySQL 数据库只读访问能力。

## 功能特性

- **只读访问**: 仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN 查询
- **自动限制**: 默认 LIMIT 10，防止数据过载
- **密码保护**: 支持环境变量替换，密码显示时自动掩码
- **SQL 注入防护**: 参数化查询、标识符转义、多语句阻止

## 安装方式

**推荐使用 MCP 方式安装**，提供更好的工具集成体验。

### 1. 安装 MCP Server

```bash
cd huayi-dev-mcp
pip install -e .
```

### 2. 准备数据库配置文件

默认配置文件路径为当前工作目录下的 `config/config.yaml`，也可通过环境变量 `HUAYI_DEV_MCP_CONFIG` 指定其他路径。

```yaml
databases:
  production:
    description: 生产环境数据库
    driver: mysql
    host: "db.example.com"
    port: 3306
    username: readonly_user
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

### 3. 为 AI 编码助手配置 MCP

#### Claude Code

```bash
# 使用 CLI 添加（推荐）
claude mcp add huayi-db -- python -m huayi_dev_mcp

# 或指定 Python 路径
claude mcp add huayi-db -- /path/to/python -m huayi_dev_mcp
```

或编辑 `~/.claude/settings.json`：

```json
{
  "mcpServers": {
    "huayi-db": {
      "command": "python",
      "args": ["-m", "huayi_dev_mcp"]
    }
  }
}
```

#### OpenAI Codex CLI

```bash
# 使用 CLI 添加
codex mcp add huayi-db -- python -m huayi_dev_mcp

# 或指定 Python 路径
codex mcp add huayi-db -- ~/python-3.13/bin/python -m huayi_dev_mcp
```

或编辑 `~/.codex/config.yaml`：

```yaml
mcp_servers:
  huayi-db:
    command: python
    args:
      - "-m"
      - "huayi_dev_mcp"
```

#### GitHub Copilot CLI

编辑 `~/.config/github-copilot/mcp.json`：

```json
{
  "mcpServers": {
    "huayi-db": {
      "command": "python",
      "args": ["-m", "huayi_dev_mcp"]
    }
  }
}
```

### 4. 设置环境变量

数据库密码通过环境变量传递：

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

详细参数说明请参考 [huayi-dev-mcp/README.md](huayi-dev-mcp/README.md)。

---

## 其他安装方式

除了 `python -m huayi_dev_mcp`，还支持：

- **huayi-dev-mcp 命令**: `pip install -e .` 后直接使用 `huayi-dev-mcp`
- **uvx**: `uvx --from /path/to/huayi-dev-mcp huayi-dev-mcp`
- **直接脚本**: `python /path/to/huayi-dev-mcp/src/huayi_dev_mcp/server.py`

---

## Skills 安装（传统方式）

如果你的环境不支持 MCP，可以使用传统的 Skills 方式安装。

详细说明请参考 [doc/skills-installation.md](doc/skills-installation.md)。

---

## 依赖

```bash
pip install mcp pyyaml pymysql
```

Python 3.10+ 必需。

---

## License

MIT
