---
description: 数据库开发助手 - 安全连接 MySQL 数据库，查询表结构、获取示例数据、执行只读查询
---

## 脚本位置

```
${CODEX_PLUGIN_ROOT}/skills/database-access/scripts/da.py
${CODEX_PLUGIN_ROOT}/skills/database-access/scripts/requirements.txt
```

## 环境检查与自动安装

在执行任何数据库操作前，**必须**按以下顺序检查环境。

### 1. 检查 Python

```bash
which python3 && python3 --version
```

如果 python3 不存在，告知用户需要安装 Python 3.8+。

### 2. 检查并自动安装依赖

```bash
python3 -c "import yaml; import pymysql; print('deps OK')" 2>/dev/null
```

如果输出不是 `deps OK`，自动安装：

```bash
pip install -r "${CODEX_PLUGIN_ROOT}/skills/database-access/scripts/requirements.txt"
```

安装后再次验证：

```bash
python3 -c "import yaml; import pymysql; print('deps OK')"
```

如果仍然失败，告知用户手动执行 `pip install pyyaml pymysql`。

## 工具脚本用法

```bash
DA="${CODEX_PLUGIN_ROOT}/skills/database-access/scripts/da.py"

# 列出配置的所有数据库
python3 $DA --config <config.yaml> --list-databases

# 列出数据库实例中的所有 schemas
python3 $DA --config <config.yaml> --db <alias> --list-schemas

# 列出所有表
python3 $DA --config <config.yaml> --db <alias> --list-tables

# 查看表结构
python3 $DA --config <config.yaml> --db <alias> --describe <table>

# 获取示例数据
python3 $DA --config <config.yaml> --db <alias> --sample <table> --limit 10

# 执行 SELECT 查询
python3 $DA --config <config.yaml> --db <alias> --query "SELECT * FROM table WHERE id=1"

# 导出表结构到 JSON
python3 $DA --config <config.yaml> --db <alias> --export-schema schema.json

# JSON 格式输出
python3 $DA --config <config.yaml> --db <alias> --list-tables --json
```

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

## 安全约束

1. **仅允许 SELECT 操作**：禁止 INSERT/UPDATE/DELETE/DROP 等操作
2. **分页限制**：查询数据时默认 LIMIT 10，避免返回过多数据
3. **密码保护**：密码通过环境变量传递，不在配置文件中明文存储

## Your Task

当用户调用此 skill 时，**必须按以下顺序执行**：

1. 执行环境检查（Python + 依赖），缺失依赖时自动安装
2. 确认数据库配置文件路径（用户指定或搜索当前项目中的 `config/config.yaml`、`db.yaml` 等）
3. 使用脚本列出可用的数据库连接
4. 等待用户进一步指示
5. 当用户询问业务实现或 SQL 优化时，主动查询相关表结构和示例数据
