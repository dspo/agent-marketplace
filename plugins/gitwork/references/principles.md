# Git Platform Development Shared Principles

All gitwork sub-skills follow these principles.

## Platform Detection

```bash
git remote -v
```

| Remote | Platform | CLI | Object | Branch flags |
|--------|----------|-----|--------|-------------|
| `github.com` | GitHub | `gh` | PR | `--base` / `--head` |
| `gitlab.com` | GitLab | `glab` | MR | `--target-branch` / `--source-branch` |
| other | — | Platform CLI/API | PR or MR | Per platform |

Convention: **PR/MR** = platform delivery object; **`<default-branch>`** = default branch (`main`/`master`).

## CLI Command Mapping

| Operation | GitHub (`gh`) | GitLab (`glab`) |
|-----------|---------------|-----------------|
| List PR/MR | `gh pr list` | `glab mr list` |
| View PR/MR | `gh pr view <id>` | `glab mr view <id>` |
| View diff | `gh pr diff <id>` | `glab mr diff <id>` |
| Create PR/MR | `gh pr create --base <t> --head <s>` | `glab mr create --target-branch <t> --source-branch <s>` |
| Comment | `gh pr comment <id> --body "..."` | `glab mr note <id> -m "..."` |
| Issue | `gh issue view <id>` | `glab issue view <id>` |
| CI status | `gh pr checks <id>` | `glab ci trace <id>` |

Advanced ops (line comments, resolve discussions, merge) fall back to REST API or Web when CLI lacks support.

## Core Principles

1. Deliver a platform object — usually a **PR/MR link**.
2. Reuse existing branches, worktrees, and PR/MRs; don't duplicate.
3. Prefer the platform's official CLI; fall back to REST API / Web only when needed.
4. If blocked, state the reason — "locally changed" is not completion.

## Worktree Rules

**Hard constraint**: All code changes must be in a dedicated worktree. Never modify code in the root worktree.

- Worktrees go alongside the root worktree: `../<root-name>--<branch-slug>`
- Confirm location: `git worktree list`
- Example: root `agent-skills`, branch `fix/foo` → worktree `agent-skills--fix-foo`
