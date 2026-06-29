# Area B — AI Runtime / Provenance Audit

**Product:** AiA Reception SaaS
**Scope:** AI Runtime · Tenant-Scoped AI Context · Verified/Unverified Provenance · `aiMode` / Kill Switch · Safe Level 2 Draft Generation
**Status:** AUDIT — evidence-based source verification
**Date:** 2026-06-15
**Audited at:** PR #95 (Area A closure checkpoint merged)
**Source of truth:** `docs/product/PRD-v1.1.md` (LOCKED, §5 / §5.1 / §9 / §16)
**Companion docs:** `docs/audits/AREA-A-closure-checkpoint.md` · `docs/audits/AREA-A-authorization.md` · `docs/audits/AREA-A-remediation-plan.md`

This is a **documentation-only audit**. It contains no code, no patches, and no migrations. It verifies the current backend against the PRD-v1.1 Area B requirements and classifies the gap into blockers vs. later hardening. PRD-v1.1, the schema, tests, and CI are unchanged. Current-implementation statements are labelled **[VERIFIED]** (read in source/schema), **[VERIFIED-TEST]** (confirmed by a test), or **[ABSENT]** (searched for; not present).

> **⚠ Superseded in part — operator send path shipped (2026-06-29).** This is a point-in-time RED record (2026-06-15) preserved as historical context; the **current status reference is `AREA-B-closure-checkpoint.md`.** Since this audit, a **human-gated operator "Send Approved Draft" path has shipped** (route `POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/:draftId/send`; in one DB transaction it claims `APPROVED → SENT`, creates one internal **OUTBOUND OPERATOR `Message`**, and links `sentMessageId`; content-free audits; gated by `ai_drafts.send`). Accordingly, the send-related findings below — **Q13 / §3** ("no send endpoint, no `sendDraft` method, no code transitions a draft to `SENT`, no `ai_drafts.send` consumer") and risk **B-9** ("no send path") — are **SUPERSEDED**: that path now exists and is consumed, human-initiated only. **What still holds:** there is **no AI-initiated / auto-send path** (B-R8 green; the AI runtime itself has no send / message-delivery path), and **external channel delivery (WhatsApp/email/SMS/etc.) remains unimplemented** — the shipped path writes an internal `Message` record only. The no-auto-send guarantee that B-9 / B-10 recommended preserving was realized by an `ai_drafts.send`-gated handler plus tests.

---

## 1. Executive Verdict

> **Real-data AI-assisted alpha readiness (Area B): RED.**

There is **no Area B AI runtime in the repository today.** No model provider integration exists, no prompt/context builder exists, no `Business.aiMode` / kill switch exists, no verified business-context / provenance model exists, and no AI-context isolation test exists. "Reply draft generation" is a **deterministic SYSTEM stub** (a hardcoded string), not AI. The PRD-v1.1 §9 hard gate — *"AI context assembly must be proven tenant-isolated before real customer data is used in AI prompts"* — is therefore **not met**, because the thing to be proven does not yet exist.

**Important nuance — this is a "clean" RED, not an active-leak RED.** Precisely *because* no AI runtime exists, there is **zero current real-data AI exposure**: no customer PII enters any model prompt today (there are no prompts and no provider), and the system runs fully and safely at **Level 1 — Manual Mode**. The RED is entirely **prospective**: it describes what must be built and proven *before* AI may touch real customer data, not a hole open right now.

**Area A is closed and GREEN; Area B is separate and RED.** Area A (backend authorization / tenant isolation) was closed through PR #95 (`AREA-A-closure-checkpoint.md`). That GREEN verdict covers the authenticated operator/admin data plane only. **Enabling AI does not inherit Area A's GREEN.** Area B is a distinct gate with its own blockers; the Area A tenant-isolation foundation (`TenantRequestContext`) is the correct *substrate* for AI context assembly, but assembling, prompting, and provenance-gating that context are unbuilt and unproven.

