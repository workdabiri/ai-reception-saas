# Playbook: Session handoff summary workflow

## When to use

You need to compress a long session into a short handoff — to continue later, hand to another session, or shrink context — **without** losing safety-critical state. Use this instead of lossy ad-hoc compression ("Caveman" style) that can silently drop guardrails.

## Required inputs

- The current branch, last commit, and working-tree state (`git status --short`).
- The active task and its risk level ([task-risk-classifier.md](task-risk-classifier.md)).
- The validation results actually run this session (don't infer them).

## What to summarize (include all of these)

1. **Branch** and whether it matches the task's expected branch.
2. **Latest commit** (`git --no-pager log --oneline -1`) and any uncommitted changes (`git status --short`).
3. **Open task**: what it is, its risk level, and Definition of Done.
4. **Security constraints in force**: tenant isolation (server-derived `businessId`), RBAC/ABAC, dev-bypass guard, AI no-auto-send / metadata-only audit, no provider SDK / no env reads — list the ones the task touches, concretely enough to act on.
5. **Validation status**: each of lint / typecheck / build / test = PASS/FAIL/skipped, with failures quoted, not summarized away.
6. **Remaining TODOs**: ordered, blocking ones first.
7. **Exact next command** to run on resume (copyable) — e.g. the next test or validation step. This is an **ephemeral** resume hint, not a durable decision: re-validate it via [session-bootstrap-workflow.md](session-bootstrap-workflow.md) on resume rather than trusting it blindly. Durable owner accept/defer/reject decisions belong in the non-authoritative `../decision-log.md`, which is **not** a status source and never replaces the checkpoints or git history (those win on conflict).
8. **Pointers**: the checkpoint(s) and playbook(s) that govern the task.

## What must NOT be omitted

- Any **security/safety gate** that applies (tenant, RBAC, AI no-auto-send, schema/migration L4, provider/env prohibitions). Compressing these away is the exact failure mode this playbook exists to prevent.
- Any **failed or skipped validation** — a handoff that hides a red test reads as "done" when it isn't.
- The **risk level** and any **owner-approval-required / STOP** state.

## Steps

1. Gather branch, last commit, working-tree state, and the validation results you actually ran.
2. Fill the template below; copy security constraints from `CLAUDE.md` / the checkpoint rather than paraphrasing loosely.
3. Re-read the summary against "What must NOT be omitted"; if any gate or failure is missing, add it back.
4. Hand off; keep the summary; do not commit it into the repo unless asked.

## Validation commands

```bash
git rev-parse --abbrev-ref HEAD
git --no-pager log --oneline -1
git status --short
```

## Stop conditions

- A failed/skipped validation would be dropped to make the handoff look clean → stop, include it.
- A security constraint touching the task can't be represented in the summary → stop, expand the summary.
- You cannot state the exact next command → stop; you don't yet understand the resume point.

## Forbidden actions

- Never drop tenant-isolation, RBAC, or AI-safety constraints to save tokens.
- Never report PASS for validation you didn't run, or hide a FAIL.
- Never compress a STOP / owner-approval-required state into "in progress".

## Final report format (the handoff itself)

```
Branch: <name> (expected? yes/no)
Last commit: <hash> <subject>
Working tree: clean / <git status --short>
Task: <id/desc> — risk <level> — DoD: <one line>
Security constraints in force: <tenant / RBAC / AI no-auto-send / no provider SDK / ...>
Validation: lint=… typecheck=… build=… test=… (failures quoted)
Remaining TODOs: 1) … 2) … (blocking first)
Next command: <exact copyable command>
Governing docs: <checkpoint(s) + playbook(s)>
```
