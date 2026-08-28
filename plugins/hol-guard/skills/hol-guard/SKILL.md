---
name: hol-guard
description: Protect supported local AI coding harnesses with HOL Guard before mutation-bearing tool work, and use Guard approvals and receipts without bypassing native application controls.
license: Apache-2.0
---

# HOL Guard

Use HOL Guard as the local AI-harness protection boundary. It complements, rather than replaces, the target application's authentication, authorization, confirmation, backup, and validation controls.

## Install and verify

Probe the CLI directly:

```bash
hol-guard --version
```

If unavailable and the user asked to configure protection, prefer an isolated install:

```bash
pipx install hol-guard
```

Then inspect the local environment:

```bash
hol-guard status
hol-guard detect --json
```

Treat `hol-guard detect --json` as the source of truth for whether the current harness is supported and for its exact identifier. Do not maintain a separate harness list in this skill.

## Protect the detected harness

For the exact supported `<harness>` returned by detection:

```bash
hol-guard bootstrap
hol-guard install <harness>
hol-guard run <harness> --dry-run
hol-guard run <harness>
hol-guard doctor <harness> --json
hol-guard status
```

Do not proceed to mutation-bearing agent work if detection fails, the dry-run is unexpected, Guard reports an error, or `doctor` cannot prove the expected protection. Do not silently retry through an unprotected harness.

## Approvals and evidence

If Guard requires review, keep the decision explicit:

```bash
hol-guard approvals
hol-guard approvals open <request-id>
hol-guard receipts
hol-guard diff <harness>
```

For terminal-only resolution:

```bash
hol-guard approvals approve <request-id>
hol-guard approvals deny <request-id>
```

Only approve after reviewing the risk reason and requested scope. Never bypass Guard approvals or claim protection without current command output proving it.

## Boundaries

- Do not read `.env` files or expose secrets.
- Preserve application-native RBAC, confirmations, policy checks, backups, tests, and audit controls.
- Prefer Guard-owned setup commands over hand-editing harness configuration.
- Keep cloud connection or sync optional and user-directed.
- HOL Guard protects supported local harness execution; do not describe it as server-side interception for unrelated services.
