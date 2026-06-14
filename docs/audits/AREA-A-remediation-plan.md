# Area A — Remediation Plan

**Product:** AiA Reception SaaS **Scope:** Tenant Isolation \+ RBAC \+ ABAC — Gate Closure **Status:** PROPOSED **Date:** 2026-06-13 **Source documents:** `docs/product/PRD-v1.1.md` (LOCKED) · `docs/audits/AREA-A-authorization.md` (VERIFIED/CONDITIONAL) · `docs/HANDOFF_FROM_ANTIGRAVITY.md`

This is a **planning artifact only**. It contains no code, no patches, and no Claude Code prompts. It sequences the Area A audit's pre-real-data blockers and pre-scale hardening into an ordered, acceptance-criteria-driven plan. PRD-v1.1 and the Area A audit are unchanged.

> **Status update (2026-06-15):** the Area A real-data blockers and the recommended contact-method / middleware-backstop hardening have been **executed and merged**. Completed workstreams: **A-R1** (#89), **A-R1.1** (#93, CI integration gate), **A-R2** (#87), **A-R3** (#88), **A-R4** (#90), **A-H3** (#94), **A-H4** (#91), **A-H4.2** (#92). The backend authorization / tenant-isolation data plane is **GREEN through PR #94**. The remaining items (**A-H1**, **A-H2**, concurrent multi-tenant tests, stronger route-backstop rule, and the Area C / Area B handoffs **A-R5** / **A-R6**) are still open. The **current status reference is now `docs/audits/AREA-A-closure-checkpoint.md`**; this plan is preserved as the historical sequencing artifact. Full private-alpha real-data readiness remains conditional on Area B (AI) and Area C (widget) and operational checks — it is **not** GREEN.

---

## 1\. Title and Status

| Field | Value |
| :---- | :---- |
| Title | Area A — Remediation Plan |
| Product | AiA Reception SaaS |
| Scope | Tenant Isolation \+ RBAC \+ ABAC Gate Closure |
| Status | **PROPOSED** |
| Date | 2026-06-13 |
| Source of truth | PRD-v1.1 (LOCKED) \+ Area A authorization audit |

---

## 2\. Executive Summary

**What this plan closes.** The six Area A blockers and four pre-scale hardening items needed to move from "synthetic-data PASS" to "one real design-partner business CONDITIONAL PASS → cleared." The core is closing the one hard PRD-v1.1 §9 gate (real-DB cross-tenant isolation tests for the PII-bearing domains), eliminating the dev-bypass risk in real-data environments, and source-confirming the one control still unread (the `ACTIVE`\-membership / suspended-business query).

**What it does not close.** It does not implement Area B (AI runtime, provenance, `aiMode`) or Area C (web-widget ingest) beyond a planning/handoff scope. It does not change the verified architecture: the Auth.js tenant adapter, route-param `businessId` validation, RBAC catalog, and shared business queue all remain valid and are preserved.

**What must be done before real customer PII.** A-R3 (tenancy verification), A-R2 (dev-bypass guard), A-R1 (real-DB cross-tenant tests), and A-R4 (OPERATOR negative tests) must all be complete and green. A-R5/A-R6 become blockers only if the widget or AI is enabled for the first real partner.

**What remains for Area B / Area C.** AI context isolation, verified/unverified provenance, and `Business.aiMode` belong to **Area B**. Web-widget key/`ChannelConnection` modelling and public-ingest isolation belong to **Area C** (planned, not built, here).

---

## 3\. Remediation Principles

1. **Targeted remediation, no major redesign.** The audit found no Major Redesign item; this plan adds tests, one config guard, one source verification, and small hardening — nothing structural beyond an optional middleware backstop.  
2. **Real-DB tests before real PII.** Mock tests are necessary but not sufficient; the gate is live-database proof of cross-tenant isolation for customers, conversations, messages, and reply-drafts.  
3. **Dev bypass must be impossible in real-data environments.** `ENABLE_DEV_AUTH_CONTEXT` and `VITE_DEV_BUSINESS_ID` must be provably off wherever real data can exist — enforced, not by convention.  
4. **Preserve the shared business queue** as the Alpha default; do not add assigned-only or skill routing.  
5. **No RLS for Alpha** unless a concrete future risk (systemic missed filters, inability to guarantee per-route tenant resolution, or rising sensitivity/scale) demands it.  
6. **No policy engine** (OPA / Cedar / DSL), no enterprise authorization engine, no full billing enforcement, no MCP architecture.

---

## 4\. Workstream Overview

| ID | Workstream | Risk | Blocks real data? | Dependency | Recommended model | Notes |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| A-R3 | Tenancy Repository Verification | High | **Yes** | None | Opus 4.8 High | Confirms ACTIVE-membership \+ suspended-business handling; unblocks trust in the adapter |
| A-R2 | Dev-Bypass Deployment Guard | High | **Yes** | None | Opus 4.8 High | Startup assertion \+ CI/deploy check \+ test; closes header-trust bypass |
| A-R1 | Real-DB Cross-Tenant Isolation Tests | High | **Yes** | A-R3 (recommended) | Opus 4.8 High | The hard PRD-§9 gate; extends gated integration harness to CRM/conversations/messages/reply-drafts |
| A-R4 | RBAC Negative-Boundary Tests | Medium | **Yes** | None | Sonnet 4.6 | OPERATOR cannot business.delete / members.\*; VIEWER write denials |
| A-H3 | Contact-Methods BusinessId Guard | Medium | Recommended | None | Opus 4.8 High | Add explicit businessId filter/check \+ test; closes the one unscoped list query |
| A-H1 | Composite FK Hardening | Medium | Recommended (pre-scale) | Migration review | Opus 4.8 High | Even ReplyDraft→Conversation and Conversation→Customer to Message's composite pattern |
| A-H2 | Assignee-Is-Member Check | Low–Med | Recommended (pre-scale) | None | Sonnet 4.6 | App/test check that assignee is an active member |
| A-H4 | Auth/Tenant Middleware Backstop | Medium | No | None | Opus 4.8 High | Structural chokepoint to replace per-handler convention; design \+ apply |
| A-R5 | Widget / Public Ingest Isolation Planning | Medium | Conditional (Area C) | Area C scope | Sonnet 4.6 | Plan widget-key/ChannelConnection \+ ingest isolation; no build here |
| A-R6 | AI Context / Provenance Handoff to Area B | Medium | Conditional (Area B) | Area B scope | Sonnet 4.6 | Handoff note: aiMode, provenance, tenant-scoped assembly; no build here |

---

## 5\. Detailed Workstreams

### A-R3 — Tenancy Repository Verification

- **Problem.** The exact `resolveTenantContext` query (ACTIVE-status membership filter; suspended/archived business handling) was not in the evidence bundle; it is the one load-bearing control still `[NEEDS FILE]`.  
- **Evidence (audit).** §4 finding 3–4 (membership check), §10 blocker 3, Appendix evidence gaps.  
- **Required verification.** Read `src/domains/tenancy/repository.ts` / service; confirm membership lookup filters `status = ACTIVE` (rejects INVITED/DECLINED/EXPIRED/REMOVED/LEFT) and that a SUSPENDED/ARCHIVED `Business` is denied or flagged. If suspension is not enforced, add a check.  
- **Dependencies.** None (requires the file).  
- **Acceptance criteria.** Source confirms ACTIVE-only membership resolution; suspended/archived business is rejected at resolution; behaviour documented in the audit appendix as VERIFIED.  
- **Tests required.** Unit tests: inactive membership → denied; suspended business → denied; active member → context returned.  
- **Model.** Opus 4.8 High. **Blocks real PII: Yes. Alpha-critical.**

### A-R2 — Dev-Bypass Deployment Guard

- **Problem.** `createDevHeaderAuthContextAdapter` trusts `x-dev-*` headers with no DB check; selection depends on env flags. If `ENABLE_DEV_AUTH_CONTEXT` (or frontend `VITE_DEV_BUSINESS_ID`) is set where real data lives, tenant isolation is fully bypassable.  
- **Evidence (audit).** §5 dev-bypass risk; §2 finding 3; §10 blocker 2\.  
- **Required change.** Enforced guard so real-data environments cannot enable dev bypass: runtime startup assertion that `ENABLE_AUTHJS_REQUEST_CONTEXT=true` and `ENABLE_DEV_AUTH_CONTEXT` is unset/false (and `VITE_DEV_BUSINESS_ID` unset) when a real-data flag/environment marker is present; plus a CI/deploy configuration check.  
- **Dependencies.** None.  
- **Acceptance criteria.** App refuses to boot (or fails closed) in a real-data environment if dev-bypass flags are present; CI fails if a real-data config sets them; documented env contract.  
- **Tests required.** Config/unit tests for each flag combination; a fail-closed test for the dev adapter in a real-data marker.  
- **Model.** Opus 4.8 High. **Blocks real PII: Yes. Alpha-critical.**

### A-R1 — Real-DB Cross-Tenant Isolation Tests

- **Problem.** Cross-tenant logic is unit/mock-tested only; no live-database test proves business-A context cannot read/write business-B rows for the PII-bearing domains.  
- **Evidence (audit).** §7 (missing real-DB tests); §10 blocker 1; PRD-v1.1 §9.  
- **Required change.** Extend the existing gated integration harness (`RUN_INTEGRATION_TESTS=true`, localhost guard) to cover customers, customer-contact-methods, conversations, messages, and reply-drafts. Seed two businesses; assert every read/list/mutation scoped to business A cannot touch business B; assert wrong-`businessId` → null/403/empty.  
- **Dependencies.** A-R3 recommended first (so the resolution control is confirmed before the harness asserts on it).  
- **Acceptance criteria.** Green real-DB suite covering all five domains with positive \+ negative cases; runs in CI behind the integration gate; documented as the §9 gate evidence.  
- **Tests required.** This workstream *is* the test suite (≥2 isolation cases per domain: same-business passes, cross-business denied).  
- **Model.** Opus 4.8 High. **Blocks real PII: Yes. Alpha-critical.**

### A-R4 — RBAC Negative-Boundary Tests

- **Problem.** OPERATOR negative-boundary coverage is thin (what OPERATOR cannot do); only VIEWER denial is well covered.  
- **Evidence (audit).** §7 (OPERATOR boundary thin); §3 Q3.  
- **Required change.** Add tests asserting OPERATOR is denied `business.delete` and `members.*`; VIEWER denied writes; confirm sensitive-permission denials return 403\.  
- **Dependencies.** None (RBAC catalog already verified).  
- **Acceptance criteria.** Each role's deny-set is tested at the handler or authz-service layer; CI green.  
- **Tests required.** Per-role negative tests across representative sensitive permissions.  
- **Model.** Sonnet 4.6. **Blocks real PII: Yes (low effort). Alpha-critical.**

### A-H3 — Contact-Methods BusinessId Guard

- **Problem.** `crm.listContactMethods` filters by `customerId` only, relying on prior customer-ownership validation — the one query without an explicit `businessId` scope.  
- **Evidence (audit).** §5 Q5 (contact-methods ⚠️); §6 recommendation.  
- **Required change.** Add an explicit `businessId` filter/check to the contact-methods listing path so it does not depend solely on caller discipline.  
- **Dependencies.** None.  
- **Acceptance criteria.** Listing contact methods for a customer in another business returns empty/denied; covered by a test (ideally in the A-R1 real-DB suite).  
- **Tests required.** Cross-tenant contact-methods negative test.  
- **Model.** Opus 4.8 High (tenant-isolation-sensitive). **Blocks real PII: Recommended (treat as Alpha-critical given low cost).**

### A-H1 — Composite FK Hardening

- **Problem.** `reply_drafts.conversation_id → conversations(id)` and `conversations.customer_id → customers(id)` are plain-id FKs; `Message` uses the stronger composite `(conversation_id, business_id)`. Uneven defense-in-depth.  
- **Evidence (audit).** §6 (weak FKs); §4 finding 10; migration evidence.  
- **Required change.** Migration review to even up the two FKs to the composite `[id, business_id]` pattern (and add the composite unique on `customers` if needed), matching `Message`. Verify no data violates the constraint before applying.  
- **Dependencies.** Migration review; data check.  
- **Acceptance criteria.** DB rejects a reply-draft whose `business_id` disagrees with its conversation, and a conversation referencing a customer in another business; existing data migrates cleanly.  
- **Tests required.** Migration applied in the integration DB; constraint-violation tests.  
- **Model.** Opus 4.8 High. **Blocks real PII: Recommended pre-scale (hard requirement before two–three tenants).**

### A-H2 — Assignee-Is-Member Check

- **Problem.** `conversations.assigned_user_id → users(id)` has no constraint that the assignee is an active member of the business.  
- **Evidence (audit).** §6 (assignee membership issue).  
- **Required change.** Application \+ test check that an assignment target is an ACTIVE member of the business; reject otherwise.  
- **Dependencies.** None.  
- **Acceptance criteria.** Assigning a conversation to a non-member is rejected; covered by a test.  
- **Tests required.** Negative assignment test.  
- **Model.** Sonnet 4.6. **Blocks real PII: No (pre-scale; relevant when assignment is exercised).**

### A-H4 — Auth/Tenant Middleware Backstop

- **Problem.** No structural chokepoint; enforcement is per-handler by convention (currently consistent). A future route could omit the sequence.  
- **Evidence (audit).** §5 (lack of middleware chokepoint; service-layer gap).  
- **Required change.** Design and apply a shared auth/tenant backstop (e.g., a route wrapper or middleware) that guarantees tenant-context resolution \+ permission enforcement for every tenant-scoped route, preserving the existing adapter and RBAC. Not RLS, not a policy engine.  
- **Dependencies.** None; should not alter verified behaviour.  
- **Acceptance criteria.** Every tenant-scoped route is covered by the backstop; a meta-test/lint fails if a new tenant route bypasses it; existing handler behaviour unchanged.  
- **Tests required.** Coverage/meta test enumerating tenant routes.  
- **Model.** Opus 4.8 High. **Blocks real PII: No (strong hardening; reduces future regression risk).**

### A-R5 — Widget / Public Ingest Isolation Planning

- **Problem.** No widget-key/`ChannelConnection` model exists; `ChannelType` is an enum only. Public ingest isolation is unbuilt.  
- **Evidence (audit).** §9 / §10 blocker 5 (audit) and PRD-v1.1 §11.  
- **Required (planning only).** Define the widget-key → business mapping model, public-ingest security requirements (origin allowlist, rate limiting, abuse protection, anonymous Customer creation scoped to the key's business, client-sent businessId ignored). **No build in this plan** — this is Area C scope.  
- **Dependencies.** Area C kickoff; only a blocker if the widget is partner \#1's channel.  
- **Acceptance criteria.** A written Area C planning section exists; isolation requirements enumerated.  
- **Model.** Sonnet 4.6. **Blocks real PII: Conditional (only if widget on for real data).**

### A-R6 — AI Context / Provenance Handoff to Area B

- **Problem.** AI context isolation, verified/unverified provenance, and `Business.aiMode` do not exist; required before real customer data enters AI prompts (PRD-v1.1 §5.1, §9).  
- **Evidence (audit).** §10 blocker 6; PRD-v1.1 §5.1.  
- **Required (handoff only).** Record the dependency for Area B: tenant-scoped AI context assembly driven by `TenantRequestContext`; a `verified` provenance flag on injected business context; a `Business.aiMode` field gating L1/L2; kill switch. **No build here.**  
- **Dependencies.** Area B.  
- **Acceptance criteria.** Area B brief receives this as fixed input.  
- **Model.** Sonnet 4.6 (handoff doc). **Blocks real PII: Conditional (only if AI on for real data).**

---

## 6\. Recommended Sequence

The owner-proposed order is sound on dependencies; I disagree with it on **one point** and adjust accordingly.

**Disagreement (stated):** the proposed order places A-R2 (dev-bypass guard) second, after A-R3. I recommend running **A-R2 and A-R3 as a parallel first wave**, with **A-R2 marked as the single most urgent item**. Reason: A-R3 is a *verification* (it may simply confirm the control is already correct and require no change), whereas A-R2 closes an *active, exploitable* bypass that makes every other control moot if a flag leaks into a real-data environment. Gating A-R2 behind A-R3 risks leaving the exploitable hole open longer for no dependency reason — the two are independent. Everything else in the proposed order is correct (verification/guard → real-DB tests → RBAC → hardening → planning/handoff).

**Recommended execution order:**

| Step | ID | Why here |
| :---- | :---- | :---- |
| 1 (parallel, most urgent) | **A-R2** | Closes an active bypass; independent; no real data safe until done |
| 1 (parallel) | **A-R3** | Confirms the last unread control; cheap; informs A-R1 assertions |
| 2 | **A-R1** | The hard §9 gate; builds on confirmed resolution (A-R3) |
| 3 | **A-R4** | Completes RBAC deny-set; low effort |
| 4 | **A-H3** | Closes the one unscoped query; fold into A-R1 suite |
| 5 | **A-H1** | Composite FK hardening; required before multi-tenant scale |
| 6 | **A-H2** | Assignee-is-member; exercised once assignment is used |
| 7 | **A-H4** | Middleware backstop; structural regression protection |
| 8 | **A-R5** | Widget ingest planning (Area C); only if widget is partner \#1 |
| 9 | **A-R6** | AI provenance handoff (Area B) |

Steps 1–4 (plus A-H3) are the **one-real-business gate**. Steps 5–7 are required before **two–three tenants**. Steps 8–9 are conditional handoffs.

---

## 7\. Real-Data Readiness Gate

### Before synthetic / internal testing — **allowed now**

- [ ] Dev-bypass flags off in any shared environment (A-R2 interim: documented \+ manually verified).  
- [ ] Synthetic/test-business data only; no real PII.

### Before ONE real design-partner business

- [x] **A-R3** complete (#88) — ACTIVE-membership \+ suspended-business resolution source-verified (+ tests).
- [x] **A-R2** complete (#87) — enforced dev-bypass deployment guard (startup assertion \+ CI/deploy check \+ tests).
- [x] **A-R1** complete (#89) — green real-DB cross-tenant isolation suite for customers, contact-methods, conversations, messages, reply-drafts; runs in CI behind the integration gate (**A-R1.1**, #93).
- [x] **A-R4** complete (#90) — OPERATOR/VIEWER negative-boundary tests green.
- [x] **A-H3** complete (#94) — contact-methods businessId guard \+ test.
- [ ] *(If widget is the channel)* **A-R5** built under Area C with ingest isolation tests. *(open — Area C)*
- [ ] *(If AI on)* **A-R6 / Area B** AI context isolation \+ provenance \+ `aiMode` \+ kill switch. *(open — Area B)*

### Before TWO or THREE separate real businesses

- [ ] All one-business gate items.  
- [ ] **A-H1** composite FK hardening applied and constraint-tested.  
- [ ] **A-H2** assignee-is-member check.  
- [ ] **A-R1** extended with concurrent multi-tenant tests (parallel requests do not bleed via pool/cache).  
- [ ] **A-H4** middleware backstop applied (recommended before widening exposure).

---

## 8\. Model Recommendations

| ID | Model | Rationale |
| :---- | :---- | :---- |
| A-R3 | **Claude Opus 4.8 High** | Security-critical verification of the core membership/suspension control |
| A-R2 | **Claude Opus 4.8 High** | Security-critical fail-closed guard; subtle env/config edge cases |
| A-R1 | **Claude Opus 4.8 High** | Real-DB tenant-isolation harness — the load-bearing safety evidence |
| A-H3 | **Claude Opus 4.8 High** | Tenant-isolation-sensitive query change |
| A-H1 | **Claude Opus 4.8 High** | Migration/FK hardening; data-safety review |
| A-H4 | **Claude Opus 4.8 High** | Structural auth backstop touching every tenant route |
| A-R4 | **Claude Sonnet 4.6** | Bounded, lower-risk RBAC boundary tests over a verified catalog |
| A-H2 | **Claude Sonnet 4.6** | Small, well-scoped assignment check \+ test |
| A-R5 | **Claude Sonnet 4.6** | Planning/documentation (Area C); no security-critical build here |
| A-R6 | **Claude Sonnet 4.6** | Handoff documentation to Area B |

Models offered by the owner but not selected: Gemini 3.1 Pro High / Gemini 3.5 Flash High — not assigned, as the security-critical items are kept on Opus 4.8 and the bounded items on Sonnet 4.6 for consistency with the established delegation policy. They remain available if the owner prefers them for the Sonnet-class items.

---

## 9\. Risks and Non-Goals

- **No real PII** before the one-real-business gate (A-R2, A-R3, A-R1, A-R4, A-H3) is green.  
- **No Area B implementation** in this plan — AI context/provenance/`aiMode` is handoff only.  
- **No real widget traffic** — widget ingest is Area C planning only.  
- **No AI auto-send** under any configuration (PRD-v1.1 anti-scope).  
- **No RLS** for Alpha unless a concrete future risk demands it.  
- **No policy engine** (OPA/Cedar/DSL), no enterprise authorization engine, no full skill-based routing, no assigned-only access, no full billing enforcement, no MCP architecture.  
- **Verified architecture preserved** — Auth.js adapter, route-param validation, RBAC catalog, and shared business queue remain unchanged.

---

## 10\. Output / Commit Readiness

- **Ready to commit** as `docs/audits/AREA-A-remediation-plan.md` — yes, as **PROPOSED**, pending owner approval to mark accepted.  
- **Implementation prompts** (Claude Code) may be generated **after owner approval**, per-workstream, starting with the first wave (A-R2, A-R3) then A-R1. Not produced here.  
- **Area B may run in parallel** after this plan is accepted, since A-R6 hands Area B its fixed inputs and the Area A test/guard work does not depend on AI runtime. Area C (widget) is gated on whether the widget is partner \#1's channel.  
- **Next immediate step:** owner approves this plan → generate the A-R2 \+ A-R3 implementation prompts (first wave) and begin Area A gate closure, while optionally kicking off the Area B audit in parallel.

---

*Area A remediation plan — PROPOSED, 2026-06-13. Closes the Area A real-data blockers without redesign. Real customer PII remains gated behind §7. PRD-v1.1 and the Area A audit are unchanged.*  
