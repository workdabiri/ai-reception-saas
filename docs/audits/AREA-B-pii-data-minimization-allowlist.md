# AREA-B — PII / Data-Minimization Prompt Allowlist

**Product:** AiA Reception SaaS
**Scope:** AI Runtime prompt-input data minimization (PRD-v1.1 §5.1 / §9; remediation-plan task **B-H1**; checkpoint §6 "PII / data-minimization review")
**Date:** 2026-06-19 (spec) · **Updated:** 2026-06-20 (PR #124 / `2f4d015` — enforcement adopted)
**Source documents:** `docs/audits/AREA-B-closure-checkpoint.md` (current status reference) · `docs/audits/AREA-B-remediation-plan.md` (B-H1 implemented for the fake-provider scope) · `docs/audits/AREA-B-ai-runtime-provenance-audit.md` (RED, historical) · `docs/product/PRD-v1.1.md` (LOCKED, §5 / §5.1 / §9) · `src/domains/ai-runtime/*` · `src/domains/knowledge/*` · `src/domains/ai-config/*` · `prisma/schema.prisma`

---

## 0. Status

> **Status: ADOPTED / ENFORCED FOR CURRENT FAKE-PROVIDER AI-RUNTIME SCOPE**
> *(supersedes the original PROPOSED / OWNER-REVIEW REQUIRED status as of PR #124 / `2f4d015`, 2026-06-20)*

This document defines the PII / data-minimization allowlist governing what data may enter an AI prompt. As of **PR #124 / commit `2f4d015` (2026-06-20)** the allowlist (§5) and denylist (§6) are **adopted and enforced in code, proven by a dedicated test**, for the **current fake-provider AI-runtime prompt-builder boundary** — see the **Implementation note** below. It remains a **policy / specification document**: the §7/§8 conditional fields and any real-provider use are still owner-gated.

**Implementation note (PR #124 / `2f4d015`, 2026-06-20).** The prompt-renderable allowlist was centralized as `PROMPT_RENDERABLE_ITEM_FIELDS` in `src/domains/ai-runtime/types.ts` (exactly `category` / `key` / `value` / `sourceType` / `sourceLabel` / `verifiedAt`); `prompt-builder.ts` was refactored to render verified-context items by **iterating that centralized allowlist** (so a field later added to the item type is excluded from prompt text by default — fail-closed / default-deny); and `__tests__/domains/ai-runtime-data-minimization.test.ts` proves the allowlisted fields render while **Customer / CustomerContactMethod / Conversation / Message / ReplyDraft-shaped fields** and internal/provenance fields (`sourceMetadata` / `sourceUrl` / `verifiedByUserId` / internal item id / per-item `businessId` / `status` / `createdByUserId`) **do not** enter prompt text. The B-R7 cross-tenant isolation and B-R8 no-auto-send suites remained green. (Spec added by PR #123; enforcement + test by PR #124.)

Adoption / enforcement is **scoped to the current fake-provider AI-runtime prompt-builder boundary**. Explicitly, this document and PR #124 do **not**:

- approve any real model provider (none is integrated, and **real-provider production AI-assisted go-live remains NOT YET APPROVED**);
- approve route-level AI generation wiring (none is wired);
- approve or create any auto-send path (none exists);
- authorize env / API-key work (that remains blocked);
- approve customer-message-in-prompt (that remains **STOP** / future owner-gated — see §9).

This document **recommends**; the owner **decides**. Any item that would let customer/conversation/message content into a prompt is a **STOP** / **future owner-gated** decision requiring explicit written owner approval and a dedicated PR (per `CLAUDE.md` → Decision authority and Remaining AI go-live gates).

---

## 1. Executive Verdict

The current fake-provider scope is **structurally safe**: no customer, conversation, message, or reply-draft content enters AI context or any prompt today. The B-R3 assembler ([context-assembler.ts](../../src/domains/ai-runtime/context-assembler.ts)) reads only the server-resolved `businessId` plus **VERIFIED** business-context items, and the B-R5 builder ([prompt-builder.ts](../../src/domains/ai-runtime/prompt-builder.ts)) renders only a fixed subset of those item fields plus static guardrail text and an optional bounded operator instruction.

Originally, that safety was an **emergent property of the implementation** rather than a **formally declared allowlist**. As of **PR #124 / `2f4d015`** that is no longer the case: the prompt-input surface is now a **formally declared, centralized allowlist** (`PROMPT_RENDERABLE_ITEM_FIELDS`) that `formatItem` iterates, backed by static scope guards and a **dedicated data-minimization test**. What was implicit is now explicit and regression-proofed for the current fake-provider scope.

**Verdict:** The prompt-input surface is now **frozen as an explicit allowlist** (this document) and the denylist is **enforced by a dedicated data-minimization test** — so **B-H1 is CLOSED for the current fake-provider AI-runtime prompt-builder scope** (PR #124 / `2f4d015`). This does **not** open the door to a real provider or route-level generation: before either is wired, the allowlist must be re-reviewed against the §7/§8 conditional fields together with a prompt-injection strategy, and **real-provider production AI-assisted go-live remains NOT YET APPROVED**.

---

## 2. Scope

**In scope.** The set of fields and free-text values that are *permitted*, *forbidden*, or *deferred* as inputs to a reply-draft AI prompt for the single supported operation (`REPLY_DRAFT`), and the enforcement/test strategy that must back that set.

**Out of scope (unchanged by this document).**

- Real model-provider integration / SDK selection (remediation-plan **B-H3**; remains future, **blocked**).
- API-key / env-secret handling (remains **blocked** until its own gate).
- Route-level generation wiring (assembly → prompt → provider → audit → draft; not wired).
- Cost / rate-limit / observability, staging validation, human-approval UX, rollback drill (separate §6 checkpoint gates).
- Prompt-injection defense against untrusted customer-message content (separate gate; no customer message is in any prompt today).
- Area C (public widget ingest) — out of scope.
- Schema / migration changes — **not required for this spec** and not proposed here.

This spec governs **what data is allowed into a prompt**. It does not by itself approve building the prompt path for real data.

---

## 3. Current AI Data Flow

Today's flow is a **test-only composition** over a deterministic fake provider; there is no production route that performs real generation.

```
TenantRequestContext.businessId  (server-resolved; never client-supplied)
        │
        ▼
ai-config: resolveAiPolicy({ businessId })           ── fail-closed unless aiMode = AI_ASSISTED
        │   (default aiMode = MANUAL → AI_CONTEXT_DISABLED, no knowledge read)
        ▼
knowledge: listVerifiedItems({ businessId, ... })    ── status:VERIFIED pinned; DRAFT/ARCHIVED excluded
        │
        ▼
ai-runtime B-R3 assembler → AssembledAiContext        ── verified items + provenance only; NO customer/conversation/message
        │
        ▼
ai-runtime B-R5 prompt builder → AiProviderGenerateTextRequest  ── static rules + allowed item fields + optional operator instruction
        │
        ▼
(FUTURE) AiProvider.generateText(...)                 ── today: deterministic FAKE provider only; no network, no SDK, no env read
        │
        ▼
ai-runtime B-R6 audit log (metadata only) + draft AI metadata   ── counts/ids/hash only; NO raw prompt/text/PII
```

Key facts (evidence):

- The route that exists — [reply-drafts/generate/handler.ts](../../src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/handler.ts) — returns a **deterministic SYSTEM stub** (`STUB_DRAFT_TEXT`), calls **no** LLM, and is gated by `aiMode` (fail-closed when disabled). It does **not** invoke the assembler or prompt builder.
- The assembler depends only on other **services** (ai-config, knowledge) and adds no Prisma surface of its own; tenancy is read only from `context.businessId`.
- The only persistence in ai-runtime is the **metadata-only** `AiGenerationAuditLog` (`prisma/schema.prisma`), which has no column for raw prompt, generated text, transcript, or customer PII.

---

## 4. Current Prompt Input Surface

What the B-R5 builder actually puts into prompt text today (see `formatItem` / `buildPromptText` / `buildSystemRules` in [prompt-builder.ts](../../src/domains/ai-runtime/prompt-builder.ts)):

1. **Static system rules** — fixed guardrail text (PRD-v1.1 §5.1 refusal/hedge rules; human-review boundary; no-auto-send; do-not-leak-internals).
2. **Per verified item** (`AssembledBusinessContextItem`, see [types.ts](../../src/domains/ai-runtime/types.ts)): `category`, `key`, `value`, `sourceType`, and — only when present and non-blank — `sourceLabel` and `verifiedAt`.
3. **Optional operator instruction** — a bounded (`MAX_OPERATOR_INSTRUCTION_CHARS = 2000`), non-blank string, explicitly labeled as operator steering and **NOT** verified context.
4. **Static task block** — fixed instruction to output only the draft.

What the builder **already excludes from prompt text by construction** (it reads these fields but never prints them): per-item `id` (internal item id), `verifiedByUserId`, `sourceMetadata`, `sourceUrl`, lifecycle `status`, and per-item `businessId`. The assembled `businessId` is carried as provider-request tenancy metadata only.

**Gap:** this surface is correct but **implicit** — it lives in the body of `formatItem` and in the static scope guards, not in a declared allowlist proven by a dedicated data-minimization test. This document converts the implicit surface into an explicit, reviewable allowlist/denylist.

---

## 5. Proposed Prompt Allowlist

These are the **only** fields/values permitted to enter a reply-draft prompt. Anything not on this list is denied by default (§6).

| Allowed input | Source | Rule |
| :--- | :--- | :--- |
| `AssembledBusinessContextItem.category` | VERIFIED business context (knowledge) | Permitted as verified business-owned fact. |
| `AssembledBusinessContextItem.key` | VERIFIED business context | Permitted as verified business-owned fact. |
| `AssembledBusinessContextItem.value` | VERIFIED business context | Permitted as verified business-owned fact (see §8 free-text risk). |
| `AssembledBusinessContextItem.sourceType` | VERIFIED business context | Permitted; provenance kind only (enum-valued). |
| `AssembledBusinessContextItem.sourceLabel` | VERIFIED business context | Permitted **only** as a customer-safe provenance label (see §8 free-text risk). |
| `AssembledBusinessContextItem.verifiedAt` | VERIFIED business context | Permitted; timestamp only. |
| `context.businessId` | Server-resolved tenant context | Permitted **only** as tenant boundary / provider-request metadata — **never** rendered as a customer-facing prompt claim. |
| Bounded operator instruction | Operator-supplied steering | Permitted **only** if bounded and **clearly labeled as NOT verified context**; can never promote an unverified fact to a definitive claim (see §8). |
| Static system / task guardrail text | Builder constants | Permitted; fixed, non-PII, non-tenant text. |

No other field is on the allowlist. In particular, **all `Customer` / `CustomerContactMethod` / `Conversation` / `Message` / `ReplyDraft` content is excluded** (§6). Eligibility additionally requires the item be **`status: VERIFIED`** — `DRAFT` / `ARCHIVED` items are never eligible (enforced upstream by the knowledge service).

---

## 6. Proposed Denylist

These inputs are **forbidden** from entering a prompt. The list is **default-deny**: anything not explicitly allowlisted in §5 is also denied even if not enumerated here. Field names cite `prisma/schema.prisma`.

**Customer PII (`Customer`)**

- `Customer.displayName`
- `Customer.notes`
- `Customer.metadata`

**Customer contact (`CustomerContactMethod`)**

- `CustomerContactMethod.value` (email / phone / handle)
- `CustomerContactMethod.label`

**Conversation content (`Conversation`)**

- `Conversation.subject`
- `Conversation.channelMetadata`
- `Conversation.metadata`

**Message content (`Message`)**

- `Message.content`
- `Message.channelMetadata`
- `Message.metadata`

**Reply-draft content (`ReplyDraft`)**

- `ReplyDraft.draftText`
- `ReplyDraft.originalText`

**Internal / provenance-implementation fields (must never reach prompt text)**

- `verifiedByUserId`
- `sourceMetadata`
- `sourceUrl`
- internal item ids (per-item `id`)
- per-item `businessId`
- lifecycle `status`
- `createdByUserId`

**Secrets / credentials (never anywhere near a prompt)**

- `process.env`
- API keys
- provider credentials

Note: `Customer` / `Conversation` / `Message` / `ReplyDraft` reads are **already statically forbidden** in all ai-runtime source (the AST + substring scope guards forbid `db.customer` / `db.conversation` / `db.message` / `db.replyDraft` and the corresponding domain imports). This denylist makes that boundary an **explicit prompt-input policy**, not only an implementation guard.

---

## 7. Conditional / Future-Review Fields

These are **neither allowlisted nor permanently denied**. Each is **deferred** to a dedicated, owner-gated future review and must **not** be added to a prompt by routine work:

- **customer message text** — STOP / future owner-gated (see §9).
- **conversation transcript** — STOP / future owner-gated (see §9).
- **operator instruction free text** — allowed today only as bounded, clearly-labeled non-verified steering; any expansion of how it is used is review-gated (see §8).
- **business-context `value` free text** — allowed today, but the free-text risk in §8 must be accepted by the owner before real-provider use.
- **`sourceLabel` free text** — allowed today only as a customer-safe label; see §8.
- **`sourceUrl`** — currently denied from prompt text; any future inclusion (e.g. as a citation) is review-gated.
- **`sourceMetadata`** — currently denied; any future structured-provenance inclusion is review-gated.

A field appearing here means: "not approved for prompt inclusion by default; requires its own owner decision and test before it may move to the allowlist."

---

## 8. Free-Text Risk: business value, sourceLabel, operator instruction

Three allowlisted inputs are **free text** and therefore carry residual risk even though they are business- or operator-owned, not customer-derived:

- **`AssembledBusinessContextItem.value`** — the business-owned fact. A business could enter customer-identifying or sensitive text here. It is VERIFIED business context, so it is allowed, but the value is not field-validated for PII content.
- **`AssembledBusinessContextItem.sourceLabel`** — a provenance label. Free text; could contain a URL-like or identifying string.
- **operator instruction** — operator steering. Bounded to 2000 chars and explicitly labeled "NOT verified context," but a malicious or careless operator could paste customer PII or injection-style text into it.

**Required mitigations (to be specified/enforced by the enforcement PR, not here):**

- Keep operator instruction **bounded and clearly labeled as not verified context** (already true in B-R5) — and prove by test that it can never be promoted to a definitive claim.
- Treat `value` / `sourceLabel` as **business-trust, not customer-trust**: acceptable for the verified-business-context boundary, but the owner must explicitly accept that these free-text fields are not PII-scrubbed before any real provider sees them.
- Consider bounding/normalizing `value` length and stripping control characters at the allowlist boundary (defense in depth) — proposed, not decided.
- These free-text fields remain in the **§7 conditional** posture: allowed today for fake-provider/synthetic data; their use with a **real provider** requires explicit owner sign-off.

---

## 9. Customer Message / Conversation Transcript Policy

**Policy: customer message text and conversation transcripts may NOT enter a prompt by default. This is a STOP / future owner-gated decision.**

- No customer/conversation/message/reply-draft content enters AI context or prompt today, and none may by default.
- Introducing customer-message text or a conversation transcript into a prompt is the single highest-risk change in Area B. It is **out of scope** for this spec and for routine work.
- Such a change requires, at minimum: explicit written owner approval, a dedicated PR, a defined **prompt-injection / untrusted-content strategy** (separate checkpoint gate), an updated allowlist (moving the relevant §7 conditional field with its own test), and re-proof of the B-R7 cross-tenant isolation suite and the B-R8 no-auto-send lock.
- Until then, the denylist (§6) treats `Message.content`, `Conversation.subject`, transcripts, and reply-draft text as **forbidden prompt inputs**, and the recommendation for any request to include them is **STOP**.

---

## 10. Required Enforcement Strategy

Enforcement strategy below — **now implemented by PR #124 / `2f4d015`** for the current fake-provider AI-runtime prompt-builder scope (items 1, 2, 5, 6 are in place via the centralized `PROMPT_RENDERABLE_ITEM_FIELDS` allowlist and the data-minimization test; items 3, 4 continue to hold as before). Strategy:

1. **Single allowlist boundary.** Centralize prompt-input construction so every field that reaches prompt text passes through one explicit allowlist (the §5 set) — making `formatItem`'s current implicit choice an explicit, named policy.
2. **Default-deny.** Any field not on the §5 allowlist is dropped before prompt assembly; adding a new prompt field requires editing the allowlist (and its test), which forces review.
3. **Type-level minimization.** Keep `AssembledAiContext` carrying only allowlistable fields where practical; the assembler already projects only business-owned + provenance fields and carries no customer/conversation/message field by construction (`toAssembledItem`).
4. **Static guards retained.** Keep the existing AST + substring scope guards (no `db.customer` / `db.conversation` / `db.message` / `db.replyDraft`, no provider SDK import, no `process.env` / API-key read) as the structural backstop beneath the allowlist.
5. **Provenance fields stay out of prompt text.** `verifiedByUserId`, `sourceMetadata`, `sourceUrl`, internal ids, per-item `businessId`, lifecycle `status`, `createdByUserId` remain excluded from rendered text (audit-only where needed).
6. **Fail closed.** Any ambiguity (malformed item, unknown field, oversized input) drops the field or fails closed — never includes by default. (B-R5 already drops malformed items and enforces a prompt size budget.)

No schema or migration is required: the allowlist operates over already-projected in-memory types, not new columns.

---

## 11. Tests Required Before Real Provider

B-H1 enforcement (**PR #124 / `2f4d015`**) added the following in `__tests__/domains/ai-runtime-data-minimization.test.ts` (the free-text bounding test remains deferred to a future real-provider review, per §8):

- **Allowlist positive test** — only the §5 fields appear in built prompt text for representative verified items.
- **Denylist negative test** — every §6 field, when smuggled into assembler/builder input (customer-PII-shaped fields, `sourceMetadata`, `sourceUrl`, `verifiedByUserId`, internal ids, per-item `businessId`, lifecycle `status`, `createdByUserId`), is proven **absent** from prompt text and from the provider request. (Extends the existing B-R7 smuggle-style assertions.)
- **Customer-content exclusion test** — `Customer` / `Conversation` / `Message` / `ReplyDraft` content can never reach context or prompt (parity with, and extension of, B-R7).
- **Operator-instruction labeling test** — instruction is bounded, labeled "NOT verified context," and cannot back a definitive §5.1 claim.
- **Free-text bounding test** (if mitigations in §8 are adopted) — `value` / `sourceLabel` bounding/normalization behaves as specified.
- **Secrets test** — no `process.env` / API-key / provider-credential read on any prompt path (retain the existing AST guard).
- **Regression linkage** — B-R7 cross-tenant isolation and B-R8 no-auto-send lock remain green.

All tests run against the **deterministic fake provider** and **synthetic data only** — no real provider, no spend, no real PII.

---

## 12. Files Likely Involved in Future Enforcement PR

Indicative only; the enforcement PR is separate and owner-approved.

- `src/domains/ai-runtime/prompt-builder.ts` — centralize the allowlist at `formatItem` / `buildPromptText`.
- `src/domains/ai-runtime/context-assembler.ts` — keep `toAssembledItem` projecting only allowlistable fields.
- `src/domains/ai-runtime/types.ts` — keep `AssembledBusinessContextItem` minimal; document allow/deny posture.
- `__tests__/domains/ai-runtime-prompt-builder.test.ts` — add allowlist/denylist assertions.
- `__tests__/domains/ai-runtime-cross-tenant-isolation.test.ts` (B-R7) and `__tests__/domains/ai-runtime-no-auto-send-lock.test.ts` (B-R8) — extend / keep green.
- A new `__tests__/domains/ai-runtime-data-minimization.test.ts` (proposed) — the dedicated B-H1 allowlist proof.

---

## 13. Files Not Allowed Yet

The enforcement work must **not** touch these without a separate, explicitly authorized gate:

- `prisma/schema.prisma` / `prisma/migrations/**` — no schema/migration is required for the allowlist (L4 / high-risk; out of scope).
- `package.json` / `pnpm-lock.yaml` — no model-provider SDK may be added (real-provider work remains **blocked**).
- `.env*` and any env / API-key wiring — remains **blocked**.
- Any real-provider adapter file — remains **blocked** (B-H3, future).
- The existing reply-draft `generate` route/handler — **not** to be wired to real generation here (route-level generation not approved).
- `.github/workflows/**` / CI config — no CI change is part of this spec.
- `docs/audits/AREA-B-closure-checkpoint.md`, `docs/audits/AREA-B-remediation-plan.md`, `docs/audits/AREA-B-ai-runtime-provenance-audit.md` — existing audit/checkpoint docs are not edited by this spec.

---

## 14. Gates Still Open

This spec, with PR #124, closes the **B-H1** data-minimization gate **for the current fake-provider AI-runtime prompt-builder scope only**. It closes **no other** go-live gate. Status (per `docs/audits/AREA-B-closure-checkpoint.md` §6 and `CLAUDE.md` → Remaining AI go-live gates):

- **PII / data-minimization allowlist (B-H1)** — **CLOSED for the current fake-provider AI-runtime prompt-builder scope** (PR #124 / `2f4d015`, 2026-06-20). The full PII review for a **real provider** (re-validating the allowlist against §7/§8 with a defined prompt-injection strategy) remains a precondition before real customer data may enter a prompt.
- Real-provider adapter review — OPEN (blocked).
- API-key / env-secret handling — OPEN (blocked).
- Route-level generation wiring — OPEN (not wired).
- Cost / rate-limit / observability — OPEN.
- Provider error handling — OPEN.
- Prompt-injection / untrusted-message strategy — OPEN (precondition for any §7 customer-content move).
- Human-approval UX verification — OPEN.
- Staging validation (default-off verified) — OPEN.
- Rollback / kill-switch drill — OPEN.
- Authz guard on a future `ai_drafts.send` consumer — OPEN.

(The real-DB AI-isolation CI gate / branch-protection enforcement is recorded as CLOSED as of 2026-06-19 in the checkpoint; it is unaffected by this spec.)

---

## 15. Owner Decisions Required

The owner is asked to decide (Claude recommends; owner decides). **Update (PR #124 / `2f4d015`, 2026-06-20):** decisions **1** (adopt the allowlist/denylist) and **5** (authorize a separate B-H1 enforcement PR) have been **executed** for the current fake-provider scope — the allowlist is centralized and test-enforced with no provider/env/route/schema/auto-send change. Decisions **2–4** remain owner-gated, and a fresh sign-off is required before any real-provider use.

1. **Adopt the §5 allowlist and §6 denylist as the frozen prompt-input policy?** (Recommended: yes — it matches and formalizes today's safe behavior.) — **DONE (PR #124).**
2. **Accept the §8 free-text residual risk** for `value` / `sourceLabel` / operator instruction as *business-trust, not customer-trust*, for fake-provider/synthetic use — and require a separate sign-off before real-provider use? (Recommended: yes.)
3. **Adopt §8 defense-in-depth mitigations** (bounding/normalizing `value`, stripping control chars)? (Recommended: yes, in the enforcement PR.)
4. **Confirm the §9 STOP posture**: customer message text / conversation transcript stay out of prompts as a future owner-gated decision. (Recommended: STOP — hold.)
5. **Authorize a separate B-H1 enforcement PR** (tests + centralized allowlist) — *without* any provider/env/route/schema change? (Recommended: yes, when scheduled.) — **DONE (PR #124 / `2f4d015`).**

None of these authorizes real-provider, route-level generation, env/API-key work, or auto-send.

---

## 16. Final Recommendation

> **Recommendation (now executed): the allowlist/denylist is ADOPTED as the prompt-input policy for Area B and ENFORCED for the current fake-provider AI-runtime prompt-builder scope (PR #124 / `2f4d015`), with no provider, env, route, schema, or auto-send change. Before any real provider or route-level generation, re-review the allowlist against §7/§8 with a prompt-injection strategy — STOP pending explicit owner approval.**

The current fake-provider scope is structurally safe and no customer/conversation/message/reply-draft content enters any prompt today. This spec froze that safety as an explicit, testable allowlist so it cannot silently regress as work resumes; **PR #124 implemented and test-enforced it** for the current fake-provider scope, closing **B-H1 for that scope**. It introduced no real provider, no SDK, no env/API-key read, no route-level generation wiring, no schema/migration, and no auto-send change.

Hard posture preserved: **real-provider production AI-assisted go-live remains NOT YET APPROVED**; no real provider is integrated or approved; no route-level generation is wired; no auto-send path exists; no customer/conversation/message/reply-draft content may enter a prompt by default; customer-message-in-prompt is **STOP / future owner-gated**; no schema/migration is required; env/API-key work and real-provider work remain **blocked**. For any of those, the recommendation is **STOP** pending explicit written owner approval and a dedicated PR.

---

*AREA-B PII / data-minimization prompt allowlist — ADOPTED / ENFORCED FOR CURRENT FAKE-PROVIDER AI-RUNTIME SCOPE (spec 2026-06-19; enforcement adopted 2026-06-20 via PR #124 / `2f4d015`; supersedes the original PROPOSED / OWNER-REVIEW REQUIRED status). Specifies the allowlist (§5), denylist (§6), and conditional/future-review fields (§7) for AI prompt inputs; enforcement (§10) is now implemented via the centralized `PROMPT_RENDERABLE_ITEM_FIELDS` allowlist and the `ai-runtime-data-minimization` test (§11). B-H1 is CLOSED for the current fake-provider AI-runtime prompt-builder scope only. AI remains default-off; no real provider is integrated or approved; no route-level generation is wired; no auto-send exists; customer-message-in-prompt is STOP / future owner-gated. Real-provider production AI-assisted go-live remains NOT YET APPROVED.*
