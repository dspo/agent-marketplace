"""SQL security validation module."""

import re
from typing import Optional

DEFAULT_LIMIT = 10
MAX_LIMIT = 100
MAX_EXPORT_LIMIT = 1000

SYSTEM_SCHEMAS = {"information_schema", "mysql", "performance_schema", "sys"}

ENV_VAR_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
SQL_COMMENT_BLOCK_RE = re.compile(r"/\*.*?\*/", re.S)
SQL_COMMENT_LINE_RE = re.compile(r"--[^\n]*")


def strip_sql_comments(sql: str) -> str:
    """Remove SQL comments from a query string."""
    sql = SQL_COMMENT_BLOCK_RE.sub("", sql)
    sql = SQL_COMMENT_LINE_RE.sub("", sql)
    return sql


def first_keyword(sql: str) -> str:
    """Extract the first SQL keyword from a query."""
    cleaned = strip_sql_comments(sql).strip()
    match = re.match(r"([A-Za-z]+)", cleaned)
    return match.group(1).upper() if match else ""


def has_multiple_statements(sql: str) -> bool:
    """Check if SQL contains multiple statements."""
    parts = [part.strip() for part in strip_sql_comments(sql).split(";")]
    parts = [part for part in parts if part]
    return len(parts) > 1


def is_read_query(keyword: str) -> bool:
    """Check if keyword indicates a read-only query."""
    return keyword in {"SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"}


def is_write_query(keyword: str) -> bool:
    """Check if keyword indicates a write query."""
    return keyword in {"INSERT", "UPDATE", "DELETE", "REPLACE"}


def is_ddl_query(keyword: str) -> bool:
    """Check if keyword indicates a DDL query."""
    return keyword in {
        "CREATE",
        "ALTER",
        "DROP",
        "TRUNCATE",
        "RENAME",
        "GRANT",
        "REVOKE",
    }


def ensure_allowed_sql(sql: str) -> str:
    """Validate SQL and return query type ('read') or raise ValueError."""
    if has_multiple_statements(sql):
        raise ValueError("Multiple SQL statements are not allowed.")
    keyword = first_keyword(sql)
    if not keyword:
        raise ValueError("SQL is empty.")
    if is_read_query(keyword):
        return "read"
    if is_write_query(keyword):
        raise ValueError("Write operations are not allowed (INSERT/UPDATE/DELETE/REPLACE).")
    if is_ddl_query(keyword):
        raise ValueError("DDL operations are not allowed (CREATE/ALTER/DROP/TRUNCATE).")
    raise ValueError(f"Unsupported or unsafe SQL statement: {keyword}")


def quote_ident(name: str) -> str:
    """Quote a MySQL identifier (table/column name)."""
    return "`" + name.replace("`", "``") + "`"


def parse_columns(arg: Optional[str]) -> str:
    """Parse comma-separated column names into quoted SQL expression."""
    if not arg:
        return "*"
    columns = [col.strip() for col in arg.split(",") if col.strip()]
    if not columns:
        return "*"
    return ", ".join(quote_ident(col) for col in columns)