| Question | Answer |
| :---- | :---- |
| Does real customer PII enter AI prompts today? | **No** — there are no AI prompts and no provider. [VERIFIED / ABSENT] |
| Is the system safe to operate at Level 1 (Manual) now? | **Yes** — manual draft/review/approve works; no AI path. [VERIFIED] |
| Is the system ready for real-data Level 2 (AI-Assisted)? | **No (RED)** — entire Area B runtime + provenance + isolation proof is unbuilt. |
| Can AI auto-send to customers today? | **No** — there is no AI-initiated / auto-send path, and no external customer-delivery path. (As of the 2026-06-15 audit, *no* send path existed at all; as of 2026-06-29 a **human-gated** operator send path exists that writes only an internal `Message` — see the superseding banner above and §3, Q13.) [VERIFIED] |

---

## 2. Source-of-Truth Requirements (PRD-v1.1)

**AI Operating Levels (§5).** Three product-facing levels mapped onto S0–S4 engineering stages (Level 1 ↔ S0, Level 2 ↔ S2 + thin business-context slice / partial S3, Level 3 ↔ S4):

- **Level 1 — Manual Mode.** AI does not generate customer replies; humans write and send. **Mandatory fallback and substrate — the system must work fully if AI is disabled.**
- **Level 2 — AI-Assisted / Half Pilot Mode (private-alpha target).** AI generates *draft* replies; a human operator reviews, edits, approves, and sends. **No direct AI-to-customer sending.** Runs **behind feature flags / kill switches**, per-business enablement.
- **Level 3 — Auto Pilot Mode (future-only).** AI replies to customers end-to-end. **Cannot be enabled before PRD-v1.0 S4 gates pass.** Out of alpha scope.

**AI mode resolution (§5).** Resolved at the **business level** (Level 1 or Level 2); per-business is the alpha default. Architecture must not block future per-conversation / per-operator / per-channel / feature-flag overrides.

**No auto-send / human approval (§5, §5.1).** No direct AI-to-customer sending in alpha; a human must review, (edit,) approve, and send **every** reply. Auto-send belongs to Level 3 / S4 (future).

**Verified/unverified provenance (§5.1) — build-critical for Area B.** AI drafts must **not** make definitive claims about price, property availability, ROI, investment guarantees, legal/regulatory requirements, mortgage/financing, commissions, or contracts **unless that information is explicitly present in verified business-provided context.** "Verified business-provided context" = business-entered profile / FAQ / minimal knowledge slice / business-provided structured information. It explicitly does **not** mean model-prior knowledge, AI inference, unverified external data, assumptions, or scraped/guessed market data. Where verified context is missing, the draft must hedge / defer to the operator / ask for confirmation / avoid fabrication. **This implies the business-context slice must carry a verified/unverified provenance signal** so drafts can refuse definitive claims when verified context is absent. The pattern is a platform guardrail (generalizes to medical/financial verticals), not a real-estate-only feature.

**Tenant-scoped AI context (§9) — hard pre-real-data gate.** AI context assembly must be **proven tenant-isolated** before real customer data is used in AI prompts: the AI must be **structurally incapable of reading another tenant's data.** Area A tenant isolation is the foundation to reuse.

**`aiMode` / kill switch (§5).** Per-business AI enablement with feature flags / kill switches is a stated Level 2 requirement.

**Real-estate vertical-sensitive content boundaries (§5.1, §16).** Real-estate-first **raises the bar** on Area B: the §5.1 content boundaries become **build-critical, not optional**, because real-estate data carries financial intent and PII.

---

## 3. Current Implementation Reality

The fifteen audit questions, answered against source.

**Q1 — What AI/runtime functionality exists today?** **Effectively none that is executable.**
- `src/domains/ai-runtime/`, `src/domains/ai-config/`, and `src/domains/knowledge/` are **README-only scaffolds** — they declare intended ownership (provider abstraction, prompt templates, knowledge/FAQ) but contain **zero code**. [VERIFIED]
- A reply-draft lifecycle exists (`generate` stub, `current`, `edit`, `discard`, `approve`) under `src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/**`, plus `src/domains/reply-drafts/`. It is deterministic (see Q2). [VERIFIED]
- Schema carries forward-looking **placeholders only**: `Conversation.aiClassificationStatus` / `aiDraftStatus` are workflow-state enums; `ReplyDraftSource.AI`, `MessageSenderType.AI_RECEPTIONIST`, and `AuditActorType.AI_RECEPTIONIST` are enum values that nothing currently produces. [VERIFIED: `prisma/schema.prisma`]

