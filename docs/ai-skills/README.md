# Repo-local AI skills / playbooks

Operational playbooks for working safely in this repository. These are **repo-local Markdown playbooks**, not native Claude Code skills, not `.claude/` config, and not slash commands. They grant **no authority** — they describe how to do recurring tasks within the existing safety gates. When a playbook and a checkpoint disagree, the checkpoint in `docs/audits/` wins.

## How to use

1. Read `CLAUDE.md` first (status, guardrails, architecture).
2. Pick the playbook matching your task.
3. Follow its steps and **stop conditions**. If a stop condition fires, stop and report — do not improvise around it.
4. Run the playbook's validation commands before reporting done.

## Index

| Playbook | Use when |
| --- | --- |
| [git-pr-workflow.md](git-pr-workflow.md) | Branching, committing, opening a PR (only when explicitly asked). |
| [security-review-workflow.md](security-review-workflow.md) | Reviewing a diff for auth / tenancy / RBAC / AI-safety issues. |
| [area-remediation-workflow.md](area-remediation-workflow.md) | Closing a numbered blocker (A-Rx / B-Rx) against an audit + remediation plan. |
| [test-first-hardening-workflow.md](test-first-hardening-workflow.md) | Adding a regression/lock test before (or instead of) a behavior change. |
| [pr-body-writing-workflow.md](pr-body-writing-workflow.md) | Writing a PR description that satisfies the merge gate. |
| [post-merge-cleanup-workflow.md](post-merge-cleanup-workflow.md) | Syncing `main`, verifying a squash landed, branch cleanup. |
| [ai-runtime-no-auto-send-guard.md](ai-runtime-no-auto-send-guard.md) | Any change touching `src/domains/ai-runtime/` or reply-draft generation. |
| [real-provider-readiness-gate.md](real-provider-readiness-gate.md) | Anyone considering wiring a real model provider or route-level generation. |

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
