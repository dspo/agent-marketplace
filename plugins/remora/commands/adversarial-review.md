---
description: Run an adversarial code review — the client agent and remora spar over multiple rounds until both agree it's mergeable; the client agent holds final decision authority as the stronger party
argument-hint: '[--auto-merge] [prompt]'
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), Agent, AskUserQuestion
---

Run an adversarial code review with remora.

Raw arguments: `$ARGUMENTS`

## Arguments

- `--auto-merge`: only when explicitly passed, auto squash-merge and clean up the remote branch / local worktree; without it, just report the verdict. The authorization to merge is scoped to **the turn in which the flag is issued** — see Notes for the cross-turn boundary.
- `prompt`: optional — a PR/MR link, branch name, or extra context (background, design trade-offs, acceptance criteria, original requirements).

## Flow

1. **Gather and summarize context yourself** (never just hand over a diff):
   - `prompt` is a PR/MR link → read its title, description, comments, diff.
   - `prompt` is a branch name → read `git log` / `git diff`.
   - `prompt` empty or free-form → use the current working tree.
   - Also review this session's history for the original requirement, design background, trade-offs, and constraints.
   - Fold it all into one complete, structured context.

2. **Do your own initial review**: correctness, edge cases, error handling, maintainability; check for project-convention violations (see `.claude/rules/`). Form your own mergeable/not-mergeable verdict with reasons.

3. **Invoke remora for the adversarial pass**:
   - Spawn `remora:remora-task` via the `Agent` tool. Do NOT call `Skill(remora:task)` or `Skill(remora:remora-task)`. Do NOT pass `--write`.
   - Give remora the full context **plus your initial verdict**, and ask it to review from an opposing, nitpicking angle and return its own mergeable/not-mergeable verdict with reasons.
   - remora is long-running (minutes). Its result is its real `finalMessage` — never a "still running" placeholder. If the spawned subagent returns a placeholder instead of remora's actual conclusion, treat that as a tooling failure: recover remora's real output before proceeding (its stdout JSON `finalMessage`, or `dump <id>` using the sessionId from the stderr `session` event), or invoke the remora CLI directly with background + `BashOutput` polling.

4. **Adversarial loop**:
   - Read remora's `finalMessage` carefully.
   - For each of its points: accept and fix, or rebut with reasons.
   - State this round's verdict: mergeable / not mergeable / keep discussing.
   - Send the updated context and your response back to remora for the next round.
   - When both sides agree it's mergeable — or you judge that remora has no valid blocking objection — you decide, as the stronger party.

5. **Terminate**:
   - Without `--auto-merge`: output the verdict and reasons; suggest merging manually or rerunning with `--auto-merge`.
   - With `--auto-merge` and a mergeable verdict: squash-merge → commit → push base → delete remote branch → clean up local worktree/branch. Stop and report on the first failed step.
   - Not-mergeable verdict: output the blocking issues; do not run any git operations.

## Notes

- Read-only by default; do not modify files or branches.
- If remora fails to run, tell the user to run `/remora:setup` to check config.
- `--auto-merge` counts as user authorization to merge **in the same turn the flag is issued** — do not ask for confirmation again within that turn. A *turn* is one user message and the agent's continuous response to it: multiple adversarial rounds within a single agent invocation count as the same turn, but once the agent yields control back to the user — including the user sending any follow-up message, or context compaction ending the response — the turn ends. The authorization does **not** carry across turns: if the merge is not executed before the turn ends (e.g. the adversarial loop spans multiple turns, context is compacted, remora hangs, or the agent yields back to the user), re-confirm via `AskUserQuestion` (present the verdict and ask whether to merge now) before executing any git operations in a later turn. The user authorized merging based on that turn's context (diff, verdict, sparring progress); past a turn boundary the context may have changed, so the prior authorization is no longer valid. (Runtime enforcement — tracking which turn the flag was issued in across compaction — is out of scope for a markdown skill; the `AskUserQuestion` re-confirmation is the practical mitigation.)
