---
name: deliver
description: 实现需求并交付 PR/MR —— 新建或继续 branch，实现变更，推送并创建/更新 PR/MR（GitHub / GitLab 通用）
---

# 实现需求并交付 PR/MR

通用原则见 [principles.md](../../references/principles.md)。

## 流程

### 1. 准备资产

若来自 Issue：`gh issue view <id>` / `glab issue view <id>`。已有 branch/worktree/PR → 复用。否则新建 worktree（principles.md worktree 规则）。

### 2. 实现并提交

**硬约束**：所有代码变更在专用 worktree 中完成，严禁在 root worktree 编码。

### 3. 创建/更新 PR/MR

```bash
gh pr create --title "<t>" --body "<desc>" --base <default> --head <branch>
glab mr create --title "<t>" --description "<desc>" --target-branch <default> --source-branch <branch>
```

描述含 `Closes #<issue>`。CI 失败 → 修复 → 推送。

### 4. 合并并清理

**硬约束**：合并在 root worktree 执行，严禁在 feature worktree 内执行。先 `--json state` 确认成功再清理。

```bash
cd <root-worktree>
git checkout <default-branch> && git pull origin <default-branch>
gh pr merge <id> --squash --delete-branch
glab mr merge <id> --squash --remove-source-branch
```

确认后 `git worktree remove` + `git branch -D`。

交付：PR/MR 链接。无法交付时说明阻塞原因。
