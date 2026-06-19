# AREA-B — Provider Operational Error-Handling Contract

**Product:** AiA Reception SaaS
**Scope:** AI Runtime provider error handling (PRD-v1.1 §5 / §9; remediation-plan **B-R4 / B-R6** lineage; checkpoint §6 "Provider error handling")
**Date:** 2026-06-20
**Source documents:** `docs/audits/AREA-B-closure-checkpoint.md` (current status reference) · `docs/audits/AREA-B-remediation-plan.md` · `docs/audits/AREA-B-pii-data-minimization-allowlist.md` · `src/domains/ai-runtime/provider.ts` · `src/domains/ai-runtime/fake-provider.ts` · `src/domains/ai-runtime/audit-log.ts` · `src/domains/ai-runtime/types.ts`

---

## 0. Status

> **Status: ADOPTED / TEST-PROVEN FOR CURRENT FAKE-PROVIDER SCOPE**

> **Adopted — PR #126 / commit `2823e88` / 2026-06-20.** This contract is now **adopted and test-proven for the current fake-provider AI-runtime scope**. PR #126 landed the test-only fault provider helper (`__tests__/_helpers/ai-runtime-fault-provider.ts`) and the dedicated provider error-handling suite (`__tests__/domains/ai-runtime-provider-error-handling.test.ts`) that prove §3–§5 end-to-end, and this document was added alongside them. The `docs/audits/AREA-B-closure-checkpoint.md` §6 "Provider error handling" gate is recorded **CLOSED for the current fake-provider AI-runtime scope** as of the same date. Adoption is **scoped to the current fake-provider boundary only** and changes none of the hard caveats below: **real-provider production AI-assisted go-live remains NOT YET APPROVED**, **no real provider is integrated or approved**, **no route-level generation is wired**, **no env/API-key work is authorized**, **no auto-send path exists**, and **customer-message-in-prompt remains STOP / future owner-gated**. A real provider must re-prove this contract (vendor → taxonomy mapping, real timeouts/retries, audit `FAILED` mapping) under its own gate (§6) before go-live.

This document defines the vendor-neutral **operational** error-handling contract for the AI runtime and is **test-proven for the current fake-provider scope** by `__tests__/domains/ai-runtime-provider-error-handling.test.ts` (using the test-only `__tests__/_helpers/ai-runtime-fault-provider.ts`). It is a **policy / specification** plus a **test proof**; it integrates **no real provider** and authorizes none.

It deliberately **does not**:

- approve any real model provider (none is integrated, and **real-provider production AI-assisted go-live remains NOT YET APPROVED**);
- add any production error taxonomy (`src/domains/ai-runtime/types.ts` is intentionally untouched — the operational taxonomy lives only in the test helper);
- approve route-level AI generation wiring (none is wired);
- authorize env / API-key work (that remains blocked);
- create any auto-send path (none exists);
- approve customer-message-in-prompt (that remains **STOP** / future owner-gated).

This document **recommends**; the owner **decides**.

---

## 1. Executive Verdict

Today the provider boundary distinguishes only two outcomes: a **successful** generation, or a **request-validation** failure (`AI_PROVIDER_ERROR_CODES` in `src/domains/ai-runtime/types.ts`: `INVALID_REQUEST` / `UNSUPPORTED_OPERATION` / `INVALID_BUSINESS_ID` / `INVALID_PROMPT` / `PROMPT_TOO_LARGE`). The deterministic `createFakeAiProvider` can only **succeed** or return one of those **validation** errors — it cannot model an **operational** failure (a timeout, a rate-limit, an upstream outage) that a *real* provider raises *after* it has accepted an otherwise well-formed request.

That left the checkpoint §6 gate **"Provider error handling. Timeouts, rate limits, partial failures, and retries surfaced through the existing fail-closed result contract and the audit FAILED path"** open: the audit `FAILED` lifecycle exists and is terminal-immutable (`audit-log.ts`), but no test drove an *operational* provider failure through it.

**Verdict:** the AI runtime already has the right *shape* to handle operational failures — `AiProvider.generateText` returns `ActionResult`, and `completeFailure` records a metadata-only `FAILED` row. This document **freezes the operational error taxonomy and posture** and **proves end-to-end** that an operational failure is fail-closed, surfaced through `ActionResult`, recorded as exactly one metadata-only audit `FAILED` row, and **never produces a draft or any send/message path**. This **closes the §6 provider-error-handling gate for the current fake-provider scope only**. A real provider must re-validate this contract (its vendor → taxonomy mapping, real timeouts/retries) before go-live.

---

## 2. Scope

**In scope.** The vendor-neutral classification of *operational* provider failures, the fail-closed posture for each, how each maps onto the existing `ActionResult` error contract and the B-R6 audit `FAILED` row, and the test strategy that proves it for the fake-provider scope.

**Out of scope (unchanged by this document).**

