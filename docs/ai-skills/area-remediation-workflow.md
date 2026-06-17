# Playbook: Area remediation workflow

## When to use

Closing a single numbered blocker (e.g. `A-R3`, `B-R8`) from an audit + remediation plan in `docs/audits/`. One workstream → one PR.

## Required inputs

- The audit (`AREA-X-*.md`) and the remediation plan (`AREA-X-remediation-plan.md`).
- The exact blocker id and its Definition of Done from the plan.
- The closure checkpoint for the area (current status reference).

## Steps

1. Read the blocker's scope and DoD in the remediation plan. Quote it. Do **not** expand scope beyond that one id.
2. Confirm prerequisites are already CLOSED (don't start a blocker whose dependency is open/red).
3. Prefer test-first: write the regression/lock that pins the safety property (see [test-first-hardening-workflow.md](test-first-hardening-workflow.md)).
4. Make the **minimal** source change to satisfy the DoD. Keep within the listed files/domain.
5. Run full validation; the area's hard regression suite must be green.
6. Update the area closure checkpoint **only if the task says so** — checkpoints are usually a separate docs PR; never rewrite the historical audit or plan.
7. Record evidence: commit hash, full test output, per-suite counts.

## Validation commands

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
git --no-pager diff --stat
git status --short
```

## Stop conditions

- The change would touch schema/migrations and the task didn't authorize it → stop.
- The DoD requires a real provider, route-level generation, or auto-send → stop; that is a gated future item ([real-provider-readiness-gate.md](real-provider-readiness-gate.md)).
- Closing the blocker requires weakening another control → stop, escalate.
- Scope creep beyond the single blocker id → stop, split the work.

## Forbidden actions

- No multi-blocker mega-PRs.
- No editing the historical audit/remediation-plan verdicts (they are preserved as history).
- No claiming an area is "GREEN for real data" beyond what the checkpoint's narrow scope states.

## Final report format

```
Blocker: <id> — <one-line DoD>
Files changed: <list>  (schema/migration touched? yes/no)
Tests added/changed: <files + counts>
Validation: typecheck/test/lint/build = PASS/FAIL
Regression suite (<name>): PASS/FAIL
Checkpoint updated: yes/no
Evidence: commit <hash>, <N> passed / <M> skipped
```
