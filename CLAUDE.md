# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

This repository is a unified **Plugin Marketplace** for AI coding assistants, compatible with Claude Code, GitHub Copilot CLI, and OpenAI Codex.

- `.claude-plugin/marketplace.json` — Claude Code + Copilot CLI shared index
- `.agents/plugins/marketplace.json` — OpenAI Codex index
- `plugins/` — Plugin source directory

## Architecture

```
├── .claude-plugin/marketplace.json
├── .agents/plugins/marketplace.json
└── plugins/<name>/
    ├── plugin.json                  # Claude Code / Copilot CLI descriptor
    ├── .codex-plugin/plugin.json    # Codex manifest
    ├── skills/<skill>/SKILL.md      # Claude Code + Codex shared skill entry
    └── [references|templates|examples]/  # Optional supporting files
```

## Installation

```bash
/plugin marketplace add https://<git-host>/<org>/agent-marketplace.git
/plugin install gitwork
```

## Maintenance Rules

1. When adding or modifying plugins, only change `plugins/<name>/` and the two marketplace index files.
2. Claude Code, Copilot CLI, and Codex share `skills/<skill>/SKILL.md` — do not use root-level `SKILL.md`.
3. Codex uses `.codex-plugin/plugin.json` (where `"skills": "./skills/"` points to the plugin's `skills/` directory).
4. `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` have different schemas and must be maintained separately.
5. For multi-skill plugins, each skill is maintained independently and references shared principle files using relative paths from the skill's own directory (e.g., `../../references/principles.md`) rather than copying content between skills.
