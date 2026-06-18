# GitLab 开发共享原则

所有 gitlab-dev sub-skill 都遵循以下原则。当本文件与具体 skill 文档冲突时，以具体 skill 文档为准。

## 基本原则

1. GitLab 任务必须交付到对应 GitLab 对象上，通常是 **MR 链接** 或 **已更新的 MR 链接**。
2. 优先复用已有 branch、worktree、MR，不重复造资产。
3. 操作 GitLab 对象时优先用 `glab`；只有 `glab` 不支持时才回退到其他接口。
4. 完成实现后要主动提交、推送，并创建或更新 MR。
5. 如果被认证、权限、远端配置或工具能力阻塞，要明确说清阻塞点。

## 工具优先级

| 操作 | 优先工具 | 回退方案 |
|------|----------|----------|
| 仓库操作（branch、commit、worktree） | `git` | — |
| GitLab 对象（MR、Issue、Pipeline、Note） | `glab` | GitLab REST API（`curl`）或 MCP |
| 其他 | 当前环境最可用工具 | — |

## Worktree 规则

> **强制规则**：所有代码实现必须在 worktree 中完成，严禁在 root worktree（主目录）进行任何代码变更。

- 新 worktree 放到 **root worktree 平级**，而不是放到 root worktree 下的子目录中。
- 命名规则：`${root_worktree_name}--$(basename "$branch_name")`
- 例如：root worktree 为 `huayi-dev-agent-skills`，branch 为 `fix/codex-marketplace-install`，则 worktree 名为 `huayi-dev-agent-skills--fix-codex-marketplace-install`。
- 每次开始实现前，用 `git worktree list` 确认当前所在目录不是 root worktree。

## 交付要求

- GitLab 工作流任务的最终交付物应是 **MR 链接** 或 **已更新的 MR 链接**。
- Review 任务还应包括已经回写到 MR 的评论。
- 如果无法交付，必须明确说明阻塞原因，而不是把"本地已改完"当成完成。