**Q2 — Real AI or deterministic stubs?** **Deterministic stubs.** The generate handler writes a hardcoded constant `STUB_DRAFT_TEXT = "Thanks for your message…"` and is documented "Generates a deterministic SYSTEM stub… Does NOT use LLM." `createSystemDraft` hardcodes `source: 'SYSTEM'`. [VERIFIED: `reply-drafts/generate/handler.ts:37`, `reply-drafts/repository.ts:347`]

**Q3 — Any model provider integration?** **None.** `package.json` has no AI/LLM SDK (dependencies are `@auth/prisma-adapter`, `@prisma/*`, `next`, `next-auth`, `pg`, `react`, `zod`). `ReplyDraft.modelProvider` / `modelName` / `promptVersion` columns exist but are **never written** (always null). [VERIFIED / ABSENT]

**Q4 — Does real customer PII currently enter AI prompts?** **No.** There are no prompts and no model calls anywhere in `src`; no code path assembles customer data into model input. Current real-data AI exposure is **zero**. [VERIFIED / ABSENT]

**Q5 — Is there a `Business.aiMode` or kill switch?** **No.** `Business` has `status` / `timezone` / `locale` only; `grep` for `aiMode` / `ai_mode` / `killSwitch` across `src` returns nothing. The §5 per-business Level 1/2 resolution is unimplemented. [ABSENT: `prisma/schema.prisma:189`, `src/**`]

**Q6 — Tenant-scoped AI context assembly?** **No.** No context assembler exists. The Area A substrate is present and correct — `TenantRequestContext{userId, businessId, membershipId, role}` (`request-context.ts:51`) — but nothing reads it to assemble an AI context. [VERIFIED substrate / ABSENT assembler]

**Q7 — Verified/unverified provenance on business context?** **No — and there is no business-context store at all.** The Knowledge domain (profile / FAQ / knowledge slice) is a README-only scaffold; no schema model holds business-provided context, so there is nothing to tag with provenance. (`CustomerContactMethod.verified` is contact-method verification of a phone/email, unrelated to context provenance.) [ABSENT]

**Q8 — Prompt/context builder?** **None.** `grep` for `buildPrompt` / `promptBuilder` / `assembleContext` / `systemPrompt` across `src` returns nothing. [ABSENT]

**Q9 — AI provider abstraction?** **None built.** Only the `ai-runtime` README names the intended "provider interface / adapter abstraction." No interface, no adapter, no fake provider exists. [ABSENT]

**Q10 — Audit logging for AI draft generation?** **Infrastructure yes; AI-generation logging no.** An `AuditEvent` model + audit service exist, and `approve` emits an `ai_draft.approved` event (actor `USER`). But **`generate` emits no audit event**, and there is no AI-generation audit (no generation occurs). `AuditActorType.AI_RECEPTIONIST` exists but is unused. [VERIFIED: `approve/handler.ts:205`; ABSENT for generation]

**Q11 — Data minimization for prompt context?** **N/A today / unimplemented.** No prompt context is built, so nothing is minimized. This becomes required the moment a context assembler carries customer/business data into a prompt. [ABSENT]

**Q12 — Protection against cross-tenant prompt-context leakage?** **No AI-specific protection, because no AI context exists.** Area A tenant isolation is GREEN and is the correct foundation, but there is no AI-context-assembly isolation test (the §9 AI gate) because there is no AI context to test. [ABSENT]

**Q13 — Is the system structurally unable to auto-send AI replies?** **Yes — no *AI-initiated* / auto-send path exists.** *(Send-path specifics below are **SUPERSEDED 2026-06-29** — a human-gated operator send path has since shipped; see the superseding banner above. The AI-initiated / auto-send answer is unchanged: still No.)*
- *As of the 2026-06-15 audit:* No send endpoint, no `sendDraft` repository method, and **no code transitions a draft to `SENT`** anywhere in `src`. `approveDraft` is documented and implemented to "**Does NOT create a Message. Does NOT call any provider.**" The repository `update` type could not even write `sentMessageId` / `sentAt` / `sentByUserId`. **[SUPERSEDED 2026-06-29:** a human-gated `sendApprovedDraft` repository method + send route now transition `APPROVED → SENT` and create one internal OUTBOUND OPERATOR `Message` atomically; `approveDraft` itself still creates no Message.] [VERIFIED at audit time: `reply-drafts/repository.ts:213`, `:113`]
- **Caveat (now realized):** the RBAC catalog **defines and grants** `ai_drafts.send` (to OPERATOR/ADMIN/OWNER, and it is in `SENSITIVE_PERMISSIONS`). At audit time **no handler consumed it** — forward-scaffolding for a future human-initiated send path. **[UPDATED 2026-06-29:** it is now consumed by the operator send handler, which is **human-initiated only** (never an automatic trigger) and pinned by tests — exactly the guard this caveat asked for.] [VERIFIED: `authz/permissions.ts:39,64`]

