# Area A — Closure Checkpoint

**Product:** AiA Reception SaaS
**Scope:** Backend Authorization / Tenant Isolation + RBAC + ABAC — Gate Closure Record
**Status:** CLOSED (backend authorization / tenant-isolation data plane)
**Date:** 2026-06-15
**Closes through:** PR #94
**Source documents:** `docs/product/PRD-v1.1.md` (LOCKED) · `docs/audits/AREA-A-authorization.md` (VERIFIED/CONDITIONAL) · `docs/audits/AREA-A-remediation-plan.md` (PROPOSED → executed)

This is a **status checkpoint only**. It records the closure of the Area A backend authorization / tenant-isolation remediation through PR #94. It does **not** rewrite or supersede the historical audit (`AREA-A-authorization.md`) or the remediation plan (`AREA-A-remediation-plan.md`); both are preserved as historical context. This checkpoint is the **current status reference** for Area A.

It makes a deliberately narrow claim. **Area A backend tenant isolation is closed. The full private-alpha product is not declared real-data-ready** — that remains conditional on Area B (AI runtime) and Area C (public widget ingest) plus the operational checks in §6.

---

## 1. Repository State After PR #94

The Area A remediation sequence (remediation-plan §6) has been executed and merged. Each workstream maps to a merged PR on the default branch history:

| PR | Workstream | Commit subject |
| :---- | :---- | :---- |
| #87 | A-R2 — Dev-bypass deployment guard | `fix(auth): guard dev auth bypass in real-data envs` |
| #88 | A-R3 — Deny tenant context for inactive businesses | `fix(tenancy): deny context for inactive businesses` |
| #89 | A-R1 — Real-DB cross-tenant isolation tests | `test(security): add cross-tenant isolation integration coverage` |
| #90 | A-R4 — RBAC negative-boundary tests | `test(security): add RBAC negative-boundary coverage` |
| #91 | A-H4 — Tenant route alignment backstop | `fix(security): add tenant route alignment backstop` |
| #92 | A-H4.2 — Consolidate tenant-route guards + meta-test | `refactor(security): consolidate tenant route guards` |
| #93 | A-R1.1 — Run real-DB tenant-isolation suite in CI | `ci(security): run tenant isolation integration gate` |
| #94 | A-H3 — Scope contact-method listing by `businessId` | `fix(security): scope contact methods by business` |

Anchoring source state (read-only spot checks, not changed by this checkpoint):

