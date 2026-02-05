"""Database operations module."""

from typing import Any, Dict, Iterable, List, Optional, Tuple

from .config import (
    get_config_path,
    load_config,
    mask_secret,
    normalize_instance,
    resolve_instance,
)
from .sql_security import (
    DEFAULT_LIMIT,
    MAX_EXPORT_LIMIT,
    MAX_LIMIT,
    SYSTEM_SCHEMAS,
    ensure_allowed_sql,
    first_keyword,
    parse_columns,
    quote_ident,
)


def get_mysql_connector() -> Tuple[str, Any]:
    """Get available MySQL connector module."""
    try:
        import pymysql
        return "pymysql", pymysql
    except ImportError:
        pass
    try:
        import mysql.connector
        return "mysql.connector", mysql.connector
    except ImportError:
        raise ImportError(
            "Missing MySQL driver. Install one of:\n"
            "  pip install pymysql\n"
            "  pip install mysql-connector-python"
        )


def connect_mysql(cfg: Dict[str, Any], database: Optional[str]) -> Tuple[Any, str]:
    """Create a MySQL connection."""
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


def run_query(
    conn: Any, driver: str, sql: str, params: Optional[Iterable[Any]] = None
) -> Tuple[List[Dict[str, Any]], int]:
    """Execute a SQL query and return results."""
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


def list_instances() -> List[Dict[str, Any]]:
    """List all configured database instances."""
    config_path = get_config_path()
    config = load_config(config_path)
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
    return output


def list_schemas(
    instance_name: str,
    include_system: bool = False,
) -> List[Dict[str, Any]]:
    """List schemas for a database instance."""
    config_path = get_config_path()
    config = load_config(config_path)
    instance = resolve_instance(config, instance_name)
    conn, driver = connect_mysql(instance, database="information_schema")
    try:
        sql = (
            "SELECT schema_name AS schema_name, default_character_set_name AS charset "
            "FROM information_schema.schemata"
        )
        params: List[Any] = []
        if not include_system:
            placeholders = ", ".join(["%s"] * len(SYSTEM_SCHEMAS))
            sql += f" WHERE schema_name NOT IN ({placeholders})"
            params.extend(sorted(SYSTEM_SCHEMAS))
        rows, _ = run_query(conn, driver, sql, params)
        for row in rows:
            row["instance"] = instance_name
    finally:
        conn.close()
    return rows


