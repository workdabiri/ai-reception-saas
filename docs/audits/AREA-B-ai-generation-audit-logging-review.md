# AREA-B — AI Generation / Audit-Event Logging Gap Review

**Product:** AiA Reception SaaS
**Scope:** AI Runtime audit/observability — general `AuditEvent` logging vs. B-R6 `AiGenerationAuditLog`; the reply-draft generate route's audit posture (PRD-v1.1 §5 / §9; checkpoint §6 "Audit logging wired to the actual generation route"; remediation-plan B-R6 lineage)
**Date:** 2026-06-21
**Source documents:** `docs/audits/AREA-B-closure-checkpoint.md` (current status reference) · `docs/audits/AREA-B-remediation-plan.md` · `docs/audits/AREA-B-prompt-injection-untrusted-input-strategy.md` · `docs/audits/AREA-B-token-usage-cost-guard.md` · `src/domains/ai-runtime/audit-log.ts` (B-R6) · the reply-draft `generate` / `approve` / `edit` / `discard` handlers · `__tests__/api/reply-draft-generate-handler.test.ts`

---

## 0. Status

- Review only.
- Docs-only.
- No implementation.
- No route wiring.
- No real provider.
- No provider SDK.
- No env/API-key work.
- No customer-message-in-prompt.
- No auto-send.
- Real-provider production AI-assisted go-live remains NOT YET APPROVED.

This document **records and reviews** a grounded audit/observability gap and **recommends future owner-approved work only**. It implements nothing, changes no production source, no tests, no schema, no packages, no CI, and no environment configuration. It is a single new docs file in `docs/audits/`. It **recommends**; the owner **decides**.

---

## 1. Executive Finding

Verified against `main` after PR #134 (the handlers below are unchanged since `fa4079a` / PR #98):

- **The generate route currently creates/reuses the deterministic SYSTEM stub draft but emits no general audit event.** `reply-drafts/generate/handler.ts` builds a draft via `generateOrReuseStubDraft(...)` with the fixed `STUB_DRAFT_TEXT` constant and reconciles `Conversation.aiDraftStatus`, but it has **no** `auditService` dependency and makes **no** `createAuditEvent(...)` call.
- **Approve / edit / discard handlers do emit general audit events.** Each of `reply-drafts/[draftId]/approve|edit|discard/handler.ts` takes an optional `auditService: Pick<AuditService, 'createAuditEvent'>` and emits a PII-safe, metadata-only audit event on its successful mutation (e.g. the approve handler emits `action: 'ai_draft.approved'` with metadata such as `previousStatus`, and is proven by test to carry no `draftText` / `originalText`).
- **The generate route test has no audit assertion.** `__tests__/api/reply-draft-generate-handler.test.ts` covers fail-closed `AI_DISABLED`, no-draft-when-disabled, stub-only-when-`AI_ASSISTED`, authz, and "no LLM/provider imports", but it asserts **neither** the presence **nor** the deliberate absence of a general audit event. The current behavior is therefore not pinned either way.
- **B-R6 `AiGenerationAuditLog` is not wired to any real route.** The B-R6 generation-attempt audit boundary (`src/domains/ai-runtime/audit-log.ts`) is complete and exercised by tests, but it is composed only in test-only pipelines. No production route invokes it, because there is no real generation path today (the generate route is the deterministic stub).

This asymmetry — generate is the **only** reply-draft lifecycle mutation that emits no general audit event — is the core finding of this review.

---

## 2. Audit-Domain Distinction

Two distinct audit systems exist; the gap and the future work differ for each. They must not be conflated.

### General `AuditEvent`

- Purpose: **product/admin traceability**.
- Records **lifecycle mutation observability** (who did what to which entity, when).
- Owned by the `audit` domain (`createAuditEvent`), emitted best-effort from API handlers on successful mutations, as observed in the approve / edit / discard handlers.
- Must be **PII-safe and metadata-only** — no contact values, notes, or message content. (The approve handler test pins that no draft text reaches audit metadata.)
- Today: emitted by approve/edit/discard; **not** emitted by generate.

