---
name: resolve
description: 解决 PR/MR 上的评论和讨论 —— 定位 unresolved notes，修复或回复，推送更新（GitHub / GitLab 通用）
---

# 解决 PR/MR 上的评论

通用原则见 [principles.md](../../references/principles.md)。

## 流程

1. **定位**：`gh pr view <id> --comments` / `glab mr view <id> --comments`，找 unresolved。
2. **处理**：改代码 → checkout + 修改 + push；回复 → `gh pr comment <id> --body "…"` / `glab mr note <id> -m "…"`。
3. **标记 resolved**：平台 Web 或 API。推送后确认 CI 通过。

交付：已解决列表 + PR/MR 链接。无法解决的保持 unresolved。
