# Repo-local AI skills / playbooks

Operational playbooks for working safely in this repository. These are **repo-local Markdown playbooks**, not native Claude Code skills, not `.claude/` config, and not slash commands. They grant **no authority** — they describe how to do recurring tasks within the existing safety gates. When a playbook and a checkpoint disagree, the checkpoint in `docs/audits/` wins.

## How to use

1. Read `CLAUDE.md` first (status, guardrails, architecture).
2. Pick the playbook matching your task.
3. Follow its steps and **stop conditions**. If a stop condition fires, stop and report — do not improvise around it.
4. Run the playbook's validation commands before reporting done.

## Index

Playbooks are grouped by purpose. Read `CLAUDE.md` and the relevant `docs/audits/*-closure-checkpoint.md` first; when a playbook and a checkpoint disagree, the checkpoint wins.

### Core workflow

| Playbook | Use when |
| --- | --- |
| [code-quality-rules.md](code-quality-rules.md) | Writing or changing TypeScript/Prisma code — the repo's coding standards. |
| [git-pr-workflow.md](git-pr-workflow.md) | Branching, committing, opening a PR (only when explicitly asked). |
| [pr-body-writing-workflow.md](pr-body-writing-workflow.md) | Writing a PR description that satisfies the merge gate. |
| [post-merge-cleanup-workflow.md](post-merge-cleanup-workflow.md) | Syncing `main`, verifying a squash landed, branch cleanup. |

### Safety / security

| Playbook | Use when |
| --- | --- |
| [task-risk-classifier.md](task-risk-classifier.md) | Before any task — classify low/medium/high/critical and set the mode. |
| [security-review-workflow.md](security-review-workflow.md) | Reviewing a diff for auth / tenancy / RBAC / AI-safety issues. |
| [area-remediation-workflow.md](area-remediation-workflow.md) | Closing a numbered blocker (A-Rx / B-Rx) against an audit + remediation plan. |
| [test-first-hardening-workflow.md](test-first-hardening-workflow.md) | Adding a regression/lock test before (or instead of) a behavior change. |
| [ai-runtime-no-auto-send-guard.md](ai-runtime-no-auto-send-guard.md) | Any change touching `src/domains/ai-runtime/` or reply-draft generation. |
| [real-provider-readiness-gate.md](real-provider-readiness-gate.md) | Anyone considering wiring a real model provider or route-level generation. |

### Session continuity

| Playbook | Use when |
| --- | --- |
| [session-bootstrap-workflow.md](session-bootstrap-workflow.md) | Starting any new session — branch/status/log check + read status before editing. |
| [session-handoff-summary-workflow.md](session-handoff-summary-workflow.md) | Compressing a long session into a safe handoff without dropping guardrails. |

### Output capture

| Playbook | Use when |
| --- | --- |
| [terminal-output-capture-workflow.md](terminal-output-capture-workflow.md) | The owner needs state/validation output captured to `/tmp` when copy-paste is hard. |

### Documentation / status

| Playbook | Use when |
| --- | --- |
| [repo-docs-sync-workflow.md](repo-docs-sync-workflow.md) | Re-aligning checkpoints / `CLAUDE.md` / skill docs after a merge changed status. |

## Global forbidden actions (apply to every playbook)

- No commit / push / PR unless the task **explicitly** asks for it.
- No production code, test, schema, or migration changes during a docs-only task.
- No new dependencies (especially no model-provider SDK) without explicit task authorization.
- No reading env vars / API keys, no auto-send, no broadening tenant scope, no bypassing RBAC/ABAC or the human-review boundary.
- Never declare the product "Private Alpha ready" or "real-provider AI ready" — real-data readiness is conditional (`docs/audits/`).

## Global validation commands

```bash
pnpm typecheck
pnpm test
pnpm lint
git diff --check
git --no-pager diff --stat
git status --short
```
