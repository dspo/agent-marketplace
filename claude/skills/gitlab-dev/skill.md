---
name: gitlab-dev
description: Guide for GitLab development workflows involving issues, merge requests, pipelines, gitlab-flow, or worktrees. Use when tasks must be delivered through GitLab objects instead of stopping at local changes.
---

# Gitlab dev

本文件是在仓库基于 GitLab / Github 工作流的主说明。

当任务涉及 GitLab、Merge Request、Issue、Pipeline、`.gitlab-ci.yml`、GitLab Flow、worktree、review MR 时，请遵循本说明。

## 任务分类

按任务的类型，可以分为：

- 开发：新功能设计、开发，Bugfix，重构等。
- Review：审查给定的 MR / PR.

按 Agent 介入的时机，可以将任务分为：

- 全新任务
- 中继任务

接手一个任务后，如果已有独立 worktree，应当找到对应的 worktree，在该 worktree 上工作。
如果没有独立 worktree，应当先 **git fetch 远端最新主分支**，基于远端最新主分支，创建独立 worktree，再在该 worktree 上工作。

对于全新开发任务，应当充分理解用户需求。如果已有 Issue，应当先读取 Issue，如果没有 Issue，可选先创建 Issue。
对于先进行 plan 的任务，应当将 plan 原文终稿作为 Issue 的正文，若无须 Issue，则应当作为 MR 的描述正文。
对于开发任务，应当完成验证、提交、推送，并创建新的 **Merge Request** 交付成果。

对于中继任务，应当先获取到相关 Issue、MR、Branch、Worktree、Plan、目标等背景。
如果这些资产已存在，则优先复用。如无，则按需创建。
一般来说，应当基于原 branch / worktree 补完未完成的工作、修复未完成的缺陷，更新原 MR。

对于 Review 任务，应当先定位该任务对应的 Issue、MR、Branch 和 Worktree。
尝试找到 MR 在本地的 worktree。优先在本地 worktree 进行 review，降低现在 review 的成本。
有时 review 还要关注流水线状态。
review 结果要口头汇报，同时在 MR 评论区留痕。

无论任务类型如何，只要任务属于 GitLab 工作流，最终都要落实到对应 GitLab 对象上，而不是停留在本地。

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

1. 操作 Git 仓库（branch、commit、rebase、worktree、diff、fetch、push 等）使用 `git`。
2. 操作 GitLab 对象（MR、Issue、评论、Pipeline、状态检查等）使用 `glab`。
3. 如果 GitLab 认证或权限失败，要明确说明阻塞点，并引导恢复访问。
4. 如果非要使用 gitlab mcp 不可，但本机缺失或未认证，也要明确指出，而不是静默放弃 GitLab 工作流。如需要认证，应当主动触发打开浏览器请用户进行认证，而不是要求用户拷贝链接到浏览器中打开进行认证。

```bash
glab -h

 GLab is an open source GitLab CLI tool that brings GitLab to your command line.

 USAGE


   glab <command> <subcommand> [command] [--flags]


 COMMANDS

   alias [command] [--flags]                  Create, list, and delete aliases.
   api <endpoint> [--flags]                   Make an authenticated request to the GitLab API.
   attestation <command> [command] [--flags]  Manage software attestations. (EXPERIMENTAL)
   auth <command> [command]                   Manage glab's authentication state.
   changelog <command> [command] [--flags]    Interact with the changelog API.
   check-update                               Check for latest glab releases.
   ci <command> [command] [--flags]           Work with GitLab CI/CD pipelines and jobs.
   cluster <command> [command] [--flags]      Manage GitLab Agents for Kubernetes and their clusters.
   completion [--flags]                       Generate shell completion scripts.
   config [command] [--flags]                 Manage glab settings.
   deploy-key <command> [command] [--flags]   Manage deploy keys.
   duo <command> prompt [command]             Work with GitLab Duo
   gpg-key <command> [command] [--flags]      Manage GPG keys registered with your GitLab account.
   help [command]                             Help about any command
   incident [command] [--flags]               Work with GitLab incidents.
   issue [command] [--flags]                  Work with GitLab issues.
   iteration <command> [command] [--flags]    Retrieve iteration information.
   job <command> [command] [--flags]          Work with GitLab CI/CD jobs.
   label <command> [command] [--flags]        Manage labels on remote.
   mcp <command> [command]                    Work with a Model Context Protocol (MCP) server. (EXPERIMENTAL)
   milestone <command> [command] [--flags]    Manage group or project milestones.
   mr <command> [command] [--flags]           Create, view, and manage merge requests.
   opentofu <command> [command] [--flags]     Work with the OpenTofu or Terraform integration.
   release <command> [command] [--flags]      Manage GitLab releases.
   repo <command> [command] [--flags]         Work with GitLab repositories and projects.
   schedule <command> [command] [--flags]     Work with GitLab CI/CD schedules.
   securefile <command> [command] [--flags]   Manage secure files for a project.
   snippet <command> [command] [--flags]      Create, view and manage snippets.
   ssh-key <command> [command] [--flags]      Manage SSH keys registered with your GitLab account.
   stack <command> [command] [--flags]        Create, manage, and work with stacked diffs. (EXPERIMENTAL)
   token [command] [--flags]                  Manage personal, project, or group tokens
   user <command> [command] [--flags]         Interact with a GitLab user account.
   variable [command] [--flags]               Manage variables for a GitLab project or group.
   version                                    Show version information for glab.

 FLAGS

   -h --help                                  Show help for this command.
   -v --version                               Show glab version information
```

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
