# Playbook: Task-cycle orchestrator workflow

## When to use

When you want a single map of the **whole task cycle** — orient → choose → owner gate → branch →
implement → validate → commit/PR → merge → docs-sync — so each step hands off to the right specialist
playbook in the right order. Use it to sequence a session, not to execute one.

This is a **thin sequencer**, not a new authority. It **grants no authority** and adds no new rule. It
only points at playbooks that already own each step; on any conflict, the specialist playbook and the
`docs/audits/*-closure-checkpoint.md` win over this one. Every gate below is defined by another doc — this
playbook just keeps them in order.

## What this is **not** (hard limits)

- It must **not** feed an automated executor — its output is a human-readable sequence, never a machine queue.
- It must **not** run as a loop.
- It must **not** run as cron / on a schedule.
- It must **not** store a "current task" anywhere (especially not `CLAUDE.md`); the next task is derived
  fresh each session per [next-task-selection-workflow.md](next-task-selection-workflow.md).
- It must **not** override owner approval — every owner gate stays exactly where the owner put it.
- It must **not** override [task-risk-classifier.md](task-risk-classifier.md) — risk levels and modes come
  from there unchanged (Low / Medium / High / Critical only).
- It must **not** override [git-pr-workflow.md](git-pr-workflow.md) — commit/push/PR rules are unchanged.
- It must **not** self-merge — merge needs CI + review + owner approval, never this playbook.

## Required inputs

- The outputs of [session-bootstrap-workflow.md](session-bootstrap-workflow.md): branch, working-tree
  state, recent history, and the live status from `CLAUDE.md` + the relevant checkpoint(s).
- The `CLAUDE.md` "Never do" list and "Remaining AI go-live gates".
- The task (if any) the owner has already approved — quoted, not assumed.

## The canonical sequence

Each numbered step is owned by the linked playbook. This playbook only enforces their **order** and the
**owner gates between them**. Do not collapse a gate or reorder past one.

1. **Orient / anti-staleness.** Run [session-bootstrap-workflow.md](session-bootstrap-workflow.md): branch,
   `git status --short`, recent log, read `CLAUDE.md` + the newest `docs/audits/*-closure-checkpoint.md`.
   If inputs have drifted past git reality → STOP and run
   [repo-docs-sync-workflow.md](repo-docs-sync-workflow.md) first.
2. **Choose / risk-classify.** If the next task is undecided, run
   [next-task-selection-workflow.md](next-task-selection-workflow.md) to derive a recommendation (it
   recommends, it does not authorize). Classify the candidate with
   [task-risk-classifier.md](task-risk-classifier.md) **before** presenting it.
3. **Owner decision gate.** Present the recommendation; if framing is needed, use
   [owner-decision-support-workflow.md](owner-decision-support-workflow.md). **STOP here** — no branch, no
   edit — until the owner explicitly decides. Critical/gated candidates may only be recommended as STOP.
4. **Branch creation — only after owner approval.** Per
   [git-pr-workflow.md](git-pr-workflow.md): never edit on `main`; create `<type>/<short-topic>` only once
   the owner has approved the task.
5. **Risk lane (set by [task-risk-classifier.md](task-risk-classifier.md)).** Pick the lane from the
   classified level — never downgrade to skip a gate:
   - **Low** (docs-only / tests-only) → fast lane: edit directly, minimum validation.
   - **Medium, non-gated** → standard lane: keep the diff minimal; ask-first recommended for code.
   - **Medium, production code** → Plan Mode **recommended** before the first edit.
   - **High** → Plan Mode **mandatory**; owner approval of scope/plan before edits.
   - **Critical / gated** → **STOP-only.** No edit without explicit written owner approval + a dedicated PR
     + the external advisor / human backstop preserved.
6. **Implement under the task-specific playbook.** Route to the matching specialist — e.g.
   [code-quality-rules.md](code-quality-rules.md) for code,
   [test-first-hardening-workflow.md](test-first-hardening-workflow.md) for a lock/regression test,
   [security-review-workflow.md](security-review-workflow.md) for auth/tenancy review,
   [ai-runtime-no-auto-send-guard.md](ai-runtime-no-auto-send-guard.md) for any AI-runtime change,
   [repo-docs-sync-workflow.md](repo-docs-sync-workflow.md) for docs drift.
7. **Validation gate.** Run the validation the risk level requires (read-only at this stage — running
   tests/lint/typecheck changes no repo state). Docs-only stays minimal; Medium+ runs the fuller gate; High
   adds the area's regression suite. Do not claim a check passed unless it was actually run.
8. **Commit / push / PR — only when explicitly asked.** Per [git-pr-workflow.md](git-pr-workflow.md) and
   [pr-body-writing-workflow.md](pr-body-writing-workflow.md). If the owner did not ask, STOP and report the
   change as uncommitted.
