# huayi-dev-agent-skills

花易项目 AI 开发工具集，为 Claude Code 提供 Plugin Marketplace，同时支持 OpenAI Codex CLI 和 GitHub Copilot CLI。

## 功能特性

- **数据库访问** (database-access): 安全连接 MySQL，查询表结构、获取示例数据、执行只读查询
- **GitLab 助手** (gitlab-dev): 结合 GitLab MCP 和 glab CLI 管理项目、MR、Issue 和 CI/CD
- **Go 规范审查** (go-spec-review): 基于 Go 语言规范的代码审查，聚焦语义正确性
- **试卷生成器** (exam-generator): 基于知识库生成专业试卷，LaTeX 排版和 PDF 导出
- **浏览器自动化** (playwright-cli): 使用 playwright-cli 进行网页测试、截图和数据提取

## 安装方式

### 方式 1: Plugin Marketplace（Claude Code 推荐）

```bash
# 从本仓库安装所有 plugins
/plugin marketplace add /path/to/huayi-dev-agent-skills

# 安装单个 plugin
/plugin install database-access
/plugin install gitlab-dev
/plugin install go-spec-review
/plugin install exam-generator
/plugin install playwright-cli
```

### 方式 2: MCP Server（通用推荐）

数据库访问功能也可通过独立的 MCP Server 安装，适用于所有支持 MCP 的 Agent。

```bash
pip install -e database-access-mcp
```

#### Claude Code

```bash
claude mcp add --transport stdio database-access -- python -m database_access_mcp
```

#### OpenAI Codex CLI

```bash
codex mcp add database-access -- python -m database_access_mcp
```

#### GitHub Copilot CLI

参见 [install-copilot-cli](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-copilot-cli.md)

### 方式 3: Skills 安装（传统方式）

如果你的环境不支持 Plugin Marketplace 或 MCP，可以使用传统的 Skills 方式安装。

```bash
# Claude Code
claude/install_to_claude.sh --global

# OpenAI Codex
codex/install_to_codex.sh --global

# GitHub Copilot
copilot/install_to_copilot.sh --global
```

详细说明请参考 [doc/skills-installation.md](doc/skills-installation.md)。

---

## 数据库配置文件

```yaml
databases:
  production:
    description: 生产环境数据库
    driver: mysql
    host: "db.example.com"
    port: 3306
    username: readonly_user
    password: ${DB_PROD_PASSWORD}  # 支持环境变量替换
    database: myapp
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

## 项目结构

```
├── .claude-plugin/marketplace.json     # Plugin Marketplace 目录
├── plugins/                            # Plugin 集合
│   ├── database-access/                # 数据库访问 plugin
│   ├── gitlab-dev/                     # GitLab 助手 plugin
│   ├── go-spec-review/                 # Go 规范审查 plugin
│   ├── exam-generator/                 # 试卷生成器 plugin
│   └── playwright-cli/                 # 浏览器自动化 plugin
├── database-access-mcp/                # 独立 MCP Server
├── claude/                             # Claude Code Skills（传统方式）
├── codex/                              # OpenAI Codex Skills
└── copilot/                            # GitHub Copilot Skills
```

---

## 依赖

```bash
pip install mcp pyyaml pymysql
```

Python 3.10+ 必需。
