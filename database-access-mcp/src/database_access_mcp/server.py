"""MCP Server for database development assistant."""

import asyncio

from mcp.server.fastmcp import FastMCP

from . import db_helper

mcp = FastMCP(
    "database-access-mcp",
    instructions="""数据库开发助手 MCP Server - 提供安全的 MySQL 数据库只读访问能力。

使用场景：
- 找库、找表
- 查看数据库结构和表定义
- 获取示例数据了解数据格式
- 执行只读 SQL 查询分析数据
- 导出 schema 用于文档或数据建模

安全特性：
- 仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN 查询
- 自动添加 LIMIT 防止数据过载
- 禁止任何写入或 DDL 操作

典型工作流：
1. 如果没有配置文件，使用 get_config_help 获取配置帮助
2. 使用 list_instances 查看可用数据库连接
3. 使用 list_schemas 或 list_tables 浏览数据库结构
4. 使用 describe_table 查看表的列定义和索引
5. 使用 sample_data 或 query 获取数据
""",
)


@mcp.tool()
async def list_instances() -> list[dict]:
    """列出所有配置的数据库实例。

    返回每个实例的名称、描述、主机、端口等信息（密码已掩码）。
    当需要了解可用的数据库连接时使用此工具。
    """
    return await asyncio.to_thread(db_helper.list_instances)


@mcp.tool()
async def list_schemas(
    instance: str,
    include_system: bool = False,
) -> list[dict]:
    """列出数据库实例中的所有 schema。

    Args:
        instance: 数据库实例名称（从 list_instances 获取）
        include_system: 是否包含系统 schema（mysql, information_schema 等）
    """
    return await asyncio.to_thread(db_helper.list_schemas, instance, include_system)


@mcp.tool()
async def list_tables(
    instance: str,
    database: str,
    table_type: str = "all",
    like: str | None = None,
) -> list[dict]:
    """列出数据库中的所有表。

    Args:
        instance: 数据库实例名称
        database: 数据库/schema 名称
        table_type: 表类型过滤（all/base/view）
        like: SQL LIKE 模式过滤表名
    """
    return await asyncio.to_thread(
        db_helper.list_tables, instance, database, table_type, like
    )


@mcp.tool()
async def describe_table(
    instance: str,
    database: str,
    table: str,
    include_indexes: bool = True,
) -> dict:
    """获取表的详细结构信息。

    Args:
        instance: 数据库实例名称
        database: 数据库名称
        table: 表名
        include_indexes: 是否包含索引信息

    返回列定义、数据类型、约束、索引等信息。
    """
    return await asyncio.to_thread(
        db_helper.describe_table, instance, database, table, include_indexes
    )


@mcp.tool()
async def sample_data(
    instance: str,
    database: str,
    table: str,
    columns: str | None = None,
    where: str | None = None,
    order_by: str | None = None,
    limit: int = 10,
    offset: int = 0,
) -> list[dict]:
    """获取表的示例数据。

    Args:
        instance: 数据库实例名称
        database: 数据库名称
        table: 表名
        columns: 要查询的列（逗号分隔），默认全部
        where: WHERE 条件（不含 WHERE 关键字）
        order_by: 排序字段（不含 ORDER BY 关键字）
        limit: 返回行数限制（默认 10，最大 100）
        offset: 跳过的行数
    """
    return await asyncio.to_thread(
        db_helper.sample_data,
        instance,
        database,
        table,
        columns,
        where,
        order_by,
        limit,
        offset,
    )


@mcp.tool()
async def query(
    instance: str,
    sql: str,
    database: str | None = None,
    limit: int = 10,
) -> list[dict] | dict:
    """执行只读 SQL 查询。

    Args:
        instance: 数据库实例名称
        sql: SQL 查询语句（仅允许 SELECT/SHOW/DESCRIBE/EXPLAIN）
        database: 数据库名称（可选，覆盖实例默认值）
        limit: 结果行数限制（默认 10）

    安全限制：
    - 仅允许只读查询
    - 自动添加 LIMIT 防止数据过载
    - 禁止 INSERT/UPDATE/DELETE/DROP 等操作
    """
    return await asyncio.to_thread(
        db_helper.execute_query, instance, sql, database, limit
    )


