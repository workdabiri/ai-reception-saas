# Playbook: Owner decision support workflow

## When to use

When Claude (or any session) has produced a plan, report, set of options, or open question, and the
**non-technical owner now has to decide what to do next**. This playbook turns raw technical output into
one or more clear, owner-ready decisions. It is a **decision-support** aid: it helps frame the choice and
recommend the safest action. It **grants no authority** and **starts no work** — every recommendation
terminates at the owner's explicit decision.

It does not replace the playbooks that produce the underlying work. Run it *after* the producing playbook
(e.g. [next-task-selection-workflow.md](next-task-selection-workflow.md), a security review, a remediation
plan) when the owner is staring at the output and asking "so what do I pick?"

## Required inputs

- The artifact to be decided on: the plan / report / option set / question, with the exact files or areas
  it would touch.
- The risk level for each option, from [task-risk-classifier.md](task-risk-classifier.md) — use **only**
  its four levels (Low / Medium / High / Critical). Do **not** invent a second scale.
- The `CLAUDE.md` "Never do" list, the "Remaining AI go-live gates", and the relevant
  `docs/audits/*-closure-checkpoint.md` (authoritative status).
- Whatever evidence backs each option (git history, checkpoint section, test result, file diff) so the
  recommendation cites what was actually checked, not a guess.

## Steps

1. **Restate the decision in one plain sentence.** Strip the jargon: what is the owner actually choosing
   between, and what happens if they do nothing? If you cannot state it plainly, you do not understand it
   well enough to advise on it — stop and clarify.
2. **Classify each option with [task-risk-classifier.md](task-risk-classifier.md)** as Low / Medium /
   High / Critical. Map each option to the **highest** level any part of it touches. Do not create a new
   taxonomy and do not relabel these levels.
3. **Gate-check every option against `CLAUDE.md`.** If an option touches a "Never do" item or a "Remaining
   AI go-live gate" (real provider, route-level AI generation, auto-send / message delivery,
   `schema.prisma` / migrations, env / secrets, RBAC / tenancy / AI-safety, production deploy), mark it
   **Critical / gated**.
4. **For any Critical / gated option, the only recommendation Claude may make is STOP.** Claude must not
   recommend approve, accept, auto-accept, or "proceed". State plainly that the option needs **explicit
   written owner approval plus a dedicated PR** before any work, and that an external advisor / human
   backstop should review a Critical decision — Claude is not that backstop.
5. **For Low / Medium / High options, recommend the safest viable action** and, where there are several
   options, name the recommended one. Prefer the smallest reversible step that makes progress; when unsure
   between two levels, treat it as the higher one.
6. **Build the owner-facing question** (format below). Every owner-facing question must carry all of:
   recommended owner action; recommended option (if options exist); risk level; a plain-language
   explanation a non-technical owner can act on; why this is safest; the strongest case *against* the
   recommendation; what evidence was checked; whether owner approval is required; and the exact wording to
   approve, if approval is needed. For **High / Critical** decision packages, also state a **confidence
   level** and **what would change this recommendation** — so a non-technical owner does not blindly trust
   a fluent recommendation.
7. **Present, then stop.** Hand the owner the decision package and wait. Do not start the chosen work from
   this playbook — on the owner's decision, hand off to that work's own playbook (and commit/PR only if the
   owner explicitly asks, per [git-pr-workflow.md](git-pr-workflow.md)).

## Validation commands

```bash
git rev-parse --abbrev-ref HEAD
git --no-pager log --oneline -10
git status --short
# Read-only: framing a decision changes no code, so no build/test is needed here.
# The chosen work runs its own validation gate when (and only when) the owner approves it.
```

## Stop conditions

- The option is **Critical / gated** (any "Never do" item or AI go-live gate) → recommend **STOP only**;
  never approve or auto-accept; require explicit written owner approval + a dedicated PR; preserve the
  external advisor / human backstop.
- The decision cannot be restated in plain language, or the evidence behind an option cannot be located →
  STOP, ask the owner rather than guess.
- An option's risk level is ambiguous between two levels → treat it as the higher level; if still unclear,
  STOP and ask.
- Acting on the recommendation would require self-authorizing, starting implementation, or feeding an
  automated executor / loop / cron → STOP; this playbook ends at the owner's decision.
- The underlying status inputs (checkpoints, gates, PR numbers) have drifted past git reality → STOP and
  run [repo-docs-sync-workflow.md](repo-docs-sync-workflow.md) first; do not advise off stale status.

## Forbidden actions

- Never recommend approve / accept / auto-accept / proceed for a **Critical / gated** decision — STOP is
  the only allowed recommendation, and explicit written owner approval + a dedicated PR is mandatory.
- Never present Claude as the final approver or as the external advisor / human backstop for a Critical
  decision; that backstop is a person, not this playbook.
- Never self-authorize or start the chosen work from this playbook; the output terminates at owner approval
  and must not feed an automated executor / loop / cron.
- Never invent a new risk scale or relabel the four levels — use Low / Medium / High / Critical from
  [task-risk-classifier.md](task-risk-classifier.md) and no other.
- Never omit any required field from an owner-facing question (especially the strongest case *against* the
  recommendation and whether approval is required) — a one-sided recommendation is not decision support.
- Never omit **confidence / what would change this recommendation** from a **High / Critical** decision
  package — a fluent recommendation without it invites blind trust.
- Never write the chosen decision back into `CLAUDE.md` or a committed backlog as a "current priority";
  record an owner's decision only where its source playbook says to (e.g. `docs/decision-log.md` is
  decisions-only and non-authoritative).

## Final report format

One block per decision presented to the owner:

```
Decision (plain language): <what the owner is choosing, and what "do nothing" means>
Recommended owner action: <the single safest next step — for Critical/gated this is always STOP>
Recommended option (if options exist): <name it; or "none — STOP" for Critical/gated>
Risk level: Low / Medium / High / Critical (reason)
Plain-language explanation: <why this matters, no jargon, for a non-technical owner>
Why this is safest: <one or two lines>
Strongest case against: <the best argument the other way — never blank>
Confidence / what would change this recommendation: <how confident Claude is and what new evidence would change the recommendation>
Evidence checked: <checkpoint section / git ref / test / file diff actually looked at>
Owner approval required: yes / no  (Critical/gated → yes: explicit written approval + dedicated PR)
Human backstop: <required for Critical — external advisor/human must review; N/A otherwise>
Exact question to ask the owner (if needed): "<copy-paste-ready question or approval wording>"
```