def list_tables(
    instance_name: str,
    database: str,
    table_type: str = "all",
    like: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """List tables in a database."""
    config_path = get_config_path()
    config = load_config(config_path)
    instance = resolve_instance(config, instance_name)
    conn, driver = connect_mysql(instance, database="information_schema")
    try:
        sql = (
            "SELECT table_name AS table_name, table_type AS table_type, engine AS engine, "
            "table_rows AS table_rows, table_comment AS table_comment "
            "FROM information_schema.tables WHERE table_schema = %s"
        )
        params: List[Any] = [database]
        if table_type != "all":
            sql += " AND table_type = %s"
            params.append("BASE TABLE" if table_type == "base" else "VIEW")
        if like:
            sql += " AND table_name LIKE %s"
            params.append(like)
        sql += " ORDER BY table_name"
        rows, _ = run_query(conn, driver, sql, params)
    finally:
        conn.close()
    return rows


def describe_table(
    instance_name: str,
    database: str,
    table: str,
    include_indexes: bool = True,
) -> Dict[str, Any]:
    """Get detailed table structure information."""
    config_path = get_config_path()
    config = load_config(config_path)
    instance = resolve_instance(config, instance_name)
    conn, driver = connect_mysql(instance, database="information_schema")
    try:
        col_sql = (
            "SELECT column_name AS column_name, ordinal_position AS ordinal_position, "
            "column_type AS column_type, is_nullable AS is_nullable, column_default AS column_default, "
            "column_key AS column_key, extra AS extra, column_comment AS column_comment "
            "FROM information_schema.columns WHERE table_schema = %s AND table_name = %s "
            "ORDER BY ordinal_position"
        )
        columns, _ = run_query(conn, driver, col_sql, [database, table])
        output: Dict[str, Any] = {
            "instance": instance_name,
            "database": database,
            "table": table,
            "columns": columns,
        }
        if include_indexes:
            idx_sql = (
                "SELECT index_name AS index_name, non_unique AS non_unique, seq_in_index AS seq_in_index, "
                "column_name AS column_name, index_type AS index_type, collation AS collation, "
                "cardinality AS cardinality "
                "FROM information_schema.statistics WHERE table_schema = %s AND table_name = %s "
                "ORDER BY index_name, seq_in_index"
            )
            indexes, _ = run_query(conn, driver, idx_sql, [database, table])
            output["indexes"] = indexes
    finally:
        conn.close()
    return output


def sample_data(
    instance_name: str,
    database: str,
    table: str,
    columns: Optional[str] = None,
    where: Optional[str] = None,
    order_by: Optional[str] = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Get sample data from a table."""
    limit = min(limit, MAX_LIMIT)
    config_path = get_config_path()
    config = load_config(config_path)
    instance = resolve_instance(config, instance_name)
    conn, driver = connect_mysql(instance, database=database)
    try:
        column_expr = parse_columns(columns)
        sql = f"SELECT {column_expr} FROM {quote_ident(database)}.{quote_ident(table)}"
        if where:
            sql += f" WHERE {where}"
        if order_by:
            sql += f" ORDER BY {order_by}"
        sql += " LIMIT %s OFFSET %s"
        rows, _ = run_query(conn, driver, sql, [limit, offset])
    finally:
        conn.close()
    return rows


def execute_query(
    instance_name: str,
    sql: str,
    database: Optional[str] = None,
    limit: int = DEFAULT_LIMIT,
) -> Any:
    """Execute a read-only SQL query."""
    sql = sql.strip()
    ensure_allowed_sql(sql)
    limit = min(limit, MAX_LIMIT)
    config_path = get_config_path()
    config = load_config(config_path)
    instance = resolve_instance(config, instance_name)
    database = database or instance.get("database")
    conn, driver = connect_mysql(instance, database=database)
    try:
        keyword = first_keyword(sql)
        params: List[Any] = []
        if keyword in {"SELECT", "WITH"}:
            sql = f"SELECT * FROM ({sql.rstrip(';')}) AS _q LIMIT %s OFFSET %s"
            params = [limit, 0]
        rows, rowcount = run_query(conn, driver, sql, params)
    finally:
        conn.close()
    if rows:
        return rows
    return {"mode": "read", "affected_rows": rowcount}


def export_schema(
    instance_name: str,
    database: str,
    include_indexes: bool = True,
) -> Dict[str, Any]:
    """Export complete schema structure for a database."""
    config_path = get_config_path()
    config = load_config(config_path)
    instance = resolve_instance(config, instance_name)
    conn, driver = connect_mysql(instance, database="information_schema")
    try:
        tables_sql = (
            "SELECT table_name AS table_name, table_comment AS table_comment, engine AS engine "
            "FROM information_schema.tables WHERE table_schema = %s AND table_type = 'BASE TABLE' "
            "ORDER BY table_name"
        )
        tables, _ = run_query(conn, driver, tables_sql, [database])
        schema: Dict[str, Any] = {
            "instance": instance_name,
            "database": database,
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
            columns, _ = run_query(conn, driver, col_sql, [database, table_name])
            table_info: Dict[str, Any] = {
                "table_comment": table.get("table_comment"),
                "engine": table.get("engine"),
                "columns": columns,
            }
            if include_indexes:
                idx_sql = (
                    "SELECT index_name AS index_name, non_unique AS non_unique, "
                    "seq_in_index AS seq_in_index, column_name AS column_name, "
                    "index_type AS index_type, collation AS collation, cardinality AS cardinality "
                    "FROM information_schema.statistics WHERE table_schema = %s AND table_name = %s "
                    "ORDER BY index_name, seq_in_index"
                )
                indexes, _ = run_query(conn, driver, idx_sql, [database, table_name])
                table_info["indexes"] = indexes
            schema["tables"][table_name] = table_info
    finally:
        conn.close()
    return schema


def export_data(
    instance_name: str,
    database: str,
    table: str,
    columns: Optional[str] = None,
    where: Optional[str] = None,
    order_by: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Export data from a table."""
    limit = min(limit, MAX_EXPORT_LIMIT)
    return sample_data(
        instance_name, database, table, columns, where, order_by, limit, offset
    )
