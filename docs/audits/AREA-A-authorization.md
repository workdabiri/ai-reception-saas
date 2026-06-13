# Area A — Authorization Architecture Audit

**Product:** AiA Reception SaaS **Scope:** Authorization Architecture — Tenant Isolation \+ RBAC \+ ABAC **Status:** VERIFIED / CONDITIONAL **Date:** 2026-06-13 **Source of truth:** PRD-v1.1 (LOCKED, 2026-06-13) **Audit type:** Evidence-based source verification (post evidence-bundle) **Backend repo:** `workdabiri/ai-reception-saas`

This audit verifies the authorization architecture against actual backend source and Prisma migrations from the Area A evidence bundle. Current-implementation claims are labelled **\[VERIFIED\]** (read in source/migration), **\[VERIFIED-TEST\]** (confirmed by a test file), or **\[NEEDS FILE\]** (not present in the bundle; inferred from contract). No code, implementation tasks, or Claude Code prompts are included. PRD-v1.1 is unchanged.

---

## 1\. Title and Status

| Field | Value |
| :---- | :---- |
| Title | Area A — Authorization Architecture Audit |
| Product | AiA Reception SaaS |
| Scope | Tenant Isolation \+ RBAC \+ ABAC |
| Status | **VERIFIED / CONDITIONAL** |
| Date | 2026-06-13 |
| Source of truth | PRD-v1.1 (LOCKED) |

---

## 2\. Executive Summary

The intended authorization design is **sound and now source-verified**. The Auth.js tenant adapter validates membership against the exact path `businessId`, never falls back to the header for route-param scope, and rejects non-members. Route handlers follow a consistent validate → resolve-tenant → assert-match → require-permission sequence, and repositories scope by `businessId`. The previous audit's central unknowns are resolved; two prior blockers are downgraded. The remaining gate is **test depth and one deployment-config risk**, not architecture.

| Scenario | Verdict |
| :---- | :---- |
| Synthetic / internal test data | **PASS** (keep dev-bypass flags off shared envs) |
| One real design-partner business | **CONDITIONAL PASS** (pre-real-data blockers in §10) |
| Two–three separate real businesses | **CONDITIONAL PASS** (§10 \+ concurrency \+ FK hardening) |
| **Real customer PII allowed now?** | **NO** |

**Top security findings:**

1. **Auth.js tenant adapter verified correct** — route-param `businessId` is membership-checked via DB; header is not consulted for route-param scope; non-member/inactive → 403\.  
2. **Real-DB cross-tenant isolation tests for customers/conversations/messages/reply-drafts are missing** — the hard PRD-v1.1 §9 gate before real customer PII.  
3. **Dev-bypass adapter is a concrete, env-gated risk** — `ENABLE_DEV_AUTH_CONTEXT` trusts `x-dev-*` headers with no DB check; requires an enforced deployment guard.  
4. **Tenant-isolation FKs are uneven** — `Message` has a strong composite FK; `ReplyDraft → Conversation` and `Conversation → Customer` use plain-id FKs and need hardening.  
5. **No single middleware chokepoint** — enforcement is per-handler by convention (currently consistent), and services trust the handler for permission checks.  
6. **No Major Redesign is warranted.**

---

## 3\. Evidence Reviewed

**Source-verified (read in source):**

- `prisma/schema.prisma` and `prisma/migrations/**` (6 migrations).  
- `src/app/api/_shared/authjs-context-adapter.ts`, `auth-context-adapter.ts`, `request-context.ts`, `route-handler.ts`, `handler.ts`.  
- `src/domains/authz/permissions.ts`, `service.ts`, `implementation.ts`.  
- Business route handlers: `businesses/[businessId]/conversations/route.ts` \+ `handler.ts`.  
- Reply-draft handlers: `.../reply-drafts/[draftId]/approve/route.ts` \+ `handler.ts`.  
- Repositories: `src/domains/crm/repository.ts`, `src/domains/reply-drafts/repository.ts`.  
- `docs/product/PRD-v1.1.md` (LOCKED scope reference).

**Test-verified (read in test source):**

- `__tests__/api/authjs-request-context-adapter.test.ts` — adapter denial paths.  
- `__tests__/api/reply-draft-approve-handler.test.ts` — handler cross-tenant rejection.  
- `__tests__/domains/conversations-service.test.ts` — service wrong-business → null.  
- `__tests__/api/businesses-handler.test.ts` — membership-scoped listing.  
- `__tests__/domains/tenant-identity-services.test.ts`, `tenant-identity-validation.test.ts` — VIEWER negative.  
- `__tests__/integration/tenant-identity-repositories.integration.test.ts` — gated real-DB test (identity/tenancy/audit only).

**Still unverified (not in bundle) \[NEEDS FILE\]:**

