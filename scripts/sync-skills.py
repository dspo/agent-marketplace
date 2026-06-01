#!/usr/bin/env python3
"""
Export marketplace plugin skills to Codex or Copilot compatibility bundles.

Usage:
    python scripts/sync-skills.py --list
    python scripts/sync-skills.py --target codex --output-dir ~/.codex/skills --all
    python scripts/sync-skills.py --target copilot --output-dir ~/.copilot/skills --skill <name>
"""

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).parent.parent.resolve()
PLUGINS_DIR = REPO_ROOT / "plugins"


def find_plugins() -> list[str]:
    if not PLUGINS_DIR.exists():
        return []
    return sorted(
        d.name
        for d in PLUGINS_DIR.iterdir()
        if d.is_dir() and (d / ".claude-plugin" / "plugin.json").exists()
    )


def read_file(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def copy_skill_tree(src: Path, dst: Path) -> None:
    if not src.exists():
        return

    if dst.exists():
        shutil.rmtree(dst)

    for item in src.rglob("*"):
        rel = item.relative_to(src)
        target_name = "skill.md" if rel.name == "SKILL.md" else rel.name
        target = dst / rel.parent / target_name

        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            import yaml

            try:
                meta = yaml.safe_load(parts[1])
                body = parts[2].strip()
                return meta or {}, body
            except Exception:
                pass
    return {}, text


def build_frontmatter(data: dict) -> str:
    import yaml

    fm = yaml.dump(data, allow_unicode=True, sort_keys=False)
    return f"---\n{fm}---\n"


def rewrite_platform_paths(content: str, target: str) -> str:
    replacements = {
        "codex": {
            "${CLAUDE_PLUGIN_ROOT}": "${CODEX_PLUGIN_ROOT}",
            "~/.claude/skills/": "~/.codex/skills/",
            ".claude/skills/": ".codex/skills/",
        },
        "copilot": {
            "${CLAUDE_PLUGIN_ROOT}": "${COPILOT_PLUGIN_ROOT}",
            "~/.claude/skills/": "~/.copilot/skills/",
            ".claude/skills/": ".copilot/skills/",
        },
    }

    updated = content
    for src, dst in replacements[target].items():
        updated = updated.replace(src, dst)
    return updated


class Plugin:
    def __init__(self, name: str):
        self.name = name
        self.plugin_dir = PLUGINS_DIR / name
        self.claude_plugin_json = self.plugin_dir / ".claude-plugin" / "plugin.json"
        self.skills_dir = self.plugin_dir / "skills" / name
        self.skill_md = self.skills_dir / "SKILL.md"
        self.copilot_yaml = self.plugin_dir / ".copilot.yaml"

    def exists(self) -> bool:
        return self.skills_dir.exists() and self.skill_md.exists()

    def read_plugin_json(self) -> dict:
        return json.loads(read_file(self.claude_plugin_json))

    def read_skill(self) -> tuple[dict, str]:
        return parse_frontmatter(read_file(self.skill_md))

    def read_copilot_config(self) -> Optional[dict]:
        if self.copilot_yaml.exists():
            import yaml

            return yaml.safe_load(read_file(self.copilot_yaml)) or {}
        return None


def export_common_markdown(target_dir: Path, target: str) -> None:
    for md_file in target_dir.rglob("*.md"):
        content = read_file(md_file)
        updated = rewrite_platform_paths(content, target)
        if updated != content:
            write_file(md_file, updated)


def export_to_codex(plugin: Plugin, output_dir: Path) -> None:
    if not plugin.exists():
        print(f"  [SKIP] {plugin.name}: no skill found")
        return

    target_dir = output_dir / plugin.name
    copy_skill_tree(plugin.skills_dir, target_dir)
    export_common_markdown(target_dir, "codex")
    print(f"  [OK] {target_dir}")


def export_to_copilot(plugin: Plugin, output_dir: Path) -> None:
    if not plugin.exists():
        print(f"  [SKIP] {plugin.name}: no skill found")
        return

    target_dir = output_dir / plugin.name
    copy_skill_tree(plugin.skills_dir, target_dir)
    export_common_markdown(target_dir, "copilot")

    skill_md = target_dir / "skill.md"
    if skill_md.exists():
        meta, body = parse_frontmatter(read_file(skill_md))
        copilot_config = plugin.read_copilot_config()

        copilot_frontmatter = {
            "name": plugin.name,
            "description": meta.get("description", ""),
        }
        if copilot_config and "commands" in copilot_config:
            copilot_frontmatter["commands"] = copilot_config["commands"]

        new_content = build_frontmatter(copilot_frontmatter)
        new_content += "\n" + rewrite_platform_paths(body, "copilot").strip() + "\n"
        write_file(skill_md, new_content)

    print(f"  [OK] {target_dir}")


def ensure_copilot_template(plugin: Plugin) -> bool:
    if plugin.copilot_yaml.exists():
        return False

    template = """# Copilot compatibility export configuration
# This file is source input for: python scripts/sync-skills.py --target copilot --output-dir <path> --skill {name}
#
# commands:
#   - name: <command-name>
#     description: <what the command does>
#     script: scripts/<script.py>
#     args:
#       - <arg1>
#       - <arg2>
""".format(name=plugin.name)

    plugin.copilot_yaml.write_text(template, encoding="utf-8")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export marketplace plugin skills to Codex or Copilot compatibility bundles"
    )
    parser.add_argument("--all", action="store_true", help="Export all plugins")
    parser.add_argument("--skill", type=str, help="Export a specific plugin")
    parser.add_argument("--list", action="store_true", help="List available plugins")
    parser.add_argument(
        "--target",
        choices=("codex", "copilot"),
        help="Compatibility target format",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Directory where exported skills will be written",
    )
    parser.add_argument(
        "--init-copilot",
        action="store_true",
        help="Create .copilot.yaml templates for plugins that do not have one",
    )
    args = parser.parse_args()

    plugins = find_plugins()

    if args.list:
        print("Available plugins:")
        for name in plugins:
            desc = Plugin(name).read_plugin_json().get("description", "")
            print(f"  - {name}: {desc}")
        return

    if args.init_copilot:
        print("Creating .copilot.yaml templates...")
        for name in plugins:
            plugin = Plugin(name)
            if ensure_copilot_template(plugin):
                print(f"  [NEW] plugins/{name}/.copilot.yaml")
            else:
                print(f"  [EXISTS] plugins/{name}/.copilot.yaml")
        return

    if args.skill:
        if args.skill not in plugins:
            print(f"Error: plugin '{args.skill}' not found. Available: {', '.join(plugins)}")
            sys.exit(1)
        plugins = [args.skill]
    elif not args.all:
        print("Usage: python scripts/sync-skills.py --target <codex|copilot> --output-dir <path> [--all | --skill <name>]")
        sys.exit(1)

    if not args.target or not args.output_dir:
        print("Error: --target and --output-dir are required for export.")
        sys.exit(1)

    output_dir = args.output_dir.expanduser().resolve()
    if output_dir.exists() and not output_dir.is_dir():
        print(f"Error: output path is not a directory: {output_dir}")
        sys.exit(1)
    output_dir.mkdir(parents=True, exist_ok=True)

    exporter = export_to_codex if args.target == "codex" else export_to_copilot

    print(f"Exporting {len(plugins)} plugin(s) to {args.target} -> {output_dir}\n")
    for name in plugins:
        plugin = Plugin(name)
        print(f"[{name}]")
        exporter(plugin, output_dir)
        print()

    print("Done!")


if __name__ == "__main__":
    main()
