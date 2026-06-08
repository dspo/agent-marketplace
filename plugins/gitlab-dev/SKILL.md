---
name: gitlab-dev
description: GitLab 开发工作流指南 —— 适用于 issue、merge request、pipeline、gitlab-flow、worktree 与 review 交付
---

# GitLab 开发工作流

当任务涉及 GitLab 对象或需要通过 GitLab 交付时，遵循本说明，而不是只停留在本地代码变更。

适用场景：
- Issue / Merge Request / Pipeline
- `.gitlab-ci.yml` 或 GitLab Flow 相关改动
- 需要新建 branch、worktree、MR 的研发任务
- 需要在 MR 中完成 review、回写评论、跟进流水线的任务

## 基本原则

1. GitLab 任务必须交付到对应 GitLab 对象上，通常是 **MR 链接** 或 **已更新的 MR 链接**。
2. 优先复用已有 branch、worktree、MR，不重复造资产。
3. 操作 GitLab 对象时优先用 `glab`；只有 `glab` 不支持时才回退到其他接口。
4. 完成实现后要主动提交、推送，并创建或更新 MR。
5. 如果被认证、权限、远端配置或工具能力阻塞，要明确说清阻塞点。

## 任务类型

### 1. 全新任务

1. 先读取 GitLab 上下文：Issue、已有讨论、相关 MR、流水线约束。
2. 同步默认分支最新内容。
3. 基于最新默认分支创建新 branch。
4. 为该 branch 建独立 worktree，在该 worktree 中完成实现。
5. 验证后提交、推送，并创建新的 MR。

### 2. 继续已有任务

1. 先定位已有的 branch、worktree、MR。
2. 如果这些资产已经存在，优先复用。
3. 在原有上下文中补齐未完成项、修复缺陷、继续推进。
4. 最终更新同一个 MR，而不是另起一套交付物。

### 3. Review 任务

1. 先定位对应 MR、分支、流水线和本地 checkout。
2. 能在本地 review 时，优先使用本地 diff、代码和流水线信息。
3. Review 结论必须回写到 GitLab，优先使用 `glab` 评论到 MR。
4. 最终交付物不是口头总结，而是已经提交到 MR 的 review 意见。

### 4. 流水线 / 杂项维护

1. 处理 pipeline、comment、状态检查、标签等任务时，优先使用 `glab`。
2. 仍然要把结果落到 GitLab 对象上，而不是只在本地说明。

## 推荐流程

```text
read_gitlab_context()
reuse_existing_assets_if_any()
if no_existing_branch:
    sync_default_branch()
    create_branch_and_worktree()
implement_and_validate()
commit_and_push()
create_or_update_mr()
if task_is_review:
    publish_review_comments_to_mr()
```

## 工具优先级

1. Git 仓库操作：`git`
2. GitLab 对象操作：`glab`
3. 只有前两者不支持时，才回退到其他方式

## Worktree

新 worktree 放到 root worktree 平级，而不是放到 root worktree 下的子目录中。
新 worktree 命名规则 `${root_worktree_name}--$(basename "$branch_name")`.

## 交付要求

- GitLab 工作流任务的最终交付物应是 **MR 链接** 或 **已更新的 MR 链接**。
- Review 任务还应包括已经回写到 MR 的评论。
- 如果无法交付，必须明确说明阻塞原因，而不是把“本地已改完”当成完成。
