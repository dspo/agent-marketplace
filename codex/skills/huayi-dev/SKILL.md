---
name: huayi-dev
description: 花易项目数据库开发助手 - 连接数据库、查询表结构、获取示例数据。支持环境检查、依赖安装、多种安装位置自动检测。
---

# Huayi Dev

花易项目数据库开发助手，用于连接 MySQL 数据库、查询表结构、获取示例数据。

## Overview

Use this skill to discover Huayi database models and sample data from configured MySQL instances. Prefer it whenever a business flow or SQL decision depends on actual tables, columns, or example rows.

## 脚本和依赖位置

本 skill 可能安装在以下两个位置之一：

| 安装方式 | 脚本路径 | requirements.txt 路径 |
|---------|---------|----------------------|
| 全局安装 | `~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py` | `~/.codex/skills/huayi-dev/scripts/requirements.txt` |
| 项目安装 | `.codex/skills/huayi-dev/scripts/huayi_db_tool.py` | `.codex/skills/huayi-dev/scripts/requirements.txt` |

**重要**：执行脚本前必须先确定正确的路径。

## 环境检查流程

在执行任何数据库操作前，**必须按以下顺序检查环境**：

### Step 1: 确定脚本位置

按优先级检查脚本是否存在：
1. 先检查项目目录：`.codex/skills/huayi-dev/scripts/huayi_db_tool.py`
2. 再检查全局目录：`~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py`

```bash
# 检查项目目录
ls -la .codex/skills/huayi-dev/scripts/huayi_db_tool.py 2>/dev/null

# 检查全局目录
ls -la ~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py 2>/dev/null
```

使用找到的第一个路径作为 `SCRIPT_PATH`，对应的 requirements.txt 在同目录下。

### Step 2: 获取 Python 环境信息

```bash
# 获取 Python 路径和版本
which python3
python3 --version

# 获取 pip 路径
which pip3 || which pip
```

### Step 3: 检查依赖是否已安装

```bash
# 检查 pyyaml
python3 -c "import yaml; print('pyyaml:', yaml.__version__)" 2>/dev/null || echo "pyyaml: NOT INSTALLED"

# 检查 pymysql
python3 -c "import pymysql; print('pymysql:', pymysql.__version__)" 2>/dev/null || echo "pymysql: NOT INSTALLED"
```

### Step 4: 安装缺失的依赖

如果依赖未安装，使用对应位置的 requirements.txt：

```bash
# 使用之前确定的 REQUIREMENTS_PATH
pip install -r "$REQUIREMENTS_PATH"

# 或者直接安装
pip install pyyaml pymysql
```

## Quick Start

确定脚本路径后（以下用 `$SCRIPT_PATH` 表示），执行以下命令：

```bash
# 列出配置的所有数据库实例
python3 $SCRIPT_PATH list-instances --database-config /path/to/db.yaml

# 列出数据库实例中的所有 schemas
python3 $SCRIPT_PATH list-schemas --database-config /path/to/db.yaml --instance haoxiangmei

# 列出所有表
python3 $SCRIPT_PATH list-tables --database-config /path/to/db.yaml --instance haoxiangmei --database huayi_haoxiangmei

# 查看表结构
python3 $SCRIPT_PATH describe-table --database-config /path/to/db.yaml --instance haoxiangmei --database huayi_haoxiangmei --table inventory

# 获取示例数据
python3 $SCRIPT_PATH sample-data --database-config /path/to/db.yaml --instance haoxiangmei --database huayi_haoxiangmei --table inventory --limit 20
```

## Export Commands

```bash
# 导出表结构到 JSON
python3 $SCRIPT_PATH export-schema --database-config /path/to/db.yaml --instance haoxiangmei --database huayi_haoxiangmei --output /tmp/haoxiangmei-schema.json

# 导出数据到 JSON
python3 $SCRIPT_PATH export-data --database-config /path/to/db.yaml --instance haoxiangmei --database huayi_haoxiangmei --table inventory --limit 100 --output /tmp/inventory-sample.json
```

