# huayi-dev-agent-skills

花易项目的统一 **Plugin Marketplace** 仓库，同时兼容 Claude Code、GitHub Copilot CLI 和 OpenAI Codex。

`plugins/` 是唯一 source of truth。每个插件目录同时保留：

- 面向 Claude Code / Copilot CLI 的根级 `plugin.json` 与 `SKILL.md`
- 面向 Codex 的 `.codex-plugin/plugin.json` 与 `skills/<skill>/SKILL.md`

## 使用方式

### Claude Code / Copilot CLI

```bash
# 注册 marketplace（Claude Code 和 Copilot CLI 共享 .claude-plugin/ 索引）
/plugin marketplace add /path/to/huayi-dev-agent-skills        # Claude Code
copilot plugin marketplace add /path/to/huayi-dev-agent-skills # Copilot CLI

# 安装插件
/plugin install gitlab-dev
/plugin install exam-generator
/plugin install playwright-cli
```

### OpenAI Codex

Codex 通过 `.agents/plugins/marketplace.json` 发现插件，并从每个插件目录下的
`.codex-plugin/plugin.json` 与 `skills/` 读取插件元数据和 skill。

## 项目结构

```text
├── .claude-plugin/marketplace.json       # Claude Code + Copilot CLI 共享索引
├── .agents/plugins/marketplace.json      # OpenAI Codex 索引
├── plugins/                              # 统一插件源码
│   ├── gitlab-dev/
│   │   ├── .codex-plugin/plugin.json
│   │   ├── skills/gitlab-dev/SKILL.md
│   │   ├── plugin.json
│   │   └── SKILL.md
│   ├── exam-generator/
│   │   ├── .codex-plugin/plugin.json
│   │   ├── skills/exam-generator/SKILL.md
│   │   ├── plugin.json
│   │   ├── SKILL.md
│   │   ├── examples/
│   │   └── templates/
│   └── playwright-cli/
│       ├── .codex-plugin/plugin.json
│       ├── skills/playwright-cli/SKILL.md
│       ├── plugin.json
│       ├── SKILL.md
│       └── references/
├── CLAUDE.md
└── README.md
```

## 维护规则

1. 新增或修改插件时，只改 `plugins/<name>/` 和两份 `marketplace.json`。
2. Claude Code / Copilot CLI 入口保持在根级 `plugin.json` 与 `SKILL.md`。
3. Codex 入口保持在 `.codex-plugin/plugin.json` 与 `skills/<skill>/SKILL.md`。
4. `.claude-plugin/marketplace.json` 与 `.agents/plugins/marketplace.json` 的 schema 不同，不要混用。
5. 若同一插件同时维护根级 `SKILL.md` 与 Codex `skills/<skill>/SKILL.md`，两者内容变更需要同步；Codex 版的文档链接必须按其自身目录重新校准相对路径。
