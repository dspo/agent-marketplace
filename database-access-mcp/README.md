# Database Access MCP Server

MCP Server providing secure read-only MySQL database access for AI coding assistants.

为 Claude Code 及其他支持 MCP 的客户端提供安全的 MySQL 数据库只读访问能力。

## Features

- **Read-only access**: Only SELECT/SHOW/DESCRIBE/EXPLAIN queries allowed
- **Auto limit**: Default LIMIT 10 to prevent data overload
- **Password protection**: Environment variable substitution, passwords masked in output
- **SQL injection prevention**: Parameterized queries, identifier escaping, multi-statement blocking
- **Self-documenting**: Built-in `get_config_help` tool for configuration guidance

## Installation

```bash
# From PyPI
pip install database-access-mcp

# From source
pip install -e .
```

## Quick Start

### 1. Configure MCP for your AI assistant

**Claude Code:**
```bash
claude mcp add --transport stdio database-access -- python -m database_access_mcp
```

**Other MCP clients:**

Register the same stdio command in your client-specific MCP configuration:

```bash
python -m database_access_mcp
```

### 2. Create database configuration

Create `config/config.yaml` in your working directory:

```yaml
databases:
  production:
    description: Production database (read-only)
    driver: mysql
    host: "db.example.com"
    port: 3306
    username: readonly_user
    password: ${DB_PROD_PASSWORD}
    database: myapp

  development:
    description: Local development database
    driver: mysql
    host: "localhost"
    port: 3306
    username: dev_user
    password: ${DB_DEV_PASSWORD}
    database: myapp_dev
```

### 3. Set environment variables

```bash
export DB_PROD_PASSWORD="your_password"
export DB_DEV_PASSWORD="your_dev_password"
```

Or specify a custom config path:
```bash
export DATABASE_ACCESS_MCP_CONFIG=/path/to/config.yaml
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_config_help` | Get configuration file schema and example |
| `list_instances` | List all configured database instances |
| `list_schemas` | List all schemas in a database instance |
| `list_tables` | List all tables in a database |
| `describe_table` | Get detailed table structure |
| `sample_data` | Get sample data from a table |
| `query` | Execute read-only SQL query |
| `export_schema` | Export complete database schema |
| `export_data` | Export table data |

## Tool Reference

### get_config_help

Get configuration file help. Use this when you don't know how to configure database connections.

**Parameters**: None

**Returns**: Configuration schema (JSON Schema) and YAML example

---

### list_instances

List all configured database instances.

**Parameters**: None

**Returns**: Instance list with name, description, host, port (passwords masked)

---

### list_schemas

List all schemas in a database instance.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | Yes | - | Database instance name |
| `include_system` | bool | No | false | Include system schemas |

---

### list_tables

List all tables in a database.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | Yes | - | Database instance name |
| `database` | string | Yes | - | Database name |
| `table_type` | string | No | "all" | Filter by type (all/base/view) |
| `like` | string | No | - | SQL LIKE pattern for table names |

---

### describe_table

Get detailed table structure.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | Yes | - | Database instance name |
| `database` | string | Yes | - | Database name |
| `table` | string | Yes | - | Table name |
| `include_indexes` | bool | No | true | Include index information |

---

### sample_data

Get sample data from a table.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | Yes | - | Database instance name |
| `database` | string | Yes | - | Database name |
| `table` | string | Yes | - | Table name |
| `columns` | string | No | - | Columns to query (comma-separated) |
| `where` | string | No | - | WHERE condition (without WHERE keyword) |
| `order_by` | string | No | - | ORDER BY field (without ORDER BY keyword) |
| `limit` | int | No | 10 | Row limit (max 100) |
| `offset` | int | No | 0 | Rows to skip |

---

### query

Execute read-only SQL query.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | Yes | - | Database instance name |
| `sql` | string | Yes | - | SQL query |
| `database` | string | No | - | Database name (overrides instance default) |
| `limit` | int | No | 10 | Result row limit |

**Security**:
- Only SELECT/SHOW/DESCRIBE/EXPLAIN allowed
- Auto LIMIT to prevent data overload
- INSERT/UPDATE/DELETE/DROP blocked

---

### export_schema

Export complete database schema.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | Yes | - | Database instance name |
| `database` | string | Yes | - | Database name |
| `include_indexes` | bool | No | true | Include index information |

---

### export_data

Export table data.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | Yes | - | Database instance name |
| `database` | string | Yes | - | Database name |
| `table` | string | Yes | - | Table name |
| `columns` | string | No | - | Columns to export |
| `where` | string | No | - | Filter condition |
| `order_by` | string | No | - | Sort order |
| `limit` | int | No | 100 | Row limit (max 1000) |
| `offset` | int | No | 0 | Offset |

## Alternative Installation Methods

```bash
# Direct command after pip install
database-access-mcp

# Using uvx
uvx database-access-mcp

# Run module directly
python -m database_access_mcp
```

## Requirements

- Python 3.10+
- Dependencies: mcp, pyyaml, pymysql

## License

MIT
