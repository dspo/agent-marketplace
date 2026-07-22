---
name: conflict
description: 解决 PR/MR 合并冲突 —— checkout source branch，merge target，本地解决冲突，推送更新（GitHub / GitLab 通用）
---

# 解决 PR/MR 合并冲突

通用原则见 [principles.md](../../references/principles.md)。

## 流程

1. **定位**：`gh pr view <id>` / `glab mr view <id>` 确认 conflict。
2. **Checkout + Merge**：在独立 worktree 中 checkout 源分支，`git merge origin/<target>`，解决冲突后提交推送。
3. **确认**：推送后验证 PR/MR 变为可合并。

**硬约束**：解决前理解双方意图，不可盲目删改。不确定时留评论说明。

交付：无冲突的 PR/MR 链接。