## Tasks

### Read config

- Use `--database-config` on every command.
- Read `references/db-config.md` for the YAML format and environment variable substitution rules.
- Verify required environment variables (for `${VAR_NAME}` passwords) before connecting.

### Connect and list schemas

- Run `list-schemas` for a single instance or omit `--instance` to scan all configured instances.
- Use `--include-system` only when system schemas are relevant.

### Inspect tables and columns

- Run `list-tables` to discover tables in a schema.
- Run `describe-table` to retrieve columns and indexes.

### Sample data

- Run `sample-data` with `--limit`/`--offset` (default limit is 10).
- Use `--where` and `--order-by` to narrow results; avoid wide scans unless requested.

### Custom SQL

- Run `query` for read-only SQL.
- 仅允许 SELECT 查询，禁止写操作和 DDL 操作。
- 默认自动添加 LIMIT 10，使用 `--no-limit` 可禁用。

### Export schema or data

- Use `export-schema` to capture the table model locally (JSON).
- Use `export-data` to export limited samples in JSON/JSONL/CSV.

## Safety Rules

- **仅允许 SELECT 操作**：禁止 INSERT/UPDATE/DELETE/DROP 等操作
- **分页限制**：查询数据时默认 LIMIT 10，避免返回过多数据
- **密码保护**：密码通过环境变量传递，不在配置文件中明文存储
- Avoid multi-statement SQL in `query`.

## 数据库配置文件格式

```yaml
databases:
  <database_alias>:
    description: 数据库描述
    driver: mysql
    host: "hostname"
    port: 3306
    username: user
    password: ${ENV_VAR_NAME}  # 支持环境变量
    database: database_name
```

## Answering Business or Query Questions

- Inspect schemas/tables before proposing business logic or SQL changes.
- Show table structure and sample rows to justify design or optimization advice.
- Confirm which instance/database is in scope when multiple instances exist.

## Your Task

当用户调用此 skill 时，**必须按以下顺序执行**：

### 步骤 1：确定脚本路径

首先检查脚本安装位置，确定 `SCRIPT_PATH` 和 `REQUIREMENTS_PATH`：

```bash
# 检查项目目录是否有脚本
ls -la .codex/skills/huayi-dev/scripts/huayi_db_tool.py 2>/dev/null

# 检查全局目录是否有脚本
ls -la ~/.codex/skills/huayi-dev/scripts/huayi_db_tool.py 2>/dev/null
```

- 如果项目目录存在，使用项目目录路径
- 否则使用全局目录路径
- 如果都不存在，提示用户先安装 skill

### 步骤 2：检查 Python 环境

```bash
which python3 && python3 --version
```

### 步骤 3：检查依赖状态

```bash
python3 -c "import yaml; print('pyyaml OK')" 2>/dev/null || echo "pyyaml MISSING"
python3 -c "import pymysql; print('pymysql OK')" 2>/dev/null || echo "pymysql MISSING"
```

### 步骤 4：处理缺失依赖

如果有依赖缺失：
1. 告知用户哪些依赖缺失
2. 询问用户是否要安装
3. 如果用户同意，使用正确路径的 requirements.txt 安装：
   ```bash
   pip install -r $REQUIREMENTS_PATH
   ```

### 步骤 5：执行用户请求

- 使用确定的 `SCRIPT_PATH` 执行脚本
- 读取配置文件并列出可用的数据库连接
- 等待用户进一步指示

### 步骤 6：后续数据库操作

- 当用户询问业务实现或 SQL 优化时，主动使用工具脚本查询相关表结构
- 获取示例数据以理解数据格式
- 基于实际数据模型给出建议
- 始终遵守安全约束
- 查询时注意使用 LIMIT 避免返回过多数据

## Resources

- Script: `skills/huayi-dev/scripts/huayi_db_tool.py`
- Requirements: `skills/huayi-dev/scripts/requirements.txt`
- Reference: `skills/huayi-dev/references/db-config.md`
