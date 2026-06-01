---
name: gitlab-dev
description: Guide for GitLab development workflows involving issues, merge requests, pipelines, gitlab-flow, or worktrees. Use when tasks must be delivered through GitLab objects instead of stopping at local changes.
---

# Gitlab dev

本文件是本仓库 GitLab 任务工作流的主说明，避免在 repo-wide 或 path-specific instructions 中重复维护同类规则。

当任务涉及 GitLab、Merge Request、Issue、Pipeline、`.gitlab-ci.yml`、GitLab Flow 或 worktree 时，请遵循本说明。

## 任务分类

### 全新任务

1. 先从 GitLab 读取对应 Issue 或任务上下文。
2. 同步远端默认分支的最新内容。
3. 从最新默认分支切出新分支。
4. 为该分支创建独立 worktree，并在该 worktree 中独立完成实现。
5. 完成验证、提交、推送，并创建新的 **Merge Request** 交付成果。

### 继续任务

1. 先定位该任务已有的 Issue、MR、Branch 和 Worktree。
2. 如果这些资产已经存在，优先复用，不要重复创建分支、worktree 或 MR。
3. 在原 branch / worktree 基础上补齐未完成项、修复缺陷并继续推进。
4. 最终更新同一个 MR 交付结果。

### Review 任务

1. 先定位该任务对应的 Issue、MR、Branch 和 Worktree。
2. 能在本地完成 review 时，优先使用本地 checkout、diff、流水线状态和相关代码做 review，以降低在线 review 的成本。
3. Review 结论必须回写到 GitLab：优先使用 `glab`；只有 `glab` 明显不支持或受限时，再回退到 GitLab MCP。
4. 最终交付物应是已经提交到 MR 评论区的 review 意见，而不是仅在本地口头总结。

### 其他任务

1. 对流水线、评论、状态检查、杂项维护等 GitLab 任务，优先使用 `glab`。
2. 只有 `glab` 明显不支持时，才回退到 GitLab MCP。
3. 无论任务类型如何，只要任务属于 GitLab 工作流，最终都要落实到对应 GitLab 对象上，而不是停留在本地。

## 执行原则

1. 一旦任务边界和验收条件已经明确，就应端到端独立 solo，直到所有要求全部落地。
2. 不允许只做占位、不允许只完成某个子步骤后提前停下，也不允许在任务未完成时无故中断。
3. 一个任务优先对应一个 branch、一个 worktree、一个 MR；如果已有对应资产，就复用它们。
4. 如果被认证、权限、远端配置或工具能力阻塞，要明确指出阻塞点，以及继续推进所缺失的 GitLab 条件。

## 多 agent 协作

1. 适合并行拆分时，推荐使用多个 agent 提升速度，例如实现、review、流水线排查分别并行处理。
2. 每个 agent 应只负责一个 branch / worktree / MR，避免相互覆盖。
3. Review agent 应优先给出 review 结论并回写 MR，而不是直接改动实现 worktree。
4. 并行协作时，要把 handoff 信息落到 Issue、MR 评论或其他 GitLab 上下文里，而不是依赖隐式记忆。

## 工具优先级

1. 操作 Git 仓库（branch、commit、rebase、worktree、diff、fetch、push 等）时，优先使用 `git`。
2. 操作 GitLab 对象（MR、Issue、评论、Pipeline、状态检查等）时，优先使用 `glab`，GitLab MCP 作为后备。
3. 只有在前序工具不支持所需动作时，才回退到后序工具。
4. 如果 GitLab 认证或权限失败，要明确说明阻塞点，并引导恢复访问。
5. 如果必须用 `glab`，但本机缺失或未认证，也要明确指出，而不是静默放弃 GitLab 工作流。

## 偏好

1. 完成代码变更后，要**主动提出、创建或更新 MR**。
2. 合并 MR 时，偏好 删除源分支 + 压缩提交 + 中文编写提交消息；确认合并完成后，清理本地对应的 worktree（若该 worktree 仍承载未合并任务或存在明确保留理由，则先说明原因再保留）。

## 批量 review & resolve & merge MRs

1. 明确 MR 处理顺序，尤其是依赖顺序。注意 MR 序号不一定是与处理顺序一致。明确顺序后要串行处理防止冲突，这类任务如果 MR 之间可能叠层或共享基线，应优先建依赖图，不要默认并行。
2. 每合并一个 MR 后，剩余 MR 必须立刻基于最新 `origin/main` 更新，防止后续 MR 的 mergeable 状态滞后。
3. 不要轻信 server-side rebase，要以 MR `detailed_merge_status`、`diff_refs`、pipeline 和实际 head 为准。
4. 遇到本地 worktree 脏或旧分支时，不要在原 worktree 上硬 rebase。更安全的技巧是新建 detached clean worktree 做冲突解决，验证通过后用 `--force-with-lease` 推回源分支。
5. Review 结论要回写 MR 留痕，而不是只在本地总结。本轮各 MR 的问题与修复都已通过 MR comment 留痕。
6. 合并时使用 `--sha` 锁定已 review 的 head，避免在 pipeline/rebase 期间误合并新提交。执行合并要符合偏好。
7. 清理时要区分“可删的干净临时 worktree”和“可能含用户内容的旧 worktree”，避免误删。

操作流程伪代码：

```text
sort_dependencies(MRs)
for mr in MRs:
    for mr.is_conflict:
        resolve_conflicts(mr)
    for true:
        review(mr)
        if mr.has_unresolved_comments:
            resolve_comments(mr)
        else:
            break
    merge(mr)
```

## 交付要求

- 只要任务遵循 GitLab 工作流，最终交付物就应当是一个 **MR 链接** 或 **已更新的 MR 链接**。
- 对 review 任务，最终交付物还应包括已经提交到 MR 评论区的 review 意见。
- 如果任务本应通过 GitLab 交付，那么仅有本地代码变更并不算交付完成。
- 如果 MR 因阻塞无法交付，必须明确报告阻塞原因。
