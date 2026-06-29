# Area B AI-Runtime Kill-Switch / Rollback Drill Runbook

## Status

Runbook only. No drill executed. Documentation-only.

## Purpose and Scope

- This is an **Area B AI-runtime kill-switch / rollback drill runbook**.
- It documents the rollback / disable procedure for AI reply-draft generation: how to flip the per-business kill switch, what the system is guaranteed to do afterward, and how to rehearse and sign off on that procedure.
- It **advances, but does not close, readiness gate #11** (`docs/ai-skills/real-provider-readiness-gate.md` — "Staging validation + kill-switch/rollback drill").
- It **does not approve real-provider production AI-assisted go-live**.

This runbook is documentation only. It changes no production source, no tests, no schema, no packages, no CI, and no environment configuration. It implements no admin endpoint, no provider, and no auto-send. It is the operator-facing procedure to be rehearsed later under explicit owner approval.

## Hard Posture Banner

The following hard-posture facts hold and are preserved by this runbook:

- AI remains default-off.
- No real provider is integrated.
- No provider SDK is approved.
- No env/API-key work is approved.
- No route-level real generation wiring is approved.
- No auto-send exists.
- customer-message-in-prompt remains STOP / future owner-gated.
- real-provider production AI-assisted go-live remains NOT YET APPROVED.

## Gate Status

> This runbook documents and advances the kill-switch / rollback drill gate.
> It does not close the gate.
> Gate closure requires a witnessed rehearsal and recorded owner sign-off.

