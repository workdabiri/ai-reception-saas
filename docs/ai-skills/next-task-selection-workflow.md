# Playbook: Next-task selection workflow

## When to use

When the owner asks "what's next?", or a task just merged and the next one is undecided. Run it right
after [session-bootstrap-workflow.md](session-bootstrap-workflow.md). It **recommends** the next task —
it never authorizes or starts one. The next task is **derived fresh each session** from authoritative
sources; it is never read from a stored "current task" anywhere (especially not `CLAUDE.md`).

## Required inputs

- The output of session-bootstrap (current branch, working-tree state, recent commits).
- The relevant `docs/audits/*-closure-checkpoint.md` (current status, plus its "Remaining Gates" and
  "Remaining Non-Blocking Hardening" sections — find them by heading, not a fixed section number) and
  `docs/audits/*-remediation-plan.md` (open blockers / DoD).
- `git --no-pager log --oneline -20` (execution reality) and open PR/branch state.
- `docs/decision-log.md` — prior owner decisions (deferral memory / who-has-what). **Non-authoritative
  input only**; on any conflict with a checkpoint or git history, the log loses.
- The `CLAUDE.md` "Never do" list and the AI go-live gates.

## Steps

1. **Anti-staleness self-check (do this first).** This procedure can itself decay. Resolve the *newest*
   `docs/audits/*-closure-checkpoint.md` by glob — do not trust a hardcoded "Area B is latest". Confirm
   every checkpoint / gate / PR a candidate would rely on still exists, and that `git log` head is newer
   than the newest PR the checkpoint cites. Reference docs by role/glob, never by a fixed filename or section number. If
   the inputs have drifted past reality → **STOP** and run [repo-docs-sync-workflow.md](repo-docs-sync-workflow.md) first.
2. **Read authoritative status:** which Areas/blockers are CLOSED vs open (checkpoints + remediation DoD).
3. **Reconcile against git history:** drop anything already merged; note in-flight branches/open PRs so
   two sessions/actors don't pick the same work. Read `docs/decision-log.md` and apply any still-relevant
   owner deferral/sequencing as an **input** (e.g. "do Z before Y"); drop log entries whose work already
   merged. If the log conflicts with checkpoints/git, the log loses.
4. **Assemble candidates from OPEN, NON-GATED work first** — open remediation items, the hardening backlog
   in checkpoints' "Remaining/Non-blocking" sections, known doc-sync debt.
5. **Flag every GATED candidate** (real provider, route-level AI, auto-send/message delivery,
   `schema.prisma`/migrations, CI/branch-protection, env/secrets, RBAC/tenancy/AI-safety) as
   **STOP-for-approval** — never auto-select these.
6. **Classify each candidate with [task-risk-classifier.md](task-risk-classifier.md) BEFORE presenting it**,
   and attach the required mode (direct / ask-first / plan-mode / stop-for-approval). Classifying inside the
   selection loop is what stops a Critical/STOP item from ever being surfaced as "ready to pick up."
7. **Rank by a fixed ordering** (for reproducibility across sessions/models — not ad-hoc judgment):
   (1) open security / go-live-gate blockers that unblock the most, (2) correctness / regression / test
   debt, (3) doc-sync / drift reduction, (4) features. Within a tier, break ties by lowest risk class
   first, then smallest shippable scope. State the ordering so the owner can audit *why* this ranked top.
8. **Present the recommendation** in the Final report format below — it is a **proposal**; ask the owner to
   choose one.
9. **On the owner's decision,** append one dated entry to `docs/decision-log.md` (accept/defer/reject +
   date + PR-or-commit + risk class + approving owner) — decisions only, never a candidate list, never a
   status claim. On approval, hand off to that task's own playbook (commit/PR only if explicitly asked, per
   [git-pr-workflow.md](git-pr-workflow.md)). On no approval, record the transient pointer in the ephemeral
   session handoff ([session-handoff-summary-workflow.md](session-handoff-summary-workflow.md)) and STOP.

## Validation commands

```bash
git rev-parse --abbrev-ref HEAD
git --no-pager log --oneline -20
git status --short
# Read-only: no build/test needed to *recommend*. The chosen task runs its own validation gate.
```

## Stop conditions

- The procedure's cited anchors (checkpoint names, gate names, PR numbers) have drifted past git reality →
  STOP (step 1), run repo-docs-sync first.
- The top candidate is a GATED item without explicit written owner approval → STOP, present it as blocked.
- Checkpoints and git history disagree about what's done → STOP, run repo-docs-sync first.
- The recommendation cannot be tied to an open checkpoint gate or remediation item → STOP, ask the owner
  rather than invent scope.
- Selection would require trusting a stale "next step" note (e.g. an old handoff "Next Development Sequence",
  a stale domain count) → STOP, verify against git + checkpoints first.

## Forbidden actions

- Never self-authorize or start implementation from this playbook. The output terminates at owner approval
  and must **not** feed an automated executor / loop / cron.
- Never select real-provider / route-AI / auto-send / schema / migration / CI-security work without explicit
  written owner approval + a dedicated PR.
- Never write the chosen task back into `CLAUDE.md` or any committed backlog; never "just annotate the
  current priority in `CLAUDE.md`".
- This playbook **names no specific task and stores no task list** — it derives the recommendation live each
  run. Do not add a "candidate tasks" / "current priority" section to it.
- `docs/decision-log.md` is **decisions-only and non-authoritative**: never write a candidate/backlog list,
  a "next priority", or any security/Area/AI-safety status into it; never cite it as status. On any conflict,
  checkpoints + git history win. If it ever starts being read as the plan or the status, that is the signal
  to graduate to GitHub Issues (owner-approved, where approval is an owner-only label).
- Never treat a stale handoff section, an old "next step" note, or an uncommitted handoff "Next command" as
  authoritative — reconcile against git + checkpoints first.

## Final report format

```
Recommended next task (owner must confirm): <one line>   # never "Next task: X"
Why now (per the fixed ordering): <tier + unblocks / closes gate / reduces drift>
Risk level + mode: <low/med/high/critical — direct/ask/plan/stop>
Gated?: yes/no (approval present? quote it)
Governing docs: <checkpoint(s) + task playbook>
Definition of Done: <one line>
Alternatives considered (ranked): <2-3>
Owner decision needed before any edit: yes
```
