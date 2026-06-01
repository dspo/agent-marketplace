# Skills Sync Tool

同步 `plugins/`（Plugin Marketplace 源文件）到 `claude/`、`codex`、`copilot` 目录。

## 架构

```
plugins/<name>/                 # 唯一源文件（Plugin Marketplace 格式）
  ├── .claude-plugin/plugin.json
  ├── .copilot.yaml              # Copilot commands 配置（可选）
  └── skills/<name>/
      ├── SKILL.md               # 主文件（frontmatter + Markdown）
      ├── scripts/               # 工具脚本
      ├── references/            # 参考资料
      └── examples/              # 示例

# 运行 scripts/sync-skills.py 后自动生成：
claude/skills/<name>/           # Claude Code（传统方式）
codex/skills/<name>/            # Codex（OpenAI）
copilot/skills/<name>/          # Copilot（GitHub）
```

## 使用

```bash
# 列出所有 plugins
python scripts/sync-skills.py --list

# 同步所有 plugins
python scripts/sync-skills.py --all

# 同步单个 plugin
python scripts/sync-skills.py --skill <name>

# 为所有 plugin 生成 .copilot.yaml 模板
python scripts/sync-skills.py --init-copilot
```

## 添加新 Skill

1. 在 `plugins/` 下创建新目录：
   ```
   plugins/my-skill/
     ├── .claude-plugin/plugin.json
     ├── .copilot.yaml              # 可选
     └── skills/my-skill/
         ├── SKILL.md
         └── ...
   ```

2. 运行同步：
   ```bash
   python scripts/sync-skills.py --skill my-skill
   ```

## 注意事项

- **唯一源文件**：`plugins/` 是唯一的源，不要手动修改 `claude/`、`codex`、`copilot` 目录中的内容
- **自动替换路径**：脚本会自动替换不同平台的路径变量（如 `${CLAUDE_PLUGIN_ROOT}` → `${CODEX_PLUGIN_ROOT}`）
- **文件名转换**：`SKILL.md` → `skill.md`（Codex/Copilot/Claude 使用小写文件名）
- **Copilot commands**：在 `.copilot.yaml` 中定义 commands，脚本会自动合并到 Copilot 的 `skill.md`
