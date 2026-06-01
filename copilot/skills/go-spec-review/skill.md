---
name: go-spec-review
description: Go 规范审查 — 基于 Go 语言规范的代码审查，聚焦语义正确性和边界情况
commands:
- name: go-collect
  description: 收集 Go 项目上下文信息（go.mod、构建约束、变更文件）
  script: scripts/collect_context.go
  args:
  - --repo
  - --base
  - --head
  - --max-files
- name: go-risk
  description: 扫描 Go 代码中的 spec 风险区域
  script: scripts/risk_sweep.go
  args:
  - --repo
  - --base
  - --head
- name: go-check
  description: 轻量级 Go 代码检查
  script: scripts/light_checks.go
  args:
  - --repo
---

# Go spec-based review

## Overview

Use the Go language specification as the source of truth for language semantics during code review. Focus on spec-defined correctness and flag any reliance on unspecified behavior.

## Review workflow

0) (Optional) Run helper scripts (fast context + red flags)
   - Scripts live under `${COPILOT_PLUGIN_ROOT}/skills/go-spec-review/scripts/`.
   - `go run ${COPILOT_PLUGIN_ROOT}/skills/go-spec-review/scripts/collect_context.go --repo <repo> --base <git-ref>`
   - `go run ${COPILOT_PLUGIN_ROOT}/skills/go-spec-review/scripts/risk_sweep.go --repo <repo> --base <git-ref>`
   - `go run ${COPILOT_PLUGIN_ROOT}/skills/go-spec-review/scripts/light_checks.go --repo <repo>`
   - Notes:
     - These scripts are heuristics; confirm findings against the spec.
     - Prefer passing `--repo` explicitly; don't assume the current working directory.

1) Confirm the Go version and build constraints
   - Prefer reading `go.mod` (`go` directive) and any `//go:build` tags.
   - If the Go version is ambiguous, ask; some semantics changed across versions (e.g. loop variable capture in Go 1.22).

2) Determine review scope (default: global)
   - **Default ("global")**: review everything the user provided (diff/snippets/files); if nothing was provided, review all Go code in the repo.
   - **Diff**: if the user provides a unified diff/PR context, review the full diff and prioritize spec pitfalls in changed code.
   - **File paths**: if the user lists file paths, review only those files.
   - **Key functions/symbols**: if the user names functions/types, locate and review only those definitions plus their immediate callers.

3) Run a "spec risk areas" sweep
   - Read `${COPILOT_PLUGIN_ROOT}/skills/go-spec-review/references/spec-review-checklist.md` and scan for language-edge cases.
   - Explicitly call out reliance on unspecified/nondeterministic behavior.

4) Produce actionable findings
   - For each issue: point to the code, cite the spec section name, explain the risk, and propose a concrete fix or safer pattern.
   - Separate "spec correctness" findings from "performance/style/tooling" suggestions.

## How to reference the spec

- Spec URL: https://golang.google.cn/ref/spec
- Prefer citing spec section names (e.g. "Range clause", "Method sets", "Order of evaluation") rather than quoting long passages.
- If you need exact wording, open the spec URL and search by the section name/keyword.
- If you cite something not covered by the spec (e.g. memory ordering), label it explicitly and reference the correct document (e.g. Go memory model).

## Output format (recommended)

- Start with a short summary (2-4 bullets).
- List findings grouped by severity: `bug`, `spec-pitfall`, `unspecified-behavior`, `question`.
- For each finding: include affected symbol/file, explanation, spec section name, and a suggested fix.