- `src/domains/tenancy/repository.ts` / `resolveTenantContext` — the `status = ACTIVE` membership query and any business-suspension check.  
- `src/domains/conversations/repository.ts` implementation.  
- Audit and identity domain implementations.

---

## 4\. Source-Verified Findings

| \# | Finding | Evidence |
| :---- | :---- | :---- |
| 1 | **Auth.js tenant context adapter** resolves session via cookies, then membership via DB resolver; builds `TenantRequestContext{userId, businessId, membershipId, role}`. | \[VERIFIED: authjs-context-adapter.ts\] |
| 2 | **Route-param `businessId` never falls back to header** — `if (scope.source === 'route-param') return normalizeBusinessId(scope.businessId)`. | \[VERIFIED\] |
| 3 | **DB membership check** against the exact path `businessId` via `tenantMembershipResolver({userId, businessId})` → `tenancyService.resolveTenantContext`. | \[VERIFIED\] |
| 4 | **Non-member / inactive rejection** — missing scope → 403 `TENANT_CONTEXT_REQUIRED`; resolver failure → 403 `ACCESS_DENIED`. | \[VERIFIED\] \+ \[VERIFIED-TEST: authjs-request-context-adapter.test.ts\] |
| 5 | **Trusted `TenantRequestContext`** — typed contract carries DB-resolved businessId/role; handlers derive scope from it, not raw input. | \[VERIFIED: request-context.ts\] |
| 6 | **Frontend `businessId` is UX only** — path param \+ `assertBusinessRouteMatchesTenant` re-check; header path still membership-validated. | \[VERIFIED: business-context.tsx, conversations/handler.ts\] |
| 7 | **Handler-level authorization pattern** — validate UUID → resolve tenant (route-param) → assert match → `requirePermission` → service(businessId). Consistent across handlers inspected. | \[VERIFIED: conversations/handler.ts, approve/handler.ts\] |
| 8 | **RBAC catalog** — OWNER(all), ADMIN(all−business.delete), OPERATOR(ops set incl. ai\_drafts.approve/send, conversations.assign/close), VIEWER(read-only). `requirePermission` stateless role→permission. | \[VERIFIED: authz/permissions.ts, implementation.ts\] |
| 9 | **Repository businessId filtering** — `findUnique`\-by-id then app-check `record.businessId !== businessId → null`; list queries `where:{businessId}`. | \[VERIFIED: crm/repository.ts, reply-drafts/repository.ts\] |
| 10 | **Schema constraints** — `conversations UNIQUE(id, business_id)`; `messages` composite FK `(conversation_id, business_id)`; no RLS. | \[VERIFIED: migrations\] |
| 11 | **Test coverage** — adapter denial, handler cross-tenant 403, service wrong-business→null, VIEWER negative all unit/mock-tested; real-DB isolation for CRM/conversations/messages/reply-drafts absent. | \[VERIFIED-TEST\] |

---

## 5\. Authorization Architecture Assessment

**Tenant model.** Single-level tenancy rooted at `Business`; `BusinessMembership(userId, businessId, role, status)` with `@@unique([userId, businessId])`; users may belong to many businesses. Sound. \[VERIFIED\]

**RBAC.** Centralized hardcoded role→permission map; enforced at the handler layer via `requirePermission`. Functionally adequate for Alpha; shared queue fits the OPERATOR grant set. \[VERIFIED\]

**ABAC.** The foundational ABAC decision — membership-scoped role for a specific business — is already implemented as the tenant context. Attributes still missing backing data: `aiMode` per business, verified/unverified context provenance, channel/widget key. These are needed only on the AI/widget paths. No policy engine is warranted. \[VERIFIED / partial\]

**Server-side business context resolution.** Authoritative: the adapter resolves and validates membership server-side for the exact path `businessId`; route-param scope ignores the header. \[VERIFIED\]

**Shared business queue.** Safe for Alpha — any member-operator may see the business's conversations; this is a business-data-visibility choice, not a tenant-isolation change. \[VERIFIED — fits RBAC\]

**Future assigned-only compatibility.** `Conversation.assignedUserId` exists; assigned-only access layers on later as one ABAC predicate (`resource.assignedUserId == actor.userId`) without redesign. \[VERIFIED — field present\]

**Dev-bypass adapter risk.** `createDevHeaderAuthContextAdapter` trusts `x-dev-user-id/business-id/membership-id/role` with no DB check. `getDefaultAuthContextAdapter()` selects the real Auth.js adapter only when `ENABLE_AUTHJS_REQUEST_CONTEXT==="true"`; otherwise the dev adapter (inert unless `ENABLE_DEV_AUTH_CONTEXT==="true"`). Real-data safety depends on env config. \[VERIFIED: auth-context-adapter.ts\]

**Route-level enforcement.** Present and consistent per handler. \[VERIFIED\]

