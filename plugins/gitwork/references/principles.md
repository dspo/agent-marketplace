# Git Platform Development Shared Principles

All gitwork sub-skills follow these principles. When this file conflicts with a specific skill document, the specific skill document takes precedence.

## Core Principles

1. Git platform work must ultimately deliver to a platform object — usually a **PR/MR link** or an **updated PR/MR link**.
2. Reuse existing branches, worktrees, and PR/MRs whenever possible; do not duplicate assets.
3. When operating on platform objects, prefer the official CLI for that platform (see below); fall back to REST API or web UI only when CLI does not support the operation.
4. After completing implementation, proactively commit, push, and create or update the PR/MR.
5. If blocked by authentication, permissions, remote configuration, or tool limitations, clearly state the blocking point.

## Platform Detection (Determine Platform and Terminology First)

Before starting, determine which platform the current repository belongs to based on the git remote, then select the correct CLI, object names, and field names.

```bash
# View remote URL
git remote -v
```

Detection rules:

| Remote characteristic | Platform | CLI | Delivery object | Branch fields |
|-----------------------|----------|-----|-----------------|---------------|
| `github.com` / GitHub Enterprise instance | GitHub | `gh` | PR (Pull Request) | base / head |
| `gitlab.com` / self-hosted GitLab | GitLab | `glab` | MR (Merge Request) | target-branch / source-branch |
| `gitee.com` / others | Other | Platform CLI / API | PR or MR | Per platform |

Convention: **PR/MR** denotes the delivery object for the current platform; **`<default-branch>`** denotes the default branch (e.g., `master`/`main`).
Each skill's example commands are grouped by platform — execute only the group corresponding to the current platform.

## CLI Command Mapping

Common operations mapped between GitHub (`gh`) and GitLab (`glab`):

| Operation | GitHub (`gh`) | GitLab (`glab`) |
|-----------|---------------|-----------------|
| List PR/MR | `gh pr list` | `glab mr list` |
| View PR/MR | `gh pr view <id>` | `glab mr view <id>` |
| View diff | `gh pr diff <id>` | `glab mr diff <id>` |
| Create PR/MR | `gh pr create --base <t> --head <s>` | `glab mr create --target-branch <t> --source-branch <s>` |
| General comment | `gh pr comment <id> --body "..."` | `glab mr note <id> -m "..."` |
| View Issue | `gh issue view <id>` | `glab issue view <id>` |
| CI / Pipeline status | `gh pr checks <id>` | `glab ci trace <id>`, `glab mr view <id> --comments` |

> Advanced operations like line comments, resolving discussions, and merging have limited CLI support on both platforms. Fall back to the platform's REST API (GitHub `/repos/.../pulls/.../comments`, GitLab `/projects/.../merge_requests/.../discussions`) or web UI when needed.

## Tool Priority

| Operation | Preferred tool | Fallback |
|-----------|----------------|----------|
| Repository operations (branch, commit, worktree) | `git` | — |
| Platform objects (PR/MR, Issue, Pipeline, Note) | Platform official CLI (`gh` / `glab`) | Platform REST API (`curl`) or MCP |
| Other | Most available tool in current environment | — |

## Worktree Rules

> **Mandatory rule:** All code implementation must be done in a worktree — never make any code changes in the root worktree.

- New worktrees are placed **at the same level as the root worktree**, not inside subdirectories of the root worktree.
- Naming convention: `${root_worktree_name}--$(basename "$branch_name")`
- For example: if root worktree is `agent-skills` and branch is `fix/codex-marketplace-install`, the worktree name is `agent-skills--fix-codex-marketplace-install`.
- Before starting any implementation, confirm the current directory is not the root worktree with `git worktree list`.

## Delivery Requirements

- Git platform workflow tasks must ultimately deliver a **PR/MR link** or an **updated PR/MR link**.
- Review tasks should also include comments that have been written back to the PR/MR.
- If delivery is not possible, clearly explain the blocking reason — do not treat "locally changed" as completion.