**Q14 — What remains required before real-data AI-assisted alpha?** The entire Area B runtime: `aiMode`/kill switch; a verified business-context store with provenance; a tenant-scoped context assembler; a provider abstraction; a prompt builder enforcing §5.1 refusal rules; an AI-generation audit log; data minimization; and a **proven** cross-tenant AI-context isolation test suite. The human-approval boundary and the no-auto-send property already exist and must be **preserved**. (Detailed in §5–§6.)

**Q15 — Which are blockers vs. later hardening?** Summarized in the §4 risk matrix and sequenced in §6. Blockers: aiMode/kill switch, verified-context+provenance model, tenant-scoped assembler, prompt builder with refusal rules, provider abstraction, AI-generation audit, and the cross-tenant isolation proof. Later hardening: data-minimization refinement, multi-vertical generalization, per-conversation/operator/channel overrides, and retrieval/eval/confidence scaffolding (toward Level 3).

**Architecture note (positive).** The seams are pre-declared and clean: the three AI domains have stated boundaries (`ai-runtime` / `ai-config` / `knowledge`), the composition root (`composition.ts`) is straightforward DI where AI dependencies plug in, and `TenantRequestContext` gives a ready tenant key. Area B is **net-new build against good seams**, not a redesign.

---

## 4. Risk Matrix

Classification key: **BLOCKER** (must close before real customer data enters any AI prompt) · **SHOULD_DO_BEFORE_ALPHA** (strongly recommended before real-data Level 2) · **LATER** (post-alpha / pre-scale / Level 3).

| ID | Risk | Current status | Severity | Classification | Evidence | Recommended action |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| B-1 | No per-business `aiMode` / kill switch — AI cannot be gated or disabled per business | ABSENT | High | **BLOCKER** | `schema.prisma:189`; no `aiMode` in `src` | Add `Business.aiMode` (default Level 1) + resolution + kill switch; AI paths fail closed when off |
| B-2 | No verified business-context store + provenance — drafts could make definitive vertical-sensitive claims without verified context | ABSENT | Critical | **BLOCKER** | Knowledge domain README-only; no model | Add a minimal verified business-context slice with a `verified` provenance flag (PRD §5.1) |
| B-3 | No tenant-scoped AI context assembler — cross-tenant context risk once AI is built | ABSENT | Critical | **BLOCKER** | no assembler in `src`; substrate `request-context.ts:51` | Build assembler keyed strictly on `TenantRequestContext.businessId`; never trust client input |
| B-4 | No prompt builder with provenance-aware refusal rules — §5.1 boundary unenforceable | ABSENT | Critical | **BLOCKER** | no prompt builder in `src` | Build prompt assembly that injects only verified context and hedges/defers when absent |
| B-5 | No provider abstraction — risk of SDK hardcoding, vendor lock, untestable generation | ABSENT (README intent only) | High | **BLOCKER** | `ai-runtime/README.md`; no SDK in `package.json` | Define a provider interface + a deterministic fake provider for tests before any real SDK |
| B-6 | No AI-generation audit log / unused model-metadata columns — no traceability of model/prompt/version per draft | Partial (audit infra exists; generation unlogged) | High | **BLOCKER** | `approve/handler.ts:205` logs approve only; `modelProvider/Name/promptVersion` null | Log every generation (actor `AI_RECEPTIONIST`, model, promptVersion, provenance) + populate draft metadata |
| B-7 | No cross-tenant AI-context-leakage proof — PRD §9 hard gate unmet | ABSENT | Critical | **BLOCKER** | §9; no AI isolation test | Add real-DB gated suite proving business-A AI context cannot read business-B data |
| B-8 | No data minimization for prompt context — over-broad PII into prompts once assembly exists | ABSENT (N/A today) | Medium | **SHOULD_DO_BEFORE_ALPHA** | no assembler yet | Define an explicit allowlist of fields entering prompts; exclude unneeded PII |
| B-9 | `ai_drafts.send` granted but no send path — future send path could be wired to auto-trigger | ~~Forward-scaffolding; currently inert~~ **RESOLVED 2026-06-29: human-gated operator send path shipped, consumed by an `ai_drafts.send` handler; no auto-trigger** | Medium | **SHOULD_DO_BEFORE_ALPHA** → **DONE (human-gated)** | `authz/permissions.ts:39,64`; consumed by the send route handler | ~~Add a guard/test asserting send is human-initiated only and never auto-invoked~~ **Done:** send is human-initiated only, pinned by tests; no-auto-send preserved (B-R8 green) |
| B-10 | Human-approval / no-auto-send property is convention, not locked by an AI-specific test | Holds today (structural) | Medium | **SHOULD_DO_BEFORE_ALPHA** | `repository.ts:213` | Add tests pinning: approve creates no Message; no draft auto-progresses to SENT |
| B-11 | Multi-vertical generalization of §5.1 refusal rules; retrieval/eval/confidence scaffolding | ABSENT | Low | **LATER** | §5.1 (platform guardrail); §5 Level 3 | Generalize refusal categories post-alpha; defer eval/confidence gating to Level 3 / S4 |
| B-12 | Per-conversation / per-operator / per-channel `aiMode` overrides | ABSENT (not required for alpha) | Low | **LATER** | §5 ("must not block" future overrides) | Keep `aiMode` resolution shaped to allow overrides later; do not build now |

