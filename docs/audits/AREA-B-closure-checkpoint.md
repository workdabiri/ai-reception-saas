# Area B — Closure Checkpoint

**Product:** AiA Reception SaaS
**Scope:** AI Runtime · Tenant-Scoped AI Context · Verified/Unverified Provenance · `aiMode` / Kill Switch · Provider Abstraction · Provenance-Aware Prompt Builder · AI Generation Audit · Cross-Tenant AI-Context Isolation · No-Auto-Send / Human-Approval Lock — Blocker-Suite Closure Record
**Status:** B-R1 → B-R8 blocker suite CLOSED · Foundational AI-runtime boundary GREEN for the implemented (fake-provider / provenance / isolation / no-auto-send) scope · Real-provider production AI-assisted go-live NOT YET APPROVED
**Date:** 2026-06-17
**Closes through:** PR #106 (`7f4eee0`)
**Source documents:** `docs/product/PRD-v1.1.md` (LOCKED, §5 / §5.1 / §9 / §16) · `docs/audits/AREA-B-ai-runtime-provenance-audit.md` (RED) · `docs/audits/AREA-B-remediation-plan.md` (PROPOSED → executed) · `docs/audits/AREA-A-closure-checkpoint.md` (Area A CLOSED/GREEN, isolation substrate)

This is a **status checkpoint only**. It records the closure of the Area B blocker remediation suite (B-R1 through B-R8) through PR #106. It does **not** rewrite or supersede the historical audit (`AREA-B-ai-runtime-provenance-audit.md`, verdict RED) or the remediation plan (`AREA-B-remediation-plan.md`); both are preserved as historical context. This checkpoint is the **current status reference** for Area B.

It makes a deliberately narrow claim. **The foundational AI-runtime / provenance / isolation boundary is now built and proven for the implemented scope — but real AI is not live.** No real model provider is integrated; no route-level generation path is wired; AI is default-off; no auto-send exists; Area C is out of scope. Real-provider production AI-assisted operation remains **NOT YET APPROVED** and must pass the separate gates in §6 before any real customer data enters an AI prompt.

---

## 1. Executive Verdict

> **Area B B-R1 → B-R8 blocker remediation is complete.** The foundational AI runtime / provenance / tenant-isolation boundary is **closed for the built scope**.

Precise scope of that verdict:

