# Area B — AI Runtime / Provenance Remediation Plan

**Product:** AiA Reception SaaS
**Scope:** AI Runtime · Tenant-Scoped AI Context · Verified/Unverified Provenance · `aiMode` / Kill Switch · Safe Level 2 Draft Generation
**Status:** PROPOSED
**Date:** 2026-06-15
**Audited at:** PR #96 (Area B audit merged)
**Source documents:** `docs/product/PRD-v1.1.md` (LOCKED, §5 / §5.1 / §9 / §16) · `docs/audits/AREA-B-ai-runtime-provenance-audit.md` (RED) · `docs/audits/AREA-A-closure-checkpoint.md` (Area A CLOSED/GREEN) · `docs/audits/AREA-A-remediation-plan.md` (formatting/structure reference only)

This is a **documentation-only planning artifact**. It contains no code, no patches, no schema, no migrations, and no Claude Code prompts. It converts the Area B audit (`AREA-B-ai-runtime-provenance-audit.md`, verdict **RED**) into an execution-ready, PR-by-PR remediation plan. It does **not** implement Area B, does **not** add schema/code/tests, does **not** mark Area B GREEN, and does **not** declare the product real-data-ready. PRD-v1.1, the schema, the tests, and CI are unchanged.

---

## 1. Executive Summary

**Where things stand.**

- **Area A is closed and GREEN.** Backend authorization / tenant isolation (RBAC + ABAC + real-DB cross-tenant proof) closed through PR #94 and is recorded in `AREA-A-closure-checkpoint.md`. `TenantRequestContext{userId, businessId, membershipId, role}` is the verified isolation substrate Area B reuses. Enabling AI does **not** inherit Area A's GREEN — Area B is a distinct gate.
- **Area B is RED for real-data AI-assisted alpha.** Per `AREA-B-ai-runtime-provenance-audit.md`, there is **no AI runtime in the repository today**: no model provider, no prompt/context builder, no `Business.aiMode` / kill switch, no verified business-context / provenance model, and no AI-context isolation test. "Reply draft generation" is a **deterministic SYSTEM stub** (a hardcoded constant), not AI. The PRD-v1.1 §9 hard gate — *AI context assembly must be proven tenant-isolated before real customer data enters AI prompts* — is unmet because the thing to prove does not yet exist.
- **This is a clean RED, not an active leak.** Precisely because no AI runtime exists, **zero** real customer PII enters any model prompt today, and the system runs fully and safely at **Level 1 — Manual Mode**. The RED is entirely prospective: it describes what must be built and proven *before* AI may touch real customer data.
- **What this plan does.** It sequences the work — `B-R1…B-R8` blockers plus `B-H*` hardening — required **before** real customer data may enter AI prompts, into ordered, acceptance-criteria-driven, owner-approvable PRs, mirroring how Area A proceeded (audit → remediation plan → execution).
- **What this plan does not do.** It is **documentation-only**. It implements no runtime changes, adds no schema/code/tests/CI, does not mark Area B GREEN, does not declare full-product real-data readiness, and does not enable AI. AI remains **default-off** until explicitly enabled per business via `Business.aiMode` / kill switch.

---

## 2. Gate Policy

### 2.1 The hard gate

> **No real customer PII enters any AI prompt until every BLOCKER task below is complete, tested, and its tests are green in CI, and the cross-tenant AI-context isolation suite (B-R7) proves the assembler is structurally tenant-isolated and fails closed when AI is disabled.**

This is the PRD-v1.1 §9 gate applied to the AI runtime. Until it is met, the system operates at **Level 1 — Manual Mode** only, and any AI runtime built under this plan runs against **synthetic / test-business data only**, behind a **default-off** per-business switch.

### 2.2 Standing invariants (must hold at every step)

- **AI default-off.** AI is off unless explicitly enabled per business via `Business.aiMode` (default Level 1) and the kill switch. Generation **fails closed** when disabled — no provider call, clean "AI disabled" result.
- **No PII before B-R7 green.** No customer PII may enter an AI prompt until the B-R7 AI-context isolation gate is green in CI.
- **No auto-send before S4 / Level 3.** No direct AI-to-customer sending under any configuration in alpha. Auto-send belongs to Level 3 / S4 (future-only).
- **Human review/approval mandatory for Level 2.** Generate → review → (edit) → approve → send remains human-driven. AI never approves and never sends.
- **Area C widget ingest is out of scope** except as a dependency note (a future widget-sourced conversation must still be assembled tenant-scoped).

### 2.3 Blocker classification

Key: **BLOCKER** (must close before real customer data enters any AI prompt) · **SHOULD_DO_BEFORE_ALPHA** (strongly recommended before real-data Level 2) · **LATER** (post-alpha / pre-scale / Level 3). Classification is deliberately conservative.

