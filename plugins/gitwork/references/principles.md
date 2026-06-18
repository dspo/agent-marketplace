# Git 平台开发共享原则

所有 gitwork sub-skill 都遵循以下原则。当本文件与具体 skill 文档冲突时，以具体 skill 文档为准。

## 基本原则

1. 围绕 git 平台的工作最终要交付到对应平台的对象上，通常是 **PR/MR 链接** 或 **已更新的 PR/MR 链接**。
2. 优先复用已有 branch、worktree、PR/MR，不重复造资产。
3. 操作平台对象时优先用对应平台的官方 CLI（见下文）；只有 CLI 不支持时才回退到 REST API 或 Web 界面。
4. 完成实现后要主动提交、推送，并创建或更新 PR/MR。
5. 如果被认证、权限、远端配置或工具能力阻塞，要明确说清阻塞点。

## 平台探测（先确定平台与术语）

在动手之前，根据 git 远端确定当前仓库属于哪个平台，从而选择正确的 CLI、对象名称和字段名。

```bash
# 查看远端地址
git remote -v
```

判断规则：

| 远端特征 | 平台 | CLI | 交付对象 | 分支字段 |
|----------|------|-----|----------|----------|
| `github.com` / GitHub 企业实例 | GitHub | `gh` | PR（Pull Request） | base / head |
| `gitlab.com` / 自建 GitLab（如 `git.huayi.tech`） | GitLab | `glab` | MR（Merge Request） | target-branch / source-branch |
| `gitee.com` / 其他 | 其他 | 平台对应 CLI / API | PR 或 MR | 按平台 |

约定：后文中以 **PR/MR** 表示当前平台的交付对象，**`<default-branch>`** 表示默认分支（如 `master`/`main`）。
每个 skill 的示例命令按平台分两组给出；执行时只取与当前平台对应的一组。

## CLI 命令映射

常用操作在 GitHub (`gh`) 与 GitLab (`glab`) 之间的对应关系：

| 操作 | GitHub (`gh`) | GitLab (`glab`) |
|------|---------------|-----------------|
| 列出 PR/MR | `gh pr list` | `glab mr list` |
| 查看 PR/MR | `gh pr view <id>` | `glab mr view <id>` |
| 查看 diff | `gh pr diff <id>` | `glab mr diff <id>` |
| 新建 PR/MR | `gh pr create --base <t> --head <s>` | `glab mr create --target-branch <t> --source-branch <s>` |
| 总体评论 | `gh pr comment <id> --body "..."` | `glab mr note <id> -m "..."` |
| 查看 Issue | `gh issue view <id>` | `glab issue view <id>` |
| CI / Pipeline 状态 | `gh pr checks <id>` | `glab ci trace <id>`、`glab mr view <id> --comments` |

> 行级评论、resolve discussion、merge 等高级操作两个 CLI 都支持有限，必要时回退到对应平台的 REST API（GitHub `/repos/.../pulls/.../comments`，GitLab `/projects/.../merge_requests/.../discussions`）或 Web 界面。

## 工具优先级

| 操作 | 优先工具 | 回退方案 |
|------|----------|----------|
| 仓库操作（branch、commit、worktree） | `git` | — |
| 平台对象（PR/MR、Issue、Pipeline、Note） | 平台官方 CLI（`gh` / `glab`） | 平台 REST API（`curl`）或 MCP |
| 其他 | 当前环境最可用工具 | — |

## Worktree 规则

> **强制规则**：所有代码实现必须在 worktree 中完成，严禁在 root worktree（主目录）进行任何代码变更。

- 新 worktree 放到 **root worktree 平级**，而不是放到 root worktree 下的子目录中。
- 命名规则：`${root_worktree_name}--$(basename "$branch_name")`
- 例如：root worktree 为 `huayi-dev-agent-skills`，branch 为 `fix/codex-marketplace-install`，则 worktree 名为 `huayi-dev-agent-skills--fix-codex-marketplace-install`。
- 每次开始实现前，用 `git worktree list` 确认当前所在目录不是 root worktree。

## 交付要求

- 围绕 git 平台的工作流任务，最终交付物应是 **PR/MR 链接** 或 **已更新的 PR/MR 链接**。
- Review 任务还应包括已经回写到 PR/MR 的评论。
- 如果无法交付，必须明确说明阻塞原因，而不是把"本地已改完"当成完成。
