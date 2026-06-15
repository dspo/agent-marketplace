---
name: gitlab-dev
description: GitLab 开发工作流入口 —— 根据任务类型引导选择对应 skill
---

# GitLab 开发工作流

当任务涉及 GitLab 对象或需要通过 GitLab 交付时，不要只停留在本地代码变更——选择对应的 skill 将结果交付到 GitLab。

适用场景：
- Issue / Merge Request / Pipeline
- `.gitlab-ci.yml` 或 GitLab Flow 相关改动
- 需要新建 branch、worktree、MR 的研发任务
- 需要在 MR 中完成 review、回写评论、跟进流水线的任务

## 选择 Skill

| 场景 | Skill | 说明 |
|------|-------|------|
| 实现需求并交付 MR | `/gitlab-dev:mr` | 新建或继续 branch → 实现 → 推送 → 创建/更新 MR |
| Review MR 并交付评论 | `/gitlab-dev:review` | 定位 MR → 本地 review → 回写评论到 GitLab |
| 解决 MR 上的评论 | `/gitlab-dev:resolve` | 定位 unresolved notes → 修复或回复 → 推送 → 标记已解决 |
| 解决 MR 合并冲突 | `/gitlab-dev:conflict` | 定位冲突 → 本地解决 → 推送 → 更新 MR |

通用原则见 [principles.md](references/principles.md)。
