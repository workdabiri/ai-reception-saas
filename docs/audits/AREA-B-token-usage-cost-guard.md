# AREA-B — Token / Usage Cost-Guard Contract

**Product:** AiA Reception SaaS
**Scope:** AI Runtime token / usage cost guard (PRD-v1.1 §5 / §9; checkpoint §6 "Token / usage cost guard"; real-provider-readiness-gate gate #3)
**Date:** 2026-06-20
**Source documents:** `docs/audits/AREA-B-closure-checkpoint.md` (current status reference) · `docs/audits/AREA-B-remediation-plan.md` · `docs/audits/AREA-B-provider-error-handling.md` · `docs/audits/AREA-B-pii-data-minimization-allowlist.md` · `src/domains/ai-runtime/types.ts` (`AiProviderUsage`) · `src/domains/ai-runtime/audit-log.ts` (B-R6 token columns)

---

## 0. Status

> **Status: PROPOSED / TEST-PROVEN FOR CURRENT FAKE-PROVIDER SCOPE**

This contract defines the vendor-neutral **token / usage cost-guard decision contract** for the AI runtime and is **test-proven for the current fake-provider scope** by `__tests__/domains/ai-runtime-cost-guard.test.ts` (using the test-only pure helper `__tests__/_helpers/ai-runtime-cost-policy.ts`). It is a **policy / specification** plus a **test proof**; it integrates **no real provider**, adds **no metering**, adds **no persistent counter**, and authorizes none.

> **This closes nothing for real-provider production use.**
> **It only test-proves the fake-provider-scope cost-guard decision contract.**

This document is **PROPOSED**, not adopted. Adoption (recording the §6 "Token / usage cost guard" gate as CLOSED *for the current fake-provider scope only*) belongs to a **later docs-sync PR** after this PR merges — it is not claimed here.

It deliberately **does not**:

- approve any real model provider (none is integrated, and **real-provider production AI-assisted go-live remains NOT YET APPROVED**);
- add any production cost taxonomy or cost code path (`src/domains/ai-runtime/types.ts` is intentionally untouched — the cost taxonomy lives only in the test helper);
- add a persistent per-business usage counter, a schema column, or a migration (none is added; persistence is **owner-gated / deferred**);
- meter real token spend (no real provider, no pricing, no billing);
- approve route-level AI generation wiring or cost enforcement (none is wired);
- authorize env / credential work (that remains blocked);
- create any auto-send path (none exists);
- approve customer-message-in-prompt (that remains **STOP** / future owner-gated).

This document **recommends**; the owner **decides**.

---

## 1. Executive Verdict

The provider boundary already records **metadata-only token usage** for every generation: `AiProviderUsage` (`promptTokens` / `completionTokens` / `totalTokens`) on a successful result (`src/domains/ai-runtime/types.ts`), and the B-R6 audit row persists those same counts (`promptTokens` / `completionTokens` / `totalTokens` columns on `AiGenerationAuditLog`). What did **not** exist was a **decision** over those counts: a rule that, given a per-business limit and a usage figure, returns allow or deny.

That left the checkpoint §6 gate **"Token / usage cost guard — Real per-business usage limits and spend controls before any real provider call"** open.

**Verdict:** the genuinely useful cost guard — *stateful, enforced, real-spend* limiting — cannot be advanced without a **persistence model** (per-business accumulated-usage counters → schema/migration), a **real provider** (to meter real spend), and **route-level wiring** (to enforce before a call). All three are out of scope and **deferred**. But the **fail-closed decision contract** — the pure predicate "is this usage within this business's limit?" — is freezable and test-provable now over the existing `AiProviderUsage` shape. This document **freezes that contract and its fail-closed posture** and **proves end-to-end** (for the fake-provider scope) that usage within budget is allowed, and that an over-budget usage, a missing/invalid limit, and a missing/invalid usage are all denied fail-closed through the existing `ActionResult` `err(...)` contract. This **advances the §6 cost-guard gate for the current fake-provider scope only**. A real provider must build the deferred metering + persistence + enforcement on top of this contract before go-live.

---

## 2. Scope

**In scope.** The vendor-neutral definition of a **per-business cost limit** (budget), the **fail-closed decision posture** for evaluating a usage figure against that limit, how each decision maps onto the existing `ActionResult` contract, and the test strategy that proves it for the fake-provider scope.

**Out of scope (unchanged by this document).**

- Real model-provider integration / SDK selection (remediation-plan **B-H3**; remains future, **blocked**).
- Real token **metering** (real `AiProviderUsage` from a real provider, real pricing, real spend) — only the *contract* over the token shape is specified here.
- **Persistent per-business usage counters** — the accumulate-and-store step (a counter table or `Business` columns, reset per window) is a schema/migration concern and is **owner-gated / deferred**. This helper is a **stateless predicate** and stores nothing.
- The limit **window** (per-day / per-month / rolling) — an **owner-gated / deferred** product decision.
- **Route-level enforcement** (calling the guard before a real provider call inside a generation route) — not wired; deferred (depends on route-level generation wiring, itself a separate gate).
- API-key / env-secret handling, billing integration, and invoicing — remain **blocked** until their own gates.
- Schema / migration changes — **not required** for this contract and not made.

---

## 3. Vendor-Neutral Cost-Guard Contract

### 3.1 Per-business budget concept

A **cost limit** (budget) is a per-business ceiling on AI usage for a single window. It is resolved server-side from the business's own configuration (never client-supplied), exactly as the rest of Area B resolves tenant scope. The decision contract receives an **already-resolved limit** and an **already-summed usage figure**; it does not read tenant data itself.

The vendor-neutral limit shape proven here (`AiRuntimeCostLimit` in the test helper):

| Field | Meaning | Type | Required |
| :--- | :--- | :--- | :--- |
| `maxTotalTokens` | Hard ceiling on total tokens for the window. | non-negative **integer** | **Yes** |
| `maxPromptTokens` | Optional sub-ceiling on prompt tokens. | non-negative **integer** | No |
| `maxCompletionTokens` | Optional sub-ceiling on completion tokens. | non-negative **integer** | No |
| `maxSpend` | Optional spend ceiling, in synthetic cost units (may be 0). | non-negative number (decimal OK) | No (paired) |
| `costPerToken` | Synthetic per-token rate used to derive spend. | number **strictly > 0** | No (paired) |

### 3.2 Token limit concept

The primary dimension is **tokens**. The guard compares the usage figure's `totalTokens` (and, when configured, `promptTokens` / `completionTokens`) against the corresponding ceilings. Usage **at** a ceiling is allowed; only usage **strictly over** a ceiling is denied. Tokens are the metadata the provider boundary already produces (`AiProviderUsage`) and the B-R6 audit already records — so the guard adds no new content surface.

Token ceilings **and** token usage counts are **non-negative integer counts** — tokens are whole units. A **decimal token count fails closed**: a fractional ceiling is `AI_COST_BUDGET_INVALID` and a fractional usage count is `AI_COST_USAGE_INVALID`. (Only the spend fields, §3.3, may be fractional.)

### 3.3 Spend limit concept

The **spend** dimension expresses a monetary-style ceiling without binding to any real pricing. Spend is derived as `totalTokens × costPerToken` and compared against `maxSpend`, both in **synthetic cost units**. The dimension is **all-or-nothing**: a ceiling (`maxSpend`) requires a rate (`costPerToken`) and vice-versa; a half-configured spend dimension is rejected as an invalid limit (fail-closed). A **real** spend guard must source `costPerToken` from the real provider's actual pricing — that mapping is **real-provider work** (§6), not specified here.

Unlike token counts, the spend fields may be **decimals**. `maxSpend` may be any finite non-negative value, and **`maxSpend = 0` is a valid configuration** — but then usage is allowed only when the evaluated spend is exactly 0. `costPerToken`, when present, must be **strictly greater than 0**: a **zero `costPerToken` is invalid** (and a negative / non-finite rate likewise), because a zero rate would make a configured spend guard over-permissive (any usage would evaluate to 0 spend and pass). A non-strictly-positive rate is rejected fail-closed as `AI_COST_BUDGET_INVALID`.

### 3.4 Limit window — OWNER-GATED / DEFERRED

The window over which usage accumulates (per-day, per-month, rolling N-hour, etc.), and the reset semantics, are a **product decision** the PRD does not specify. They are **OWNER-GATED / DEFERRED**. This contract is window-agnostic: it evaluates a single resolved limit against a single usage figure and leaves "which window, reset when" to the owner-gated persistence design.

### 3.5 Persistence model — OWNER-GATED / DEFERRED

Where per-business accumulated usage is **stored** (a counter table, `Business` columns, an external meter), and how it is incremented and reset, is **OWNER-GATED / DEFERRED**. Persisting counters is a schema/migration change (Critical) and is explicitly **not** part of this PR. The pure decision contract assumes a caller has already summed the business's persisted accumulated usage with the current request's projected usage **before** calling the guard; this contract proves only the *decision*, not the *accumulation* or *storage*.

---

## 4. Fail-Closed Decision Posture

The guard **fails closed**: on any condition it cannot positively verify as within-budget, it returns a denial through the `ActionResult` `err(...)` contract — it never throws, and it never returns an "allow" by default. Evaluation order is **most-fundamental-first** so one broken input yields a predictable code.

### 4.1 Over-budget behavior
Usage strictly over any configured ceiling (total / prompt / completion / spend) is **denied** with `AI_COST_BUDGET_EXCEEDED`. No "soft" overage, no warning-then-allow. A future caller treats this denial as fail-closed: **no real provider call is made** and (when wired) a metadata-only audit `FAILED` row is recorded — never a draft, never a send.

### 4.2 Missing-limit behavior
A missing limit (null / undefined / non-object) is **denied** with `AI_COST_BUDGET_MISSING`. A business with **no configured budget is DENIED, never treated as "unlimited"** — this is the core fail-closed stance of a cost guard (parity with AI default-off: absence of explicit configuration means *off*, not *unbounded*).

### 4.3 Invalid-limit behavior
A limit whose values are invalid is **denied** with `AI_COST_BUDGET_INVALID`: a **decimal** token ceiling (token ceilings must be non-negative integers), a negative ceiling, `NaN`, `Infinity`, a non-number, a `costPerToken` that is **not strictly > 0** (zero / negative / non-finite), or a half-configured spend dimension. `maxSpend` itself may be any finite non-negative number, **including 0**. An un-trustworthy budget can never authorize spend.

### 4.4 Unknown / invalid-usage behavior
A missing usage figure is **denied** with `AI_COST_USAGE_MISSING`. A usage figure whose counts are not finite, non-negative **integers** (a **decimal** token count fails closed), or whose `totalTokens` is **inconsistent** with `promptTokens + completionTokens` (the invariant `AiProviderUsage` already satisfies — see `src/domains/ai-runtime/fake-provider.ts`), is **denied** with `AI_COST_USAGE_INVALID`. Counts that cannot be trusted are never compared against a budget as if valid.

---

## 5. Decision → Result Mapping

The decision maps onto the existing `ActionResult` contract (`src/lib/result.ts`):

| Outcome | Result | Code |
| :--- | :--- | :--- |
| Within budget | `ok(allowance)` | — (allowance carries derived numeric metadata only) |
| Over any ceiling | `err(...)` | `AI_COST_BUDGET_EXCEEDED` |
| Limit missing | `err(...)` | `AI_COST_BUDGET_MISSING` |
| Limit invalid | `err(...)` | `AI_COST_BUDGET_INVALID` |
| Usage missing | `err(...)` | `AI_COST_USAGE_MISSING` |
| Usage invalid / inconsistent | `err(...)` | `AI_COST_USAGE_INVALID` |

All codes are vendor-neutral, bounded, and audit-safe (`[A-Z0-9_]`, no PII, no content) and **disjoint** from the production provider validation codes (`AI_PROVIDER_ERROR_CODES`), so a future audit `FAILED` row could record a denial code directly. The allowance payload carries **only derived numeric metadata** (evaluated counts, remaining headroom, derived spend) — no prompt, no generated text, no tenant content.

---

## 6. Real-Provider Metering Requirements

When a real adapter and metering are built (future, gated **B-H3** + the §6 cost-guard gate — requires explicit written owner approval + a dedicated PR), they MUST:

- Source the usage figure from the **real provider's** reported `AiProviderUsage` (real `promptTokens` / `completionTokens` / `totalTokens`), validated against this contract before it is trusted.
- Source `costPerToken` from the real provider's **actual pricing** (per model), and treat spend as real money — never the synthetic units used in the test proof.
- **Accumulate** per-business usage in a persisted counter (the owner-gated persistence model, §3.5) over the owner-decided window (§3.4), and pass `accumulated + projected` to the guard **before** the real call.
- Enforce the guard **before** spending (pre-call), and fail closed on a denial: **no provider call**, a metadata-only audit `FAILED` row, **no draft, no send**.
- Keep the guard **metadata-only**: it must never receive or store a prompt, generated text, or customer PII — only token counts and numeric limits.
- Re-prove this contract (real usage → decision, real pricing → spend, accumulation + window + persistence) under its own gate before go-live, **alongside** the real-provider PII re-review (`docs/audits/AREA-B-pii-data-minimization-allowlist.md` §7/§8), the provider error-handling contract (`docs/audits/AREA-B-provider-error-handling.md`), and a defined prompt-injection strategy.

If a real meter needs a richer limit model than the test-only shape (multiple windows, soft + hard tiers, per-operation budgets), that production model decision is **owner-gated** and belongs in its dedicated PR — not in routine work.

---

## 7. Future Route-Level Enforcement Requirements

When a production generation route is wired (future, gated — the §6 "Route-level generation wiring" gate), cost enforcement MUST:

- Run **before** the provider call, after assembly + prompt build, on the server-resolved `businessId` only.
- Resolve the per-business limit server-side (never client-supplied), sum it against persisted accumulated usage, and call the guard.
- On `AI_COST_BUDGET_EXCEEDED` (or any fail-closed denial): abort the generation, record the metadata-only audit `FAILED` row, return the fail-closed result, and **build no draft and touch no send/message path** (preserving the B-R8 no-auto-send / human-approval lock).
- After a successful real generation, **increment** the persisted counter by the real usage (the owner-gated persistence step).
- Never enable any of this on real data until the full §6 gate sequence (`docs/ai-skills/real-provider-readiness-gate.md`) has passed with explicit owner approval.

Until then, the existing reply-draft `generate` route remains the deterministic SYSTEM stub; **no route consumes this guard**.

---

## 8. Test Proof (current fake-provider scope)

Proven in `__tests__/domains/ai-runtime-cost-guard.test.ts` over synthetic data with the pure helper `__tests__/_helpers/ai-runtime-cost-policy.ts`:

- **Allow:** usage below the limit, usage exactly at the limit, usage within prompt/completion sub-limits, and usage within (and exactly at) a configured spend limit, each returns `ok(allowance)` with correct remaining headroom.
- **Deny (over budget):** usage over the total / prompt / completion / spend ceiling returns `err('AI_COST_BUDGET_EXCEEDED')`.
- **Deny (fail-closed limit):** missing limit → `AI_COST_BUDGET_MISSING`; **decimal token ceiling** / negative / `NaN` / `Infinity` / non-number / **`costPerToken` not strictly > 0 (zero / negative / non-finite)** / half-configured-spend / negative-sub-limit → `AI_COST_BUDGET_INVALID`.
- **Deny (fail-closed usage):** missing usage → `AI_COST_USAGE_MISSING`; **decimal** / `NaN` / `Infinity` / negative / non-number / inconsistent-total → `AI_COST_USAGE_INVALID`.
- **Integer vs spend / `maxSpend = 0` edge:** token ceilings and token usage counts must be non-negative integers (decimals fail closed); spend fields may be fractional; a decimal `maxSpend` with a positive `costPerToken` is accepted; `maxSpend = 0` with a positive `costPerToken` is a **valid** budget that allows zero usage (evaluated spend 0) and denies any positive usage with `AI_COST_BUDGET_EXCEEDED`.
- **Order:** the limit is validated before the usage (the limit code wins when both are bad).
- **Taxonomy:** exactly five unique, bounded, audit-safe codes, disjoint from `AI_PROVIDER_ERROR_CODES`; the policy only ever returns codes from the declared taxonomy.
- **Purity & determinism:** identical inputs → identical results; arguments are not mutated (safe on frozen inputs); no global network call during evaluation.
- **Metadata-only & compatibility:** the usage produced by the production `createFakeAiProvider` is accepted under a generous budget; a usage object smuggling a PII-shaped field never leaks it into the decision; the allowance surfaces only numeric metadata keys.
- **Static scope guards (helper surface):** no real provider / LLM SDK import; only allowlisted imports (`@/lib/result`, `@/domains/ai-runtime`); no network; no env / credential read (`process.env`, **`process['env']` / `process["env"]`**, **`import.meta.env`**, api-key); no randomness; no database / persistent-counter access; no auto-send / dispatch / deliver / message-create path; no customer/conversation/message/reply-draft read path.

All tests run against synthetic numeric data and the deterministic fake provider — **no real provider, no spend, no real PII, no persistence**.

---

## 9. Hard Posture Preserved

- **real-provider production AI-assisted go-live remains NOT YET APPROVED**
- **no real provider is integrated or approved**
- **no route-level generation is wired**
- **no env/API-key work is authorized**
- **no schema/migration is added**
- **no DB usage counters are added**
- **no auto-send path exists**
- **customer-message-in-prompt remains STOP / future owner-gated**
- **No production cost taxonomy was added** (`src/domains/ai-runtime/types.ts` untouched); the cost taxonomy lives only in the test helper.

> **Token / usage cost guard is test-proven for the current fake-provider scope only.**
> **This does not approve real-provider production AI-assisted go-live.**
> **Real-provider metering, persistent counters, schema/migration, route-level enforcement, and billing/spend controls remain future gated work.**

This document **PROPOSES** the cost-guard contract and **test-proves** it for the current fake-provider AI-runtime scope. It does not adopt it or close the §6 gate; that status change is recorded in a later docs-sync PR. Every other §6 go-live gate remains as recorded in `docs/audits/AREA-B-closure-checkpoint.md`.

---

*AREA-B token / usage cost-guard contract — PROPOSED / TEST-PROVEN FOR CURRENT FAKE-PROVIDER SCOPE (2026-06-20). Defines the vendor-neutral budget concept (§3), the fail-closed decision posture (§4), the result mapping (§5), and the real-provider metering (§6) and future route-level enforcement (§7) requirements, proven by `__tests__/domains/ai-runtime-cost-guard.test.ts` over the pure helper `__tests__/_helpers/ai-runtime-cost-policy.ts`. Adds no real provider, no SDK, no metering, no persistent counter, no env/API-key read, no route wiring, no schema/migration, and no auto-send. Real-provider production AI-assisted go-live remains NOT YET APPROVED.*
