# AREA-B — Prompt-Injection / Untrusted-Input Trust-Boundary Strategy

**Product:** AiA Reception SaaS
**Scope:** AI Runtime prompt-injection defense / untrusted-input trust boundary (PRD-v1.1 §5.1 / §9; checkpoint §6 "Prompt-injection / untrusted user-message strategy")
**Date:** 2026-06-20
**Source documents:** `docs/audits/AREA-B-closure-checkpoint.md` (current status reference) · `docs/audits/AREA-B-remediation-plan.md` · `docs/audits/AREA-B-pii-data-minimization-allowlist.md` · `docs/audits/AREA-B-provider-error-handling.md` · `docs/audits/AREA-B-token-usage-cost-guard.md` · `docs/product/PRD-v1.1.md` (LOCKED, §5 / §5.1 / §9) · `src/domains/ai-runtime/prompt-builder.ts` · `src/domains/ai-runtime/types.ts`

---

## 0. Status

> **Status: PROPOSED / OWNER-REVIEW REQUIRED / GATE STILL OPEN**

This document defines the vendor-neutral **prompt-injection / untrusted-input trust-boundary strategy** for the AI runtime. It is a **strategy / specification only**. It integrates no real provider, adds no code, adds no tests, and authorizes nothing.

Explicitly:

> **This document defines a strategy only.**
> **It closes no gate.**
> **It approves no real provider.**
> **It approves no customer-message-in-prompt.**
> **It approves no route-level generation wiring.**
> **Real-provider production AI-assisted go-live remains NOT YET APPROVED.**

It deliberately **does not**:

- approve any real model provider (none is integrated, and **real-provider production AI-assisted go-live remains NOT YET APPROVED**);
- add any production code, prompt-builder change, or production taxonomy (`src/domains/ai-runtime/*` is intentionally untouched);
- add any test or test helper (the enforcement tests are a separate, owner-gated future PR);
- approve route-level AI generation wiring (none is wired);
- authorize env / API-key work (that remains blocked);
- add any schema / migration / DB counter (none is added);
- create any auto-send path (none exists);
- approve **customer-message-in-prompt** (that remains **STOP** / future owner-gated — see §3 and §6).

This document **recommends**; the owner **decides**. Any item that would let untrusted customer/conversation/message content into a prompt is a **STOP** / **future owner-gated** decision requiring explicit written owner approval and a dedicated PR (per `CLAUDE.md` → Decision authority and Remaining AI go-live gates).

---

## 1. Executive Verdict

Today's prompt construction is **structurally narrow**. The B-R5 prompt builder (`src/domains/ai-runtime/prompt-builder.ts`) assembles a prompt from only:

- **verified, tenant-scoped business context** (B-R3 assembler output; `status: VERIFIED` only);
- **static guardrail / task rules** (fixed builder constants — the PRD-v1.1 §5.1 refusal/hedge rules, the human-review boundary, the no-auto-send rule, and the do-not-leak-internals rule);
- an optional **bounded operator instruction** (≤ `MAX_OPERATOR_INSTRUCTION_CHARS`, explicitly labeled "NOT verified business context");

and it includes:

- **no customer message text**;
- **no conversation transcript**;
- **no reply-draft / customer-PII read path** (statically forbidden across the AI-runtime source);
- **no tool execution** (the provider boundary is text-in / text-out only; no tool/function-call surface exists);
- **no auto-send** (no send / dispatch / deliver / message-creation path exists in any AI-runtime file).

So there is, in effect, **nothing untrusted to attack inside a prompt today** — the prompt is built from business-owned and operator-owned inputs over a deterministic fake provider on synthetic data.

