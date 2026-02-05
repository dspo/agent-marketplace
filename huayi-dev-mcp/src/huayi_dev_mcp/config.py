"""Configuration loading module."""

import os
import re
from typing import Any, Dict, Optional

from .sql_security import ENV_VAR_RE


def load_yaml(path: str) -> Dict[str, Any]:
    """Load a YAML file and return its contents as a dict."""
    try:
        import yaml
    except ImportError:
        raise ImportError("Missing PyYAML. Install with: pip install pyyaml")
    with open(path, "r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise ValueError("Config must be a YAML mapping.")
    return data


def substitute_env(value: Any, location: str = "") -> Any:
    """Recursively substitute ${VAR} patterns with environment variables."""
    if isinstance(value, str):
        def repl(match: re.Match) -> str:
            var_name = match.group(1)
            var_value = os.getenv(var_name)
            if var_value is None:
                raise ValueError(f"Missing env var {var_name} for {location or 'value'}")
            return var_value
        return ENV_VAR_RE.sub(repl, value)
    if isinstance(value, dict):
        return {
            key: substitute_env(val, f"{location}.{key}" if location else key)
            for key, val in value.items()
        }
    if isinstance(value, list):
        return [
            substitute_env(val, f"{location}[{idx}]")
            for idx, val in enumerate(value)
        ]
    return value


def load_config(path: str) -> Dict[str, Dict[str, Any]]:
    """Load database configuration from YAML file."""
    data = load_yaml(path)
    data = substitute_env(data)
    databases = data.get("databases")
    if not isinstance(databases, dict):
        raise ValueError("Config must contain a 'databases' mapping.")
    return databases


def normalize_instance(name: str, cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Validate and normalize instance configuration."""
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
    missing = [
        field for field in ("host", "username", "password") if not cfg.get(field)
    ]
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
    """Mask a secret value, showing only last 4 characters."""
    if value is None:
        return None
    if len(value) <= 4:
        return "*" * len(value)
    return "*" * (len(value) - 4) + value[-4:]


def resolve_instance(config: Dict[str, Dict[str, Any]], instance: str) -> Dict[str, Any]:
    """Resolve and validate an instance from config."""
    if instance not in config:
        raise ValueError(f"Instance not found: {instance}")
    return normalize_instance(instance, config[instance])


def get_config_path() -> str:
    """Get config path from HUAYI_DEV_MCP_CONFIG environment variable.

    Falls back to 'config/config.yaml' in current working directory if not set.
    """
    path = os.getenv("HUAYI_DEV_MCP_CONFIG")
    if not path:
        path = os.path.join(os.getcwd(), "config", "config.yaml")
    return path
