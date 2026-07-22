---
description: Run an adversarial code review — the client agent and remora spar over multiple rounds until both agree it's mergeable; the client agent holds final decision authority as the stronger party
argument-hint: '[--auto-merge] [prompt]'
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), Agent, AskUserQuestion
---

Run an adversarial code review with remora.

Raw arguments: `$ARGUMENTS`

## Arguments

- `--auto-merge`: auto squash-merge and clean up remote branch / local worktree. Without it, just report verdict. Authorization scoped to the turn it's issued — ends when agent yields control back to the user.
- `prompt`: optional — PR/MR link, branch name, or extra context.

## Flow

1. **Gather context**: From PR link / branch / session history — fold into one structured context.
2. **Your own review**: Form a mergeable/not-mergeable verdict with reasons. Check `.claude/rules/` for project conventions.
3. **Invoke remora** via `Agent` (`remora:remora-task`). Do NOT use `Skill`. Do NOT pass `--write`.
   - When target is not current cwd, pass `--worktree <branch>` or `--cwd <path>` in the subagent prompt.
   - Give remora your context + initial verdict; ask it to review from an opposing, nitpicking angle.
   - **Verbatim-citation rule**: Each blocking issue must quote verbatim diff lines with `file:line`. A blocking issue without a verbatim diff quotation is invalid — downgrade to a nit.
4. **Adversarial loop**: Read remora's `finalMessage`. For each point: accept+fix or rebut. Verify blocking findings' verbatim quotes against actual PR diff. State round verdict. Send updated context back to remora. You decide, as the stronger party, when no valid blocking objection remains.
5. **Terminate**:
   - Without `--auto-merge`: output verdict + reasons.
   - With `--auto-merge` + mergeable: squash-merge → push → delete remote branch → clean up local worktree/branch. Stop on first failure.
   - Not mergeable: output blocking issues; no git operations.

Read-only by default. If remora fails, suggest `/remora:setup`.