9. **Merge — only after CI + review.** Squash-merge only; owner approval required; **never self-merge**.
10. **Post-merge docs-sync detection.** Run [post-merge-cleanup-workflow.md](post-merge-cleanup-workflow.md)
    to confirm the squash landed and sync `main`; if the merge changed status, detect drift and hand off to
    [repo-docs-sync-workflow.md](repo-docs-sync-workflow.md) (a separate docs-only PR).

## Allowed automation (read-only / proposal-only)

This playbook may automate only steps that change no repo state and authorize nothing:

- Read-only git checks: `git status` / `git --no-pager log` / branch checks.
- Read-only PR checks (status, CI result, review state).
- Read-only checkpoint / doc-freshness (anti-staleness) checks.
- Producing a next-task **selection proposal** (recommendation only).
- Risk **classification** of a candidate.
- A **lightweight plan proposal** for Low / Medium non-gated tasks.
- Read-only **validation** (run the gate's commands and report results).
- Post-merge **docs-drift detection** (flagging what went stale).

Nothing above creates a branch, edits a file, commits, pushes, opens a PR, or merges.

## Must-stop gates (owner approval required between steps)

Each is owned elsewhere; this playbook only refuses to cross one without it:

- Owner approval **before branch creation**.
- Owner approval **before edits**.
- Owner approval **before commit**.
- Owner approval **before push**.
- Owner approval **before PR creation**.
- Owner approval **before merge**.
- **Plan Mode before High** tasks (mandatory).
- **Critical / gated → STOP-only**: explicit **written** owner approval + a **dedicated PR** + the external
  advisor / human backstop preserved. Claude may recommend only STOP — never approve / auto-accept.

## Critical / gated examples (STOP-only)

If a candidate touches any of these, it is Critical / gated — recommend STOP, never auto-select, never
edit without written owner approval + a dedicated PR (see `CLAUDE.md` "Never do" + "Remaining AI go-live
gates" and the `docs/audits/*-closure-checkpoint.md`):

- Integrating a **real AI model provider** / adding a provider SDK.
- **Route-level AI generation** wiring (assembly → prompt → provider → draft).
- **Auto-send** of AI output / wiring the AI runtime to message delivery.
- `prisma/schema.prisma` / **migrations**.
- **Env / secrets / API keys** (reading or wiring).
- **Production deploy**.
- **RBAC / tenancy / AI-safety-critical** behavior (incl. the dev-bypass guard, tenant backstop,
  no-auto-send / human-review boundary).
- **Branch protection / GitHub settings** changes.
- **Area B real-AI go-live gates** (`AREA-B-closure-checkpoint.md` §6) — none satisfied today.
- **Area C public web widget ingest** — out of scope unless separately audited and approved.

## Validation commands

This playbook only sequences; the **active step** runs its own validation. The orchestration itself is
read-only:

```bash
git rev-parse --abbrev-ref HEAD
git status --short
git --no-pager log --oneline -10
# The chosen step runs its own gate (task-risk-classifier.md / git-pr-workflow.md). No build/test to *sequence*.
```

## Stop conditions

- Inputs have drifted past git reality (stale checkpoint/PR/gate refs) → STOP, run
  [repo-docs-sync-workflow.md](repo-docs-sync-workflow.md) first.
- The next step is a must-stop gate and owner approval is absent → STOP, present the gate; do not cross it.
- The candidate is Critical / gated without explicit written owner approval + a dedicated PR → STOP,
  recommend STOP only.
- A task classified Low/Medium is discovered mid-flight to touch a High/Critical surface → STOP,
  re-classify with [task-risk-classifier.md](task-risk-classifier.md), re-confirm.
- This playbook and a specialist playbook or a checkpoint disagree → the specialist / checkpoint wins; STOP
  and follow it.

## Forbidden actions

- Never let this playbook feed an automated executor, run as a loop, or run as cron.
- Never store a "current task" / "current priority" / backlog in this playbook, `CLAUDE.md`, or any
  committed file; derive the next task fresh per
  [next-task-selection-workflow.md](next-task-selection-workflow.md).
- Never self-authorize, self-merge, or cross an owner gate without explicit approval.
- Never override or relabel [task-risk-classifier.md](task-risk-classifier.md) levels, the
  [git-pr-workflow.md](git-pr-workflow.md) rules, or any checkpoint.
- Never recommend approve / accept / proceed for a Critical / gated item — STOP is the only allowed
  recommendation, and the external advisor / human backstop must be preserved.

## Final report format

```
Cycle position: <step 1-10 reached>
Branch: <name> (created with owner approval? yes/no/N-A)
Task + risk level + mode: <one line — low/med/high/critical · direct/ask/plan/stop>
Gated?: yes/no (if yes: approval present? quote it)
Active step's playbook: <which specialist owns the work now>
Owner gate pending before next step: <which gate, or "none">
Validation (from the active step): <commands + PASS/FAIL/skipped, or "read-only sequencing only">
Next action requires owner approval: yes/no
```
