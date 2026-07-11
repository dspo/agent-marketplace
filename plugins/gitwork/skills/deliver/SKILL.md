---
name: deliver
description: 实现需求并交付 PR/MR —— 新建或继续 branch，实现变更，推送并创建/更新 PR/MR，可选合并并清理 worktree（GitHub / GitLab 通用）
---

# 实现需求并交付 PR/MR

当需要实现一个需求（来自 Issue、用户指令或已有讨论）并通过 git 平台（GitHub PR / GitLab MR）交付时，遵循本流程。

通用原则见 [principles.md](../../references/principles.md)。先按「平台探测」确定平台，下文命令按平台二选一。

## 流程

### 1. 读取平台上下文

先了解当前任务的背景：

```bash
# 如果任务来自 Issue
gh issue view <issue-id>        # GitHub
glab issue view <issue-id>      # GitLab

# 查看项目已有的 PR/MR
gh pr list --search "<关键词>"    # GitHub
glab mr list --search=<关键词>   # GitLab

# 查看默认分支最新状态
git fetch origin
git log origin/<default-branch> --oneline -5
```

重点关注：
- Issue 中的讨论和约束
- 是否已有相关 PR/MR 正在进行
- 默认分支最新提交

### 2. 复用或创建资产

**如果已有相关 branch/worktree/PR/MR**：
- 定位已有资产，在原有上下文中继续推进
- 最终更新同一个 PR/MR，而不是另起一套交付物

```bash
# 查看本地已有 worktree
git worktree list

# 查看已有 PR/MR
gh pr list --author @me        # GitHub
glab mr list --author=@me      # GitLab
```

**如果没有已有资产**：

```bash
# 同步默认分支
git fetch origin

# 创建新 branch（从最新默认分支）
git checkout -b <branch-name> origin/<default-branch>

# 创建 worktree（按 principles.md 的命名规则）
git worktree add ../<root-worktree-name>--<branch-slug> <branch-name>
```

### 3. 实现并验证

> **强制要求**：所有代码变更必须在专用 worktree 中完成。严禁在主目录（root worktree）进行任何代码变更或实现工作，否则 PR/MR 将无法正确关联到 branch，导致交付失败。

在 worktree 中完成实现：
- 遵循项目代码规范和 CLAUDE.md 指引
- 运行测试验证变更正确性
- 确保没有引入明显的 bug 或风格问题

> **如何确认已在 worktree 中**：执行 `git worktree list`，确保当前工作目录不是 root worktree（如 `agent-skills`），而是专用 worktree（如 `agent-skills--<branch-slug>`）。

### 4. 提交并推送

```bash
# 提交变更
git add -A
git commit -m "<commit-message>"

# 推送到远端
git push -u origin <branch-name>
```

### 5. 创建或更新 PR/MR

```bash
# 新建 PR（GitHub）
gh pr create \
  --title "<title>" \
  --body "<description>" \
  --base <default-branch> \
  --head <branch-name>

# 新建 MR（GitLab）
glab mr create \
  --title "<title>" \
  --description "<description>" \
  --target-branch <default-branch> \
  --source-branch <branch-name>

# 或更新已有 PR/MR（推送后自动更新）
git push
```

PR/MR 描述中建议包含：
- 关联的 Issue 编号（`Closes #<issue-id>`）
- 变更概述
- 验证方式

### 6. 处理 Pipeline / Checks 失败

如果 PR/MR 创建后 CI 失败：

```bash
# 查看 checks 状态（GitHub）
gh pr checks <pr-id>
gh run view <run-id> --log-failed

# 查看 pipeline 状态（GitLab）
glab mr view <mr-id> --comments
glab ci trace <pipeline-id>

# 根据失败原因修复，提交推送更新 PR/MR
```

### 7. 合并 PR/MR 并清理 worktree

> **强制要求**：合并（`gh pr merge` / `glab mr merge`）**必须在 root worktree 中执行，严禁在 feature worktree 内执行**。`gh pr merge` 会尝试 checkout 默认分支，而该分支已被 root worktree 占用，在 feature worktree 内执行会报 `fatal: '<branch>' is already used by worktree`。feature worktree 仅用于实现阶段（见步骤 3）。

待所有 Checks 通过、review 已获准后：

```bash
# 回到 root worktree 并同步默认分支（绝不在 feature worktree 内执行 merge）
cd <root-worktree-directory>
git checkout <default-branch>
git pull origin <default-branch>

# 合并（GitHub，按平台惯例选 squash / merge / rebase）
gh pr merge <pr-id> --squash --delete-branch

# 合并（GitLab）
glab mr merge <mr-id> --squash

# 用 PR/MR 状态确认合并结果——不要依赖 merge 命令的退出码
# （merge 命令在 worktree race 等场景下可能报错但实际已合并）
gh pr view <pr-id> --json state,mergeCommit -q '"\(.state) \(.mergeCommit.oid)"'   # GitHub
glab mr view <mr-id> --json state,merge_status                                     # GitLab
```

确认 `state` 为 `MERGED` / `merged` 后，再清理 feature worktree：

```bash
git worktree remove ../<root-worktree-name>--<branch-slug>
git branch -D <branch-name>   # 远端分支已由 --delete-branch 删除
```

> **不要**在合并结果未确认时就 `worktree remove`：若 merge 实际未完成，提前清理 worktree 会丢失未推送的本地修复。先 `--json state` 确认，再清理。

## 交付物

- **PR/MR 链接** 或 **已更新的 PR/MR 链接**
- 如果无法交付，必须明确说明阻塞原因
