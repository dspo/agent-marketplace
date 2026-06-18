---
name: review
description: Review PR/MR 并交付评论 —— 定位 PR/MR，本地 review，回写评论到平台（GitHub / GitLab 通用）
---

# Review PR/MR 并交付评论

当需要 review 一个 PR（GitHub）/ MR（GitLab）并将 review 意见回写到平台时，遵循本流程。

通用原则见 [principles.md](../../references/principles.md)。先按「平台探测」确定平台，下文命令按平台二选一。

## 流程

### 1. 定位 PR/MR

```bash
# GitHub
gh pr view <pr-id>
gh pr diff <pr-id>
gh pr view <pr-id> --comments

# GitLab
glab mr view <mr-id>
glab mr diff <mr-id>
glab mr view <mr-id> --comments
```

重点关注：
- PR/MR 标题、描述、关联 Issue
- 源分支和目标分支
- CI 是否通过
- 已有的 review 评论

### 2. 获取本地 diff（优先）

能在本地 review 时，优先使用本地 diff 和代码：

```bash
# 如果 PR/MR 的分支已 checkout 到本地
git diff <default-branch>..<source-branch>

# 如果需要 fetch PR/MR 的分支
git fetch origin <source-branch>
git diff origin/<default-branch>..origin/<source-branch>

# 查看变更文件列表
git diff --name-only origin/<default-branch>..origin/<source-branch>
```

本地 review 的优势：
- 可以直接阅读完整文件上下文
- 可以运行代码或测试验证
- 可以使用 LSP 等工具辅助分析

### 3. 执行 Review

Review 重点关注：

- **正确性**：逻辑错误、边界条件、类型不匹配
- **安全性**：输入验证、权限检查、敏感数据处理
- **代码质量**：重复代码、不必要的复杂度、命名规范
- **测试覆盖**：关键逻辑是否有测试、测试是否有效
- **项目规范**：是否符合 CLAUDE.md 和项目约定

### 4. 回写评论到平台

Review 结论必须回写到平台，优先使用平台官方 CLI：

```bash
# GitHub：总体评论与行级评论
gh pr comment <pr-id> --body "Review 总结：..."
# 行级评论需提供 commit_id 与 side，否则 422
gh api repos/:owner/:repo/pulls/<pr-id>/comments \
  -f body="文件 `<file>` 行 `<line>`：<评论内容>" \
  -f path=<file> -F line=<line> -F side=RIGHT \
  -f commit_id="$(git rev-parse HEAD)"

# GitLab：总体评论（glab mr note 目前只支持总体评论，行级评论回退 API 或 Web）
glab mr note <mr-id> -m "Review 总结：..."
glab mr note <mr-id> -m "文件 `<file>` 行 `<line>`：<评论内容>"
```

评论格式建议：
- 用 `[建议]`、`[问题]`、`[严重]` 标注严重程度
- 说明原因和改进方向
- 如果同意合并，明确标注 `[同意]`

## 交付物

- **已提交到 PR/MR 的 review 评论**（不是口头总结）
- 如果没有发现任何问题，也应在 PR/MR 上发表一条简短的通过评论