| ID | Task | Classification |
| :---- | :---- | :---- |
| B-R1 | Business `aiMode` + default-off kill switch | **BLOCKER** |
| B-R2 | Verified business-context store + provenance | **BLOCKER** |
| B-R3 | Tenant-scoped AI context assembler | **BLOCKER** |
| B-R4 | Provider abstraction + deterministic fake provider | **BLOCKER** |
| B-R5 | Prompt builder with provenance-aware refusal rules | **BLOCKER** |
| B-R6 | AI generation audit log + draft metadata | **BLOCKER** |
| B-R7 | Cross-tenant AI-context isolation test suite | **BLOCKER** (PRD §9 AI gate) |
| B-R8 | No-auto-send + human-approval lock | **SHOULD_DO_BEFORE_ALPHA** |
| B-H1 | Data-minimization policy | **SHOULD_DO_BEFORE_ALPHA** — *IMPLEMENTED for the current fake-provider AI-runtime scope (PR #123 spec + PR #124 enforcement); see the B-H1 entry below* |
| B-H2 | Multi-vertical refusal generalization | **LATER** |
| B-H3 | Provider vendor integration (after fake provider) | **LATER** |
| B-H4 | Evaluation / confidence / risk scoring | **LATER** |
| B-H5 | Per-conversation / per-channel / per-operator `aiMode` override | **LATER** |

**Conservative-classification note.** B-R8 is classified SHOULD_DO_BEFORE_ALPHA only because the no-auto-send / human-approval property already holds **structurally** today (no send path exists; `approveDraft` creates no Message). It is nonetheless treated as a **hard pre-Level-2-enablement gate**: the property must be **pinned by an AI-specific test** before Level 2 is enabled for any real user, so future work cannot silently regress it. B-H1 (data minimization) is likewise SHOULD_DO_BEFORE_ALPHA: the moment a context assembler carries customer/business data into a prompt, an explicit field allowlist is expected, not optional.

---

## 3. Dependency Graph

The ordering is driven by safety dependencies, not convenience. The chain is: **enablement gate → context + provenance → assembler → provider → prompt rules → audit → isolation proof → send-lock**, then hardening.

```
B-R1 (aiMode + default-off kill switch)         ← FIRST: creates the safety gate
  │
  ├─► B-R2 (verified business-context + provenance)
  │       │
  │       └─► B-R5 (prompt builder + refusal rules)   [needs provenance data]
  │
  ├─► B-R3 (tenant-scoped assembler)
  │       │
  │       ├─► B-R5 (prompt builder)                   [prompt consumes assembled context]
  │       │
  │       └─► B-R7 (cross-tenant isolation suite)     [must test the real assembler]
  │
  ├─► B-R4 (provider abstraction + fake provider)
  │       │
  │       └─► B-R6 (generation audit + draft metadata)[real generation path]
  │
  └─► B-R6 ──► B-R7 (isolation + fail-closed proof)
                 │
                 └─► B-R8 (no-auto-send + approval lock)  ← before Level 2 for real users
```

**Why this order:**

1. **B-R1 first**, because it creates the default-off safety gate. With a per-business, default-**Level 1**, kill-switched enablement that fails closed, every subsequent task can be developed and tested **behind a gate** with zero risk to real data.
2. **B-R2 before B-R5**, because the prompt's provenance-aware refusal rules need verified/unverified provenance data to act on. There is nothing for B-R5 to gate on until the verified-context store exists.
3. **B-R3 before B-R7**, because the cross-tenant isolation suite must test the **actual assembler**. Building the §9 proof before the thing it proves exists is meaningless.
4. **B-R4 before real generation**, because the provider abstraction + deterministic fake provider make generation **testable without a live model and without spend**, and keep tests deterministic.
5. **B-R5 before provider-generated drafts touch real customer context**, because the §5.1 content boundaries (refuse/hedge/defer when verified context is absent) must be enforced in the prompt before any generated draft is allowed to reference real customer or business data.
6. **B-R6 before any generated draft is persisted as AI output**, so every generation is traceable (actor `AI_RECEPTIONIST`, provider/model/promptVersion/provenance) and `ReplyDraft.source = AI` carries model metadata from the first real generation.
7. **B-R7 before any real customer data enters prompts** — it is the PRD §9 hard gate: structural tenant isolation proven on real DB, plus fail-closed proof that AI-off makes no provider call.
8. **B-R8 before enabling Level 2 for real users**, so the no-auto-send / human-approval property is locked by test before any operator can act on AI drafts.

B-R2, B-R3, and B-R4 are mutually independent and may proceed in parallel after B-R1, subject to the convergence points above (B-R5 needs B-R2 + B-R3; B-R6 needs B-R4; B-R7 needs B-R3 + B-R6).

---

## 4. PR-Sized Implementation Tasks

`B-R*` = required Area B runtime (blockers / pre-alpha); `B-H*` = hardening / later. Each task is a single, owner-approvable PR. **None of these are implemented in this document.**

---

### B-R1 — Business `aiMode` + default-off kill switch

- **Classification.** BLOCKER. (PRD-v1.1 §5; audit B-1.)
- **Purpose.** Per-business AI enablement (default **Level 1 / OFF**) with a kill switch, resolved server-side. Every AI path checks it and **fails closed** when AI is off. This is the safety gate every later task builds behind.
- **Files likely touched.** `prisma/schema.prisma` (+ migration: add `Business.aiMode` enum), a server-side resolver (new `src/domains/ai-config/*` or `src/domains/tenancy/*`), `src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/handler.ts` (gate check), `composition.ts`.
- **Schema / migration impact.** Adds a `Business.aiMode` enum (e.g. `MANUAL` / `AI_ASSISTED`, mapped to Level 1 / Level 2) defaulting to **Level 1 / MANUAL**, plus an optional global/business kill-switch flag. Additive, backfill-safe migration; no data backfill needed (default applies).
- **Acceptance criteria.**
  - A business defaults to **Level 1 (Manual)**; no business is AI-enabled without an explicit server-side state change.
  - The mode is resolved **server-side only** from `TenantRequestContext.businessId`; client-supplied mode/businessId is never trusted.
  - With AI off (default or kill switch active), generation paths return a clean **"AI disabled"** result and **never call a provider**.
  - The kill switch can disable generation business-wide (and ideally globally) **without a deploy**.
  - The resolver shape does not block future per-conversation / per-operator / per-channel overrides (B-H5), but builds none.
- **Tests required.** Unit: default mode is Level 1; off → fail closed (no provider invoked); on → allowed. Resolver rejects client-supplied mode/businessId. Kill-switch flips to fail-closed.
- **Validation commands.** `npm run lint` · `npm run typecheck` · `npm test -- ai-config` (unit) · `npx prisma validate` · `npx prisma migrate diff` (review only, no apply against real data).
- **Recommended model.** Claude Opus 4.8 High — security-critical fail-closed gate with subtle default/kill-switch edge cases.
- **Recommended effort.** Medium.
- **Suggested branch.** `feat/b-r1-business-aimode-kill-switch`
- **Merge gate.** Lint + typecheck + unit tests green; migration reviewed as additive/default-Level-1; reviewer confirms fail-closed-when-off; no provider dependency introduced.

---

### B-R2 — Verified business-context store + provenance

- **Classification.** BLOCKER. (PRD-v1.1 §5.1; audit B-2.)
- **Purpose.** A minimal business knowledge/profile/FAQ context model, `businessId`-scoped, where each item carries a **verified / unverified provenance** flag. This is the *only* source from which a draft may make definitive vertical-sensitive claims (§5.1).
- **Files likely touched.** `prisma/schema.prisma` (+ migration: business-context model), new `src/domains/knowledge/*` (repository/service/types — currently README-only scaffold), `composition.ts`.
- **Schema / migration impact.** Adds a minimal business-context model (profile / FAQ / structured fields) with a required `businessId` FK (composite `[id, business_id]` pattern, consistent with Area A hardening) and a `verified` boolean (or provenance enum) per item. Additive migration; no real data.
- **Acceptance criteria.**
  - Context items are stored **per business** and are only readable scoped to `TenantRequestContext.businessId`.
  - Each item carries a **verified/unverified** provenance signal. "Verified" means business-entered profile / FAQ / knowledge slice / business-provided structured info — **not** model-prior knowledge, inference, scraped, or guessed data (§5.1).
  - **No definitive claims may be backed by unverified context** — only verified items are eligible to back the §5.1 definitive-claim categories. (Enforcement lives in B-R5; this task makes the signal available.)
- **Tests required.** Unit: CRUD + provenance flag set/read; tenant-scoped reads (business A cannot read business B's context); verified vs unverified distinction preserved.
- **Validation commands.** `npm run lint` · `npm run typecheck` · `npm test -- knowledge` · `npx prisma validate`.
- **Recommended model.** Claude Opus 4.8 High — provenance is the load-bearing input to the §5.1 guardrail.
- **Recommended effort.** Medium.
- **Suggested branch.** `feat/b-r2-verified-business-context-provenance`
- **Merge gate.** Tenant-scoped read tests green; provenance flag proven; migration additive; reviewer confirms no path lets unverified context be treated as verified.

---

### B-R3 — Tenant-scoped AI context assembler

- **Classification.** BLOCKER. (PRD-v1.1 §9; audit B-3.)
- **Purpose.** Assemble the prompt context **strictly from `TenantRequestContext`**, reusing the Area A isolation substrate, so the AI is structurally incapable of reading another tenant's data.
- **Files likely touched.** New `src/domains/ai-runtime/*` (assembler), reading `businessId`-scoped CRM / conversations / messages / knowledge repositories.
- **Schema / migration impact.** None expected (read-only assembly over existing scoped repositories).
- **Acceptance criteria.**
  - Assembler accepts a **`TenantRequestContext`**, never a raw client-supplied `businessId`.
  - Assembles **only the current business's** context — its conversation/customer/message rows and its verified business context — keyed on the server-side `businessId`.
  - **Excludes unrelated tenant data** by construction; there is no code path that admits another business's rows.
  - Returns provenance-tagged context (verified/unverified preserved from B-R2) for B-R5 to consume.
- **Tests required.** Unit: assembler returns only business-A rows given business-A context. **Negative cross-tenant tests**: given business-A context, business-B conversation/customer/knowledge rows are never included (these feed and are hardened by B-R7).
- **Validation commands.** `npm run lint` · `npm run typecheck` · `npm test -- ai-runtime`.
- **Recommended model.** Claude Opus 4.8 High — tenant-isolation-critical; the assembler is the surface the §9 gate proves.
- **Recommended effort.** Medium–High.
- **Suggested branch.** `feat/b-r3-tenant-scoped-context-assembler`
- **Merge gate.** Unit + cross-tenant negative tests green; reviewer confirms the assembler signature takes `TenantRequestContext` and never a client `businessId`; no unrelated-tenant read path.

---

### B-R4 — Provider abstraction + deterministic fake provider

- **Classification.** BLOCKER. (Audit B-5.)
- **Purpose.** A provider **interface** with no SDK hardcoded into domain logic, plus a **deterministic fake provider** so the runtime is testable without a live model and without spend.
- **Files likely touched.** New `src/domains/ai-runtime/provider/*` (interface + fake), `composition.ts` (DI wiring).
- **Schema / migration impact.** None.
- **Acceptance criteria.**
  - A provider **interface** is defined; runtime/domain logic depends only on the interface.
  - A **fake provider** yields deterministic output for tests.
  - **No real SDK** is added yet (no dependency added to `package.json`) unless explicitly decided later (B-H3).
  - **No provider-specific core logic** leaks into the assembler, prompt builder, or domain services — vendor specifics stay behind the seam.
- **Tests required.** Unit: runtime produces deterministic output against the fake provider; swapping providers requires no change to domain logic.
- **Validation commands.** `npm run lint` · `npm run typecheck` · `npm test -- ai-runtime` · `git grep -nE "openai|anthropic|@anthropic-ai|sdk" -- src` returns no real SDK import.
- **Recommended model.** Claude Opus 4.8 High — getting the seam right prevents vendor lock and keeps every later test deterministic.
- **Recommended effort.** Medium.
- **Suggested branch.** `feat/b-r4-provider-abstraction-fake`
- **Merge gate.** Fake-provider unit tests green; reviewer confirms no SDK dependency and no provider-specific logic outside the provider module.

---

### B-R5 — Prompt builder with provenance-aware refusal rules

- **Classification.** BLOCKER. (PRD-v1.1 §5.1; audit B-4.)
- **Purpose.** Enforce the §5.1 content boundaries in prompt construction: definitive vertical-sensitive claims only from **verified** context; otherwise **hedge / defer / refuse**.
- **Files likely touched.** New `src/domains/ai-config/*` (prompt templates + versioning), integrated with the B-R3 assembler.
- **Schema / migration impact.** None expected (prompt version is recorded on the draft via B-R6's metadata columns).
- **Acceptance criteria.**
  - **Prompt versioning** exists; each generation records the prompt version.
  - Only **verified** context is injected as the basis for definitive claims; unverified/missing context is tagged as such.
  - Missing/unverified context produces explicit **hedge / defer-to-operator / ask-for-confirmation / suggest-business-contact / avoid-fabrication** instructions — never a fabricated definitive claim.
  - The **real-estate sensitive categories from PRD-v1.1 §5.1** are covered: property availability, price, ROI, investment guarantees, legal requirements, regulatory requirements, mortgage/financing, commissions, contracts.
- **Tests required.** Unit per §5.1 category: verified-present → definitive claim permitted; verified-absent → refusal/hedge instruction emitted. Prompt-version recorded. Unverified context never promoted to a definitive claim.
- **Validation commands.** `npm run lint` · `npm run typecheck` · `npm test -- ai-config`.
- **Recommended model.** Claude Opus 4.8 High — the §5.1 guardrail is build-critical and category-sensitive.
- **Recommended effort.** Medium–High.
- **Suggested branch.** `feat/b-r5-prompt-builder-refusal-rules`
- **Merge gate.** Per-category refusal tests green; prompt versioning present; reviewer confirms no §5.1 category can be answered definitively from unverified/missing context.

---

### B-R6 — AI generation audit log + draft metadata

- **Classification.** BLOCKER. (Audit B-6.)
- **Purpose.** Traceability: every generation emits an audit event; the resulting draft records `source = AI` and its model metadata. **No auto-send.**
- **Files likely touched.** `reply-drafts/generate/handler.ts` (real generation path replacing the SYSTEM stub when AI enabled), `reply-drafts/repository.ts` (populate model metadata), `audit` service.
- **Schema / migration impact.** None expected — `ReplyDraft.modelProvider` / `modelName` / `promptVersion` columns and `ReplyDraftSource.AI` / `AuditActorType.AI_RECEPTIONIST` enum values already exist (forward-scaffolding placeholders); this task **populates** them. If any column is missing, add it as an additive migration.
- **Acceptance criteria.**
  - When AI is enabled and generation runs, `ReplyDraft.source = AI` and `modelProvider` / `modelName` / `promptVersion` are populated (no longer null).
  - Each generation emits an **`AuditEvent`** (actor `AI_RECEPTIONIST`) recording business, conversation, provider, model, prompt version, and context provenance.
  - **No auto-send**: the generation path creates a draft only — it does **not** create or send a `Message` and does not transition any draft to `SENT`.
  - When AI is **off** (B-R1), no generation, no AI audit event, no provider call.
- **Tests required.** Unit: audit event emitted on generate (actor `AI_RECEPTIONIST`); draft metadata persisted; generation creates no Message and no SENT transition; AI-off → no generation/audit/provider call.
- **Validation commands.** `npm run lint` · `npm run typecheck` · `npm test -- reply-drafts` · `npm test -- audit`.
- **Recommended model.** Claude Opus 4.8 High — touches the draft lifecycle and the no-auto-send boundary.
- **Recommended effort.** Medium.
- **Suggested branch.** `feat/b-r6-ai-generation-audit-metadata`
- **Merge gate.** Audit + metadata tests green; reviewer confirms generation creates no Message and no SENT transition; AI-off fail-closed preserved.

---

### B-R7 — Cross-tenant AI-context isolation suite

- **Classification.** BLOCKER — **PRD §9 AI gate.** (Audit B-7.)
- **Purpose.** Prove the AI context assembly is **structurally tenant-isolated** on a real DB, and that `aiMode`-off **fails closed**. This is the evidence that satisfies the §2.1 hard gate.
- **Files likely touched.** `__tests__/integration/*` (gated real-DB suite, mirroring the Area A harness), `.github/workflows/ci.yml` (wire to the existing integration gate if needed).
- **Schema / migration impact.** None (test-only; seeds synthetic businesses).
- **Acceptance criteria.**
  - **Real-DB integration tests** run behind the existing gate (`RUN_INTEGRATION_TESTS=true`, localhost guard), seeding **business A and business B** with distinct context.
  - Proves the **assembler cannot include other-tenant context**: given business-A `TenantRequestContext`, no business-B conversation/customer/message/knowledge row is ever assembled or injected (≥2 cross-tenant cases).
  - Proves **AI disabled means no provider call** (fail-closed cases): `aiMode` off / kill switch active → generation returns "AI disabled" and the fake provider is never invoked.
  - **Wired into CI** behind the integration gate so the proof is enforced on every change, alongside the Area A tenant-isolation suite.
- **Tests required.** This workstream **is** the suite: ≥2 cross-tenant isolation cases + fail-closed cases. Must test the **actual B-R3 assembler** (not a mock).
- **Validation commands.** `RUN_INTEGRATION_TESTS=true npm run test:integration -- ai-isolation` (localhost-gated, synthetic data) · CI green on the integration job.
- **Recommended model.** Claude Opus 4.8 High — the load-bearing §9 safety evidence.
- **Recommended effort.** High.
- **Suggested branch.** `test/b-r7-cross-tenant-ai-isolation`
- **Merge gate.** Real-DB suite green locally and in CI behind the integration gate; reviewer confirms it exercises the real assembler and includes both cross-tenant and fail-closed cases. **This is the gate whose green state unlocks real-data prompt entry.**

---

### B-R8 — No-auto-send + human-approval lock

- **Classification.** SHOULD_DO_BEFORE_ALPHA — treated as a hard pre-Level-2-enablement gate. (Audit B-9, B-10.)
- **Purpose.** Pin the existing structural no-auto-send / human-approval guarantees by test so future work cannot regress them before Level 2 reaches real users.
- **Files likely touched.** `__tests__/**`; optionally an authz guard around any future send path (`ai_drafts.send` is granted to OPERATOR but currently has **no consumer**).
- **Schema / migration impact.** None.
- **Acceptance criteria.**
  - **Approve creates no Message / does not send**: `approveDraft` asserts no Message is created and no provider/send is invoked.
  - **AI cannot transition a draft to `SENT`**: no path auto-progresses a draft to SENT; the AI actor cannot send.
  - **`ai_drafts.send` remains human-only** if/when a send path is ever consumed: any future send is human-initiated only and never wired to an automatic trigger.
  - Tests **lock** these behaviors (negative / meta tests) so a future change that introduces auto-send fails CI.
- **Tests required.** Negative/meta tests: approve → no Message; no auto-SENT transition; AI actor cannot send; `ai_drafts.send` requires a human actor.
- **Validation commands.** `npm run lint` · `npm run typecheck` · `npm test -- reply-drafts` · `npm test -- authz`.
- **Recommended model.** Claude Opus 4.8 High — guards the most consequential safety property (no AI-to-customer send).
- **Recommended effort.** Low–Medium.
- **Suggested branch.** `test/b-r8-no-auto-send-approval-lock`
- **Merge gate.** Lock tests green; reviewer confirms no auto-send path exists and the tests would fail if one were introduced. **Required green before Level 2 is enabled for any real user.**

---

### Optional hardening tasks (B-H*)

These are **not** required before the real-data gate (unless noted) and are not built in this plan.

#### B-H1 — Data-minimization policy
- **Classification.** SHOULD_DO_BEFORE_ALPHA.
- **Status (2026-06-20).** **IMPLEMENTED for the current fake-provider AI-runtime scope** by **PR #123** (spec added — `docs/audits/AREA-B-pii-data-minimization-allowlist.md`) + **PR #124 / `2f4d015`** (enforcement + test). PR #124 centralized the prompt-renderable allowlist (`PROMPT_RENDERABLE_ITEM_FIELDS` in `src/domains/ai-runtime/types.ts`), refactored `prompt-builder.ts` to render verified-context items by iterating that allowlist, and added `__tests__/domains/ai-runtime-data-minimization.test.ts` proving allowlisted verified-context fields render while customer / CustomerContactMethod / conversation / message / reply-draft-shaped fields and internal/provenance fields (`sourceMetadata` / `sourceUrl` / `verifiedByUserId` / internal item id / per-item `businessId` / `status` / `createdByUserId`) do not. **Real-provider use remains blocked by the remaining go-live gates:** this work added **no real provider, no SDK, no env/API-key read, no route-level generation wiring, no schema/migration, and no auto-send**, and does **not** approve customer-message-in-prompt. The closure checkpoint §6 records B-H1 as **CLOSED for the current fake-provider AI-runtime prompt-builder scope**; real-provider production AI-assisted go-live remains **NOT YET APPROVED**.
- **Purpose.** An explicit **allowlist** of fields permitted into a prompt; unneeded PII excluded by construction.
- **Acceptance criteria.** Only allowlisted fields enter a prompt; excluded PII proven absent by test.
- **Recommended model / effort.** Opus 4.8 High / Low–Medium. **Suggested branch.** `feat/b-h1-data-minimization`. **Merge gate.** Allowlist test proving excluded PII never reaches the prompt.

#### B-H2 — Multi-vertical refusal generalization
- **Classification.** LATER.
- **Purpose.** Generalize the §5.1 refusal categories beyond real estate (e.g. medical, financial) as a configurable platform guardrail.
- **Acceptance criteria.** Refusal categories configurable per vertical; real-estate behavior unchanged.
- **Recommended model / effort.** Sonnet 4.6 / Medium. **Suggested branch.** `feat/b-h2-multivertical-refusal`. **Merge gate.** Config-driven categories; no regression of §5.1 alpha behavior.

#### B-H3 — Provider vendor integration (after fake provider)
- **Classification.** LATER.
- **Purpose.** Integrate a real model-provider SDK **behind the B-R4 interface**, after the fake provider and prompt rules exist. Vendor selection is a separate, explicit decision.
- **Acceptance criteria.** Real provider implements the B-R4 interface; fake provider remains the test default; env-gated and **off in production** until explicitly enabled.
- **Recommended model / effort.** Opus 4.8 High / Medium. **Suggested branch.** `feat/b-h3-provider-vendor-integration`. **Merge gate.** No domain-logic change vs. fake; env-gated; default-off preserved.

#### B-H4 — Evaluation / confidence / risk scoring
- **Classification.** LATER (toward Level 3 / S4).
- **Purpose.** Scaffold evaluation harnesses and confidence/risk gating. **Out of alpha scope** — Level 3 gates are separate.
- **Acceptance criteria.** Eval/scoring scaffolding exists without gating alpha Level 2 behavior.
- **Recommended model / effort.** Sonnet 4.6 / Medium. **Suggested branch.** `feat/b-h4-eval-confidence-scoring`. **Merge gate.** Does not alter Level 2 alpha path.

#### B-H5 — Per-conversation / per-channel / per-operator `aiMode` override
- **Classification.** LATER.
- **Purpose.** Add finer-grained `aiMode` overrides. The B-R1 resolver must be **shaped to allow** these later, but they are **not built** now (PRD §5: "must not block" future overrides).
- **Acceptance criteria.** Overrides resolve under the per-business default; default-off preserved when unset.
- **Recommended model / effort.** Sonnet 4.6 / Medium. **Suggested branch.** `feat/b-h5-aimode-overrides`. **Merge gate.** Per-business default remains the fallback; no weakening of default-off.

---

## 5. Suggested Execution Strategy

### 5.1 Tasks that MUST be separate PRs

- **B-R1 must be its own PR and the first implementation PR.** It establishes the default-off gate. It must **not** be combined with B-R2 or any later task — every subsequent task depends on the gate existing and being reviewable in isolation.
- **B-R7 must be its own PR** and must **not** be implemented before B-R3 exists (it must test the real assembler).
- **B-R5 must be its own PR** and must not precede B-R2 (provenance data) and B-R3 (assembled context).
- **B-R8 must be its own PR**, landing before Level 2 is enabled for any real user.
- **B-H3 (real provider) must be its own PR** and must **not** be done before B-R4 (fake provider) and B-R5 (prompt rules) exist.

### 5.2 What may be combined if safe

- B-R2 and B-R3 may be developed in parallel branches (independent after B-R1), but should land as **separate PRs** for reviewable isolation. They may be combined **only** if a reviewer judges the combined diff small and the provenance + assembler boundaries clearly testable — default is separate.
- B-R6's metadata population may fold into the same PR as the first real generation path **only after** B-R4 and B-R5 exist; otherwise keep separate.
- B-H1 (data minimization) may fold into B-R3/B-R5 if the allowlist is small and proven by test; otherwise separate.

### 5.3 What must NOT be combined

- **Do not combine B-R1 with B-R2 or any later task.** B-R1 is the first PR, standalone.
- **Do not combine B-R7 with the assembler PR (B-R3).** The proof must be a separate, CI-wired suite over the merged assembler.
- **Do not combine B-H3 (real provider) with the fake-provider/prompt-rule work.** Real vendor integration only after B-R4 + B-R5.
- **Do not combine any task that introduces a send path with B-R6/B-R8** — no auto-send may ride in on a generation or audit PR.

### 5.4 Where human review is mandatory

Every BLOCKER PR requires human owner review. Reviews are **mandatory and security-gating** for: **B-R1** (fail-closed gate), **B-R3** (tenant isolation), **B-R5** (§5.1 refusal rules), **B-R7** (the §9 proof), and **B-R8** (no-auto-send lock). These five carry the safety-critical invariants and must not be auto-merged.

### 5.5 When to stop and re-audit

- **After B-R7 goes green in CI**, stop and re-audit before enabling AI for **any** real business: confirm the §9 gate evidence holds, all blockers merged, fail-closed proven. This is the RED→YELLOW/GREEN decision point (§8).
- **Before enabling Level 2 for the first real partner**, confirm B-R8 is merged and green.
- **Before any B-H3 real-provider enablement in production**, re-audit env/secret handling and default-off enforcement.

---

## 6. Test Strategy

| Layer | Required tests | Tasks |
| :---- | :---- | :---- |
| **Unit** | Resolver defaults/fail-closed; provenance flag; assembler scoping; prompt refusal per §5.1 category; fake-provider determinism | B-R1, B-R2, B-R3, B-R4, B-R5 |
| **Service** | Context assembly over scoped repositories; generation service emits audit + metadata; fail-closed when AI off | B-R3, B-R6 |
| **Handler** | `generate` handler gated by `aiMode`; creates draft only (no Message/send); approve creates no Message | B-R1, B-R6, B-R8 |
| **Repository** | Business-context CRUD tenant-scoped; draft metadata persisted; contact/knowledge reads `businessId`-scoped | B-R2, B-R6 |
| **Real-DB integration** | Two-business seed; cross-tenant assembler isolation (≥2 cases); AI-off → no provider call (fail-closed) | **B-R7** |
| **CI gate** | B-R7 suite runs behind the existing integration gate (`RUN_INTEGRATION_TESTS=true`, localhost guard) alongside Area A | B-R7 |
| **Negative** | Cross-tenant context never assembled; unverified context never backs a definitive claim; no auto-SENT transition; AI actor cannot send | B-R3, B-R5, B-R8 |
| **Meta / static** | No real provider SDK imported before B-H3; no client-supplied `businessId` trusted in assembler; lock-test fails if an auto-send path is introduced | B-R3, B-R4, B-R8 |

All AI tests run against the **deterministic fake provider** (B-R4) and **synthetic / test-business data only**. No real model calls, no spend, no real PII in any test.

---

## 7. Operational Requirements

- **Branch protection.** When Area B checks are added, branch protection on `main` should **require the Area B-relevant CI checks** (unit + the B-R7 real-DB AI-isolation integration gate) to pass before merge, consistent with the Area A tenant-isolation gate already enforced in `.github/workflows/ci.yml`.
- **Env variables for the AI provider.** Must be **disabled/absent** until the provider task (B-H3). No real provider SDK dependency is added before B-H3. CI/meta test asserts no SDK import lands early.
- **AI default-off in production.** AI must **default off in production** until explicit per-business enablement via `Business.aiMode` (default Level 1) + kill switch. No business is AI-enabled by deploy.
- **Kill switch documented.** The kill switch (business-wide, ideally global) must be **documented**: where it lives, how to flip it without a deploy, and the guarantee that flipping it off makes generation **fail closed** (no provider call). Document this in the Area B operational notes alongside the env contract.
- **No real PII before B-R7 green.** Operationally enforced: no real-data environment may enable `aiMode` Level 2 until the B-R7 gate is green in CI and the §8 GREEN condition is met.

---

## 8. Definition of Done for Area B

Area B's verdict moves only when the following precise conditions hold:

- **RED** — *current state.* No AI runtime / provenance / isolation proof exists. No `aiMode`, no verified-context store, no assembler, no prompt rules, no AI audit, no §9 AI-isolation suite. The system runs at Level 1 (Manual) only. Real-data AI-assisted alpha is not permitted.
- **YELLOW** — *architecture exists, enforcement/validation incomplete.* The blocker **architecture** is built (B-R1…B-R6 merged: aiMode/kill switch, verified-context+provenance, tenant-scoped assembler, provider abstraction + fake, prompt refusal rules, AI audit + metadata) **but** operational enforcement or real-provider validation remains incomplete — e.g. B-R7 not yet green/CI-enforced, or B-R8 not yet merged, or only the fake provider validated (no B-H3) while default-off enforcement in production is not yet verified. AI may run against **synthetic data only**, default-off. **Real customer PII still may not enter prompts.**
- **GREEN** — *real-data Level 2 permitted.* All BLOCKER tasks (**B-R1…B-R7**) are **merged**, their **tests are green**, the **B-R7 cross-tenant AI-isolation CI gate is enforced** on `main`, **B-R8** (no-auto-send + approval lock) is merged and green, AI is **default-off** with a documented kill switch, and **real-data prompt entry is proven tenant-isolated and fail-closed** by the B-R7 suite. Only then may a real business be enabled to Level 2 (AI-assisted, human-approval-mandatory, no auto-send).

GREEN is the **AI-runtime** gate only. It does **not** by itself declare the full product real-data-ready — that remains conditional on Area A (closed), Area C (widget ingest), and operational checks.

---

## 9. Recommended Immediate Next Task

**Exactly one: B-R1 — Business `aiMode` + default-off kill switch.**

**Why.** B-R1 is the **root of the dependency graph** (§3) and the **safety precondition for everything else**. A per-business, **default-Level-1 (OFF)**, kill-switched enablement that **fails closed** means every subsequent Area B task — the verified-context store, the assembler, the provider, the prompt rules, the audit, and the isolation suite — can be built and tested **behind a gate**, against synthetic data, with **zero risk to real customer data**. Building any other task first would create AI machinery that is not yet gated by a default-off switch, inverting the safety order. B-R1 is small, security-critical, and unblocks safe incremental progress on the rest of the plan.

It must be its **own first PR** (§5.1), reviewed by the owner (§5.4), and must not be combined with B-R2 or later.

---

## 10. Scope Guard — What This Plan Does Not Cover

- **Area C widget / public ingest isolation.** Out of scope except as a **dependency note**: a future widget-sourced conversation must still be assembled tenant-scoped by the B-R3 assembler. Widget-key → business mapping and public-ingest security remain Area C.
- **Level 3 / Auto Pilot Mode.** Out of scope; future-only, gated behind PRD-v1.0 S4. This plan only **preserves** the no-auto-send property.
- **MCP / third-party integrations.** Out of scope (PRD §14, future).
- **Provider vendor selection.** Out of scope beyond requiring a provider **abstraction** + a deterministic **fake provider** (B-R4). No SDK is endorsed or added until B-H3, if planned later.
- **Frontend / UI.** Out of scope unless explicitly needed by a later task; no UI is required to satisfy the Area B blockers.
- **Full real-estate workflow.** Out of scope; only the §5.1 content-boundary guardrail is in scope, as a general platform pattern.
- **Area A re-audit.** Out of scope; Area A is closed/GREEN (`AREA-A-closure-checkpoint.md`) and is reused as the isolation substrate, not re-litigated.
- **No code/schema/test/CI changes in this plan.** This is a documentation-only planning artifact; nothing in the application, schema, tests, or CI is modified here.

---

*Area B AI runtime / provenance remediation plan — PROPOSED, 2026-06-15. Sequences B-R1…B-R8 (+ B-H*) into ordered, acceptance-criteria-driven PRs. AI remains default-off; no real customer PII may enter any AI prompt until the B-R7 §9 AI-isolation gate is green and all blockers are merged and tested. Area B remains RED until the §8 GREEN condition is met. Area A remains closed/GREEN and separate. PRD-v1.1, the schema, tests, and CI are unchanged.*
