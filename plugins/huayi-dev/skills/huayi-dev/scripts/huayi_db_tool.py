#!/usr/bin/env python3
"""
Huayi database helper for schema inspection and safe queries.
"""

import argparse
import csv
import json
import os
import re
import sys
from typing import Any, Dict, Iterable, List, Optional, Tuple


DEFAULT_LIMIT = 10
SYSTEM_SCHEMAS = {"information_schema", "mysql", "performance_schema", "sys"}
ENV_VAR_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
SQL_COMMENT_BLOCK_RE = re.compile(r"/\*.*?\*/", re.S)
SQL_COMMENT_LINE_RE = re.compile(r"--[^\n]*")


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


def load_yaml(path: str) -> Dict[str, Any]:
    try:
        import yaml  # type: ignore
    except Exception:
        eprint("Missing PyYAML. Install with: python3 -m pip install pyyaml")
        sys.exit(2)
    with open(path, "r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise ValueError("Config must be a YAML mapping.")
    return data


def substitute_env(value: Any, location: str = "") -> Any:
    if isinstance(value, str):
        def repl(match: re.Match) -> str:
            var_name = match.group(1)
            var_value = os.getenv(var_name)
            if var_value is None:
                raise ValueError(f"Missing env var {var_name} for {location or 'value'}")
            return var_value
        return ENV_VAR_RE.sub(repl, value)
    if isinstance(value, dict):
        return {key: substitute_env(val, f"{location}.{key}" if location else key) for key, val in value.items()}
    if isinstance(value, list):
        return [substitute_env(val, f"{location}[{idx}]") for idx, val in enumerate(value)]
    return value


def load_config(path: str) -> Dict[str, Dict[str, Any]]:
    data = load_yaml(path)
    data = substitute_env(data)
    databases = data.get("databases")
    if not isinstance(databases, dict):
        raise ValueError("Config must contain a 'databases' mapping.")
    return databases


def normalize_instance(name: str, cfg: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(cfg, dict):
        raise ValueError(f"Instance {name} must be a mapping.")
    driver = cfg.get("driver")
    if driver != "mysql":
        raise ValueError(f"Instance {name} uses unsupported driver: {driver}")
    host = cfg.get("host")
    port = int(cfg.get("port", 3306))
    username = cfg.get("username")
    password = cfg.get("password")
    database = cfg.get("database")
    description = cfg.get("description")
    missing = [field for field in ("host", "username", "password") if not cfg.get(field)]
    if missing:
        raise ValueError(f"Instance {name} missing fields: {', '.join(missing)}")
    return {
        "name": name,
        "driver": driver,
        "host": host,
        "port": port,
        "username": username,
        "password": password,
        "database": database,
        "description": description,
    }


def mask_secret(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if len(value) <= 4:
        return "*" * len(value)
    return "*" * (len(value) - 4) + value[-4:]


def get_mysql_connector() -> Tuple[str, Any]:
    try:
        import pymysql  # type: ignore
        return "pymysql", pymysql
    except Exception:
        pass
    try:
        import mysql.connector  # type: ignore
        return "mysql.connector", mysql.connector
    except Exception:
        eprint("Missing MySQL driver. Install one of:")
        eprint("  python3 -m pip install pymysql")
        eprint("  python3 -m pip install mysql-connector-python")
        sys.exit(2)


def connect_mysql(cfg: Dict[str, Any], database: Optional[str]) -> Tuple[Any, str]:
    driver_name, module = get_mysql_connector()
    if driver_name == "pymysql":
        conn = module.connect(
            host=cfg["host"],
            user=cfg["username"],
            password=cfg["password"],
            database=database,
            port=cfg["port"],
            charset="utf8mb4",
            cursorclass=module.cursors.DictCursor,
            autocommit=True,
        )
        return conn, driver_name
    conn = module.connect(
        host=cfg["host"],
        user=cfg["username"],
        password=cfg["password"],
        database=database,
        port=cfg["port"],
        autocommit=True,
    )
    return conn, driver_name


def run_query(conn: Any, driver: str, sql: str, params: Optional[Iterable[Any]] = None) -> Tuple[List[Dict[str, Any]], int]:
    params = tuple(params) if params else ()
    if driver == "pymysql":
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() if cur.description else []
            return rows, cur.rowcount
    cur = conn.cursor(dictionary=True)
    cur.execute(sql, params)
    rows = cur.fetchall() if cur.description else []
    rowcount = cur.rowcount
    cur.close()
    return rows, rowcount


def write_output(data: Any, fmt: str, output: Optional[str]) -> None:
    if fmt == "json":
        text = json.dumps(data, ensure_ascii=True, indent=2, default=str)
        if output:
            with open(output, "w", encoding="utf-8") as handle:
                handle.write(text + "\n")
        else:
            print(text)
        return
    if fmt == "jsonl":
        if not isinstance(data, list):
            raise ValueError("jsonl output requires a list of rows.")
        lines = [json.dumps(row, ensure_ascii=True, default=str) for row in data]
        text = "\n".join(lines) + ("\n" if lines else "")
        if output:
            with open(output, "w", encoding="utf-8") as handle:
                handle.write(text)
        else:
            print(text, end="")
        return
    if fmt == "csv":
        if not isinstance(data, list):
            raise ValueError("csv output requires a list of rows.")
        if output:
            handle = open(output, "w", encoding="utf-8", newline="")
            close_handle = True
        else:
            handle = sys.stdout
            close_handle = False
        try:
            if not data:
                return
            fieldnames = sorted({key for row in data for key in row.keys()})
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in data:
                writer.writerow({key: row.get(key) for key in fieldnames})
        finally:
            if close_handle:
                handle.close()
        return
    raise ValueError(f"Unsupported format: {fmt}")


def strip_sql_comments(sql: str) -> str:
    sql = SQL_COMMENT_BLOCK_RE.sub("", sql)
    sql = SQL_COMMENT_LINE_RE.sub("", sql)
    return sql


def first_keyword(sql: str) -> str:
    cleaned = strip_sql_comments(sql).strip()
    match = re.match(r"([A-Za-z]+)", cleaned)
    return match.group(1).upper() if match else ""


def has_multiple_statements(sql: str) -> bool:
    parts = [part.strip() for part in strip_sql_comments(sql).split(";")]
    parts = [part for part in parts if part]
    return len(parts) > 1


def is_read_query(keyword: str) -> bool:
    return keyword in {"SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"}


def is_write_query(keyword: str) -> bool:
    return keyword in {"INSERT", "UPDATE", "DELETE", "REPLACE"}


def is_ddl_query(keyword: str) -> bool:
    return keyword in {"CREATE", "ALTER", "DROP", "TRUNCATE", "RENAME", "GRANT", "REVOKE"}


def ensure_allowed_sql(sql: str) -> str:
    """检查 SQL 是否允许执行，仅允许 SELECT 查询"""
    if has_multiple_statements(sql):
        raise ValueError("Multiple SQL statements are not allowed.")
    keyword = first_keyword(sql)
    if not keyword:
        raise ValueError("SQL is empty.")
    if is_read_query(keyword):
        return "read"
    if is_write_query(keyword):
        raise ValueError("安全限制：禁止执行写操作 (INSERT/UPDATE/DELETE/REPLACE)")
    if is_ddl_query(keyword):
        raise ValueError("安全限制：禁止执行 DDL 操作 (CREATE/ALTER/DROP/TRUNCATE)")
    raise ValueError(f"Unsupported or unsafe SQL statement: {keyword}")


def quote_ident(name: str) -> str:
    return "`" + name.replace("`", "``") + "`"


def parse_columns(arg: Optional[str]) -> str:
    if not arg:
        return "*"
    columns = [col.strip() for col in arg.split(",") if col.strip()]
    if not columns:
        return "*"
    return ", ".join(quote_ident(col) for col in columns)


def resolve_instance(config: Dict[str, Dict[str, Any]], instance: str) -> Dict[str, Any]:
    if instance not in config:
        raise ValueError(f"Instance not found: {instance}")
    return normalize_instance(instance, config[instance])


def list_instances(args: argparse.Namespace) -> None:
    config = load_config(args.database_config)
    output = []
    for name, cfg in sorted(config.items(), key=lambda item: item[0]):
        instance = normalize_instance(name, cfg)
        output.append({
            "name": instance["name"],
            "description": instance.get("description"),
            "driver": instance.get("driver"),
            "host": instance.get("host"),
            "port": instance.get("port"),
            "username": instance.get("username"),
            "password": mask_secret(instance.get("password")),
            "database": instance.get("database"),
        })
    write_output(output, args.format, args.output)


def list_schemas(args: argparse.Namespace) -> None:
    config = load_config(args.database_config)
    instances = [args.instance] if args.instance else sorted(config.keys())
    output: List[Dict[str, Any]] = []
    for name in instances:
        instance = resolve_instance(config, name)
        conn, driver = connect_mysql(instance, database="information_schema")
        try:
            sql = (
                "SELECT schema_name AS schema_name, default_character_set_name AS charset "
                "FROM information_schema.schemata"
            )
            params: List[Any] = []
            if not args.include_system:
                placeholders = ", ".join(["%s"] * len(SYSTEM_SCHEMAS))
                sql += f" WHERE schema_name NOT IN ({placeholders})"
                params.extend(sorted(SYSTEM_SCHEMAS))
            rows, _ = run_query(conn, driver, sql, params)
            for row in rows:
                row["instance"] = name
                output.append(row)
        finally:
            conn.close()
    write_output(output, args.format, args.output)


def list_tables(args: argparse.Namespace) -> None:
    config = load_config(args.database_config)
    instance = resolve_instance(config, args.instance)
    conn, driver = connect_mysql(instance, database="information_schema")
    try:
        sql = (
            "SELECT table_name AS table_name, table_type AS table_type, engine AS engine, "
            "table_rows AS table_rows, table_comment AS table_comment "
            "FROM information_schema.tables WHERE table_schema = %s"
        )
        params: List[Any] = [args.database]
        if args.table_type != "all":
            sql += " AND table_type = %s"
            params.append("BASE TABLE" if args.table_type == "base" else "VIEW")
        if args.like:
            sql += " AND table_name LIKE %s"
            params.append(args.like)
        sql += " ORDER BY table_name"
        rows, _ = run_query(conn, driver, sql, params)
    finally:
        conn.close()
    write_output(rows, args.format, args.output)


def describe_table(args: argparse.Namespace) -> None:
    config = load_config(args.database_config)
    instance = resolve_instance(config, args.instance)
    conn, driver = connect_mysql(instance, database="information_schema")
    try:
        col_sql = (
            "SELECT column_name AS column_name, ordinal_position AS ordinal_position, "
            "column_type AS column_type, is_nullable AS is_nullable, column_default AS column_default, "
            "column_key AS column_key, extra AS extra, column_comment AS column_comment "
            "FROM information_schema.columns WHERE table_schema = %s AND table_name = %s "
            "ORDER BY ordinal_position"
        )
        columns, _ = run_query(conn, driver, col_sql, [args.database, args.table])
        output: Dict[str, Any] = {
            "instance": args.instance,
            "database": args.database,
            "table": args.table,
            "columns": columns,
        }
        if args.include_indexes:
            idx_sql = (
                "SELECT index_name AS index_name, non_unique AS non_unique, seq_in_index AS seq_in_index, "
                "column_name AS column_name, index_type AS index_type, collation AS collation, "
                "cardinality AS cardinality "
                "FROM information_schema.statistics WHERE table_schema = %s AND table_name = %s "
                "ORDER BY index_name, seq_in_index"
            )
            indexes, _ = run_query(conn, driver, idx_sql, [args.database, args.table])
            output["indexes"] = indexes
    finally:
        conn.close()
    write_output(output, args.format, args.output)


def sample_data(args: argparse.Namespace) -> None:
    config = load_config(args.database_config)
    instance = resolve_instance(config, args.instance)
    conn, driver = connect_mysql(instance, database=args.database)
    try:
        columns = parse_columns(args.columns)
        sql = f"SELECT {columns} FROM {quote_ident(args.database)}.{quote_ident(args.table)}"
        if args.where:
            sql += f" WHERE {args.where}"
        if args.order_by:
            sql += f" ORDER BY {args.order_by}"
        sql += " LIMIT %s OFFSET %s"
        rows, _ = run_query(conn, driver, sql, [args.limit, args.offset])
    finally:
        conn.close()
    write_output(rows, args.format, args.output)


def run_sql(args: argparse.Namespace) -> None:
    if bool(args.sql) == bool(args.sql_file):
        raise ValueError("Provide exactly one of --sql or --sql-file.")
    sql = args.sql
    if args.sql_file:
        with open(args.sql_file, "r", encoding="utf-8") as handle:
            sql = handle.read()
    if not sql:
        raise ValueError("SQL is empty.")
    sql = sql.strip()
    mode = ensure_allowed_sql(sql)
    config = load_config(args.database_config)
    instance = resolve_instance(config, args.instance)
    database = args.database or instance.get("database")
    conn, driver = connect_mysql(instance, database=database)
    try:
        keyword = first_keyword(sql)
        params: List[Any] = []
        if mode == "read" and not args.no_limit and keyword in {"SELECT", "WITH"}:
            sql = f"SELECT * FROM ({sql.rstrip(';')}) AS _q LIMIT %s OFFSET %s"
            params = [args.limit, args.offset]
        rows, rowcount = run_query(conn, driver, sql, params)
    finally:
        conn.close()
    if rows:
        write_output(rows, args.format, args.output)
    else:
        write_output({"mode": mode, "affected_rows": rowcount}, "json", args.output)


def export_schema(args: argparse.Namespace) -> None:
    config = load_config(args.database_config)
    instance = resolve_instance(config, args.instance)
    conn, driver = connect_mysql(instance, database="information_schema")
    try:
        tables_sql = (
            "SELECT table_name AS table_name, table_comment AS table_comment, engine AS engine "
            "FROM information_schema.tables WHERE table_schema = %s AND table_type = 'BASE TABLE' "
            "ORDER BY table_name"
        )
        tables, _ = run_query(conn, driver, tables_sql, [args.database])
        schema: Dict[str, Any] = {
            "instance": args.instance,
            "database": args.database,
            "tables": {},
        }
        for table in tables:
            table_name = table["table_name"]
            col_sql = (
                "SELECT column_name AS column_name, ordinal_position AS ordinal_position, "
                "column_type AS column_type, is_nullable AS is_nullable, column_default AS column_default, "
                "column_key AS column_key, extra AS extra, column_comment AS column_comment "
                "FROM information_schema.columns WHERE table_schema = %s AND table_name = %s "
                "ORDER BY ordinal_position"
            )
            columns, _ = run_query(conn, driver, col_sql, [args.database, table_name])
            table_info: Dict[str, Any] = {
                "table_comment": table.get("table_comment"),
                "engine": table.get("engine"),
                "columns": columns,
            }
            if args.include_indexes:
                idx_sql = (
                    "SELECT index_name AS index_name, non_unique AS non_unique, seq_in_index AS seq_in_index, "
                    "column_name AS column_name, index_type AS index_type, collation AS collation, "
                    "cardinality AS cardinality "
                    "FROM information_schema.statistics WHERE table_schema = %s AND table_name = %s "
                    "ORDER BY index_name, seq_in_index"
                )
                indexes, _ = run_query(conn, driver, idx_sql, [args.database, table_name])
                table_info["indexes"] = indexes
            schema["tables"][table_name] = table_info
    finally:
        conn.close()
    write_output(schema, args.format, args.output)


def export_data(args: argparse.Namespace) -> None:
    config = load_config(args.database_config)
    instance = resolve_instance(config, args.instance)
    conn, driver = connect_mysql(instance, database=args.database)
    try:
        columns = parse_columns(args.columns)
        sql = f"SELECT {columns} FROM {quote_ident(args.database)}.{quote_ident(args.table)}"
        if args.where:
            sql += f" WHERE {args.where}"
        if args.order_by:
            sql += f" ORDER BY {args.order_by}"
        sql += " LIMIT %s OFFSET %s"
        rows, _ = run_query(conn, driver, sql, [args.limit, args.offset])
    finally:
        conn.close()
    write_output(rows, args.format, args.output)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Huayi DB helper for config-aware inspection, queries, and exports."
    )
    parser.add_argument(
        "--database-config",
        required=True,
        help="Path to YAML config with a 'databases' mapping.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_inst = subparsers.add_parser("list-instances", help="List configured instances.")
    list_inst.add_argument("--format", default="json", choices=["json", "jsonl"])
    list_inst.add_argument("--output", help="Write output to file.")
    list_inst.set_defaults(func=list_instances)

    list_schema = subparsers.add_parser("list-schemas", help="List schemas for an instance or all.")
    list_schema.add_argument("--instance", help="Instance name (optional).")
    list_schema.add_argument("--include-system", action="store_true", help="Include system schemas.")
    list_schema.add_argument("--format", default="json", choices=["json", "jsonl", "csv"])
    list_schema.add_argument("--output", help="Write output to file.")
    list_schema.set_defaults(func=list_schemas)

    list_tbl = subparsers.add_parser("list-tables", help="List tables for a database.")
    list_tbl.add_argument("--instance", required=True, help="Instance name.")
    list_tbl.add_argument("--database", required=True, help="Database/schema name.")
    list_tbl.add_argument("--table-type", default="base", choices=["base", "view", "all"])
    list_tbl.add_argument("--like", help="Filter table name with SQL LIKE.")
    list_tbl.add_argument("--format", default="json", choices=["json", "jsonl", "csv"])
    list_tbl.add_argument("--output", help="Write output to file.")
    list_tbl.set_defaults(func=list_tables)

    desc_tbl = subparsers.add_parser("describe-table", help="Describe a table's columns.")
    desc_tbl.add_argument("--instance", required=True, help="Instance name.")
    desc_tbl.add_argument("--database", required=True, help="Database/schema name.")
    desc_tbl.add_argument("--table", required=True, help="Table name.")
    desc_tbl.add_argument("--include-indexes", action="store_true", help="Include index metadata.")
    desc_tbl.add_argument("--format", default="json", choices=["json"])
    desc_tbl.add_argument("--output", help="Write output to file.")
    desc_tbl.set_defaults(func=describe_table)

    sample = subparsers.add_parser("sample-data", help="Fetch sample rows from a table.")
    sample.add_argument("--instance", required=True, help="Instance name.")
    sample.add_argument("--database", required=True, help="Database/schema name.")
    sample.add_argument("--table", required=True, help="Table name.")
    sample.add_argument("--columns", help="Comma-separated column list (default: *).")
    sample.add_argument("--where", help="Raw SQL WHERE clause (without 'WHERE').")
    sample.add_argument("--order-by", help="Raw SQL ORDER BY clause (without 'ORDER BY').")
    sample.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Row limit.")
    sample.add_argument("--offset", type=int, default=0, help="Row offset.")
    sample.add_argument("--format", default="json", choices=["json", "jsonl", "csv"])
    sample.add_argument("--output", help="Write output to file.")
    sample.set_defaults(func=sample_data)

    query = subparsers.add_parser("query", help="Run a SQL query with safety checks.")
    query.add_argument("--instance", required=True, help="Instance name.")
    query.add_argument("--database", help="Database/schema name (optional).")
    query.add_argument("--sql", help="SQL string to execute.")
    query.add_argument("--sql-file", help="Path to SQL file to execute.")
    query.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Row limit for read queries.")
    query.add_argument("--offset", type=int, default=0, help="Row offset for read queries.")
    query.add_argument("--no-limit", action="store_true", help="Disable automatic limit for SELECT/WITH.")
    query.add_argument("--format", default="json", choices=["json", "jsonl", "csv"])
    query.add_argument("--output", help="Write output to file.")
    query.set_defaults(func=run_sql)

    export_s = subparsers.add_parser("export-schema", help="Export schema for a database.")
    export_s.add_argument("--instance", required=True, help="Instance name.")
    export_s.add_argument("--database", required=True, help="Database/schema name.")
    export_s.add_argument("--include-indexes", action="store_true", help="Include index metadata.")
    export_s.add_argument("--format", default="json", choices=["json"])
    export_s.add_argument("--output", help="Write output to file.")
    export_s.set_defaults(func=export_schema)

    export_d = subparsers.add_parser("export-data", help="Export sample data from a table.")
    export_d.add_argument("--instance", required=True, help="Instance name.")
    export_d.add_argument("--database", required=True, help="Database/schema name.")
    export_d.add_argument("--table", required=True, help="Table name.")
    export_d.add_argument("--columns", help="Comma-separated column list (default: *).")
    export_d.add_argument("--where", help="Raw SQL WHERE clause (without 'WHERE').")
    export_d.add_argument("--order-by", help="Raw SQL ORDER BY clause (without 'ORDER BY').")
    export_d.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Row limit.")
    export_d.add_argument("--offset", type=int, default=0, help="Row offset.")
    export_d.add_argument("--format", default="json", choices=["json", "jsonl", "csv"])
    export_d.add_argument("--output", help="Write output to file.")
    export_d.set_defaults(func=export_data)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        args.func(args)
    except Exception as exc:
        eprint(f"Error: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