- Real model-provider integration / SDK selection (remediation-plan **B-H3**; remains future, **blocked**).
- API-key / env-secret handling (remains **blocked** until its own gate).
- Route-level generation wiring (assembly → prompt → provider → audit → draft; not wired).
- Real network timeouts, real retry/backoff execution, and real partial-streaming semantics (a real-provider concern; only the *contract* is specified here).
- Cost / rate-limit *budgeting* (a separate gate — this doc covers handling a provider-signalled rate-limit *error*, not enforcing a spend limit).
- Schema / migration changes — **not required** for this contract and not proposed here (the `errorCode` / `errorMessage` columns already exist on `AiGenerationAuditLog`).

---

## 3. Vendor-Neutral Operational Error Taxonomy

These are the operational failure classes a real provider could raise after accepting a well-formed request. Each maps to a stable, bounded, audit-safe code (`[A-Z0-9_]`, no PII, no request content) and a fixed, generic message. (Defined in the test helper as `FAULT_SCENARIO_SPECS`; **not** in production `types.ts`.)

| Scenario | Code | Retry posture | Meaning |
| :--- | :--- | :--- | :--- |
| `timeout` | `AI_PROVIDER_TIMEOUT` | **Retryable** (bounded, with backoff) | Provider did not respond within the deadline. |
| `rate_limited` | `AI_PROVIDER_RATE_LIMITED` | **Retryable** (after backoff / `Retry-After`) | Provider rejected the call for exceeding its rate limit. |
| `unavailable` | `AI_PROVIDER_UNAVAILABLE` | **Retryable** (bounded, with backoff) | Upstream outage / 5xx / connection failure. |
| `content_filtered` | `AI_PROVIDER_CONTENT_FILTERED` | **Not retryable** | Provider blocked the request by content policy. Deterministic — retrying changes nothing. |
| `unknown` | `AI_PROVIDER_UNKNOWN_ERROR` | **Not retryable** (fail closed) | Unclassified failure. Default to fail-closed, no automatic retry. |

All five are **fail-closed**: `generateText` returns `err(code, message)` — it never throws and never returns generated text.

---

## 4. Postures

### 4.1 Timeout posture
A provider that does not respond within its deadline returns `AI_PROVIDER_TIMEOUT`. Retryable with bounded retries + backoff (see §4.6). On exhaustion the attempt is recorded `FAILED` and no draft is produced. The timeout value and budget are a **real-provider** configuration concern (future), not specified here.

### 4.2 Rate-limit posture
A provider-signalled rate-limit returns `AI_PROVIDER_RATE_LIMITED`. Retryable only after honoring backoff / any `Retry-After` signal. This is distinct from the platform's own per-business **spend/usage budgeting** (a separate gate): this posture covers *handling the provider's rate-limit error*, not enforcing a cost cap.

### 4.3 Provider-unavailable posture
Upstream outages / 5xx / connection failures return `AI_PROVIDER_UNAVAILABLE`. Retryable with bounded backoff. On exhaustion: fail closed, `FAILED` audit row, no draft.

### 4.4 Content-filtered posture
A provider content-policy block returns `AI_PROVIDER_CONTENT_FILTERED` and is **fail-closed with no draft**. It is **not** auto-retried (the outcome is deterministic for the same input). Note: this is modeled here as an *operational error* (no draft), separate from the success-path `CONTENT_FILTER` finish reason — a real adapter must choose, per vendor semantics, whether a filter event is a hard error (no output) or a truncated success, and map accordingly.

### 4.5 Unknown-error posture
Any unclassified failure maps to `AI_PROVIDER_UNKNOWN_ERROR` and fails closed with **no** automatic retry — the safe default when the failure cannot be reasoned about. It is recorded `FAILED` for observability.

### 4.6 Retry posture
Retries are **bounded** and apply **only** to the retryable classes (`timeout`, `rate_limited`, `unavailable`). Retries must: use backoff (and honor any `Retry-After`); never retry `content_filtered` or `unknown`; never block the human-review boundary; and never silently degrade to auto-send. A retry that ultimately fails records exactly one terminal `FAILED` row. Retry *execution* is a real-provider/orchestration concern (future); this document fixes the *policy* (which classes, the bound, no-retry-on-policy/unknown).

### 4.7 Partial-failure posture
A partial or truncated provider response (e.g. streaming cut off, malformed/incomplete payload) is treated as a **failure, not a draft**: it must not yield a partially-generated draft for human review under the guise of success. It maps to the closest operational class (`unavailable` for a dropped stream, `unknown` for an unparseable payload) and fails closed. No partial text is persisted (the audit row is metadata-only regardless).

---

## 5. Audit FAILED Mapping

An operational failure maps onto the existing B-R6 lifecycle (`src/domains/ai-runtime/audit-log.ts`) as follows:

