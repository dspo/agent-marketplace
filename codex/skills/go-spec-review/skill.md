---
name: go-spec-review
description: Review Go code for correctness and subtle language semantics per the Go language specification (Go spec). Use when doing Go code review / PR review, or debugging confusing behavior around types, interfaces & method sets, nil, slices/maps/strings, range/for, defer/panic/recover, channels/select, generics, and package initialization. Defaults to reviewing the full provided context; can scope to a diff, file path(s), or key function(s).
metadata:
  short-description: Spec-based Go code review
---

# Go spec-based review ($go-spec-review)

## Overview

Use the Go language specification as the source of truth for language semantics during code review. Focus on spec-defined correctness and flag any reliance on unspecified behavior.

## Review workflow

0) (Optional) Run helper scripts (fast context + red flags)
   - Scripts live under this skill folder (typically `$CODEX_HOME/skills/go-spec-review/scripts/`, often `~/.codex/skills/go-spec-review/scripts/`).
   - `go run $CODEX_HOME/skills/go-spec-review/scripts/collect_context.go --repo <repo> --base <git-ref>`
   - `go run $CODEX_HOME/skills/go-spec-review/scripts/risk_sweep.go --repo <repo> --base <git-ref>`
   - `go run $CODEX_HOME/skills/go-spec-review/scripts/light_checks.go --repo <repo>`
   - Notes:
     - These scripts are heuristics; confirm findings against the spec.
     - Prefer passing `--repo` explicitly; don’t assume the current working directory.

1) Confirm the Go version and build constraints
   - Prefer reading `go.mod` (`go` directive) and any `//go:build` tags.
   - If the Go version is ambiguous, ask; some semantics changed across versions (e.g. loop variable capture in Go 1.22).

2) Determine review scope (default: global)
   - **Default (“global”)**: review everything the user provided (diff/snippets/files); if nothing was provided, review all Go code in the repo (prioritize `main` packages, server/handlers, and concurrency-heavy code).
   - **Diff**: if the user provides a unified diff/PR context, review the full diff and prioritize spec pitfalls in changed code.
   - **File paths**: if the user lists file paths, review only those files (and any directly related call sites if needed for semantic correctness).
   - **Key functions/symbols**: if the user names functions/types (e.g. `pkg.Func`, `(*T).M`, `T.M`), locate and review only those definitions plus their immediate callers; ask if ambiguous.

3) Run a “spec risk areas” sweep
   - Read `references/spec-review-checklist.md` and scan for language-edge cases.
   - Explicitly call out reliance on unspecified/nondeterministic behavior.

4) Produce actionable findings
   - For each issue: point to the code, cite the spec section name, explain the risk, and propose a concrete fix or safer pattern.
   - Separate “spec correctness” findings from “performance/style/tooling” suggestions.

## How to reference the spec

- Spec URL: https://golang.google.cn/ref/spec
- Prefer citing spec section names (e.g. “Range clause”, “Method sets”, “Order of evaluation”) rather than quoting long passages.
- If you need exact wording, open the spec URL and search by the section name/keyword.
- If you cite something not covered by the spec (e.g. memory ordering), label it explicitly and reference the correct document (e.g. Go memory model).

## Output format (recommended)

- Start with a short summary (2–4 bullets).
- List findings grouped by severity: `bug`, `spec-pitfall`, `unspecified-behavior`, `question`.
- For each finding: include affected symbol/file, explanation, spec section name, and a suggested fix.