---

## 5. Required Minimum Area B Architecture

The minimum that must exist and be proven **before real customer data enters any AI prompt** (Level 2 / real-data alpha). Each maps to a workstream in §6.

1. **Business `aiMode` / kill switch (B-1).** A per-business mode (Level 1 / Level 2), **default Level 1**, resolved server-side. Every AI path checks it and **fails closed** when AI is off. A kill switch disables generation business-wide (and ideally globally) without a deploy.
2. **Verified/unverified business-context store (B-2).** A minimal business-context slice (profile / FAQ / structured fields) where each item carries a **`verified` provenance flag**. This is the *only* source from which the AI may make definitive vertical-sensitive claims (§5.1).
3. **Tenant-scoped AI context assembler (B-3).** Assembles the prompt context **strictly from `TenantRequestContext.businessId`** (reusing Area A), pulling only that business's conversation/customer/verified-context rows. Client-supplied `businessId` is never trusted. Structurally incapable of reading another tenant's data.
4. **Prompt builder with provenance-aware refusal rules (B-4).** Injects only verified context; tags unverified/missing context; instructs the model to hedge, defer to the operator, or ask for confirmation rather than fabricate definitive claims on the §5.1 categories.
5. **Model/provider abstraction (B-5).** A provider interface with no SDK hardcoded into domain logic, plus a **deterministic fake provider** so the runtime is testable without a live model and without spend. Vendor selection is deferred; only the seam is required.
6. **AI generation audit log (B-6).** Every generation emits an `AuditEvent` (actor `AI_RECEPTIONIST`) recording business, conversation, model provider/name, prompt version, and context provenance; the resulting `ReplyDraft` records `source = AI` and its model metadata columns.
7. **Data minimization (B-8).** An explicit allowlist of fields permitted into a prompt; unneeded PII is excluded by construction.
8. **Cross-tenant context-leakage tests (B-7).** A real-DB, gated suite (mirroring the Area A integration harness) proving business-A AI context assembly cannot read/inject business-B data, and that `aiMode`-off fails closed — the PRD §9 AI gate evidence.
9. **Human-approval boundary (B-10).** Preserved: generate → review/edit → approve remains human-driven; AI never approves.
10. **No-auto-send guarantee (B-9, B-10).** Preserved and pinned by test: no AI-initiated send; any future send path is human-initiated only and gated by `ai_drafts.send`.

