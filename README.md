# huayi-dev-agent-skills

花易项目的 **Claude Code Plugin Marketplace** 仓库。这里长期维护的只有 Claude Code marketplace 元数据和 `plugins/` 源文件；`plugins/` 是唯一 source of truth。

**不会再在仓库内长期维护** `codex/`、`copilot/` 这类平台产物目录。如果需要给 Codex 或 Copilot 复用本仓库的 plugin/skill，请按需从 `plugins/` 导出兼容产物。

## Claude Code 使用方式

```bash
/plugin marketplace add /path/to/huayi-dev-agent-skills
/plugin install database-access
/plugin install gitlab-dev
/plugin install go-spec-review
/plugin install exam-generator
/plugin install playwright-cli
```

## 仓库定位

1. `.claude-plugin/marketplace.json` 定义 marketplace。
2. `plugins/<name>/` 保存每个 Claude Code plugin 的唯一源文件。
3. `scripts/sync-skills.py` 只负责按需导出 Codex/Copilot 兼容技能，不再生成并维护仓库内目录。

## Codex / Copilot 复用口子

需要复用时，直接从 `plugins/` 导出到目标目录：

```bash
# 导出到 Codex
python3 scripts/sync-skills.py --target codex --output-dir ~/.codex/skills --all

# 导出单个 plugin 到 Copilot
python3 scripts/sync-skills.py --target copilot --output-dir ~/.copilot/skills --skill database-access
```

也可以导出到项目本地目录：

```bash
python3 scripts/sync-skills.py --target codex --output-dir "$PWD/.codex/skills" --all
python3 scripts/sync-skills.py --target copilot --output-dir "$PWD/.copilot/skills" --all
```

详细说明见 [doc/skills-installation.md](doc/skills-installation.md)。

## 项目结构

```text
├── .claude-plugin/marketplace.json     # Claude Code marketplace 目录
├── plugins/                            # 唯一源文件
│   ├── database-access/
│   ├── gitlab-dev/
│   ├── go-spec-review/
│   ├── exam-generator/
│   ├── huayi-dev/
│   └── playwright-cli/
├── scripts/sync-skills.py              # Codex/Copilot 兼容导出脚本
└── doc/skills-installation.md          # 兼容复用指南
```

## 依赖

```bash
pip install pyyaml pymysql
```

Python 3.10+ required.