### `AiGenerationAuditLog` / B-R6

- Purpose: **AI generation-attempt lifecycle audit**.
- Records **provider/runtime metadata** for an AI generation attempt — `STARTED → SUCCEEDED / FAILED`, prompt version, context hash, included/omitted item ids, provider/model ids, finish reason, token counts, char counts, and a bounded + redacted error code/message.
- Owned by `ai-runtime` (`src/domains/ai-runtime/audit-log.ts`: `createAiGenerationAuditService`, `buildStartAiGenerationAuditInput`, `buildSuccessAiGenerationAuditInput`, `buildDraftAiMetadata`, with `sanitizeAuditText` redacting email → `[redacted-email]` and phone → `[redacted-phone]` and bounding length).
- A **future real-provider route gate** (checkpoint §6 "Audit logging wired to the actual generation route"; real-provider-readiness-gate.md gate #6): it must be invoked on every **real** generation attempt — which does not exist yet.
- Must **stay metadata-only**: by construction there is no column for raw prompt, generated text, transcript, or customer PII.

> These are complementary, not interchangeable. A general `AuditEvent` answers "an operator/AI actor performed a draft action"; the B-R6 `AiGenerationAuditLog` answers "an AI generation attempt occurred and produced this provider/runtime metadata." A future real generation path will likely need **both**: a general audit event for product traceability **and** a B-R6 generation-attempt record for runtime/provider metadata.

---

## 3. Current Behavior By Handler

Grounded snapshot (read-only) of reply-draft lifecycle handlers:

| Handler | Mutation | General `AuditEvent`? | B-R6 generation audit? |
| :--- | :--- | :--- | :--- |
| `generate` | creates/reuses deterministic SYSTEM stub draft | **No** (no `auditService` dep; no `createAuditEvent`) | No (no real generation; B-R6 not invoked) |
| `approve` | `PENDING_REVIEW`/`EDITED` → `APPROVED` | Yes (`action: 'ai_draft.approved'`, on `approved=true`) | N/A |
| `edit` | edits draft text | Yes (general audit event on successful mutation) | N/A |
| `discard` | discards draft | Yes (general audit event on successful mutation) | N/A |

The generate route is the lone outlier. No test pins this; a future change could silently add or remove audit behavior without a regression signal.

---

## 4. Current Posture

- **Current behavior is acceptable only because real generation is not wired and the generate route is deterministic SYSTEM stub behavior.** No real provider runs, no real model output exists, and the route produces a fixed, non-AI placeholder for human review. The absence of a general audit event on this one route is an observability gap, not a safety leak: nothing is sent, nothing AI-generated, and the human-approval boundary (which *is* audited) remains intact.
- **Before real provider / route-level generation wiring, audit behavior must be explicitly designed and proven.** When the deterministic stub is ever replaced by a real generation path (gated), the audit story — which events are emitted, by which system, at which lifecycle point, and proven to be metadata-only — must be designed up front, not discovered after wiring.

This review exists so the audit decisions are settled **before** any route-wiring design, not bolted on afterward.

---

## 5. Recommended Future Work

The following are **recommendations for separate, owner-approved PRs**. None is implemented or approved here.

- **A. Separate production-code PR to add a PII-safe general `AuditEvent` to the existing generate route, if approved.** For lifecycle parity with approve/edit/discard, the stub generate route could emit a metadata-only `AuditEvent` (e.g. an `ai_draft.generated` action carrying `businessId` / `conversationId` / draft id / `created` flag and **no** draft text or customer content) on successful draft creation/reuse. This is **production code in an AI-adjacent route + the audit domain** (Medium–High risk; ask-first + owner confirm). It is **out of scope for this review** and must not be done in the review PR. Note it is distinct from the gated B-R6 wiring (item B).
- **B. Separate future real-provider PR to wire B-R6 `AiGenerationAuditLog` to the real generation route.** When (and only when) real route-level generation is owner-approved and wired, the B-R6 audit must be invoked on every attempt (`STARTED` at start, `SUCCEEDED`/`FAILED` at completion), tenant-scoped, metadata-only. This is a **gated** item (checkpoint §6 / readiness-gate #6); it requires explicit written owner approval and the full real-provider gate sequence. **Blocked / STOP** until then.
- **C. Separate tests to prove no customer content, prompt text, provider response text, or secrets enter audit logs.** Whichever of A/B lands, dedicated tests must prove the persisted audit records (both general `AuditEvent` and B-R6 `AiGenerationAuditLog`) carry **no** customer/conversation/message/draft content, **no** raw prompt or provider response text, and **no** secrets — extending the existing metadata-only / redaction guarantees (`sanitizeAuditText`, the approve handler's no-draft-text test, the B-R6 data-minimization posture).
- **D. Later checkpoint sync PR after this review merges.** A separate single-purpose PR updates `docs/audits/AREA-B-closure-checkpoint.md` (and, if relevant, the remediation plan) to reference this review. **Not done here** (those files are out of scope for this PR).

---

## 6. Explicit Non-Approval Language

- This review does not approve real provider.
- This review does not approve customer-message-in-prompt.
- This review does not approve route-level real generation.
- This review does not close any real-provider go-live gate.

---

## 7. Risk Classification

- This review PR risk: **LOW, docs-only**.
- Future implementation PR risk: **MEDIUM to HIGH**, because it would touch a production AI-adjacent route and the audit domain.

(Risk levels per `docs/ai-skills/task-risk-classifier.md`. Recommendation item B is additionally **gated / Critical-STOP** until the real-provider readiness-gate sequence and explicit written owner approval are satisfied.)

---

## 8. Scope / Non-Goals

This review does **not**:

- add or modify any production code (in particular, it does **not** add audit emission to the generate handler);
- add or modify any test;
- integrate a real provider or add a provider SDK;
- wire route-level real generation;
- wire B-R6 `AiGenerationAuditLog` to any route;
- read env vars / API keys or add env/secret handling;
- change `prisma/schema.prisma` or add a migration;
- create any auto-send / message-delivery path;
- introduce customer/conversation/message content into any prompt or audit log;
- edit the closure checkpoint or remediation plan (a separate sync PR does that).

---

## 9. References

Referenced read-only; none modified by this review.

| Resource | Path |
| :--- | :--- |
| Area B closure checkpoint (status reference) | `docs/audits/AREA-B-closure-checkpoint.md` |
| Area B remediation plan (B-R6 lineage) | `docs/audits/AREA-B-remediation-plan.md` |
| Prompt-injection / untrusted-input strategy | `docs/audits/AREA-B-prompt-injection-untrusted-input-strategy.md` |
| Token / usage cost-guard contract | `docs/audits/AREA-B-token-usage-cost-guard.md` |
| B-R6 AI generation audit (source) | `src/domains/ai-runtime/audit-log.ts` |
| Generate handler (no audit event) | `src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/handler.ts` |
| Approve handler (emits audit event) | `src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/handler.ts` |
| Edit handler (emits audit event) | `src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/edit/handler.ts` |
| Discard handler (emits audit event) | `src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/discard/handler.ts` |
| Generate handler tests (no audit assertion) | `__tests__/api/reply-draft-generate-handler.test.ts` |
| Real-provider readiness gate (gate #6) | `docs/ai-skills/real-provider-readiness-gate.md` |

---

## 10. Version History

| Version | Date | Description |
| :--- | :--- | :--- |
| 1.0 | 2026-06-21 | Initial Area B AI generation / audit-event logging gap review (docs-only). Records the generate-route general-audit gap and the unwired B-R6 generation-attempt audit; recommends future owner-approved work only. Approves no real provider, no route-level generation, no customer-message-in-prompt; real-provider production AI-assisted go-live remains NOT YET APPROVED. |