**Service-layer defense-in-depth gap.** Services do not re-check permissions (trust the handler). Acceptable for Alpha since all entry paths are route handlers; defense-in-depth improvement, not a blocker. \[VERIFIED\]

**Lack of middleware chokepoint.** `route-handler.ts`/`handler.ts` provide only feature-gating \+ error boundary; no middleware guarantees every route resolves tenant context. Risk is a future route that omits the sequence. \[VERIFIED\]

---

## 6\. Tenant Isolation Assessment

**Current businessId enforcement.** Application-layer: every tenant-scoped query carries/validates `businessId`. No RLS. \[VERIFIED\]

**Boundaries by model:**

- **Customer** — `businessId` column \+ app-check on `findCustomerById`; list scoped by `businessId`. \[VERIFIED\]  
- **Conversation** — `UNIQUE(id, business_id)`; app-checked reads. \[VERIFIED\]  
- **Message** — **strong composite FK** `(conversation_id, business_id) → conversations(id, business_id)`; cannot attach across tenants at the DB level. \[VERIFIED\]  
- **ReplyDraft** — `businessId` column \+ app-check (`findByBusinessConversationAndId` rejects businessId/conversationId mismatch), but FK to Conversation is **plain id**. \[VERIFIED\]

**Strong Message composite FK.** Best-practice defense-in-depth; the reference pattern to extend. \[VERIFIED\]

**Weak ReplyDraft and Conversation→Customer plain-id FKs.** `reply_drafts.conversation_id → conversations(id)` and `conversations.customer_id → customers(id)` are plain-id FKs — uneven vs Message. Reads on traced paths are app-checked, so no open leak observed; a future query that skips the app-check would leak. **Targeted hardening.** \[VERIFIED: migrations\]

**Assignee membership issue.** `conversations.assigned_user_id → users(id)` has no constraint that the assignee is a member of the business. **Targeted hardening** (add an app/test check before assignment). \[VERIFIED\]

**Contact-methods businessId guard.** `crm.listContactMethods` filters by `customerId` only; relies on prior customer-ownership validation. Add an explicit `businessId` guard \+ test. \[VERIFIED — recommendation\]

**RLS decision.** **Do not implement RLS now.** The cohort is tiny (1→3 businesses); app-layer filtering \+ composite FKs \+ a real-DB isolation test suite is proportionate; RLS under Prisma adds real complexity. Revisit post-MVP only if isolation tests reveal systemic missed filters, the team cannot guarantee tenant-context resolution on every route, or sensitivity/scale rises. \[Rec\]

---

## 7\. Test Coverage Assessment

**Verified unit/mock tests (present):**

- Adapter denial paths: unauthenticated 401, missing/empty scope 403, non-member `ACCESS_DENIED`, flag gates. \[VERIFIED-TEST\]  
- Handler cross-tenant rejection: path `businessId` ≠ context → 403 (mocked context). \[VERIFIED-TEST\]  
- Service wrong-business → null (mocked repo). \[VERIFIED-TEST\]  
- Membership-scoped business listing (mocked). \[VERIFIED-TEST\]  
- RBAC negative: VIEWER cannot `messages.create`. \[VERIFIED-TEST\]

**Verified integration tests (present):**

- One gated real-DB test (`RUN_INTEGRATION_TESTS=true`) covering **identity/tenancy/audit** repositories only; cleanup touches users/businesses/memberships/sessions/audit. \[VERIFIED-TEST\]

**Missing real-DB cross-tenant tests:**

- No real-database test executes queries across two businesses' rows for **customers, conversations, messages, or reply-drafts**. Mocks assume the Prisma query filters correctly; nothing proves it against a live database for the PII-bearing domains.  
- RBAC OPERATOR negative-boundary coverage (cannot `business.delete` / `members.*`) is thin.  
- AI context isolation and widget-key isolation: not applicable yet (features absent).

**Hard pre-real-data gate:** real-DB cross-tenant isolation tests for **customers, conversations, messages, and reply-drafts** must exist and pass before any real customer PII is used. This is the single most important open item and is mandated by PRD-v1.1 §9.

---

## 8\. Updated Verdict

| Scenario | Verdict | Conditions |
| :---- | :---- | :---- |
| Synthetic / internal data | **PASS** | Dev-bypass flags off in shared environments |
| One real design-partner business | **CONDITIONAL PASS** | §10 blockers 1–4 (and 5/6 if widget/AI on) |
| Two–three separate real businesses | **CONDITIONAL PASS** | §10 \+ concurrent multi-tenant tests \+ composite-FK hardening |
| **Real customer PII now** | **NO** | Conditions not yet met |

---

## 9\. Decision Matrix

