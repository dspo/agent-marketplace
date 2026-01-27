---
allowed-tools: Bash(python3:*), Bash(pip:*), Bash(which:*), Read, Glob, Grep
description: 花易项目数据库开发助手 - 连接数据库、查询表结构、获取示例数据
---

## 参数

- `--database-config <path>`: 数据库配置文件路径 (YAML 格式)
- `--help`: 显示帮助信息

## 脚本和依赖位置

本 skill 可能安装在以下两个位置之一：

| 安装方式 | 脚本路径 | requirements.txt 路径 |
|---------|---------|----------------------|
| 全局安装 | `~/.claude/scripts/huayi_db.py` | `~/.claude/scripts/requirements.txt` |
| 项目安装 | `.claude/scripts/huayi_db.py` | `.claude/scripts/requirements.txt` |

**重要**：执行脚本前必须先确定正确的路径。

## 环境检查流程

在执行任何数据库操作前，必须按以下顺序检查环境：

### 1. 确定脚本位置

按优先级检查脚本是否存在：
1. 先检查项目目录：`.claude/scripts/huayi_db.py`
2. 再检查全局目录：`~/.claude/scripts/huayi_db.py`

使用找到的第一个路径作为 `SCRIPT_PATH`，对应的 requirements.txt 在同目录下。

```bash
# 检查项目目录
if [ -f ".claude/scripts/huayi_db.py" ]; then
    SCRIPT_PATH=".claude/scripts/huayi_db.py"
    REQUIREMENTS_PATH=".claude/scripts/requirements.txt"
# 检查全局目录
elif [ -f "$HOME/.claude/scripts/huayi_db.py" ]; then
    SCRIPT_PATH="$HOME/.claude/scripts/huayi_db.py"
    REQUIREMENTS_PATH="$HOME/.claude/scripts/requirements.txt"
fi
```

### 2. 获取 Python 环境信息

```bash
# 获取 Python 路径和版本
which python3
python3 --version

# 获取 pip 路径
which pip3 || which pip
```

### 3. 检查依赖是否已安装

```bash
# 检查 pyyaml
python3 -c "import yaml; print('pyyaml:', yaml.__version__)" 2>/dev/null || echo "pyyaml: NOT INSTALLED"

# 检查 pymysql
python3 -c "import pymysql; print('pymysql:', pymysql.__version__)" 2>/dev/null || echo "pymysql: NOT INSTALLED"
```

### 4. 安装缺失的依赖

如果依赖未安装，使用对应位置的 requirements.txt：

```bash
# 使用之前确定的 REQUIREMENTS_PATH
pip install -r "$REQUIREMENTS_PATH"

# 或者直接安装
pip install pyyaml pymysql
```

## 工具脚本用法

**注意**：以下示例使用 `$SCRIPT_PATH` 表示实际脚本路径，执行时需替换为实际路径。

```bash
# 列出配置的所有数据库
python3 $SCRIPT_PATH --config <config.yaml> --list-databases

# 列出数据库实例中的所有 schemas
python3 $SCRIPT_PATH --config <config.yaml> --db <alias> --list-schemas

# 列出所有表
python3 $SCRIPT_PATH --config <config.yaml> --db <alias> --list-tables

# 查看表结构
python3 $SCRIPT_PATH --config <config.yaml> --db <alias> --describe <table>

# 获取示例数据
python3 $SCRIPT_PATH --config <config.yaml> --db <alias> --sample <table> --limit 10

# 执行 SELECT 查询
python3 $SCRIPT_PATH --config <config.yaml> --db <alias> --query "SELECT * FROM table WHERE id=1"

# 导出表结构到 JSON
python3 $SCRIPT_PATH --config <config.yaml> --db <alias> --export-schema schema.json

# JSON 格式输出
python3 $SCRIPT_PATH --config <config.yaml> --db <alias> --list-tables --json
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

## 使用场景

1. **了解数据模型**：当需要理解业务数据结构时，查询表结构
2. **查询示例数据**：获取真实数据样本以理解数据格式
3. **业务实现建议**：基于数据库模型给出实现建议
4. **SQL 优化**：分析表结构和索引，给出查询优化建议

## 帮助信息

```
huayi-dev - 花易项目数据库开发助手

用法:
  /huayi-dev --database-config <config.yaml>  指定数据库配置文件
  /huayi-dev --help                           显示此帮助信息

功能:
  - 读取数据库配置文件
  - 连接 MySQL 数据库
  - 列出所有 schemas/databases
  - 查看表结构和索引
  - 查询示例数据 (默认 LIMIT 10)
  - 执行自定义 SELECT 查询
  - 导出表结构到本地文件

配置文件格式:
  databases:
    <alias>:
      description: 数据库描述
      driver: mysql
      host: "hostname"
      port: 3306
      username: user
      password: ${ENV_VAR}
      database: db_name

安全限制:
  - 仅允许 SELECT 查询
  - 默认分页 LIMIT 10
  - 密码通过环境变量传递
```

## Your Task

当用户调用此 skill 时，**必须按以下顺序执行**：

### 步骤 1：确定脚本路径

首先检查脚本安装位置，确定 `SCRIPT_PATH` 和 `REQUIREMENTS_PATH`：

```bash
# 检查项目目录是否有脚本
ls -la .claude/scripts/huayi_db.py 2>/dev/null

# 检查全局目录是否有脚本
ls -la ~/.claude/scripts/huayi_db.py 2>/dev/null
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

- **如果指定 `--help`**：输出帮助信息
- **如果指定 `--database-config`**：
  - 使用确定的 `SCRIPT_PATH` 执行脚本
  - 读取配置文件并列出可用的数据库连接
  - 等待用户进一步指示

### 步骤 6：后续数据库操作

- 当用户询问业务实现或 SQL 优化时，主动使用工具脚本查询相关表结构
- 获取示例数据以理解数据格式
- 基于实际数据模型给出建议
- 始终遵守安全约束，仅执行 SELECT 查询
- 查询时注意使用 LIMIT 避免返回过多数据

### 导出功能

- 可以将表结构导出到本地 JSON 文件
- 可以将示例数据导出供分析