**Nevertheless, the checkpoint §6 "Prompt-injection / untrusted user-message strategy" gate remains OPEN.** Unlike the recently-advanced gates (PII / data-minimization — PR #124; provider error-handling — PR #126; token / usage cost-guard — PR #128), prompt-injection defense has no freezable, test-provable *decision contract* today, because its subject — **untrusted customer-message content inside a prompt** — is **out of scope / STOP** and is **structurally absent**. The genuine gap is that the project has **not yet written down how future untrusted customer text would be isolated** if it were ever introduced. This document fills that gap by **defining the trust model and the future strategy**, while keeping the gate **OPEN** and the customer-message-in-prompt posture **STOP**.

---

## 2. Scope

**In scope.** The vendor-neutral trust model (trusted / semi-trusted / untrusted prompt inputs), the prompt-injection threat model and how today's protections map onto it, and the minimum strategy + re-proof obligations that a future owner-approved PR would have to satisfy *before* any untrusted content could ever enter a prompt.

**Out of scope (unchanged by this document).**

- Real model-provider integration / SDK selection (remediation-plan **B-H3**; remains future, **blocked**).
- API-key / env-secret handling (remains **blocked** until its own gate).
- Route-level generation wiring (assembly → prompt → provider → audit → draft; not wired).
- Any production prompt-builder change (no defensive-wording edit to `prompt-builder.ts` is made or approved here — that is a separate, owner-gated production task).
- Any test / test helper (the enforcement suite is a separate, owner-gated future PR).
- Schema / migration / DB counters — **not required** for this strategy and not made.
- **Customer-message-in-prompt / conversation-transcript-in-prompt** — **STOP / future owner-gated** (§3, §6).
- Area C (public widget ingest) — out of scope.

This document governs **how untrusted input would be isolated**. It does not by itself approve introducing any untrusted input into a prompt.

---

## 3. Trust Model

The strategy defines exactly **three trust tiers** for anything that could reach a prompt. The tier determines what the input may and may not do.

### TRUSTED

- static system / task rules (builder constants);
- verified, tenant-scoped business context (B-R3 assembler output);
- **allowlisted verified-context fields only** (`PROMPT_RENDERABLE_ITEM_FIELDS` — `category` / `key` / `value` / `sourceType` / `sourceLabel` / `verifiedAt`, per B-H1 / PR #124).

Trusted inputs are the **only** basis for definitive §5.1 vertical-sensitive claims and the **only** source of system-level instruction.

### SEMI-TRUSTED

- the human / operator instruction (bounded, optional);
- `sourceLabel` / `value` free-text **inside verified business context**, where relevant (business-trust, not customer-trust — see PII spec §8).

Semi-trusted inputs:

- **may** shape style, tone, or request focus;
- **may not** override system rules;
- **may not** create definitive business claims (cannot promote an unverified fact to a definitive §5.1 claim);
- **may not** authorize sending;
- **may not** expose internal / provenance / lifecycle fields.

### UNTRUSTED

- customer message text;
- conversation transcript;
- public widget / user-submitted text;
- imported third-party text;
- any externally-derived user content.

For UNTRUSTED input:

> **Customer-message-in-prompt remains STOP / future owner-gated.**
> **No untrusted customer/conversation/message content may enter prompts in the current approved scope.**

Untrusted content is **not present in any prompt today** and may not be introduced by routine work. If it is ever introduced, it must be handled per §6 (fenced, no-authority, re-proofed) under explicit owner approval and a dedicated PR.

---

## 4. Threat Model

Vendor-neutral prompt-injection classes, with the **current mitigation** and the **remaining gap** for each. "Current mitigation" describes why the class is not exploitable in today's narrow scope; "remaining gap" describes what a future PR introducing untrusted content would have to close.

| # | Injection class | Current mitigation | Remaining gap (future untrusted content) |
| :-- | :--- | :--- | :--- |
| 1 | **Instruction override** ("ignore previous instructions…") | No untrusted text reaches the prompt; static system rules are the only instruction source; operator instruction is semi-trusted and explicitly labeled non-authoritative. | Need a system-level no-authority-from-untrusted rule + fenced untrusted region so injected overrides cannot rebind behavior. |
| 2 | **Role confusion** (untrusted text posing as system/developer/business) | Only trusted tiers carry authority; there is no untrusted tier in the prompt today. | Need explicit instruction hierarchy (system > verified business context > operator > [future fenced untrusted]) enforced and tested. |
| 3 | **Policy bypass** (defeating §5.1 refusal/hedge rules) | §5.1 refusal/hedge rules are static and provenance-gated; definitive claims require VERIFIED context (B-R5). | Need proof that fenced untrusted content cannot relax §5.1 rules or supply a "verified" fact. |
| 4 | **Data exfiltration of internal / provenance fields** | Internal / provenance fields (`id`, `verifiedByUserId`, `sourceMetadata`, `sourceUrl`, `status`, per-item `businessId`, `createdByUserId`) never render — enforced by the B-H1 allowlist (`formatItem` iterates `PROMPT_RENDERABLE_ITEM_FIELDS`) and the AST scope guard. | Need a rule + test that untrusted content cannot request hidden/internal metadata, and that the allowlist still holds with an untrusted tier present. |
| 5 | **Fake business facts** (untrusted text asserting prices/availability/etc.) | Only VERIFIED business context backs definitive claims; unverified/external/inferred information is explicitly disallowed as a definitive source (B-R5 system rules; PRD §5.1). | Need proof that untrusted content can never be treated as a verified fact or create a definitive business claim. |
| 6 | **Hidden delimiter / escape attempts** (breaking out of a content region) | No untrusted region exists; the builder uses control-char field/record separators only for the internal context hash, not for untrusted fencing. | Need a robust fenced/delimited untrusted region with escape-resistant boundaries, proven by test. |
| 7 | **Tool / command injection** | No tool / function-call / command surface exists; the provider boundary is text-only and the AI runtime has no send/dispatch/deliver/createMessage path (B-R8 + AST guard). | If tools are ever added, untrusted content must be unable to invoke them; re-proof of the no-auto-send / no-tool posture required. |
| 8 | **Output-manipulation attempts** (forcing unsafe/raw output) | Output is a **draft only** for human review; no auto-send; the human-approval boundary is the only path to a customer (B-R8). | Need proof that untrusted content cannot bypass the draft-only / human-review boundary or force exfiltration into the draft. |
| 9 | **Social-engineering instructions inside customer text** | No customer text is in any prompt; operator instruction is semi-trusted and cannot authorize sending or definitive claims. | Need the no-authority-from-untrusted rule + human-review re-proof so social-engineering payloads in untrusted text are inert. |

---

## 5. Current Protections Already Proven

These existing, merged protections **reduce current prompt-injection risk** by keeping the prompt narrow and the boundaries hard. They are referenced here, **not modified**.

- **B-H1 / PR #124 — data-minimization allowlist.** Verified-context items render only allowlisted fields (`PROMPT_RENDERABLE_ITEM_FIELDS`); customer/conversation/message/reply-draft-shaped fields and internal/provenance fields never reach prompt text (`__tests__/domains/ai-runtime-data-minimization.test.ts`).
- **B-R7 — tenant isolation / no cross-tenant context.** The assembler returns only the current tenant's VERIFIED context; cross-tenant context never leaks (`__tests__/domains/ai-runtime-cross-tenant-isolation.test.ts`), plus the gated real-DB AI-isolation suite.
- **B-R8 — no-auto-send / human-approval lock.** The AI runtime has no send / message-delivery path; draft metadata is review-only; human approval is the only boundary to a customer (`__tests__/domains/ai-runtime-no-auto-send-lock.test.ts`).
- **AST scope guard.** A TypeScript-AST static guard re-proves the no-send / no-real-provider / no-PII-read / no-provider-SDK boundary structurally (`__tests__/domains/ai-runtime-scope-guard-ast.test.ts`).
- **Provider error-handling proof.** Operational provider failures fail closed through `ActionResult` and the metadata-only audit `FAILED` path (`docs/audits/AREA-B-provider-error-handling.md`; PR #126).
- **Token / usage cost-guard proof.** The fail-closed cost-decision contract is test-proven for the fake-provider scope (`docs/audits/AREA-B-token-usage-cost-guard.md`; PR #128).
- **Branch protection — required checks.** `main` requires `Lint, Typecheck, Build, Test (20)` and `Tenant Isolation Integration (A-R1 real DB) (20)` (2026-06-19).

> These protections meaningfully reduce **current** risk, but they do **not** close the prompt-injection strategy gate: future **untrusted customer content** is still **not approved**, and no strategy for isolating it had been written down until this document. The gate stays **OPEN**.

---

## 6. Future Strategy — Required Before Any Untrusted Content May Enter a Prompt

Introducing untrusted customer/conversation/message content into a prompt is the single highest-risk change in Area B. Before any such change, **all** of the following are required (none is satisfied or authorized by this document):

- **explicit owner approval** (written);
- a **dedicated PR** (single-purpose, reviewed);
- a **trust-tier classifier or equivalent policy** that labels every prompt input TRUSTED / SEMI-TRUSTED / UNTRUSTED (§3);
- a **fenced / delimited untrusted-content region** with escape-resistant boundaries;
- a **system-level no-authority-from-untrusted rule**;
- untrusted content **cannot override** system / developer / business rules;
- untrusted content **cannot authorize sending**;
- untrusted content **cannot request hidden / internal metadata**;
- untrusted content **cannot create definitive business facts** (only VERIFIED business context may back §5.1 claims);
- **re-proof of data-minimization** (the B-H1 allowlist still holds with an untrusted tier present);
- **re-proof of no-auto-send** (the B-R8 lock stays green);
- **re-proof of tenant isolation** (the B-R7 suite, including the real-DB variant, stays green);
- **prompt-injection regression tests** (adversarial payloads proven inert);
- an **audit / privacy review** of the new untrusted surface.

Until every item above is met under explicit owner approval, untrusted customer/conversation/message content stays **out of every prompt**, and the recommendation for any request to include it is **STOP**.

---

## 7. Owner Decisions Required

The owner is asked to decide (Claude recommends; owner decides). None of these is executed by this document.

- **Whether to adopt this trust model** (the three-tier TRUSTED / SEMI-TRUSTED / UNTRUSTED boundary in §3).
- **Whether to authorize a separate test-only enforcement PR** (a trust-boundary classifier helper + suite pinning the §3 boundary and §4 invariants) — *without* any provider / env / route / schema / production-prompt-builder / auto-send change.
- **Whether customer-message-in-prompt should remain STOP** (recommended: STOP — hold).
- **What exact customer text, if any, may ever be included** (and under what summarization/extraction constraints), should the STOP posture ever be revisited.
- **Whether untrusted content should be summarized / extracted before prompt inclusion** (e.g. structured extraction by a trusted step) **instead of inserted raw** — a safer-by-construction alternative to fencing raw untrusted text.
- **Whether prompt-injection testing should be a hard CI gate** (a required status check) before real-provider go-live.

---

## 8. Non-Goals

This document does **not** add any of:

- a **real provider**;
- a provider **SDK**;
- **env / API-key** work;
- a **production prompt-builder change**;
- a **schema / migration**;
- **DB counters**;
- **route wiring**;
- **tests**;
- **customer-message prompt inclusion**;
- **auto-send**.

---

## 9. Gate Status

> **The prompt-injection / untrusted-input strategy gate remains OPEN after this document.**
> **This document moves the gate from undefined to proposed strategy.**
> **Closure requires a later owner-approved enforcement PR and checkpoint sync.**

This document closes **no** §6 go-live gate. Unlike the cost-guard and provider-error-handling gates (which had a freezable, test-provable decision contract and could be recorded CLOSED *for the current fake-provider scope*), the prompt-injection gate's subject — untrusted customer content in a prompt — is **out of scope / STOP**, so it **cannot** be closed now. Every other §6 gate remains as recorded in `docs/audits/AREA-B-closure-checkpoint.md`.

---

## 10. Hard Posture Preserved

- **real-provider production AI-assisted go-live remains NOT YET APPROVED**
- **no real provider is integrated or approved**
- **no provider SDK is added**
- **no env / API-key work is authorized**
- **no schema / migration is added**
- **no DB usage counters are added**
- **no route-level generation is wired**
- **no auto-send path exists**
- **customer-message-in-prompt remains STOP / future owner-gated**
- **no customer PII enters prompts**
- **AI remains default-off / draft-only / human-review-required**

---

*AREA-B prompt-injection / untrusted-input trust-boundary strategy — PROPOSED / OWNER-REVIEW REQUIRED / GATE STILL OPEN (2026-06-20). Defines the three-tier trust model (§3), the prompt-injection threat model and current-mitigation/remaining-gap mapping (§4), the existing proven protections (§5), and the minimum strategy + re-proof obligations before any untrusted content may enter a prompt (§6). Adds no real provider, no SDK, no env/API-key read, no production code, no tests, no schema/migration, no route wiring, no auto-send, and no customer-message-in-prompt. This document closes no gate and approves nothing; the prompt-injection / untrusted-input strategy gate remains OPEN. Real-provider production AI-assisted go-live remains NOT YET APPROVED.*
