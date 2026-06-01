# Compatibility Export Tool

`plugins/` 是仓库里的唯一源文件。这个目录下的脚本只负责把 plugin skills **按需导出** 为 Codex 或 Copilot 可复用的兼容产物；仓库本身不再维护 `codex/`、`copilot/` 目录。

## 输入与输出

```text
plugins/<name>/                 # 唯一源文件
  ├── .claude-plugin/plugin.json
  ├── .copilot.yaml             # 仅 Copilot 导出时使用，可选
  └── skills/<name>/
      ├── SKILL.md
      ├── scripts/
      ├── references/
      ├── examples/
      └── templates/

# 运行 scripts/sync-skills.py 后，导出到你指定的目录：
<output-dir>/<name>/
```

## 使用

```bash
# 列出所有 plugin
python3 scripts/sync-skills.py --list

# 导出全部 plugins 到 Codex
python3 scripts/sync-skills.py --target codex --output-dir ~/.codex/skills --all

# 导出单个 plugin 到 Copilot
python3 scripts/sync-skills.py --target copilot --output-dir ~/.copilot/skills --skill database-access

# 为 plugins 生成 Copilot 配置模板
python3 scripts/sync-skills.py --init-copilot
```

## 规则

- `plugins/` 永远是唯一 source of truth。
- `.copilot.yaml` 是 Copilot 导出用的源配置，不代表仓库继续维护 Copilot 目录。
- 导出时会自动把 `SKILL.md` 转成 `skill.md`，并替换平台路径变量。
- 不要把导出的 `codex/` 或 `copilot/` 目录重新提交回仓库。
