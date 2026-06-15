# Agent Marketplace

花易项目的统一 **Plugin Marketplace**，同时兼容 Claude Code、GitHub Copilot CLI 和 OpenAI Codex。

用户无需 clone 本仓库——直接通过 Git 仓库地址在线注册 marketplace，即可安装插件。

## 安装

### Claude Code

```bash
# 注册 marketplace（使用 Git 仓库地址，无需 clone）
/plugin marketplace add git@git.huayi.tech:2222/huayi/shared/agent-marketplace.git

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
copilot plugin marketplace add git@git.huayi.tech:2222/huayi/shared/agent-marketplace.git

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
2. Claude Code / Copilot CLI 和 Codex 共享 `skills/<skill>/SKILL.md`，不再使用根级 `SKILL.md`。
3. Codex 使用 `.codex-plugin/plugin.json`（其中 `"skills": "./skills/"` 指向插件根目录下的 `skills/`）。
4. `.claude-plugin/marketplace.json` 与 `.agents/plugins/marketplace.json` 需要分别维护各自 schema。
5. 多 skill 插件的每个 skill 独立维护，引用共享原则文件（`references/principles.md`）而非互相复制内容。
6. `.claude/worktrees/` 不应提交到 Git，已在 `.gitignore` 中排除。
