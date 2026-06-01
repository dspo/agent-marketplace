#!/usr/bin/env python3
"""
Sync Plugin Marketplace skills to Claude Code (legacy), Codex, and Copilot formats.

Usage:
    python scripts/sync-skills.py --all
    python scripts/sync-skills.py --skill <name>
    python scripts/sync-skills.py --list

Source of truth: plugins/<name>/  (Plugin Marketplace format)
Generated targets:
    - codex/skills/<name>/
    - copilot/skills/<name>/
    - claude/skills/<name>/  (legacy, kept for backward compatibility)
"""

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).parent.parent.resolve()
PLUGINS_DIR = REPO_ROOT / "plugins"
CODEX_DIR = REPO_ROOT / "codex" / "skills"
COPILOT_DIR = REPO_ROOT / "copilot" / "skills"
CLAUDE_DIR = REPO_ROOT / "claude" / "skills"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def find_plugins() -> list[str]:
    """Return list of plugin names under plugins/."""
    if not PLUGINS_DIR.exists():
        return []
    return sorted(
        d.name for d in PLUGINS_DIR.iterdir()
        if d.is_dir() and (d / ".claude-plugin" / "plugin.json").exists()
    )


def read_file(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def copy_skill_tree(src: Path, dst: Path) -> None:
    """Copy directory tree, renaming SKILL.md -> skill.md on the fly."""
    if not src.exists():
        return

    if dst.exists():
        shutil.rmtree(dst)

    for item in src.rglob("*"):
        rel = item.relative_to(src)
        # Rename SKILL.md -> skill.md in target path
        target_name = rel.name
        if target_name == "SKILL.md":
            target_name = "skill.md"
        target = dst / rel.parent / target_name

        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from markdown text. Returns (metadata, body)."""
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
    """Build YAML frontmatter string."""
    import yaml
    fm = yaml.dump(data, allow_unicode=True, sort_keys=False)
    return f"---\n{fm}---\n"


# ---------------------------------------------------------------------------
# Plugin reader
# ---------------------------------------------------------------------------

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

    def read_skill(self) -> tuple[dict, str]:
        """Read the skill.md frontmatter and body."""
        text = read_file(self.skill_md)
        return parse_frontmatter(text)

    def read_plugin_json(self) -> dict:
        return json.loads(read_file(self.claude_plugin_json))

    def read_copilot_config(self) -> Optional[dict]:
        if self.copilot_yaml.exists():
            import yaml
            return yaml.safe_load(read_file(self.copilot_yaml)) or {}
        return None


# ---------------------------------------------------------------------------
# Codex sync
# ---------------------------------------------------------------------------

def sync_to_codex(plugin: Plugin) -> None:
    """Sync plugin to codex/skills/<name>/."""
    if not plugin.exists():
        print(f"  [SKIP] {plugin.name}: no skill found")
        return

    target_dir = CODEX_DIR / plugin.name
    copy_skill_tree(plugin.skills_dir, target_dir)

    # Path replacements: .claude -> .codex
    for md_file in target_dir.rglob("*.md"):
        content = read_file(md_file)
        new_content = content.replace("${CLAUDE_PLUGIN_ROOT}", "${CODEX_PLUGIN_ROOT}")
        new_content = new_content.replace("~/.claude/skills/", "~/.codex/skills/")
        new_content = new_content.replace(".claude/skills/", ".codex/skills/")
        if new_content != content:
            write_file(md_file, new_content)

    print(f"  [OK] codex/{plugin.name}/")


# ---------------------------------------------------------------------------
# Copilot sync
# ---------------------------------------------------------------------------

def sync_to_copilot(plugin: Plugin) -> None:
    """Sync plugin to copilot/skills/<name>/."""
    if not plugin.exists():
        print(f"  [SKIP] {plugin.name}: no skill found")
        return

    target_dir = COPILOT_DIR / plugin.name
    copy_skill_tree(plugin.skills_dir, target_dir)

    # Rewrite skill.md with Copilot format (commands)
    skill_md = target_dir / "skill.md"
    if skill_md.exists():
        meta, body = parse_frontmatter(read_file(skill_md))
        copilot_config = plugin.read_copilot_config()

        # Build Copilot frontmatter
        copilot_fm = {
            "name": plugin.name,
            "description": meta.get("description", ""),
        }

        if copilot_config and "commands" in copilot_config:
            copilot_fm["commands"] = copilot_config["commands"]

        # Write new skill.md
        new_content = build_frontmatter(copilot_fm)
        new_content += "\n" + body + "\n"

        # Path replacements: .claude -> .copilot
        new_content = new_content.replace("${CLAUDE_PLUGIN_ROOT}", "${COPILOT_PLUGIN_ROOT}")
        new_content = new_content.replace("~/.claude/skills/", "~/.copilot/skills/")
        new_content = new_content.replace(".claude/skills/", ".copilot/skills/")

        write_file(skill_md, new_content)

    print(f"  [OK] copilot/{plugin.name}/")


# ---------------------------------------------------------------------------
# Claude (legacy) sync
# ---------------------------------------------------------------------------

def sync_to_claude(plugin: Plugin) -> None:
    """Sync plugin to claude/skills/<name>/ (legacy format)."""
    if not plugin.exists():
        print(f"  [SKIP] {plugin.name}: no skill found")
        return

    target_dir = CLAUDE_DIR / plugin.name
    copy_skill_tree(plugin.skills_dir, target_dir)

    # Path replacements (self-referential, no change needed for .claude)
    for md_file in target_dir.rglob("*.md"):
        content = read_file(md_file)
        new_content = content.replace("${CLAUDE_PLUGIN_ROOT}", "${CLAUDE_PLUGIN_ROOT}")
        if new_content != content:
            write_file(md_file, new_content)

    print(f"  [OK] claude/{plugin.name}/")


# ---------------------------------------------------------------------------
# Copilot config template
# ---------------------------------------------------------------------------

def ensure_copilot_template(plugin: Plugin) -> bool:
    """
    Ensure .copilot.yaml exists for a plugin.
    Returns True if a new template was created, False if already exists.
    """
    if plugin.copilot_yaml.exists():
        return False

    template = """# Copilot skill configuration
# This file is the source of truth for Copilot commands generation.
# Edit it manually, then run: python scripts/sync-skills.py --skill {name}
#
# Commands define the CLI subcommands exposed by this skill in Copilot.
# Each command maps to a script in skills/{name}/scripts/
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


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Sync Plugin Marketplace skills to Codex/Copilot/Claude")
    parser.add_argument("--all", action="store_true", help="Sync all plugins")
    parser.add_argument("--skill", type=str, help="Sync specific plugin by name")
    parser.add_argument("--list", action="store_true", help="List available plugins")
    parser.add_argument("--init-copilot", action="store_true", help="Create .copilot.yaml templates for all plugins")
    args = parser.parse_args()

    plugins = find_plugins()

    if args.list:
        print("Available plugins:")
        for name in plugins:
            p = Plugin(name)
            desc = p.read_plugin_json().get("description", "")
            print(f"  - {name}: {desc}")
        return

    if args.init_copilot:
        print("Creating .copilot.yaml templates...")
        for name in plugins:
            p = Plugin(name)
            if ensure_copilot_template(p):
                print(f"  [NEW] plugins/{name}/.copilot.yaml")
            else:
                print(f"  [EXISTS] plugins/{name}/.copilot.yaml")
        print("\nPlease edit the generated .copilot.yaml files and re-run with --all")
        return

    if args.skill:
        if args.skill not in plugins:
            print(f"Error: plugin '{args.skill}' not found. Available: {', '.join(plugins)}")
            sys.exit(1)
        plugins = [args.skill]
    elif not args.all:
        print("Usage: python scripts/sync-skills.py [--all | --skill <name> | --list | --init-copilot]")
        sys.exit(1)

    print(f"Syncing {len(plugins)} plugin(s)...\n")

    for name in plugins:
        p = Plugin(name)
        print(f"[{name}]")
        sync_to_claude(p)
        sync_to_codex(p)
        sync_to_copilot(p)
        print()

    print("Done!")


if __name__ == "__main__":
    main()