Out of this minimum (explicitly **not** required for alpha): a real vendor choice, retrieval/RAG, confidence/risk scoring, evaluation harnesses, and Level 3 auto-send controls.

---

## 6. Recommended Implementation Sequence

PR-sized tasks. `B-R*` = required Area B runtime (blockers); `B-H*` = hardening / later. Sequence respects dependencies: enablement gate → context + provenance → assembler → provider → prompt rules → audit → isolation proof, then hardening.

### B-R1 — Business `aiMode` + Kill Switch  *(BLOCKER)*
- **Purpose.** Per-business AI enablement (default **Level 1**) with a kill switch; AI paths fail closed when off.
- **Files likely touched.** `prisma/schema.prisma` (+ migration), `src/domains/tenancy/*` or a new `ai-config` resolver, `reply-drafts/generate/handler.ts` (gate check).
- **Acceptance criteria.** A business defaults to Level 1; switching to Level 2 is server-side only; with AI off, generation paths return a clean "AI disabled" result and never call a provider.
- **Tests required.** Unit: default mode; off → fail closed; on → allowed.
- **Blocker:** Yes.

### B-R2 — Verified Business-Context Store + Provenance  *(BLOCKER)*
- **Purpose.** A minimal business-context slice (profile / FAQ / structured fields) with a per-item `verified` provenance flag (§5.1).
- **Files likely touched.** `prisma/schema.prisma` (+ migration), new `src/domains/knowledge/*` (repository/service/types), `composition.ts`.
- **Acceptance criteria.** Context items are stored per business and carry verified/unverified provenance; only verified items are eligible to back definitive claims.
- **Tests required.** Unit: CRUD + provenance flag; tenant-scoped reads.
- **Blocker:** Yes.

### B-R3 — Tenant-Scoped AI Context Assembler  *(BLOCKER)*
- **Purpose.** Assemble prompt context strictly from `TenantRequestContext.businessId`, reusing Area A isolation.
- **Files likely touched.** new `src/domains/ai-runtime/*` (assembler), reads CRM/conversations/knowledge repositories (all `businessId`-scoped).
- **Acceptance criteria.** Assembler accepts a tenant context, never a raw client `businessId`; returns only that business's rows; provenance-tagged.
- **Tests required.** Unit + a cross-tenant negative (feeds into B-R7).
- **Blocker:** Yes.

### B-R4 — Provider Abstraction + Fake Provider  *(BLOCKER)*
- **Purpose.** A provider interface with no hardcoded SDK, plus a deterministic fake for tests.
- **Files likely touched.** new `src/domains/ai-runtime/provider/*`, `composition.ts`.
- **Acceptance criteria.** Runtime depends only on the interface; a fake provider yields deterministic output; no real SDK added yet.
- **Tests required.** Unit against the fake provider.
- **Blocker:** Yes (foundation for safe, testable generation).

### B-R5 — Prompt Builder with Provenance-Aware Refusal Rules  *(BLOCKER)*
- **Purpose.** Enforce §5.1: definitive vertical-sensitive claims only from verified context; otherwise hedge/defer.
- **Files likely touched.** new `src/domains/ai-config/*` (prompt templates + versioning), `ai-runtime` assembler integration.
- **Acceptance criteria.** Prompt includes only verified context for definitive claims; missing/unverified context produces a hedging/deferring instruction; prompt version recorded.
- **Tests required.** Unit: verified-present → claim allowed; verified-absent → refusal/hedge for each §5.1 category.
- **Blocker:** Yes.

### B-R6 — AI Generation Audit Log + Draft Metadata  *(BLOCKER)*
- **Purpose.** Traceability: log every generation; populate `ReplyDraft.source=AI` + model metadata.
- **Files likely touched.** `reply-drafts/generate/handler.ts` (real path), `reply-drafts/repository.ts`, `audit` service.
- **Acceptance criteria.** Each generation emits an `AuditEvent` (actor `AI_RECEPTIONIST`) with provider/model/promptVersion/provenance; draft rows carry that metadata.
- **Tests required.** Unit: audit emitted on generate; metadata persisted.
- **Blocker:** Yes.

