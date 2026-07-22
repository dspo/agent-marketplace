---
name: gitwork
description: Git 平台开发工作流入口 —— 根据任务类型引导选择对应 skill，支持 GitHub / GitLab 等多平台
---

# Git 平台开发工作流

先按 [principles.md](../../references/principles.md) 的「平台探测」确定平台（`git remote -v`），然后选择对应 skill：

| 场景 | Skill |
|------|-------|
| 实现需求并交付 PR/MR | `/gitwork:deliver` |
| Review PR/MR 并交付评论 | `/gitwork:review` |
| 解决 PR/MR 上的评论 | `/gitwork:resolve` |
| 解决 PR/MR 合并冲突 | `/gitwork:conflict` |

通用原则见 [principles.md](../../references/principles.md)。
