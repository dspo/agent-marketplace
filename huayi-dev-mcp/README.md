# Huayi Dev MCP Server

华艺项目数据库开发助手 MCP Server - 为 AI 编码助手提供安全的 MySQL 数据库访问能力。

> 安装和配置说明请参考 [主 README](../README.md)。

## 功能特性

- **只读访问**: 仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN 查询
- **自动限制**: 默认 LIMIT 10，防止数据过载
- **密码保护**: 支持环境变量替换，密码显示时自动掩码
- **SQL 注入防护**: 参数化查询、标识符转义、多语句阻止

## 配置

### 环境变量

- `HUAYI_DEV_MCP_CONFIG` - 数据库配置文件路径（可选，默认 `config/config.yaml`）
- 数据库密码变量如 `DB_PROD_PASSWORD`（在配置文件中通过 `${VAR}` 引用）

### 数据库配置文件格式

```yaml
databases:
  production:
    description: 生产数据库
    driver: mysql
    host: "db.example.com"
    port: 3306
    username: readonly_user
    password: ${DB_PROD_PASSWORD}
    database: app_db

  development:
    description: 开发数据库
    driver: mysql
    host: "localhost"
    port: 3306
    username: dev_user
    password: ${DB_DEV_PASSWORD}
    database: app_dev
```

---

## MCP 工具详细说明

### list_instances

列出所有配置的数据库实例。

**参数**: 无

**返回**: 实例列表，包含名称、描述、主机、端口等信息（密码已掩码）

---

### list_schemas

列出数据库实例中的所有 schema。

**参数**:
| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `instance` | string | 是 | - | 数据库实例名称 |
| `include_system` | bool | 否 | false | 是否包含系统 schema |

---

### list_tables

列出数据库中的所有表。

**参数**:
| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `instance` | string | 是 | - | 数据库实例名称 |
| `database` | string | 是 | - | 数据库名称 |
| `table_type` | string | 否 | "all" | 表类型过滤（all/base/view） |
| `like` | string | 否 | - | SQL LIKE 模式过滤表名 |

---

### describe_table

获取表的详细结构信息。

**参数**:
| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `instance` | string | 是 | - | 数据库实例名称 |
| `database` | string | 是 | - | 数据库名称 |
| `table` | string | 是 | - | 表名 |
| `include_indexes` | bool | 否 | true | 是否包含索引信息 |

**返回**: 列定义、数据类型、约束、索引等信息

---

### sample_data

获取表的示例数据。

**参数**:
| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `instance` | string | 是 | - | 数据库实例名称 |
| `database` | string | 是 | - | 数据库名称 |
| `table` | string | 是 | - | 表名 |
| `columns` | string | 否 | - | 要查询的列（逗号分隔） |
| `where` | string | 否 | - | WHERE 条件（不含 WHERE 关键字） |
| `order_by` | string | 否 | - | 排序字段（不含 ORDER BY 关键字） |
| `limit` | int | 否 | 10 | 返回行数限制（最大 100） |
| `offset` | int | 否 | 0 | 跳过的行数 |

---

### query

执行只读 SQL 查询。

**参数**:
| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `instance` | string | 是 | - | 数据库实例名称 |
| `sql` | string | 是 | - | SQL 查询语句 |
| `database` | string | 否 | - | 数据库名称（覆盖实例默认值） |
| `limit` | int | 否 | 10 | 结果行数限制 |

**安全限制**:
- 仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN
- 自动添加 LIMIT 防止数据过载
- 禁止 INSERT/UPDATE/DELETE/DROP 等操作

---

### export_schema

导出数据库的完整 schema 结构。

**参数**:
| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `instance` | string | 是 | - | 数据库实例名称 |
| `database` | string | 是 | - | 数据库名称 |
| `include_indexes` | bool | 否 | true | 是否包含索引信息 |

**返回**: 所有表的结构定义，适合用于文档生成或数据模型分析

---

### export_data

导出表数据。

**参数**:
| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `instance` | string | 是 | - | 数据库实例名称 |
| `database` | string | 是 | - | 数据库名称 |
| `table` | string | 是 | - | 表名 |
| `columns` | string | 否 | - | 要导出的列 |
| `where` | string | 否 | - | 过滤条件 |
| `order_by` | string | 否 | - | 排序 |
| `limit` | int | 否 | 100 | 行数限制（最大 1000） |
| `offset` | int | 否 | 0 | 偏移量 |

---

## 依赖

```bash
pip install mcp pyyaml pymysql
```

Python 3.10+ 必需。