The fail-closed behavior this runbook relies on is **test-proven in CI** (see [Evidence From Existing Tests](#evidence-from-existing-tests)). It has **not** been rehearsed in a live environment. The drill (a witnessed rehearsal) plus a recorded owner sign-off remain outstanding before gate #11 can be considered closed.

## Non-Goals

- No drill execution in this task (this document is the procedure, not a record of a run).
- No production rollout or production rollback execution.
- No production rollout approval.
- No real-provider integration or provider SDK.
- No env/API-key changes; no secret rotation.
- No `Business.aiMode` write mechanism implemented here (the admin/server-side write path is environment-specific — see [Open Items / Placeholders](#open-items--placeholders)).
- No route-level real generation wiring.
- No schema or migration changes.
- No package changes.
- No CI changes.
- No auto-send path; no message delivery.
- No customer/conversation/message content entering any prompt.

---

## Kill-Switch Location

| Aspect | Value |
|---|---|
| Kill switch | The per-business `Business.aiMode` setting. |
| `MANUAL` | AI off / generation disabled (default). |
| `AI_ASSISTED` | Explicitly enabled server-side mode. |
| Rollback / kill | Revert the target business `aiMode` to `MANUAL`. |
| Scope | Per business. Reverting one business does not affect others. |
| Mechanism | A **server-side state change** of `aiMode`. Not a deploy, not an env flag change, not a schema change. |
| Default-off | A new business defaults to `MANUAL`; no business is AI-enabled without an explicit server-side change. |

The kill switch is resolved server-side from the tenant context's `businessId`; a client-supplied mode or `businessId` is never trusted. Reverting `aiMode` to `MANUAL` disables generation business-wide **without a deploy**, and the policy resolver fails closed thereafter.

> A platform-wide / global AI kill switch (disabling AI for all businesses at once) is a future / owner-gated consideration and is **not** covered by this runbook. The concrete, in-scope kill switch today is the per-business `aiMode` → `MANUAL` revert.

This runbook adds no code and no schema. It documents the existing `aiMode` field and its fail-closed semantics only.

---

## Current Behavior

Implementation truth as of this runbook:

- Today the reply-draft generate route is still **deterministic SYSTEM stub** behavior. It returns a fixed placeholder draft for human review; it calls **no** LLM and uses **no** real provider.
- The AI-mode gate **blocks generation when AI mode is `MANUAL`**.
- When disabled, the handler **fails closed with `AI_DISABLED`** (HTTP 403) and **creates no draft**; it calls no provider.
- When AI mode is `AI_ASSISTED`, the handler proceeds **only to the deterministic stub** — there is no real model call in current scope.
- Current scope has **no real provider and no real model call**. The kill switch therefore today gates whether the generate endpoint produces a (stub) draft at all; the same fail-closed guarantee is intended to extend to a **future, owner-gated** real generation path that does not exist yet.
- Existing reviewable drafts are **review-only**; nothing auto-sends. Reverting to `MANUAL` does not delete existing drafts — they remain for human review (approve / edit / discard), and the human-approval boundary remains the only path to a customer.

Source (reference only — do not modify): `src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/handler.ts`.

---

## Evidence From Existing Tests

The fail-closed and no-auto-send guarantees that make the kill switch safe are already pinned by existing, green tests. **Do not modify these tests.** They serve as the acceptance evidence cited by this runbook.

### Generate handler — `__tests__/api/reply-draft-generate-handler.test.ts`

These cases prove (test names quoted):

- `fails closed with AI_DISABLED when business AI mode is MANUAL`
- `creates NO draft when AI is disabled (no provider, no generation)`
- `proceeds to the deterministic stub only when AI is AI_ASSISTED`
- `fails closed when resolver returns disabled even with AI_ASSISTED label`
- `fails closed when resolver errs`
- `resolves AI policy from the SERVER-SIDE tenant context businessId`
- `gate runs after authz (denied authz never reaches AI resolver)`
- `no LLM/provider imports in handler`
- `no outbound message creation in handler`

### Resolver and Area B regression suites (existing green coverage — do not modify)

- `__tests__/domains/ai-config-resolver.test.ts` — the B-R1 resolver fails closed for `MANUAL`, missing business, unknown/invalid stored mode, empty/missing context, or a repository error, and always returns a policy (never throws).
- `__tests__/domains/ai-runtime-cross-tenant-isolation.test.ts` — B-R7: with AI off, the pipeline fails closed (no knowledge read, no prompt, no provider call, no audit row, no draft), and context never cross-leaks between tenants.
- `__tests__/domains/ai-runtime-no-auto-send-lock.test.ts` — B-R8: the AI runtime has no send / message-delivery path; draft metadata is review-only; human approval remains the only boundary to a customer.

These are unit / handler-tier proofs run on every `pnpm test`, plus the gated real-DB AI-isolation suite. They establish that the **behavior** the drill verifies already holds; the drill rehearses it as an **operational procedure**.

---

## Pre-Drill Required Inputs

The following must be available before an operator begins a drill. Use placeholders until a real drill is scheduled and approved.

| Input | Source | Value |
|---|---|---|
| Written owner approval to run the drill | Owner | TBD |
| Target environment (must be non-production) | Ops | TBD |
| Target **synthetic/test** business ID | Test data | TBD |
| Approved server-side `aiMode` write mechanism | Ops / Eng | TBD (see Open Items) |
| Access to attempt the generate reply-draft request | Ops | TBD |
| Access to confirm draft non-creation (read path / DB read) | Ops | TBD |
| Operator | Owner assignment | TBD |
| Owner approver / sign-off authority | Owner | TBD |
| Evidence storage location | Ops / policy | TBD |

---

## Operator Safety Rules

1. **Run only against a synthetic/test business in a non-production environment.** Never run this drill against real customer data.
2. **Confirm written owner approval** before starting.
3. **Confirm current scope has no real provider** and **no auto-send path** before starting (the drill assumes the stub path).
4. **Record exact timestamps** and the `aiMode` value before and after every change.
5. **Do not deploy code, change env/secrets, rotate API keys, or touch provider config** during the drill — the kill switch is a server-side state change only.
6. **Do not change `prisma/schema.prisma` or run migrations** during the drill.
7. **Do not delete** existing reply-draft, conversation, or customer records during rollback.
8. **Do not paste** secrets, tokens, customer PII, message content, or full draft text into evidence; record IDs and outcomes only.
9. **Stop immediately** if any expected fail-closed result does not occur (e.g. a draft is created while AI is `MANUAL`), and record it.
10. **Do not declare the gate closed** from this drill alone — closure requires the witnessed rehearsal plus recorded owner sign-off.

---

## Rollback Procedure

A step-by-step operator runbook for executing and verifying the kill switch.

### Step 1 — Pre-check

- Identify `businessId` (synthetic/test business).
- Confirm current `aiMode` and record it as the pre-drill value.
- Confirm no real provider is integrated.
- Confirm no auto-send path exists.

### Step 2 — Execute kill switch

- Change the target business `aiMode` to `MANUAL` using the approved admin/server-side mechanism.
- Do not deploy code.
- Do not rotate env keys.
- Do not touch provider config.

> If the drill requires demonstrating the *transition* from enabled to disabled, the target synthetic/test business may first be set to `AI_ASSISTED` (which, in current scope, activates only the deterministic stub path — no real model call), then killed back to `MANUAL`. Record both transitions.

### Step 3 — Verify

- Attempt to generate a reply draft for the target business.
- Expected result: **fail closed with `AI_DISABLED`** (HTTP 403).
- Expected result: **no draft is created**.
- Expected result: existing reviewable drafts remain **review-only** and are **not sent automatically**.

### Step 4 — Rollback confirmation

- Record timestamp.
- Record `businessId`.
- Record operator / owner who approved.
- Record evidence links or command output (IDs and outcomes only — no PII, no draft text, no secrets).

### Step 5 — Restore pre-drill state

- Restore the target business `aiMode` to the **pre-drill value recorded in Step 1** using the approved server-side mechanism.
- For a synthetic/test business the pre-drill value is normally `MANUAL` (default-off); restoring confirms the environment is left as found.
- Restoring is owner-gated and, in current scope, only re-activates the deterministic stub path — it enables no real model call.

---

## Drill Checklist

- [ ] owner approval before drill
- [ ] target business selected (synthetic/test, non-production)
- [ ] aiMode before drill recorded
- [ ] aiMode changed to MANUAL
- [ ] generation attempt blocked
- [ ] no draft created
- [ ] no auto-send occurred
- [ ] logs/evidence captured
- [ ] owner sign-off recorded

---

## Verification Expectations

| Action | Pre-condition | Expected result |
|---|---|---|
| Generate reply draft | `aiMode = MANUAL` | Fail closed `AI_DISABLED` (403); no draft created; no provider call |
| Generate reply draft | `aiMode = AI_ASSISTED` (synthetic/test only) | Proceeds to deterministic SYSTEM stub only; no real model call |
| Existing reviewable draft after kill | `aiMode = MANUAL` | Remains review-only; not sent automatically |
| New business (no explicit change) | default | `aiMode = MANUAL` (default-off verified) |

---

## Sign-Off Section

Blank sign-off template. Duplicate before use; fill during the actual drill.

```
Drill date:
Business ID:
Environment:
Operator:
Owner approver:
Pre-drill aiMode:
Post-kill aiMode:
Evidence location:
Result:
Owner sign-off:
```

---

## Troubleshooting Quick Reference

| Symptom | Likely cause | Resolution |
|---|---|---|
| Generate returns a draft while `aiMode = MANUAL` | Kill switch not applied / wrong business targeted | **Stop and record.** Confirm the `aiMode` value and target `businessId`; do not proceed |
| Generate returns `AI_DISABLED` while expecting the stub | `aiMode` not `AI_ASSISTED`, or resolver fail-closed (missing/invalid state) | Confirm the recorded `aiMode`; this is the safe default — investigate before re-enabling |
| Unsure whether a draft was created | Read path access missing | Use the approved read mechanism to confirm draft non-creation; record IDs only |
| A draft is `SENT` with **no operator action** (no `ai_drafts.send` actor / no human send) | Would indicate an unexpected **auto-send** (B-R8 violation) | **Stop and escalate.** A draft `SENT` via the human-gated operator "Send Approved Draft" action is expected; only an *auto*-send (no human actor) must never happen (B-R8). |

---

## Open Items / Placeholders

| Item | Status |
|---|---|
| Exact server-side `aiMode` write mechanism (admin endpoint vs. ops data update) | TBD — environment-specific; not implemented by this runbook |
| Target staging/non-production environment for the drill | TBD |
| Witnessed rehearsal execution | Outstanding (required to advance toward gate closure) |
| Recorded owner sign-off | Outstanding (required for gate closure) |
| Global / platform-wide AI kill switch | Future / owner-gated; out of scope |

---

## What This Runbook Does NOT Cover

- Production rollout or production rollback execution.
- Real-provider integration, provider SDK, or any real model call.
- env/API-key handling or secret rotation.
- Route-level real generation wiring.
- Schema/migration changes or DB usage counters.
- Auto-send / message delivery.
- Customer-message-in-prompt (remains STOP / future owner-gated).
- A global/platform-wide AI kill switch.
- Implementing the `aiMode` write mechanism.

---

## References

Referenced for context only; none is modified by this runbook.

| Resource | Path |
|---|---|
| Area B closure checkpoint (status reference) | `docs/audits/AREA-B-closure-checkpoint.md` |
| Area B remediation plan (kill switch documentation requirement) | `docs/audits/AREA-B-remediation-plan.md` |
| Real-provider readiness gate (gate #11) | `docs/ai-skills/real-provider-readiness-gate.md` |
| AI no-auto-send guard playbook | `docs/ai-skills/ai-runtime-no-auto-send-guard.md` |
| Generate handler source | `src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/handler.ts` |
| Generate handler tests (acceptance evidence) | `__tests__/api/reply-draft-generate-handler.test.ts` |
| Resolver fail-closed tests (B-R1) | `__tests__/domains/ai-config-resolver.test.ts` |
| Cross-tenant AI-isolation tests (B-R7) | `__tests__/domains/ai-runtime-cross-tenant-isolation.test.ts` |
| No-auto-send / human-approval lock (B-R8) | `__tests__/domains/ai-runtime-no-auto-send-lock.test.ts` |
| Style precedent — staging rollout/observability plan | `docs/operations/authjs-request-context-staging-rollout-observability-plan.md` |
| Style precedent — dry-run execution guide | `docs/operations/authjs-request-context-staging-dry-run-execution-guide.md` |
| Style precedent — readiness sign-off template | `docs/operations/authjs-request-context-staging-dry-run-readiness-signoff-template.md` |

---

## Version History

| Version | Date | Description |
|---|---|---|
| 1.0 | 2026-06-20 | Initial Area B AI-runtime kill-switch / rollback drill runbook (docs-only). Advances readiness gate #11; does not close it. |
