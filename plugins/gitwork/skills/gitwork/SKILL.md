---
name: gitwork
description: Git 平台开发工作流入口 —— 根据任务类型引导选择对应 skill，支持 GitHub / GitLab 等多平台
---

# Git 平台开发工作流

当任务涉及 git 平台对象（GitHub PR / GitLab MR / Issue / Pipeline 等）或需要通过平台交付时，不要只停留在本地代码变更——先探测当前平台，再选择对应的 skill 将结果交付到平台上。

适用场景：
- Issue / Pull Request（GitHub）或 Merge Request（GitLab）/ Pipeline
- CI 配置（`.github/workflows/`、`.gitlab-ci.yml` 等）或平台 Flow 相关改动
- 需要新建 branch、worktree、PR/MR 的研发任务
- 需要在 PR/MR 中完成 review、回写评论、跟进流水线的任务

## 第一步：确定平台

按 [principles.md](../../references/principles.md) 的「平台探测」用 `git remote -v` 确定当前仓库是 GitHub 还是 GitLab（或其他平台），从而确定使用 `gh` 还是 `glab`、交付对象是 PR 还是 MR。后续命令一律按当前平台取一组。

## 选择 Skill

| 场景 | Skill | 说明 |
|------|-------|------|
| 实现需求并交付 PR/MR | `/gitwork:deliver` | 新建或继续 branch → 实现 → 推送 → 创建/更新 PR/MR |
| Review PR/MR 并交付评论 | `/gitwork:review` | 定位 PR/MR → 本地 review → 回写评论到平台 |
| 解决 PR/MR 上的评论 | `/gitwork:resolve` | 定位 unresolved notes → 修复或回复 → 推送 → 标记已解决 |
| 解决 PR/MR 合并冲突 | `/gitwork:conflict` | 定位冲突 → 本地解决 → 推送 → 更新 PR/MR |

通用原则见 [principles.md](../../references/principles.md)。
