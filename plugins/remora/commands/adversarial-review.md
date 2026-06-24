---
description: 运行 remora 对抗式代码审查，主 Claude 与 remora 多轮交锋，直到双方都认为可以合并；主 Claude 作为强势方保留最终拍板权
argument-hint: '[--auto-merge] [prompt]'
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), Agent, AskUserQuestion
---

运行 remora 对抗式代码审查。

Raw slash-command arguments:
`$ARGUMENTS`

## 参数解析

- `--auto-merge`：显式传入时，在双方达成共识后自动执行 squash merge 并清理远端分支/本地 worktree；未传时只给出结论。
- `prompt`：可选，可以是 PR/MR 链接、分支名、或任何补充提示词（业务背景、方案取舍、验收标准、原始需求等）。

## 收集完整上下文

不能把 diff 作为唯一上下文交给 remora。按以下顺序收集信息：

1. 若 `prompt` 是 PR/MR 链接：
   - 读取 PR/MR 元数据：标题、描述、作者、状态、base 分支、head 分支、review/评论等；
   - 读取 PR/MR 的 diff；
   - 收集所有能反映原始需求、方案取舍、讨论背景的信息。
   - 具体工具由 agent 根据平台选择（例如 GitHub 用 `gh`，GitLab 用 `glab`，或直接通过 API/页面提取），这里不强制指定命令。
2. 若 `prompt` 是分支名：
   - 读取 `git log <base>..<branch> --oneline` 了解提交历史；
   - 读取 `git diff <base>...<branch>` 获取 diff；
   - base 默认为当前分支上游或 `main`/`master`。
3. 若 `prompt` 是普通提示词或为空：
   - 使用当前工作区/当前分支；
   - 读取 `git status --short`、`git diff --cached`、`git diff` 了解变更范围。

无论哪种情况，都要把下列上下文一并组织进 prompt：

- 原始需求/用户目标（来自 prompt 或 PR 描述）；
- 方案背景与取舍理由；
- 相关业务/产品约束；
- 当前 diff；
- 主 Claude 的初步审查意见（见下一步）。

## 主 Claude 初步审查

在调用 remora 之前，主 Claude 先自行阅读相关文件并形成初步审查意见。要点：

- 关注正确性、边界条件、错误处理、可维护性；
- 注意是否违反项目规范（如 Go 错误处理、并发规范、测试规范等，见项目 `.claude/rules/`）；
- 记录自己认为可以合并、需要修改、或需要进一步讨论的点。

## 调用 remora 进行对抗审查

通过 `Agent` 工具 spawn `remora:remora-task` 子 agent，向其转发 task JSON。

- `subagent_type` 必须是 `remora:remora-task`。
- 不要调用 `Skill(remora:task)` 或 `Skill(remora:remora-task)`。
- 不要开启 `--write` 模式；review 阶段只读。
- 把完整上下文打包进 `prompt`，明确告知 remora：
  - 它的角色是**挑剔的反对者/审查者**；
  - 目标是从反对角度找出仅看 diff 注意不到的问题；
  - 它应当挑战实现方案、设计取舍和隐藏假设；
  - 最后明确给出“可以合并”或“不可合并”的结论及理由。

转发 prompt 示例结构：

```text
你现在是这个 PR/分支的挑剔审查者。请从反对角度、跳出实现者思维，审查以下改动是否_ready_to_merge。

【原始需求与背景】
...

【方案与取舍】
...

【相关约束】
...

【diff / 改动摘要】
...

【主 Claude 的初步审查意见】
...

请给出：
1. 你发现的主要问题（如果有）；
2. 你挑战的方案假设或取舍；
3. 最终结论：可以合并 / 不可合并，并说明理由。
```

## 读取 remora 返回

子 agent 会返回 remora 的 `finalMessage`。按如下规则处理：

