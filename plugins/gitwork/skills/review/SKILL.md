---
name: review
description: Review PR/MR 并交付评论 —— 定位 PR/MR，本地 review，回写评论到平台（GitHub / GitLab 通用）
---

# Review PR/MR 并交付评论

通用原则见 [principles.md](../../references/principles.md)。

## 流程

1. **获取 diff**：`gh pr diff <id>` / `glab mr diff <id>`；优先本地 `git diff origin/<default>..origin/<source>`。
2. **执行 Review**：正确性、安全性、代码质量、测试覆盖、项目规范。
3. **回写平台**：

```bash
gh pr comment <id> --body "…"                    # GitHub 总体
glab mr note <id> -m "…"                         # GitLab 总体

# GitHub 行级评论
gh api repos/:owner/:repo/pulls/<id>/comments \
  -f body="<内容>" -f path=<file> -F line=<line> -F side=RIGHT \
  -f commit_id="$(git rev-parse HEAD)"
```

标注：`[严重]` / `[问题]` / `[建议]`；同意标 `[同意]`。

交付：已提交到平台的 review 评论。无问题时也发表简短通过。
