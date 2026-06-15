---
name: resolve
description: 解决 MR 上的评论和讨论 —— 定位 unresolved notes，修复或回复，推送更新 MR
---

# 解决 MR 上的评论和讨论

当需要处理 MR 上的 unresolved comments/notes 并最终标记为已解决时，遵循本流程。

通用原则见 [principles.md](references/principles.md)。

## 流程

### 1. 定位 MR 和未解决的讨论

```bash
# 查看 MR 基本信息
glab mr view <mr-id>

# 查看 MR 上的讨论/评论
glab mr view <mr-id> --comments

# 或通过 GitLab API 获取未解决的讨论
# GET /projects/:id/merge_requests/:mr_id/discussions?state=active
```

重点关注：
- 哪些讨论尚未解决（unresolved）
- 每个评论的具体内容和位置
- 评论的类型（行级评论 vs 总体评论）

### 2. 逐条处理

对每个 unresolved discussion，有两种处理方式：

**方式 A：改代码修复**

如果评论指出了代码问题：
1. Checkout MR 的源分支（或进入已有 worktree）
2. 修改代码解决评论指出的问题
3. 提交并推送

```bash
git checkout <source-branch>
# 或 git worktree add ...

# 修改代码后
git add -A
git commit -m "resolve: 修复 <评论描述的问题>"
git push
```

**方式 B：回复说明**

如果评论是误解或已有代码已覆盖该关注点：
1. 在讨论中回复解释

```bash
glab mr note <mr-id> -m "回复：<解释内容>"
```

### 3. 标记讨论已解决

代码修复后或回复解释后，将讨论标记为已解决：

```bash
# glab 目前不支持直接 resolve discussion，需要回退到 GitLab API
# PUT /projects/:id/merge_requests/:mr_id/discussions/:discussion_id
# Body: { "resolved": true }
```

或在 GitLab Web 界面中手动点击 "Resolve discussion"。

### 4. 更新 MR

所有讨论处理完成后，确认 MR 状态：

```bash
# 确认推送了所有修复
git push

# 确认 pipeline 通过
glab mr view <mr-id> --comments
```

## 交付物

- **已解决的讨论列表** + **更新后的 MR 链接**
- 如果无法解决某些讨论，必须说明原因并保持其 unresolved 状态