- 不要改写或加戏，先完整理解 remora 的结论和理由。
- 如果 remora 的结论包含“可以合并”且理由充分，进入终止判断。
- 如果 remora 指出问题，主 Claude 必须认真评估；若认为问题成立，可主动承认并修正结论；若认为不成立，则准备反驳。

## 对抗循环

主 Claude 与 remora 进行多轮对抗，直到满足以下任一条件：

1. **双方都认为可以合并**；
2. **主 Claude 作为强势方认为 remora 没有提出有效阻挠理由**，拍板可以合并；
3. **主 Claude 认为不可合并**，给出结论并停止。

每轮循环：

- 主 Claude 基于 remora 的反馈，表达自己的立场：
  - 接受 remora 的某一点并说明如何修正；或
  - 反驳 remora 的某一点并说明理由；
  - 明确自己本轮的结论（可合并 / 不可合并 / 需要继续讨论）。
- 将主 Claude 的回应、修正后的上下文、以及 remora 上一条结论，再次转发给 remora，要求它继续从反对角度审查。
- remora 返回新的 `finalMessage`。

注意：

- 主 Claude 是强势方，最终由主 Claude 拍板；
- 但也要尊重 remora 的意见，不能无理由无视有效问题；
- 没有固定的最大轮数，当双方观点收敛或主 Claude 明确拍板时停止；
- 避免无意义的反复，若 remora 重复同样观点且主 Claude 已充分回应，主 Claude 可以拍板。

## 终止与合并

### 未传 `--auto-merge`

无论结论是啥，只向用户输出结论：

- 若双方都认为可以合并：
  - 输出“双方都认为可以合并”及主要理由；
  - 建议用户手动合并，或重跑时带 `--auto-merge`。
- 若主 Claude 强势拍板可以合并：
  - 输出“主 Claude 已拍板可以合并”及 remora 提出的反对意见和主 Claude 的回应；
  - 建议用户手动合并或带 `--auto-merge` 重跑。
- 若不可合并：
  - 输出“不可合并”及阻塞问题清单；
  - 不执行任何 git 操作。

### 传了 `--auto-merge`

当结论为可以合并时，执行以下自动合并流程（每步都要验证，失败时停止并报告）：

1. **确认当前分支和合并目标**：
   - 当前分支应是接收合并的分支（如 `main` 或 `master`）；
   - 若 prompt 是 PR/MR 链接，从 PR 元数据读取 `baseRefName`；
   - 若 prompt 是分支名，当前分支即为 base；
   - 否则默认以当前分支为 base。

2. **执行 squash merge**：

   ```bash
   git merge --squash --no-edit <待合并分支>
   ```

   或根据平台/项目约定使用 CLI 工具，例如 `gh pr merge --squash`（GitHub）或 `glab mr merge --squash`（GitLab）。

3. **提交合并结果**：

   ```bash
   git commit -m "<合适的合并提交信息>"
   ```

   合并提交信息应概括改动内容，可引用 PR/MR 编号。

4. **推送 base 分支**：

   ```bash
   git push origin <base分支>
   ```

5. **清理远端分支**：

   ```bash
   git push origin --delete <待合并分支>
   ```

   仅在确认该远端分支不再需要时执行。

6. **清理本地 worktree/分支**：
   - 若该分支关联了一个 git worktree，使用 `git worktree remove <路径>`；
   - 否则删除本地分支：`git branch -D <待合并分支>`（确认已合并且不再需要）。

7. 每步失败后立即停止，报告错误，不继续后续清理步骤。

## 错误处理

- 若 remora 调用失败（子 agent 或 CLI 非零退出），提示用户运行 `/remora:setup` 检查 provider 配置。
- 若 git 操作失败，保留当前状态，向用户报告具体命令和输出，不自动重试。

## 注意事项

- 本命令默认不修改任何文件或分支，除非显式传入 `--auto-merge`。
- 即使传入 `--auto-merge`，在最终执行 git 操作前，也要确保主 Claude 已经给出明确结论。
- 自动合并前，不要再次询问用户确认；`--auto-merge` 即视为授权。