@mcp.tool()
async def export_schema(
    instance: str,
    database: str,
    include_indexes: bool = True,
) -> dict:
    """导出数据库的完整 schema 结构。

    Args:
        instance: 数据库实例名称
        database: 数据库名称
        include_indexes: 是否包含索引信息

    返回所有表的结构定义，适合用于文档生成或数据模型分析。
    """
    return await asyncio.to_thread(
        db_helper.export_schema, instance, database, include_indexes
    )


@mcp.tool()
async def export_data(
    instance: str,
    database: str,
    table: str,
    columns: str | None = None,
    where: str | None = None,
    order_by: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    """导出表数据。

    Args:
        instance: 数据库实例名称
        database: 数据库名称
        table: 表名
        columns: 要导出的列
        where: 过滤条件
        order_by: 排序
        limit: 行数限制（默认 100，最大 1000）
        offset: 偏移量
    """
    return await asyncio.to_thread(
        db_helper.export_data,
        instance,
        database,
        table,
        columns,
        where,
        order_by,
        limit,
        offset,
    )


@mcp.tool()
async def get_config_help() -> dict:
    """获取配置文件帮助信息。

    当用户不知道如何配置数据库连接时使用此工具。
    返回配置文件的 JSON Schema 和 YAML 示例。
    """
    return {
        "config_path": {
            "description": "配置文件路径",
            "default": "config/config.yaml（当前工作目录下）",
            "env_var": "DATABASE_ACCESS_MCP_CONFIG",
        },
        "schema": {
            "type": "object",
            "required": ["databases"],
            "properties": {
                "databases": {
                    "type": "object",
                    "description": "数据库实例映射，key 为实例别名",
                    "additionalProperties": {
                        "type": "object",
                        "required": ["driver", "host", "username", "password"],
                        "properties": {
                            "description": {
                                "type": "string",
                                "description": "实例描述（可选）",
                            },
                            "driver": {
                                "type": "string",
                                "enum": ["mysql"],
                                "description": "数据库驱动，目前仅支持 mysql",
                            },
                            "host": {
                                "type": "string",
                                "description": "数据库主机地址",
                            },
                            "port": {
                                "type": "integer",
                                "default": 3306,
                                "description": "数据库端口",
                            },
                            "username": {
                                "type": "string",
                                "description": "数据库用户名",
                            },
                            "password": {
                                "type": "string",
                                "description": "数据库密码，支持 ${ENV_VAR} 格式引用环境变量",
                            },
                            "database": {
                                "type": "string",
                                "description": "默认数据库名（可选）",
                            },
                        },
                    },
                },
            },
        },
        "example": """# 数据库配置文件示例
# 保存为 config/config.yaml 或通过 DATABASE_ACCESS_MCP_CONFIG 环境变量指定路径

databases:
  # 生产环境数据库
  production:
    description: 生产环境数据库（只读）
    driver: mysql
    host: "db.example.com"
    port: 3306
    username: readonly_user
    # 使用环境变量避免明文密码
    password: ${DB_PROD_PASSWORD}
    database: myapp

  # 开发环境数据库
  development:
    description: 本地开发数据库
    driver: mysql
    host: "localhost"
    port: 3306
    username: dev_user
    password: ${DB_DEV_PASSWORD}
    database: myapp_dev

  # 也可以直接写密码（不推荐）
  test:
    driver: mysql
    host: "test-db.example.com"
    port: 3306
    username: test_user
    password: "plain_text_password"
""",
        "env_vars_hint": "如果配置中使用了 ${VAR} 格式的环境变量，请确保在启动 Agent 前设置这些变量",
    }


async def run_server():
    """Run the MCP server."""
    await mcp.run_stdio_async()


def main():
    """Entry point for the MCP server."""
    asyncio.run(run_server())


if __name__ == "__main__":
    main()
