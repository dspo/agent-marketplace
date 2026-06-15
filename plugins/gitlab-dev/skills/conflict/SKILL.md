---
name: conflict
description: 解决 MR 合并冲突 —— checkout source branch，merge target，本地解决冲突，推送更新 MR
---

# 解决 MR 合并冲突

当 MR 存在合并冲突需要本地解决时，遵循本流程。

通用原则见 [principles.md](references/principles.md)。

## 核心原则：尊重冲突双方的意图

解决冲突时，**必须先充分理解冲突双方各自的意图**，再决定如何合并。绝不能为了解决冲突而盲目删改——每一方改动都有其上下文和原因，忽略任何一方都可能引入 bug 或丢失重要功能。

具体要求：
1. **先理解，再合并**：阅读冲突区域的完整上下文，搞清楚 source branch 和 target branch 各自为什么做了这些改动。
2. **不遗漏任何一方**：解决后的代码必须保留两方的意图，不能简单选择一方丢弃另一方，除非有明确理由。
3. **有疑问则标注**：如果无法确定某一方改动的意图，在 MR 中留下评论说明你的判断和理由，而不是默默删除。

## 流程

### 1. 定位冲突 MR

```bash
# 查看 MR 合并状态
glab mr view <mr-id>

# 冲突信息通常在 MR 描述或 GitLab Web 界面中可见
# 如果 MR 显示 "merge conflict"，则进入下一步
```

也可以通过 GitLab API 玷取冲突详情：

```bash
# GET /projects/:id/merge_requests/:mr_id
# 查看 merge_status 字段
```

### 2. Checkout 源分支

在独立 worktree 中 checkout MR 的源分支（遵循 principles.md 的 worktree 规则）：

```bash
# fetch 源分支
git fetch origin <source-branch>

# 在 worktree 中 checkout
git worktree add ../<root-worktree-name>--<branch-slug> <source-branch>
```

或复用已有的 worktree。

### 3. Merge 目标分支并解决冲突

```bash
# 进入 worktree
cd ../<worktree-name>

# fetch 并 merge 目标分支
git fetch origin <target-branch>
git merge origin/<target-branch>

# 查看冲突文件
git diff --name-only --diff-filter=U
```

解决每个冲突文件：
- 打开冲突文件，选择正确的版本或合并两个版本的变更
- 确保解决后的代码逻辑正确，不遗漏任何一方的变更
- 删除冲突标记（`<<<<<<<`、`=======`、`>>>>>>>`）

### 4. 提交并推送

```bash
# 标记冲突已解决
git add <resolved-files>

# 提交 merge 结果
git commit -m "merge: 解决与 <target-branch> 的合并冲突"

# 推送更新 MR
git push
```

### 5. 确认 MR 状态

```bash
# 查看 MR 合并状态是否更新为 "can be merged"
glab mr view <mr-id>
```

## 常见冲突处理策略

- **双方修改同一文件不同区域**：保留两方修改，手动合并——通常两方意图互不冲突
- **一方删除文件、另一方修改文件**：先理解删除原因（重构？废弃？）和修改原因（新增功能？bugfix？），再决定恢复还是删除
- **双方修改同一行**：最难处理的场景——必须仔细阅读两方各自的 commit message 和 Issue 上下文，理解各自意图后手动组合，不能简单选择一方

## 交付物

- **无冲突的 MR 链接**（merge_status 为 "can be merged"）
- 如果无法解决冲突（如需要对方先 merge），必须说明原因