1. `start(...)` opens exactly one `STARTED` row, tenant-scoped by `businessId`, carrying metadata only (prompt **length**, context hash, item ids — never prompt text).
2. The provider returns `err(code, message)`.
3. The caller calls `completeFailure({ auditLogId, businessId, errorCode, errorMessage? })`:
   - `errorCode` is the vendor-neutral operational code from §3 (bounded, `[A-Z0-9_]`);
   - `errorMessage` is the fixed, generic provider message — it is additionally **bounded + redacted** (email/phone-like substrings stripped, control chars/whitespace collapsed, truncated) by `sanitizeAuditText` before persistence;
   - the row transitions `STARTED → FAILED` exactly once; a terminal row is **immutable** (`AI_AUDIT_INVALID_TRANSITION`);
   - completion is **tenant-scoped** by the composite `(id, businessId)` key — a different tenant gets `AI_AUDIT_NOT_FOUND` and mutates nothing.
4. **No draft** is built and **no send/message path** is touched on the failure branch.

The audit row remains **metadata-only**: it has no column for raw prompt, generated text, transcript, or customer PII. The proof set is in `__tests__/domains/ai-runtime-provider-error-handling.test.ts`.

---

## 6. Real-Provider Adapter Mapping Requirements

When a real adapter is built (future, gated **B-H3** — requires explicit written owner approval + a dedicated PR), it MUST:

- Implement the existing `AiProvider` interface and **return `ActionResult`** — never throw for an operational failure.
- Map each vendor error onto exactly one taxonomy class in §3 (timeout / rate_limited / unavailable / content_filtered / unknown); an unmapped vendor error defaults to `unknown` and fails closed.
- Honor the retry posture in §4.6 (bounded, backoff, never retry policy/unknown) and the partial-failure posture in §4.7 (partial ≠ draft).
- Carry **no request content, prompt, or PII** in the error `message` — only a generic, bounded string. Provider request ids / status codes are acceptable metadata; raw provider response bodies are not.
- Re-prove this contract (vendor → taxonomy mapping, timeout/retry behavior, audit `FAILED` mapping) against the suite before go-live, **alongside** the real-provider PII re-review (`docs/audits/AREA-B-pii-data-minimization-allowlist.md` §7/§8) and a defined prompt-injection strategy.
- Add API-key / env-secret handling **only** under its own gate; credentials must never enter the prompt, the audit row, or logs.

If a real adapter needs a richer error surface than the test-only taxonomy, the production taxonomy decision is **owner-gated** and belongs in the B-H3 PR — not in routine work.

---

## 7. Test Proof (current fake-provider scope)

Proven in `__tests__/domains/ai-runtime-provider-error-handling.test.ts` over synthetic data with the deterministic fault provider:

- Each operational scenario returns `err(...)`, never throws, and is fail-closed (no success payload, no generated text).
- The fault taxonomy is exactly the five §3 scenarios, with unique, bounded, audit-safe codes that are **disjoint** from the production validation codes.
- A failing attempt records **exactly one** metadata-only audit `FAILED` row with a bounded/safe `errorCode`; **no draft** is built and **no** customer/conversation/message/reply-draft delegate is reachable on the failure path.
- The raw prompt, generated text, and PII-shaped content (email/phone) never reach the persisted row (serialized-row assertion).
- A terminal `FAILED` row is immutable; cross-tenant completion fails `AI_AUDIT_NOT_FOUND` and mutates nothing.
- The helper surface has no provider SDK, no network, no `process.env` / API-key path, and no randomness (static scope guards).
- A control assertion confirms the production fake provider **cannot** model an operational failure (it succeeds), establishing that the fault provider fills a real gap rather than duplicating one.

All tests run against the deterministic fake/fault providers and **synthetic data only** — no real provider, no spend, no real PII.

---

## 8. Hard Posture Preserved

- **Real-provider production AI-assisted go-live remains NOT YET APPROVED.**
- **No real provider is integrated or approved.**
- **No route-level generation is wired.**
- **No env/API-key work is authorized.**
- **No auto-send path exists.**
- **Customer-message-in-prompt remains STOP / future owner-gated.**
- **No production error taxonomy was added** (`src/domains/ai-runtime/types.ts` untouched); **no schema/migration** was required or made.

This document closes the §6 provider-error-handling gate **for the current fake-provider AI-runtime scope only**. Every other §6 go-live gate remains as recorded in `docs/audits/AREA-B-closure-checkpoint.md`.

---

*AREA-B provider operational error-handling contract — ADOPTED / TEST-PROVEN FOR CURRENT FAKE-PROVIDER SCOPE (adopted PR #126 / `2823e88` / 2026-06-20). Defines the vendor-neutral operational taxonomy (§3), postures (§4), audit FAILED mapping (§5), and real-provider adapter mapping requirements (§6), proven by `__tests__/domains/ai-runtime-provider-error-handling.test.ts`. Adds no real provider, no SDK, no env/API-key read, no route wiring, no schema/migration, and no auto-send. Real-provider production AI-assisted go-live remains NOT YET APPROVED.*
