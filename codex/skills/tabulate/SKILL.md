---
name: tabulate
description: Render tables using Python + tabulate for user-facing output. Use when a task requires drawing, formatting, or presenting data in a table (Markdown/ASCII/grid), or converting structured data (lists, dicts, CSV/JSON) into a readable table.
---

# Tabulate

Render tables via the bundled Python script and the tabulate library.

## Script locations

This skill may be installed in one of two places:

| Install | Script path | requirements.txt |
| --- | --- | --- |
| Global | `~/.codex/skills/tabulate/scripts/tabulate_table.py` | `~/.codex/skills/tabulate/scripts/requirements.txt` |
| Project | `.codex/skills/tabulate/scripts/tabulate_table.py` | `.codex/skills/tabulate/scripts/requirements.txt` |

Always resolve the actual script path before running.

## Environment check (required)

1) Locate the script and requirements.
2) Check Python and pip.
3) Check tabulate dependency.
4) Install if missing (ask user first).

```bash
# Step 1: find script and requirements
ls -la .codex/skills/tabulate/scripts/tabulate_table.py 2>/dev/null
ls -la ~/.codex/skills/tabulate/scripts/tabulate_table.py 2>/dev/null

# Step 2: python and pip
which python3 && python3 --version
which pip3 || which pip

# Step 3: dependency check
python3 -c "import tabulate; print('tabulate OK')" 2>/dev/null || echo "tabulate MISSING"

# Step 4: install if missing
pip install -r "$REQUIREMENTS_PATH"
```

## Quick start

```bash
python3 $SCRIPT_PATH --data '[["Name","Score"],["Alice",9],["Bob",7]]'
```

Explicit headers:

```bash
python3 $SCRIPT_PATH --data '[["Alice",9],["Bob",7]]' --headers '["Name","Score"]'
```

JSON file input:

```bash
python3 $SCRIPT_PATH --data-file /tmp/table.json --tablefmt grid
```

stdin input:

```bash
cat /tmp/table.json | python3 $SCRIPT_PATH --headers keys
```

## Input formats

- JSON array of arrays (rows), e.g. `[["Name","Score"],["Alice",9]]`
- JSON array of objects, e.g. `[{"Name":"Alice","Score":9}]`

## Output guidance

- Default `tablefmt` is `github` for Markdown output.
- Use `grid`, `psql`, or `plain` for other contexts.
- Keep columns compact; abbreviate long text before tabulating.

## Your task

Follow this sequence whenever the skill is triggered:

1) Resolve `SCRIPT_PATH` and `REQUIREMENTS_PATH` using the script locations.
2) Verify `python3` and `pip` are available.
3) Check whether `tabulate` is installed.
4) If missing, ask the user for permission to install dependencies using the requirements file.
5) Format the provided data (or transform CSV/JSON into a 2D array or list of dicts).
6) Run the script to render the table and include the output in the response.

## Resources

- Script: `skills/tabulate/scripts/tabulate_table.py`
- Requirements: `skills/tabulate/scripts/requirements.txt`