### B-R7 — Cross-Tenant AI-Context Isolation Test Suite  *(BLOCKER — PRD §9 AI gate)*
- **Purpose.** Prove AI context assembly is structurally tenant-isolated and `aiMode`-off fails closed.
- **Files likely touched.** `__tests__/integration/*` (gated, mirroring Area A), CI wiring.
- **Acceptance criteria.** Green real-DB suite: business-A AI context cannot read/inject business-B data; AI-off → no provider call; runs behind the integration gate in CI.
- **Tests required.** This workstream *is* the suite (≥2 cross-tenant cases + fail-closed cases).
- **Blocker:** Yes.

### B-R8 — No-Auto-Send + Human-Approval Lock  *(SHOULD_DO_BEFORE_ALPHA)*
- **Purpose.** Pin the existing structural guarantees so future work cannot regress them.
- **Files likely touched.** `__tests__/**`; optionally an authz guard around any future send path.
- **Acceptance criteria.** Tests assert approve creates no Message, no path auto-transitions to `SENT`, and `ai_drafts.send` (when consumed) requires a human actor.
- **Tests required.** Negative/meta tests.
- **Blocker:** No (strong pre-alpha hardening).

### B-H1 — Data-Minimization Policy  *(LATER / pre-alpha hardening)*
- **Purpose.** Explicit field allowlist for prompt context.
- **Acceptance criteria.** Only allowlisted fields enter a prompt; excluded PII proven absent by test. **Blocker:** No.

### B-H2 — Multi-Vertical Refusal Generalization & Retrieval/Eval Scaffolding  *(LATER)*
- **Purpose.** Generalize §5.1 categories beyond real estate; scaffold retrieval/interaction logs and (later) confidence/eval toward Level 3.
- **Acceptance criteria.** Refusal categories configurable; retrieval logs structured. **Blocker:** No (post-alpha; Level 3 gates are separate).

---

## 7. Recommended Next Task

**Exactly one: create the Area B remediation plan** — `docs/audits/AREA-B-remediation-plan.md` — sequencing B-R1…B-R8 (+ B-H*) into ordered, acceptance-criteria-driven, owner-approvable PRs with per-task risk and recommended models, exactly as Area A proceeded (audit → remediation plan → execution).

**Rationale (evidence-driven).** The gap here is broad and entirely net-new (no runtime, no provider, no provenance model, no isolation proof), and it spans schema + new domains + a hard §9 isolation gate. That breadth needs sequencing and owner sign-off before code, not an ad-hoc first commit. The remediation plan should name **B-R1 (`Business.aiMode` + kill switch)** as the **first implementation task**, because a per-business, default-**off** kill switch lets all subsequent Area B work be developed and tested **behind a gate** with no risk to real data — making every later step safe to build incrementally.

---

## 8. Scope Guard — What This Audit Does Not Cover

- **Public widget / ingest isolation (Area C).** Out of scope except where it bears on the AI context boundary (a future widget-sourced conversation must still be assembled tenant-scoped). Widget-key → business mapping and public-ingest security remain Area C.
- **Real model-provider vendor selection.** Out of scope beyond requiring a provider *abstraction* + a test fake. No SDK is endorsed or added here.
- **Auto-send / Level 3 Auto Pilot.** Out of scope; future-only, gated behind PRD-v1.0 S4. This audit only requires preserving the existing no-auto-send property.
- **Full vertical-specific real-estate workflow.** Out of scope; only the §5.1 content-boundary guardrail is in scope, as a general platform pattern.
- **MCP / third-party integrations.** Out of scope (PRD §14, future).
- **Area A re-audit.** Out of scope; Area A is closed/GREEN (`AREA-A-closure-checkpoint.md`) and is reused as the isolation substrate, not re-litigated.
- **No code/schema/test/CI changes.** This is a documentation-only audit; nothing in the application, schema, tests, or CI is modified.

---

*Area B AI runtime / provenance audit — RED for real-data AI-assisted alpha, 2026-06-15. No AI runtime exists yet, so there is no current real-data AI exposure and Level 1 manual operation is safe; the entire Area B runtime + provenance + isolation proof must be built and proven before real customer data enters any AI prompt. Area A remains closed/GREEN and separate. PRD-v1.1, the schema, tests, and CI are unchanged.*