- Contact-method listing is scoped by tenant — `listContactMethods(customerId, businessId)` in `src/domains/crm/repository.ts` (A-H3 / PR #94).
- A shared tenant-route guard exists at `src/app/api/_shared/tenant-route-guard.ts` (A-H4 / A-H4.2, PR #91 / #92).
- The CI workflow `.github/workflows/ci.yml` runs the gated tenant-isolation integration suite (A-R1.1 / PR #93).

---

## 2. Completed Controls

| Control | Workstream / PR | State |
| :---- | :---- | :---- |
| Dev-bypass deployment guard — real-data environments cannot enable `ENABLE_DEV_AUTH_CONTEXT` / `VITE_DEV_BUSINESS_ID` header trust | A-R2 / #87 | **Closed** |
| Tenant-context denial for inactive / suspended businesses (ACTIVE-membership + suspended-business resolution) | A-R3 / #88 | **Closed** |
| Real-DB cross-tenant isolation tests — customers, contact-methods, conversations, messages, reply-drafts (PRD-v1.1 §9 hard gate) | A-R1 / #89 | **Closed** |
| RBAC negative-boundary coverage — OPERATOR cannot `business.delete` / `members.*`; VIEWER write denials | A-R4 / #90 | **Closed** |
| Tenant route alignment backstop — structural chokepoint replacing per-handler convention | A-H4 / #91 | **Closed** |
| Consolidated tenant-route guards + meta-test enumerating tenant-scoped routes | A-H4.2 / #92 | **Closed** |
| Real-DB tenant-isolation integration suite runs in CI (gated) | A-R1.1 / #93 | **Closed** |
| Contact-method repository listing scoped by `businessId` (last unscoped list query) | A-H3 / #94 | **Closed** |

These controls correspond to the Area A audit's pre-real-data blockers 1–4 (`AREA-A-authorization.md` §10) plus the recommended contact-method and middleware-backstop hardening. Blockers 5 (widget ingest) and 6 (AI context isolation) are **out of Area A** and remain open under Area C / Area B respectively (§5).

---

## 3. Verdict

> **Area A backend authorization / tenant-isolation verdict: GREEN.**
>
> The backend / operator data plane — tenant isolation, RBAC boundary coverage, the dev-bypass deployment guard, tenant route alignment, contact-method scoping, and the CI integration gate — is closed through PR #94.

> **Full private-alpha real-data verdict: CONDITIONAL — NOT GREEN if AI (Area B) or the public web widget (Area C) is in scope** for the first real-data cohort.
>
> Area A closure does **not** by itself authorize real customer PII for the full product. Real-data readiness additionally requires Area B (AI runtime, tenant-scoped AI context assembly, verified/unverified provenance, `aiMode`, kill switch) before AI touches real customer data, and Area C (widget-key → business mapping and public-ingest isolation) before any real public widget traffic — plus the operational checks in §6.

**Scope of the GREEN verdict (explicit).** GREEN applies to the backend authenticated operator/admin data plane only: server-side tenant-context resolution, per-route tenant alignment, RBAC enforcement, repository `businessId` scoping, and the real-DB isolation evidence. It does **not** extend to AI prompt-context isolation or unauthenticated public-ingest paths, which are not Area A surfaces.

The historical scenario verdicts in `AREA-A-authorization.md` §8 (e.g. "Real customer PII now: NO") were written pre-remediation and are preserved as historical context. This checkpoint supersedes them **only for the backend tenant-isolation data plane**, and only to the extent stated above — it does not lift the AI/widget conditions.

---

## 4. Remaining Non-Blocking Area A Hardening

These are **pre-scale** items (relevant before two–three concurrent real tenants), not blockers to the backend Area A GREEN verdict. They remain open by design.

| Item | Workstream | Note |
| :---- | :---- | :---- |
| Composite FK hardening — even up `ReplyDraft → Conversation` and `Conversation → Customer` to the `Message` composite `[id, business_id]` pattern | A-H1 | **Open.** Migration review; reads are app-checked today, so no open leak observed |
| Assignee-is-member check — reject assigning a conversation to a non-active-member | A-H2 | **Open.** Application + test check; exercised once assignment is used |
| Stronger route-backstop enforcement — AST/ESLint rule or typed route wrapper instead of the meta-test convention | (A-H4 hardening) | **Open.** Strengthens the structural chokepoint against future bypass regressions |

None of these block the first single real-business backend gate; they harden the path to multi-tenant scale.

**Update — Concurrent multi-tenant isolation tests: completed (PR #115, merge commit `b9a0eb3`).** The previously-open concurrent multi-tenant isolation item (A-R1 extension) — proving parallel requests do not bleed across tenants via connection pool or cache — is now **closed**: a real-DB concurrent tenant-isolation suite was merged in PR #115 and the real-DB **Tenant Isolation Integration** (A-R1) CI gate passed. This was a pre-scale hardening item, not a blocker to the Area A backend GREEN verdict. The remaining items above (A-H1 composite FK hardening, A-H2 assignee-is-member check, and the route-backstop hardening) **remain open by design**. This update closes one non-blocking hardening item only; it does not declare all Area A future hardening complete, and it does not change the §3 verdict or lift the §5 conditional blockers (Area B / AI, Area C / widget).

---

## 5. Remaining Conditional Blockers Outside Area A

These are **hard conditions** for full private-alpha real-data readiness when the corresponding surface is in scope. They are **not** Area A items and are **not** closed by this checkpoint. Do not treat Area A GREEN as covering them.

- **Area B — AI runtime / provenance (conditional blocker if AI is enabled on real data).** Tenant-scoped AI context assembly driven by `TenantRequestContext`; a verified/unverified provenance flag on injected business context (PRD-v1.1 §5.1); `Business.aiMode` gating L1/L2; a kill switch. AI must be structurally incapable of reading another tenant's data before real customer data enters any prompt (PRD-v1.1 §9).
- **Area C — public web widget ingest (conditional blocker if real widget traffic is used).** Widget-key → business mapping; public-ingest isolation (origin allowlist, rate limiting, abuse protection, anonymous `Customer` creation scoped to the key's business, client-sent `businessId` ignored). No cross-tenant leakage via the widget key (PRD-v1.1 §11).

If neither AI nor the public widget is in scope for the first design-partner business, these remain open but do not block that specific, narrowed real-data configuration. They become blocking the moment AI or widget ingest is turned on for real data.

---

## 6. Operational Checks (Outside the Codebase)

Area A code closure is necessary but not sufficient. The following operational/runtime conditions must hold before real customer PII, and are **not** provable from the repository alone:

- **Required GitHub checks / branch protection.** Branch protection on the default branch must **require** the CI checks — including the tenant-isolation integration gate (A-R1.1 / PR #93) — so the isolation suite cannot be merged around. A passing CI run is not equivalent to an enforced required check.
- **Production env contract for Auth.js real-data mode.** The production runtime must set the real-data auth envs correctly: `ENABLE_AUTHJS_REQUEST_CONTEXT=true`, with `ENABLE_DEV_AUTH_CONTEXT` and `VITE_DEV_BUSINESS_ID` unset/false. The A-R2 guard (PR #87) fails closed if these are misconfigured; the operational requirement is that the deployed environment is verified to satisfy the contract, not only that the guard exists.

---

## 7. Current Status Reference

This document is now the **current status reference** for Area A. The historical audit (`AREA-A-authorization.md`) and remediation plan (`AREA-A-remediation-plan.md`) are preserved unchanged in substance as historical context; the remediation plan's workstream completion is annotated against this checkpoint.

**Recommended next step after this docs closure:** begin (or continue) the **Area B — AI Runtime for Safe Level 2** audit/build — tenant-scoped AI context assembly, verified/unverified provenance, `aiMode`, and kill switch — since AI is the next conditional blocker for full private-alpha real-data readiness (PRD-v1.1 §5.1, §9, §16). Area C (widget ingest) follows if the web widget is the first design partner's channel. In parallel, confirm the operational checks in §6 (required CI checks via branch protection; production Auth.js env contract).

---

*Area A closure checkpoint — backend authorization / tenant-isolation GREEN through PR #94, 2026-06-15. Full private-alpha real-data readiness remains conditional on Area B (AI) and Area C (widget) and the §6 operational checks. PRD-v1.1, the Area A audit, and the Area A remediation plan are preserved as historical context.*
