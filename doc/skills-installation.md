# Codex / Copilot 兼容复用指南

本仓库**不再维护**仓库内的 `codex/`、`copilot/` 目录。Claude Code marketplace 才是主发布面。

如果你仍然需要在 Codex 或 Copilot 中复用本仓库的 plugin/skill，请从 `plugins/` 按需导出兼容产物。

## 前提

```bash
git clone <repo-url> huayi-dev-agent-skills
cd huayi-dev-agent-skills
```

## 导出到 Codex

### 全量导出到用户目录

```bash
python3 scripts/sync-skills.py --target codex --output-dir ~/.codex/skills --all
```

### 单个 plugin

```bash
python3 scripts/sync-skills.py --target codex --output-dir ~/.codex/skills --skill database-access
```

### 导出到项目目录

```bash
python3 scripts/sync-skills.py --target codex --output-dir "$PWD/.codex/skills" --all
```

## 导出到 Copilot

### 全量导出到用户目录

```bash
python3 scripts/sync-skills.py --target copilot --output-dir ~/.copilot/skills --all
```

### 单个 plugin

```bash
python3 scripts/sync-skills.py --target copilot --output-dir ~/.copilot/skills --skill database-access
```

### 导出到项目目录

```bash
python3 scripts/sync-skills.py --target copilot --output-dir "$PWD/.copilot/skills" --all
```

## Copilot 配置来源

若 plugin 目录下存在 `.copilot.yaml`，导出到 Copilot 时会把其中的 `commands` 合并进生成后的 `skill.md`。这个文件是导出输入，不代表仓库继续维护 Copilot 专用目录。

## 注意事项

1. `plugins/` 才是唯一源文件，改动请只改那里。
2. 导出产物是兼容复用口子，不是本仓库的长期维护对象。
3. 如需更新兼容产物，请重新执行导出命令，而不是手改导出结果。
