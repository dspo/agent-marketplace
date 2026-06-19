# Agent Skills Marketplace

A unified **Plugin Marketplace** for AI coding assistants, compatible with Claude Code, GitHub Copilot CLI, and OpenAI Codex.

Plugins are distributed as git repositories — users register a marketplace by its HTTPS URL, then install plugins by name without cloning the repository.

## Installation

### Claude Code

```bash
# Register the marketplace
# For private repositories use HTTPS + credentials: https://<user>:<token>@<git-host>/<org>/agent-marketplace.git
# For public repositories: https://<git-host>/<org>/agent-marketplace.git
/plugin marketplace add https://<git-host>/<org>/agent-marketplace.git

# Install plugins
/plugin install gitwork
/plugin install mimo
/plugin install exam-generator
/plugin install playwright-cli
/plugin install remora
```

> **Note:** SSH format (`git@host:...`) is not supported in Claude Code because its internal git clone environment cannot verify custom SSH host keys. Use HTTPS format instead.

Once registered, Claude Code caches the repository automatically. Subsequent `/plugin install <name>` calls pull from cache.

### GitHub Copilot CLI

```bash
# Register the marketplace (shares .claude-plugin/ index)
copilot plugin marketplace add https://<user>:<token>@<your-git-host>/<org>/agent-marketplace.git

# Install plugins
copilot plugin install gitwork
```

### OpenAI Codex

Codex discovers plugins via `.agents/plugins/marketplace.json` and reads metadata from each plugin's `.codex-plugin/plugin.json` and `skills/` directory.

## Available Plugins

| Plugin | Description |
|--------|-------------|
| **gitwork** | Git platform development assistant — deliver, review, resolve, and handle merge conflicts. Works with GitHub (`gh`) and GitLab (`glab`) CLI. |
| **mimo** | Programming assistant for code review, task delegation, and stop-gate reviews. |
| **exam-generator** | Exam generator from knowledge bases with LaTeX rendering and PDF export. |
| **playwright-cli** | Browser automation using playwright-cli for testing, screenshots, and data extraction. |
| **remora** | Self-contained task agent with built-in pi harness for cross-validation using non-Claude models. |

## Maintenance

When adding or modifying plugins:

1. Only touch `plugins/<name>/` and the two marketplace index files.
2. Claude Code, Copilot CLI, and Codex share `skills/<skill>/SKILL.md` — do not use root-level `SKILL.md`.
3. Codex uses `.codex-plugin/plugin.json` with `"skills": "./skills/"` pointing to the plugin's `skills/` directory.
4. `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` have different schemas and must be maintained separately.
5. For multi-skill plugins, each skill is maintained independently and references shared principle files via relative paths (e.g., `../../references/principles.md`).
6. `.claude/worktrees/` is excluded from git and should not be committed.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
