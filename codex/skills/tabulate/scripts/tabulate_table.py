#!/usr/bin/env python3
import argparse
import json
import sys
from typing import Any, Optional

from tabulate import tabulate


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render tables from JSON data using tabulate."
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--data",
        help="JSON string: array of arrays or array of objects",
    )
    group.add_argument(
        "--data-file",
        help="Path to JSON file containing an array of arrays or objects",
    )
    parser.add_argument(
        "--headers",
        help="firstrow|keys|none or a JSON array of header strings",
    )
    parser.add_argument(
        "--tablefmt",
        default="github",
        help="tabulate table format (default: github)",
    )
    parser.add_argument(
        "--floatfmt",
        default="g",
        help="float format passed to tabulate (default: g)",
    )
    parser.add_argument(
        "--output",
        help="Write output to a file instead of stdout",
    )
    return parser.parse_args()


def load_data(args: argparse.Namespace) -> Any:
    if args.data is not None:
        raw = args.data
    elif args.data_file is not None:
        try:
            with open(args.data_file, "r", encoding="utf-8") as handle:
                raw = handle.read()
        except OSError as exc:
            raise ValueError(f"Cannot read data file: {exc}") from exc
    else:
        if sys.stdin.isatty():
            raise ValueError("No input provided. Use --data, --data-file, or stdin.")
        raw = sys.stdin.read()

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON input: {exc}") from exc


def validate_data(data: Any) -> None:
    if not isinstance(data, list):
        raise ValueError("Data must be a JSON array of rows or objects.")
    if not data:
        return
    first = data[0]
    if isinstance(first, (list, tuple, dict)):
        return
    raise ValueError("Rows must be arrays or objects.")


def parse_headers(headers_arg: Optional[str], data: Any) -> Any:
    if headers_arg is None:
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return "keys"
        return "firstrow"

    lowered = headers_arg.strip().lower()
    if lowered in {"firstrow", "keys"}:
        return lowered
    if lowered in {"none", "null", "false"}:
        return None

    try:
        parsed = json.loads(headers_arg)
    except json.JSONDecodeError as exc:
        raise ValueError(
            "Headers must be 'firstrow', 'keys', 'none', or a JSON array."
        ) from exc

    if not isinstance(parsed, list):
        raise ValueError("Headers JSON must be an array.")
    return parsed


def main() -> int:
    args = parse_args()
    try:
        data = load_data(args)
        validate_data(data)
        headers = parse_headers(args.headers, data)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    table = tabulate(
        data,
        headers=headers,
        tablefmt=args.tablefmt,
        floatfmt=args.floatfmt,
    )

    if args.output:
        try:
            with open(args.output, "w", encoding="utf-8") as handle:
                handle.write(table)
                handle.write("\n")
        except OSError as exc:
            print(f"ERROR: Cannot write output file: {exc}", file=sys.stderr)
            return 3
    else:
        print(table)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