- **The blocker suite is done.** B-R1 (business `aiMode` / kill switch), B-R2 (verified business-context store with provenance), B-R3 (tenant-scoped AI context assembler), B-R4 (provider abstraction + deterministic fake provider), B-R5 (provenance-aware prompt builder), B-R6 (AI generation audit log + draft metadata), B-R7 (cross-tenant AI-context isolation proof), and B-R8 (dedicated no-auto-send / human-approval lock) are all **merged to `main` with green tests** (PRs #98–#106).
- **Real AI is NOT live.** There is **no real model-provider SDK** in the dependency tree, **no network path**, **no API-key/env wiring**, and **no route-level real generation**. All AI generation in the repository runs against a **deterministic fake provider** over **synthetic / test data only**. Do not read this checkpoint as "AI is on" — it is not.
- **Real provider integration and route-level generation wiring are future work** and must pass **separate review** (§6) before any production use. This checkpoint authorizes neither.
- **No auto-send / no Level 3 autopilot.** The system has no path that sends an AI reply to a customer. The human-review boundary (generate → review → edit → approve) is preserved; AI never approves and never sends.
- **Area C (public widget / ingest) remains out of scope** and is untouched by this checkpoint.

**Relationship to the remediation plan's Definition of Done (`AREA-B-remediation-plan.md` §8).** The plan's strict **GREEN** ("real-data Level 2 permitted") additionally requires items beyond the B-R1→B-R8 blocker suite — a CI-enforced real-DB AI-isolation gate, and the real-provider/route/PII/cost/observability/human-approval gates in §6. Those are **not** all met. This checkpoint therefore records a precise intermediate state: **the blocker architecture (B-R1→B-R6), the isolation proof (B-R7), and the dedicated no-auto-send / human-approval lock (B-R8) are built and green**, which closes the foundational AI-runtime boundary for the implemented scope, **without** declaring the plan's full real-data Level-2 GREEN. The phrase "real AI is live" is deliberately avoided because it would be false.

---

## 2. Scope Covered

This checkpoint covers — built, merged, and tested — the following:

- **Business-level AI mode / kill switch (B-R1).** Per-business `Business.aiMode` (`MANUAL` / `AI_ASSISTED`), defaulting to **`MANUAL`** (Level 1, AI off). A server-side resolver (`resolveAiPolicy`) that **fails closed**: missing/empty context, missing business, unknown/invalid stored mode, or a repository error all resolve to **AI disabled**. Generation is enabled **only** for an explicit `AI_ASSISTED` opt-in. The kill switch is "set the business back to `MANUAL`" — a server-side state change that disables generation business-wide without a deploy.
- **Verified business-owned context store (B-R2).** A tenant-scoped `BusinessContextItem` model (business-approved hours / pricing / policies / FAQ-style facts) with a composite `@@unique([id, businessId])` key, holding **data only** — no prompts, no provider, no customer/conversation/message content.
- **Provenance fields (B-R2).** Each context item carries a verification `status` (`DRAFT` / `VERIFIED` / `ARCHIVED`, default `DRAFT`) and a `sourceType` provenance kind (`OWNER_APPROVED` / `OPERATOR_APPROVED` / `SYSTEM_SEEDED` / `IMPORT` / `OTHER`), plus `sourceLabel` / `sourceUrl` / `sourceMetadata` and verifier identity (`verifiedByUserId` / `verifiedAt`). Only **`VERIFIED`** items are AI-eligible; provenance must be explicit (a missing `sourceType` is rejected, never defaulted).
- **Tenant-scoped context assembly (B-R3).** An assembler (`assembleAiContext`) that reads the businessId **only** from the server-resolved tenant context, calls the policy resolver and the verified-context reader with that businessId, and returns a structured, provenance-tagged context. It **fails closed** when AI is disabled and never widens scope from client-shaped input.
- **Provider abstraction (B-R4).** An `AiProvider` interface (`generateText`, `providerId`, `modelId`) — the seam a real provider will later sit behind — with domain logic depending on the interface only.
- **Deterministic fake provider (B-R4).** A `createFakeAiProvider` that yields deterministic, bounded output with no network call, no env/API-key read, no randomness, and **no prompt echo** (it never returns the prompt or customer content).
- **Prompt builder with provenance and refusal/hedging rules (B-R5).** A pure `buildReplyDraftPrompt` that converts an assembled context into a `REPLY_DRAFT` provider request, injects only verified context, records `promptVersion` + a deterministic `contextHash`, and emits the **§5.1 refusal/hedging rules** across all nine vertical-sensitive categories (property availability, price, ROI, investment guarantees, legal requirements, regulatory requirements, mortgage/financing, commissions, contracts) plus the human-review / no-auto-send instructions; with zero verified context it emits strict missing-context rules.
- **Audit log / draft AI metadata (B-R6).** A metadata-only `AiGenerationAuditLog` (STARTED / SUCCEEDED / FAILED lifecycle) and a review-only draft-metadata patch (`source = AI` + model/provenance fingerprint columns on `ReplyDraft`). The audit table has **no column** for the raw prompt, generated text, transcript, or customer PII; free text is bounded and PII-redacted.
- **Cross-tenant isolation proof (B-R7).** A suite that exercises the **real** B-R1→B-R6 composition over in-memory, Prisma-`where`-faithful **multi-tenant** delegates (business A and B in one store) and proves Business-A artifacts never contain any Business-B marker, and vice versa.
- **No customer / conversation / message content in prompt context.** Static scope guards across every AI-runtime source file forbid `db.customer` / `db.conversation` / `db.message` / `db.replyDraft` access and imports of the `crm` / `conversations` / `reply-drafts` domains; B-R7 actively smuggles customer-PII-shaped fields into the assembler input and proves they never reach the assembled context or the prompt.
- **No auto-send / human-approval lock (B-R8).** No send/dispatch/deliver path exists in any AI-runtime file (guarded statically); the draft-metadata patch carries no `status` / `sent*` fields. The dedicated B-R8 lock proves the AI runtime has **no send path** and **no message-delivery path**, AI metadata is **review-only**, the AI audit lifecycle is **not** a delivery lifecycle, the fake provider **cannot send**, the human-approved reply-draft APPROVED/SENT capability remains **untouched**, **no route** combines AI generation with send/message creation, and **human approval remains the only boundary**.

---

## 3. Scope NOT Covered

The following are **explicitly out of scope** for this checkpoint and remain open. None are closed here; do not treat this checkpoint as covering them:

- **Real provider SDK integration.** No `openai` / `anthropic` / `@anthropic-ai` / Google / Cohere / Mistral / Bedrock (or any model SDK) is in `package.json`; statically guarded against. (Plan task B-H3, future.)
- **API-key / env wiring.** No `process.env` AI/provider read and no `api_key` path anywhere in the AI-runtime source; statically guarded.
- **Route-level real AI generation.** No production route wires assembly → prompt → provider → audit → draft. The B-R7 pipeline is a **test-only** composition that invents no route or generation service; the existing reply-draft `generate` path remains the pre-existing deterministic SYSTEM stub.
- **Public widget / Area C ingestion security.** Widget-key → business mapping and public-ingest isolation are Area C; untouched.
- **WhatsApp / external channel AI behavior.** No external-channel AI path exists or is evaluated.
- **Level 3 autopilot.** Future-only; `BusinessAiMode` intentionally has **no** auto-pilot value.
- **Autonomous send.** No AI-initiated send path of any kind.
- **Evaluation / confidence / risk scoring.** No eval harness or confidence gating (plan B-H4, future).
- **Prompt-injection defense beyond the verified-business-context boundary.** The guardrail is "only verified business context backs definitive claims, and no customer/conversation/message content enters the prompt." Defenses against adversarial content inside an untrusted customer message (once such content is ever introduced into a prompt) are **not** built — no real customer message is in any prompt today.
- **Production observability / alerting for AI usage.** No dashboards, metrics, or alerting on AI generation.
- **Billing / usage limits for real provider tokens.** Token usage is recorded as fake-provider metadata only; no real cost guard exists.
- **Legal / compliance review for real deployment.** Not performed.
- **A CI-enforced real-DB AI-isolation integration gate.** B-R7 runs at the **domain (unit) tier** on every `pnpm test`; it is **not** wired into the dedicated `RUN_INTEGRATION_TESTS` live-Postgres CI job (which still runs only the Area A A-R1 suite). A live-DB AI-isolation gate mirroring A-R1.1 is not present.
- **Authz-level guard on a future `ai_drafts.send` consumer.** B-R8 closes the no-auto-send / human-approval lock at the **domain (unit) tier** — it proves no AI-runtime or route path can send and that human approval is the only boundary today. A route-level/authz guard on a future real `ai_drafts.send` consumer (which does not exist yet) is a **future gate**, required before real-data Level 2 is enabled (see §6).

---

## 4. Evidence Matrix

All eight workstreams are merged to `main` with green tests. Local validation for this checkpoint: **443 tests across the eight Area B suites, all passing** (full suite **2158 passed / 11 skipped**; see §8).

| Task | Main purpose | Key files | Key tests | Safety property proven | Merge / commit | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **B-R1** | Business `aiMode` + default-off kill switch; server-side fail-closed resolver | `prisma/schema.prisma` (`enum BusinessAiMode`, `Business.aiMode @default(MANUAL)`); `src/domains/ai-config/{types,service,implementation,repository}.ts` | `__tests__/domains/ai-config-resolver.test.ts` (17) | AI **default-off**; only explicit `AI_ASSISTED` enables generation; missing/invalid/empty/error all **fail closed**; resolver reads server-side `businessId` only | PR #98 · `fa4079a` | **CLOSED** |
| **B-R2** | Verified business-context store with provenance | `prisma/schema.prisma` (`BusinessContextItem`, `BusinessContextItemStatus`, `BusinessContextItemSourceType`); `src/domains/knowledge/{types,service,repository,implementation,index}.ts` | `__tests__/domains/knowledge-context-store.test.ts` (62) | Items default **`DRAFT`** (unverified); verified reads always pinned to `businessId` **AND** `status:VERIFIED`; cross-tenant reads return nothing; provenance explicit, never defaulted; verify/archive scoped by composite `(id, businessId)`; verify is one-way (terminal) | PR #99 · `334b2db` | **CLOSED** |
| **B-R3** | Tenant-scoped AI context assembler | `src/domains/ai-runtime/{context-assembler,service,types,index}.ts` | `__tests__/domains/ai-runtime-context-assembler.test.ts` (41) | Reads `businessId` from server context only; **fails closed** (`AI_CONTEXT_DISABLED`) when AI off / policy errors / inconsistent; never widens scope (smuggled businessId/options rejected); returns provenance-tagged verified-only items; excludes raw `status`/`businessId`/`createdByUserId` | PR #100 · `dafa5e1` | **CLOSED** |
| **B-R4** | Provider abstraction + deterministic fake provider | `src/domains/ai-runtime/{provider,fake-provider}.ts` | `__tests__/domains/ai-runtime-provider.test.ts` (63) | Domain depends on `AiProvider` interface only; deterministic output; **no network** (fetch never called); **no env/API-key**; no randomness; **no prompt echo / no PII leakage**; fails closed on invalid input; **no real SDK** in `package.json` | PR #101 · `f3f5698` | **CLOSED** |
| **B-R5** | Provenance-aware prompt builder (refusal/hedging) | `src/domains/ai-runtime/prompt-builder.ts` | `__tests__/domains/ai-runtime-prompt-builder.test.ts` (56) | Injects **only verified** context; records `promptVersion` + deterministic `contextHash`; emits §5.1 refusal/hedge rules for **all nine** vertical-sensitive categories + human-review/no-auto-send rules; tracks included/omitted item ids; **never leaks** verifier id / sourceMetadata / internal ids into prompt text; pure (no provider, no network) | PR #102 · `68a9120` | **CLOSED** |
| **B-R6** | AI generation audit log + draft metadata | `prisma/schema.prisma` (`AiGenerationAuditLog`, `AiGenerationStatus`, `ReplyDraft` AI columns); `src/domains/ai-runtime/audit-log.ts` | `__tests__/domains/ai-runtime-audit-log.test.ts` (57) | Metadata-only persistence (counts/ids/hash only — **no raw prompt, no generated text, no PII columns**); STARTED→SUCCEEDED/FAILED with **terminal-state immutability**; tenant-scoped by composite `(id, businessId)`; PII (email/phone) redacted + bounded; draft metadata **review-only** (no `status`/`sent*` fields) | PR #103 · `cb0d00f` | **CLOSED** |
| **B-R7** | Cross-tenant AI-context isolation proof (PRD §9 AI gate) | `__tests__/domains/ai-runtime-cross-tenant-isolation.test.ts` (test-only; no production source added) | same file (77) | Over the **real** B-R1→B-R6 composition (in-memory Prisma-`where`-faithful multi-tenant delegates): A↔B context never cross-leaks (id/key/value/label/provenance/metadata); verified-only intact; **AI-off fails closed** (no knowledge read, no prompt, no provider call, no audit row, no draft); audit tenant-scoped; **no customer/conversation/message content** reaches context or prompt; no auto-send | PR #104 · `274a509` | **CLOSED** |
| **B-R8** | Dedicated no-auto-send / human-approval lock | `__tests__/domains/ai-runtime-no-auto-send-lock.test.ts` (test-only; no production source added) | same file (70) | AI runtime has **no send path**; AI runtime has **no message-delivery path**; AI metadata is **review-only**; AI audit lifecycle is **not** a delivery lifecycle; fake provider **cannot send**; reply-draft human APPROVED/SENT capability remains **untouched**; **no route** combines AI generation with send/message creation; **human approval remains the only boundary** | PR #106 · `7f4eee0` | **CLOSED** |

---

## 5. Security Properties Now Enforced

Each property below is enforced in source and pinned by at least one test in the §4 suites:

- **AI default-off.** `Business.aiMode` defaults to `MANUAL`; `DEFAULT_BUSINESS_AI_MODE = 'MANUAL'`. No business is AI-enabled without an explicit server-side `AI_ASSISTED` state change. *(B-R1)*
- **MANUAL mode fail-closed.** `resolveAiPolicy` returns `aiGenerationEnabled: false` for `MANUAL`, missing business, unknown/invalid stored mode, empty/missing context, or a repository error — it always returns a policy and never an exception. *(B-R1)*
- **Only verified business context is eligible.** Verified reads are pinned to `status: VERIFIED`; `DRAFT` and `ARCHIVED` items are never returned; `AI_ELIGIBLE_BUSINESS_CONTEXT_ITEM_STATUS = 'VERIFIED'`. *(B-R2)*
- **Tenant-scoped context assembly.** The assembler keys the policy lookup and the verified-context read on the **server-resolved** `businessId` only; client-shaped `businessId`/options are ignored or rejected. *(B-R3, B-R7)*
- **Prompt builder uses assembled context only.** `buildReplyDraftPrompt` consumes the assembled context object; it has no DB/customer read path and injects only verified item values. *(B-R5)*
- **No raw customer / conversation / message content in AI context.** Static guards forbid customer/conversation/message/reply-draft reads and domain imports across the AI-runtime source; B-R7 smuggles customer-PII-shaped fields in and proves they never appear in context or prompt. *(B-R3, B-R5, B-R6, B-R7)*
- **No real provider network path.** No `fetch`/`http`/`https`/`axios`/`undici` in any provider file; B-R4 proves `fetch` is never invoked during generation. *(B-R4)*
- **Provider request is abstracted.** Domain logic depends on the `AiProvider` interface; swapping providers requires no calling-code change. *(B-R4)*
- **Fake provider deterministic for tests.** Same input → identical output (text/usage/requestId) across instances; injected clock makes `createdAt` deterministic; no randomness. *(B-R4)*
- **Prompt provenance tracked.** Each build records a non-empty `promptVersion` (`REPLY_DRAFT_PROMPT_VERSION`) on the result and provider-request metadata. *(B-R5, B-R6)*
- **Context hash generated.** A deterministic `contextHash` fingerprints the verified context (order-independent), changes when the business's own verified context changes, and is unaffected by another tenant's context changing. *(B-R5, B-R7)*
- **Included / omitted context item ids tracked.** The builder reports `includedContextItemIds` and `omittedContextItemIds`; ids are tracked for audit but never rendered into prompt text. *(B-R5, B-R6)*
- **AI generation audit metadata stored.** Every attempt is one `AiGenerationAuditLog` row (business, conversation trace id, operation, prompt version, context hash, item ids, provider/model, finish reason, token usage, char counts) — metadata only. *(B-R6)*
- **Audit terminal-state immutability.** A SUCCEEDED or FAILED row cannot be completed again; rejected transitions (`AI_AUDIT_INVALID_TRANSITION`) mutate nothing. *(B-R6, B-R7)*
- **Cross-tenant AI-context leakage proof.** The PRD §9 property — the assembler is structurally incapable of reading another tenant's data — is proven over the real composition; cross-tenant audit completion is rejected (`AI_AUDIT_NOT_FOUND`). *(B-R7)*
- **No auto-send / human-review boundary preserved.** No send/dispatch/deliver path in any AI-runtime file; draft metadata carries no `status`/`sent*` fields; no structured artifact carries a `SENT` status or message reference. *(B-R5, B-R6, B-R7)*
- **Dedicated no-auto-send / human-approval lock.** The AI runtime has no send path and no message-delivery path; AI metadata is review-only and the AI audit lifecycle is not a delivery lifecycle; the fake provider cannot send; the human-approved reply-draft APPROVED/SENT capability is untouched; no route combines AI generation with send/message creation; human approval remains the only boundary to a customer. *(B-R8)*

---

## 6. Remaining Gates Before Real AI Provider / Production AI-Assisted Go-Live

These are **hard future gates**. Each must pass its own review before real customer data may enter an AI prompt in production. None is satisfied by this checkpoint.

- **Real provider adapter review.** A real model-provider SDK integrated **behind the B-R4 `AiProvider` interface** (plan B-H3), with the fake provider remaining the test default and no domain-logic change.
- **API-key / env secret handling review.** How provider credentials are stored, injected, rotated, and kept out of logs/audit; default-off and absent until explicitly enabled.
- **Token / usage cost guard.** Real per-business usage limits and spend controls before any real provider call.
- **Provider error handling.** Timeouts, rate limits, partial failures, and retries surfaced through the existing fail-closed result contract and the audit FAILED path.
- **Route-level generation wiring review.** A production route composing assembly → prompt → provider → audit → draft, replacing the deterministic SYSTEM stub only when `aiMode = AI_ASSISTED`.
- **Audit logging wired to the actual generation route.** The B-R6 audit/metadata path invoked on every real generation (start + success/failure), not only in tests.
- **Human approval UX verification.** The generate → review → edit → approve flow exercised end-to-end so no draft can reach a customer without explicit human approval.
- **Prompt-injection / untrusted user-message strategy.** A defined strategy before any customer/conversation/message content is ever introduced into a prompt (none is today).
- **PII / data-minimization review.** An explicit field allowlist for anything entering a prompt (plan B-H1), proven by test to exclude unneeded PII.
- **End-to-end QA with staging data.** A full staging exercise against realistic (non-production) data, default-off verified, before any real-data enablement.
- **Rollback / kill-switch drill.** A rehearsed procedure proving the kill switch (revert to `MANUAL`) disables generation business-wide without a deploy and that generation fails closed afterward.
- **CI-enforced real-DB AI-isolation gate (parity with A-R1.1).** A live-Postgres AI-isolation suite wired into the `RUN_INTEGRATION_TESTS` CI job and required by branch protection, complementing the domain-tier B-R7 proof.
- **Authz guard on a future `ai_drafts.send` consumer.** The dedicated B-R8 no-auto-send / human-approval lock is **closed at the domain (unit) tier** (PR #106 · `7f4eee0`) — it proves no AI-runtime or route path can send and that human approval is the only boundary today. When a real `ai_drafts.send` consumer is ever introduced, an authz-level guard on it must be added and proven green **before Level 2 is enabled for any real user**.

---

## 7. Area B Risk Status

> **B-R blocker suite (B-R1 → B-R8): CLOSED.** All eight blocker workstreams are merged to `main` with green tests (PRs #98–#106).

> **Foundational Area B AI runtime boundary: GREEN** for the implemented **fake-provider / provenance / isolation / no-auto-send** scope. Default-off enablement, verified-only provenance, tenant-scoped assembly, the provider seam, the §5.1 prompt guardrail, metadata-only audit, the cross-tenant isolation proof, and the dedicated no-auto-send / human-approval lock are built and proven against synthetic data.

> **Real-provider production AI-assisted go-live: NOT YET APPROVED.** No real provider, no route wiring, no PII/cost/observability/human-approval gates (§6) are complete. By the remediation plan's §8 rubric this is **not** the full real-data Level-2 GREEN — it is the foundational boundary closed for the built scope.

> **Level 3 / autonomous AI: OUT OF SCOPE / BLOCKED.** No auto-pilot mode exists; no auto-send path exists; future-only behind PRD-v1.0 S4 gates.

**Area A** remains CLOSED / GREEN (`AREA-A-closure-checkpoint.md`) and is reused as the tenant-isolation substrate, not re-litigated. **Area C** (public widget ingest) remains open and out of scope.

---

## 8. Validation Evidence

Local validation run for this checkpoint on `docs/update-area-b-checkpoint-b-r8` (docs-only working tree; no code/schema/test changes):

| Check | Command | Result |
| :--- | :--- | :--- |
| Types | `pnpm typecheck` | **PASS** — `tsc --noEmit`, no errors |
| Tests | `pnpm test` | **PASS** — **58 passed / 1 skipped** files; **2158 passed / 11 skipped** tests (2169 total) |
| Lint | `pnpm lint` | **PASS** — 0 errors, 20 warnings (all pre-existing `no-unused-vars`, none in Area B files) |

The single skipped test file is the Area A real-DB integration suite (`__tests__/integration/tenant-identity-repositories.integration.test.ts`), gated behind `RUN_INTEGRATION_TESTS` and run by the dedicated CI integration job — expected to be skipped in the default unit run.

Per-workstream counts (this checkpoint's run; all green):

| Workstream | Suite | Tests |
| :--- | :--- | :--- |
| B-R1 | `ai-config-resolver.test.ts` | 17 |
| B-R2 | `knowledge-context-store.test.ts` | 62 |
| B-R3 | `ai-runtime-context-assembler.test.ts` | 41 |
| B-R4 | `ai-runtime-provider.test.ts` | 63 |
| B-R5 | `ai-runtime-prompt-builder.test.ts` | 56 |
| B-R6 | `ai-runtime-audit-log.test.ts` | 57 |
| B-R7 | `ai-runtime-cross-tenant-isolation.test.ts` | 77 |
| B-R8 | `ai-runtime-no-auto-send-lock.test.ts` | 70 |
| **Total** | | **443** |

Validation notes per the relevant merged PRs:

- **B-R5 validation (PR #102).** Prompt-builder unit suite green: per-§5.1-category refusal/hedge coverage, `promptVersion` + deterministic `contextHash`, no PII/internal-id leakage into prompt text, fail-closed on invalid/oversized input. (Suite confirmed green in this checkpoint run: 56 tests.)
- **B-R6 validation (PR #103).** Audit/metadata suite green: metadata-only persistence (no raw prompt/text/PII columns), STARTED→SUCCEEDED/FAILED with terminal-state immutability, tenant scoping, email/phone redaction + bounding, review-only draft metadata, and an end-to-end integration with the real B-R5 builder + B-R4 fake provider. (57 tests.)
- **B-R7 validation (PR #104).** Cross-tenant isolation suite green over the real B-R1→B-R6 composition: assembler isolation, verified-only behavior, AI-off fail-closed (no provider/audit/draft), prompt-builder isolation on real assembler output, audit tenant isolation, no-auto-send boundary, and static scope guards over the production AI-runtime source. (77 tests.)
- **B-R8 validation (PR #106).** Dedicated no-auto-send / human-approval lock suite green: AI runtime has no send path and no message-delivery path, AI metadata is review-only, the AI audit lifecycle is not a delivery lifecycle, the fake provider cannot send, the human-approved reply-draft APPROVED/SENT capability is untouched, no route combines AI generation with send/message creation, and human approval remains the only boundary. (70 tests.)
- **Full-suite count.** 2158 passing tests this run; any exact numbers attributed to individual PRs beyond those reproduced here are as **reported in PR validation**.

No Prisma or migration commands were run; this checkpoint is documentation-only and changes no schema (see §9 and the final report).

---

## 9. Operational Instruction

Standing guidance for all subsequent work until the §6 gates are met:

- **Continue to keep AI default-off.** `Business.aiMode` stays `MANUAL` by default; no business is AI-enabled by deploy. The kill switch is "revert to `MANUAL`" — disables generation business-wide without a deploy, and the resolver fails closed thereafter.
- **Do not introduce a real provider SDK without a dedicated PR.** Any real model SDK must land behind the B-R4 `AiProvider` interface in its own reviewed PR (plan B-H3), with the fake provider remaining the test default and no new SDK dependency arriving early (statically guarded).
- **Do not wire route-level generation without audit / provenance / human-review checks.** A production generate path must compose the B-R3 assembler, the B-R5 prompt builder (with `promptVersion` + `contextHash`), and the B-R6 audit/metadata, and must preserve the human-review boundary.
- **Do not allow auto-send.** No path may transition a draft to `SENT` automatically or send an AI reply to a customer. Any future send path must be human-initiated only, and must keep the B-R8 lock green: the AI runtime keeps no send/message-delivery path, AI metadata stays review-only, and human approval remains the only boundary to a customer.
- **Preserve tenant isolation and the verified-context-only invariant.** The assembler must read `businessId` from the server context only; only `VERIFIED` business context may back definitive §5.1 claims; no customer/conversation/message content may enter AI context.
- **Treat B-R7 and B-R8 as the hard regression suites for future AI changes.** `__tests__/domains/ai-runtime-cross-tenant-isolation.test.ts` and `__tests__/domains/ai-runtime-no-auto-send-lock.test.ts` must stay green on every AI change; a regression that widens scope, trusts a client `businessId`, drops the `VERIFIED` pin, or introduces a send/message-delivery/PII path will fail one of them. Extend them (and add a CI-enforced real-DB variant per §6) before real-data enablement.

---

## 10. Final Checkpoint Statement

> **Area B B-R1 through B-R8 blocker/hardening suite is closed for the implemented foundational fake-provider / provenance / isolation / no-auto-send scope.** Real-provider production AI-assisted go-live remains **NOT YET APPROVED** pending the remaining §6 gates. The system is **not yet approved** for real-provider production AI-assisted operation until the future provider, route-wiring, PII, cost, observability, and human-approval gates (§6) are completed. AI remains default-off; no real model provider is integrated; no route-level generation is wired; no auto-send exists; Level 3 / autonomous AI is out of scope; and Area C (public widget ingest) is unchanged.

This document is now the **current status reference** for Area B. The Area B audit (`AREA-B-ai-runtime-provenance-audit.md`, RED) and remediation plan (`AREA-B-remediation-plan.md`, PROPOSED → executed) are preserved unchanged as historical context; their workstream completion is annotated against this checkpoint. PRD-v1.1, the schema, the tests, and CI are unchanged by this checkpoint.

---

*Area B closure checkpoint — B-R1→B-R8 blocker suite CLOSED and the foundational AI-runtime / provenance / isolation / no-auto-send boundary GREEN for the implemented fake-provider/provenance/isolation/no-auto-send scope, through PR #106, 2026-06-17. Real-provider production AI-assisted go-live remains NOT YET APPROVED pending the §6 gates. AI is default-off; no auto-send; Level 3 out of scope. Area A remains CLOSED/GREEN and is reused as the isolation substrate; Area C remains out of scope. PRD-v1.1, the Area B audit, and the Area B remediation plan are preserved as historical context.*