| Item | Classification | Pre-real-data blocker? |
| :---- | :---- | :---- |
| authjs-context-adapter | Continue as-is (verified correct) | No |
| request context | Continue as-is | No |
| Route-level auth (per-handler) | Continue as-is (consistent) | No |
| Middleware / chokepoint | Targeted Refactor | No |
| Service-layer authz | Targeted Refactor | No |
| Dev-bypass adapter / env flags | Targeted Refactor (enforced deploy guard) | **Yes** |
| Repository filtering | Continue as-is (+ contact-methods guard) | No |
| RBAC catalog | Continue as-is | No |
| ABAC readiness (aiMode/provenance/widget-key) | Medium Architecture Correction | Partial (AI/widget paths) |
| Composite FK hardening | Targeted Refactor | Recommended pre-scale |
| Reply-draft isolation | Continue as-is (app-checked) | No |
| Customer / conversation isolation | Continue as-is (app-checked) | No |
| Real-DB cross-tenant tests | **Blocker before real data** | **Yes** |
| AI context isolation | Medium Architecture Correction | Yes (before AI on real data) |
| Web widget ingest | Medium Architecture Correction | Yes (before real widget) |
| RLS | Continue as-is (no RLS; risk-triggered later) | No |

No item is classified **Major Redesign**.

---

## 10\. Pre-Real-Data Blockers

Exact blockers before any real customer PII:

1. **Real-DB cross-tenant isolation tests** for customers, conversations, messages, and reply-drafts — extend the existing gated integration harness; assert business-A context cannot read/write business-B rows, and wrong-`businessId` → null/403. *(Hard PRD-v1.1 §9 gate.)*  
2. **Dev-bypass deployment guard** — assert `ENABLE_AUTHJS_REQUEST_CONTEXT=true` and `ENABLE_DEV_AUTH_CONTEXT` / `VITE_DEV_BUSINESS_ID` are off in any real-data environment (startup assertion \+ CI/deploy check \+ test).  
3. **Confirm `resolveTenantContext` filters ACTIVE memberships and blocks suspended/archived businesses** — upload the tenancy repository; add a test.  
4. **OPERATOR negative-boundary tests** — OPERATOR cannot `business.delete` / `members.*`.  
5. **Widget-key / ChannelConnection model \+ public ingest isolation test** — required only if the embeddable widget is the first design partner's channel.  
6. **AI context isolation \+ provenance \+ `aiMode`** — required only if AI is enabled on real customer data (owned by Area B).

**Recommended pre-scale hardening (not hard blockers):**

- Composite FK hardening — even up `ReplyDraft → Conversation` and `Conversation → Customer` to the `Message` composite pattern.  
- Assignee-is-member check before assignment.  
- Contact-methods `businessId` guard in `listContactMethods`.  
- Auth/tenant middleware backstop to replace per-handler convention with a structural chokepoint.

---

## 11\. What Is Allowed Now

- **Synthetic / internal test-business data:** allowed.  
- **Implementation planning for Area A gate-closing work:** allowed (planning artifacts only).  
- **Real partner onboarding:** not allowed yet.  
- **Real customer PII:** not allowed yet.

---

## 12\. What Is Not Allowed Yet

- No real customer PII.  
- No real partner data.  
- No AI prompts containing real customer data.  
- No real web-widget traffic.  
- No expansion to multiple real businesses until the §10 gate tests pass.

---

## 13\. Recommended Next Step

1. **Commit this audit document** at `docs/audits/AREA-A-authorization.md`.  
2. **Produce an Area A remediation plan** sequencing the §10 blockers and pre-scale hardening (with per-task risk and recommended models) — planning artifacts only, no code.  
3. **Run Area B — AI Runtime for Safe Level 2** once the Area A gate-closing scope is clear; Area B owns blockers 5–6 and the §5.1 provenance requirement and can proceed in parallel with the Area A test/dev-guard work.

---

## 14\. Appendix

**Unresolved evidence gaps \[NEEDS FILE\]:**

- `src/domains/tenancy/repository.ts` / `resolveTenantContext` — exact `status = ACTIVE` membership query and business-suspension handling.  
- `src/domains/conversations/repository.ts` implementation.  
- Audit and identity domain implementations.

**Files still useful to inspect if available:**

- The tenancy repository (to close blocker 3 by direct source read).  
- Deployment/env configuration (to confirm the dev-bypass guard contract).  
- Auth.js runtime/session config (cookie flags: httpOnly, SameSite, expiry).

**Governance:**

- **No PRD-v1.1 amendment required** — findings implement locked scope; they do not change it.  
- **No Major Redesign required** — the architecture is verified sound; remaining work is targeted hardening, test depth, and one deployment-config guard.

---

*Area A authorization audit — VERIFIED / CONDITIONAL, 2026-06-13. Source-verified against the Area A evidence bundle. Real customer PII remains gated behind the §10 blockers. PRD-v1.1 unchanged.*  
