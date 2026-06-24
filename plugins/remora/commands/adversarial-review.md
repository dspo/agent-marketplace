---
description: 运行 remora 对抗式代码审查，主 agent 与 remora 多轮交锋，直到双方都认为可以合并；主 agent 作为强势方保留最终拍板权
argument-hint: '[--auto-merge] [prompt]'
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), Agent, AskUserQuestion
---

运行 remora 对抗式代码审查。

Raw arguments: `$ARGUMENTS`

## 参数

- `--auto-merge`：显式传入时才自动 squash merge 并清理远端分支/本地 worktree；未传时只给结论。
- `prompt`：可选，PR/MR 链接、分支名或补充提示词（业务背景、方案取舍、验收标准、原始需求等）。

## 流程

1. **主 agent 自行收集并总结上下文**（不能只给 diff）：
   - 若 `prompt` 是 PR/MR 链接：读取标题、描述、评论、diff 等。
   - 若 `prompt` 是分支名：读取 `git log`/`git diff`。
   - 若 `prompt` 为空或为普通提示词：使用当前工作区状态。
   - 同时回顾本会话历史，提炼原始需求、方案背景、取舍理由、业务约束等。
   - 将以上信息总结成一份完整、结构化的上下文，不要只贴 diff。

2. **主 agent 初步审查**：
   - 关注正确性、边界条件、错误处理、可维护性；
   - 检查是否违反项目规范（如错误处理、并发规范、测试规范等，可参见 `.claude/rules/`）；
   - 形成自己的“可合并/不可合并”结论及理由。

3. **调用 remora 对抗审查**：
   - 通过 `Agent` 工具 spawn `remora:remora-task`；
   - 不要调用 `Skill(remora:task)` 或 `Skill(remora:remora-task)`；
   - 不要开启 `--write`；
   - 将完整上下文 + 主 agent 初步意见发给 remora，要求其从反对/挑刺角度审查，并给出“可合并/不可合并”结论及理由。

4. **对抗循环**：
   - 主 agent 认真阅读 remora 的 `finalMessage`；
   - 对 remora 的观点：接受并修正、或反驳并说明理由；
   - 明确本轮结论：可合并 / 不可合并 / 继续讨论；
   - 将更新后的上下文和主 agent 回应回传给 remora，进入下一轮；
   - 当双方都认为可合并，或主 agent 认为 remora 没有有效阻挠理由时，主 agent 作为强势方拍板。

5. **终止**：
   - 未传 `--auto-merge`：输出结论与理由，建议手动合并或重跑带 `--auto-merge`。
   - 传了 `--auto-merge` 且结论为可合并：执行 squash merge → 提交 → push base → 删除远端分支 → 清理本地 worktree/分支。任一步失败立即停止并报告。
   - 结论为不可合并：输出阻塞问题，不执行 git 操作。

## 注意

- 默认只读，不修改任何文件或分支。
- remora 调用失败时，提示运行 `/remora:setup` 检查配置。
- 自动合并即视为用户已授权，不要再询问确认。
