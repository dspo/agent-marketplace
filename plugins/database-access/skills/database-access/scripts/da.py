#!/usr/bin/env python3
"""
huayi-dev 数据库工具脚本
用于连接数据库、查询表结构、获取示例数据
"""

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

try:
    import yaml
except ImportError:
    print("Error: PyYAML not installed. Run: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

try:
    import pymysql
except ImportError:
    print("Error: PyMySQL not installed. Run: pip install pymysql", file=sys.stderr)
    sys.exit(1)


def load_config(config_path: str) -> Dict[str, Any]:
    """加载并解析数据库配置文件，展开环境变量"""
    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    # 展开环境变量
    for db_name, db_config in config.get("databases", {}).items():
        for key, value in list(db_config.items()):
            if (
                isinstance(value, str)
                and value.startswith("${")
                and value.endswith("}")
            ):
                env_var = value[2:-1]
                env_value = os.environ.get(env_var, "")
                if not env_value:
                    print(
                        f"Warning: Environment variable {env_var} not set",
                        file=sys.stderr,
                    )
                db_config[key] = env_value

    return config


def get_connection(db_config: Dict[str, Any]) -> pymysql.Connection:
    """创建数据库连接"""
    return pymysql.connect(
        host=db_config["host"],
        port=db_config.get("port", 3306),
        user=db_config["username"],
        password=db_config["password"],
        database=db_config.get("database"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def list_databases(config: Dict[str, Any]) -> None:
    """列出配置文件中的所有数据库"""
    print("配置的数据库连接:")
    print("-" * 60)
    for name, db_config in config.get("databases", {}).items():
        desc = db_config.get("description", "无描述")
        host = db_config.get("host", "unknown")
        database = db_config.get("database", "unknown")
        print(f"  {name}:")
        print(f"    描述: {desc}")
        print(f"    主机: {host}")
        print(f"    数据库: {database}")
        print()


def list_schemas(db_config: Dict[str, Any]) -> List[str]:
    """列出数据库实例中的所有 schemas"""
    conn = get_connection(db_config)
    try:
        with conn.cursor() as cursor:
            cursor.execute("SHOW DATABASES")
            return [row["Database"] for row in cursor.fetchall()]
    finally:
        conn.close()


def list_tables(db_config: Dict[str, Any], database: Optional[str] = None) -> List[str]:
    """列出指定数据库中的所有表"""
    config_copy = db_config.copy()
    if database:
        config_copy["database"] = database
    conn = get_connection(config_copy)
    try:
        with conn.cursor() as cursor:
            cursor.execute("SHOW TABLES")
            # 结果的 key 是 'Tables_in_<database>'
            return [list(row.values())[0] for row in cursor.fetchall()]
    finally:
        conn.close()


def describe_table(
    db_config: Dict[str, Any], table: str, database: Optional[str] = None
) -> Dict[str, Any]:
    """获取表结构信息"""
    config_copy = db_config.copy()
    if database:
        config_copy["database"] = database
    conn = get_connection(config_copy)
    try:
        with conn.cursor() as cursor:
            # 获取列信息
            cursor.execute(f"DESCRIBE `{table}`")
            columns = cursor.fetchall()

            # 获取建表语句
            cursor.execute(f"SHOW CREATE TABLE `{table}`")
            create_stmt = cursor.fetchone()["Create Table"]

            # 获取索引信息
            cursor.execute(f"SHOW INDEX FROM `{table}`")
            indexes = cursor.fetchall()

            return {
                "columns": columns,
                "create_statement": create_stmt,
                "indexes": indexes,
            }
    finally:
        conn.close()


def query_data(
    db_config: Dict[str, Any], sql: str, database: Optional[str] = None, limit: int = 10
) -> Tuple[List[str], List[Dict]]:
    """执行查询并返回结果（仅允许 SELECT）"""
    sql_stripped = sql.strip()
    sql_upper = sql_stripped.upper()

    # 安全检查：仅允许 SELECT
    if not sql_upper.startswith("SELECT"):
        raise ValueError("安全限制：仅允许 SELECT 查询")

    # 如果没有 LIMIT，自动添加
    if "LIMIT" not in sql_upper:
        sql_stripped = f"{sql_stripped} LIMIT {limit}"

    config_copy = db_config.copy()
    if database:
        config_copy["database"] = database
    conn = get_connection(config_copy)
    try:
        with conn.cursor() as cursor:
            cursor.execute(sql_stripped)
            rows = cursor.fetchall()
            columns = (
                [desc[0] for desc in cursor.description] if cursor.description else []
            )
            return columns, rows
    finally:
        conn.close()


def sample_data(
    db_config: Dict[str, Any],
    table: str,
    database: Optional[str] = None,
    limit: int = 10,
) -> Tuple[List[str], List[Dict]]:
    """获取表的示例数据"""
    return query_data(db_config, f"SELECT * FROM `{table}`", database, limit)


def export_schema(
    db_config: Dict[str, Any], output_path: str, database: Optional[str] = None
) -> None:
    """导出数据库表结构到文件"""
    tables = list_tables(db_config, database)
    schema_info = {"database": database or db_config.get("database"), "tables": {}}

    for table in tables:
        table_info = describe_table(db_config, table, database)
        schema_info["tables"][table] = table_info

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(schema_info, f, ensure_ascii=False, indent=2, default=str)

    print(f"Schema exported to {output_path}")


def print_table(columns: List[str], rows: List[Dict], max_width: int = 50) -> None:
    """格式化打印表格数据"""
    if not rows:
        print("(无数据)")
        return

    # 使用 dict 的 keys 作为列名
    if rows and isinstance(rows[0], dict):
        columns = list(rows[0].keys())

    # 计算列宽
    col_widths = {}
    for col in columns:
        col_widths[col] = min(
            max_width,
            max(
                len(str(col)),
                max(len(str(row.get(col, ""))[:max_width]) for row in rows)
                if rows
                else 0,
            ),
        )

    # 打印表头
    header = " | ".join(
        str(col).ljust(col_widths[col])[: col_widths[col]] for col in columns
    )
    print(header)
    print("-" * len(header))

    # 打印数据行
    for row in rows:
        line = " | ".join(
            str(row.get(col, ""))[: col_widths[col]].ljust(col_widths[col])
            for col in columns
        )
        print(line)


def main():
    parser = argparse.ArgumentParser(
        description="花易项目数据库工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s --config db.yaml --list-databases
  %(prog)s --config db.yaml --db haoxiangmei --list-schemas
  %(prog)s --config db.yaml --db haoxiangmei --list-tables
  %(prog)s --config db.yaml --db haoxiangmei --describe products
  %(prog)s --config db.yaml --db haoxiangmei --sample products --limit 5
  %(prog)s --config db.yaml --db haoxiangmei --query "SELECT * FROM products WHERE id=1"
  %(prog)s --config db.yaml --db haoxiangmei --export-schema schema.json
        """,
    )

    parser.add_argument(
        "--config", "-c", required=True, help="数据库配置文件路径 (YAML)"
    )
    parser.add_argument("--db", "-d", help="选择配置文件中的数据库别名")
    parser.add_argument("--database", help="指定要操作的数据库名（覆盖配置）")

    # 操作选项
    parser.add_argument(
        "--list-databases", action="store_true", help="列出配置的所有数据库"
    )
    parser.add_argument(
        "--list-schemas", action="store_true", help="列出数据库实例中的所有 schemas"
    )
    parser.add_argument("--list-tables", action="store_true", help="列出所有表")
    parser.add_argument("--describe", metavar="TABLE", help="显示表结构")
    parser.add_argument("--sample", metavar="TABLE", help="获取表的示例数据")
    parser.add_argument("--query", "-q", metavar="SQL", help="执行 SELECT 查询")
    parser.add_argument(
        "--export-schema", metavar="FILE", help="导出表结构到 JSON 文件"
    )

    # 其他选项
    parser.add_argument("--limit", type=int, default=10, help="查询结果限制 (默认: 10)")
    parser.add_argument("--json", action="store_true", help="以 JSON 格式输出")

    args = parser.parse_args()

    # 加载配置
    config = load_config(args.config)

    # 列出配置的数据库
    if args.list_databases:
        list_databases(config)
        return

    # 获取指定的数据库配置
    if args.db:
        if args.db not in config.get("databases", {}):
            print(f"Error: Database '{args.db}' not found in config", file=sys.stderr)
            print(
                f"Available: {', '.join(config.get('databases', {}).keys())}",
                file=sys.stderr,
            )
            sys.exit(1)
        db_config = config["databases"][args.db]
    else:
        # 使用第一个数据库
        dbs = config.get("databases", {})
        if not dbs:
            print("Error: No databases configured", file=sys.stderr)
            sys.exit(1)
        db_name = list(dbs.keys())[0]
        db_config = dbs[db_name]
        print(f"Using database: {db_name}", file=sys.stderr)

    database = args.database

    try:
        if args.list_schemas:
            schemas = list_schemas(db_config)
            if args.json:
                print(json.dumps(schemas, ensure_ascii=False))
            else:
                print("Schemas:")
                for s in schemas:
                    print(f"  - {s}")

        elif args.list_tables:
            tables = list_tables(db_config, database)
            if args.json:
                print(json.dumps(tables, ensure_ascii=False))
            else:
                print(f"Tables in {database or db_config.get('database')}:")
                for t in tables:
                    print(f"  - {t}")

        elif args.describe:
            info = describe_table(db_config, args.describe, database)
            if args.json:
                print(json.dumps(info, ensure_ascii=False, default=str, indent=2))
            else:
                print(f"Table: {args.describe}")
                print("\nColumns:")
                print_table([], info["columns"])
                print("\nCreate Statement:")
                print(info["create_statement"])

        elif args.sample:
            columns, rows = sample_data(db_config, args.sample, database, args.limit)
            if args.json:
                print(json.dumps(rows, ensure_ascii=False, default=str, indent=2))
            else:
                print(f"Sample data from {args.sample} (limit {args.limit}):")
                print_table(columns, rows)

        elif args.query:
            columns, rows = query_data(db_config, args.query, database, args.limit)
            if args.json:
                print(json.dumps(rows, ensure_ascii=False, default=str, indent=2))
            else:
                print_table(columns, rows)

        elif args.export_schema:
            export_schema(db_config, args.export_schema, database)

        else:
            parser.print_help()

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
