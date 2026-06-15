# huayi-dev-agent-skills

花易项目的统一 **Plugin Marketplace**，同时兼容 Claude Code、GitHub Copilot CLI 和 OpenAI Codex。

用户无需 clone 本仓库——直接通过 Git 仓库地址在线注册 marketplace，即可安装插件。

## 安装

### Claude Code

```bash
# 注册 marketplace（使用 Git 仓库地址，无需 clone）
/plugin marketplace add ssh://git@git.huayi.tech:2222/huayi/shared/agent-marketplace.git

# 安装插件
/plugin install gitlab-dev
/plugin install mimo
/plugin install exam-generator
/plugin install playwright-cli
```

注册后 Claude Code 会自动拉取仓库缓存，后续 `/plugin install` 即可按名称安装。

### GitHub Copilot CLI

```bash
# 注册 marketplace（Copilot CLI 共享 .claude-plugin/ 索引）
copilot plugin marketplace add ssh://git@git.huayi.tech:2222/huayi/shared/agent-marketplace.git

# 安装插件
copilot plugin install gitlab-dev
```

### OpenAI Codex

Codex 通过 `.agents/plugins/marketplace.json` 发现插件，并从每个插件目录下的
`.codex-plugin/plugin.json` 与 `skills/` 读取插件元数据和 skill。

## 项目结构

```text
├── .gitignore
├── .claude-plugin/marketplace.json       # Claude Code + Copilot CLI 共享索引
├── .agents/plugins/marketplace.json      # OpenAI Codex 索引
├── plugins/                              # 统一插件源码
│   ├── gitlab-dev/
│   │   ├── .codex-plugin/plugin.json
│   │   ├── skills/gitlab-dev/SKILL.md
│   │   ├── plugin.json
│   │   └── SKILL.md
│   ├── mimo/
│   │   ├── plugin.json
│   │   ├── SKILL.md
│   │   ├── hooks/hooks.json
│   │   ├── agents/mimo-rescue.md
│   │   ├── commands/*.md
│   │   ├── prompts/*.md
│   │   ├── schemas/review-output.schema.json
│   │   ├── scripts/*.mjs                 # 编译产物（已提交）
│   │   └── _build/                       # TypeScript 源码和构建配置
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
6. `.claude/worktrees/` 不应提交到 Git，已在 `.gitignore` 中排除。
