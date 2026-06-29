# PRD-v1.1 — Amendment to PRD-v1 (AiA Reception SaaS)

**Status:** LOCKED (owner approved, 2026-06-13) **Date:** 2026-06-13 **Version:** 1.1 (Amendment) **Supersedes:** PRD-v1.0 *for Private Alpha scope only* **Baseline retained:** PRD-v1.0 (`PRD-v1.md`, locked 2026-05-22) **Backend repo:** `workdabiri/ai-reception-saas` **Frontend repo:** `workdabiri/ai-reception-saas-a7cff9d2`

This amendment is a **reconciliation layer**, not a rewrite. PRD-v1.0 remains the original locked product baseline. Sections below override or clarify PRD-v1.0 **only where explicitly stated**, and only for Private Alpha decisions. All PRD-v1.0 safety gates, domain definitions, and anti-scope rules not contradicted here remain in force.

Current-implementation statements are marked **\[Verified — repo\]** where confirmed against `schema.prisma`, `mvp-scope.md`, the project source files, or `HANDOFF_FROM_ANTIGRAVITY.md`. Forward-looking statements are marked **\[Design intent\]**.

---

## 1\. Purpose of Amendment

PRD-v1.1 reconciles the original locked baseline with the owner-confirmed Private Alpha direction validated in the Business Direction Validation gate. It exists because PRD-v1.0 and the owner's intended alpha diverge in **both** directions: PRD-v1.0 defers some items the owner wants in alpha (a billing/plan surface), and includes in its S2 milestone several items the owner wants deferred (full onboarding wizard, lead capture, action requests, full knowledge lifecycle).

This amendment reconciles:

- the **original PRD-v1.0 locked baseline** (retained, not discarded);  
- the **owner-confirmed Private Alpha scope** (now canonical for alpha);  
- the **two-repo implementation reality** (backend API \+ frontend TanStack Start), correcting PRD-v1.0's "single Next.js modular monolith" label;  
- the **UAE / Dubai, English-first** launch direction;  
- the **real-estate-first but multi-vertical** product strategy;  
- the **three AI operating levels** (Manual / AI-Assisted / Auto Pilot);  
- **Level 2 / AI-Assisted as the alpha product target**;  
- **Level 1 / Manual as the mandatory substrate and fallback**;  
- **Level 3 / Auto Pilot as future-only**;  
- **Level 2 vertical-sensitive content boundaries** for the real-estate alpha (no definitive claims without verified business context);  
- the **billing/entitlement clarification** (scaffolding, no payment capture);  
- the **RBAC \+ ABAC** access-control direction (formalizing PRD-v1.0 §12's "RBAC baseline \+ ABAC contextual constraints");  
- the **tenant-isolation hard gate** before real partner/customer data;  
- the **future MCP / third-party integration** direction (future-safe, not built in alpha).

---

## 2\. Source-of-Truth Rule

1. **PRD-v1.0 remains the original baseline.** It continues to define product identity, domain architecture, AI safety philosophy, and permanent anti-scope.  
2. **PRD-v1.1 is canonical for Private Alpha scope.** Any decision about what is in or out of Private Alpha is governed by this document.  
3. **On conflict, PRD-v1.1 controls Private Alpha decisions.** Where PRD-v1.0 and PRD-v1.1 disagree about alpha scope, PRD-v1.1 wins. Where they do not conflict, PRD-v1.0 still applies.  
4. **The next Architecture Audit uses PRD-v1.1 as its scope reference.** PRD-v1.0 is consulted for baseline architecture and safety intent; PRD-v1.1 defines what the audit treats as in-scope for alpha.  
5. **Permanent anti-scope from PRD-v1.0 §23 is not weakened** by this amendment (e.g., no auto-send before S4, no provider-specific core logic, no cross-tenant access, no vertical-specific hardcoded workflow).

---

## 3\. Canonical Private Alpha Scope — IN

The following are **in** Private Alpha. Anything not listed here or in PRD-v1.0 as a non-conflicting baseline capability is, by default, **out** (see §4).

- Operator inbox.  
- Customer management. **\[Verified — repo: `Customer`, `CustomerContactMethod` models exist\]**  
- Conversation management. **\[Verified — repo: `Conversation` model \+ status enum exist\]**  
- Message management. **\[Verified — repo: `Message` model exists\]**  
- Manual operator replies, including the **outbound message-send path** (see §16 / Area C). **\[Verified — repo (updated 2026-06-29): the human-gated operator "Send Approved Draft" path is implemented — `sendApprovedDraft` atomically writes the `ReplyDraft` send-tracking columns (`sentMessageId`/`sentAt`/`sentByUserId`) and creates an internal OUTBOUND OPERATOR `Message`. This is an internal record only; **external-channel delivery (Area C) remains net-new / not implemented**. At PRD lock time no send path existed.\]**  
- Conversation status workflow. **\[Verified — repo: `ConversationStatus` enum present\]**  
- **Level 1 / Manual Mode** as mandatory fallback and substrate (system must function with all AI disabled).  
- **Level 2 / AI-Assisted draft replies** as the alpha **product target** (net-new — current drafts are SYSTEM-source stubs with no provider). **\[Verified — repo: `ReplyDraft` CRUD exists; real AI generation does not\]**  
- **Level 2 vertical-sensitive content guardrails** for the real-estate alpha (see §5.1).  
- Human review / edit / approve / **send** of AI drafts.  
- **No AI auto-send** under any configuration in alpha.  
- Website chat as the **first** customer channel.  
- Embeddable web chat widget, **anonymous-first** with progressive contact capture (see §11).  
- Basic business profile / minimal business context for AI draft generation (a thin slice sufficient for "business-aware" drafts — **not** the full knowledge-base lifecycle).  
- Plan-selection / subscription-structure UI.  
- Entitlement scaffolding (structure-first; soft or admin-controlled limits only).  
- **No real payment capture.**  
- Google login acceptable initially. **\[Verified — repo: Google OAuth via Auth.js, staging-verified\]**  
- Future invite / email-password login must remain possible. **\[Verified — repo: `Account`, `Session`, `VerificationToken`, `BusinessMembership.INVITED` support this\]**  
- **Tenant-isolation automated tests** before any real customer/partner data (hard gate — see §9).  
- **RBAC \+ ABAC** access-control direction with a **shared business queue** alpha default (see §8).  
- Future-safe **channel adapter** boundaries (see §11).

---

## 4\. Explicitly OUT of Private Alpha

The following are **out** of Private Alpha. Each may return only if the Architecture Audit proves it is required for alpha.

- Level 3 / Auto Pilot.  
- AI direct auto-reply (any customer-facing AI autonomy).  
- Voice / telephony.  
- WhatsApp implementation (architectural readiness only — see §11).  
- Full self-serve onboarding wizard.  
- Full knowledge-base lifecycle (DRAFT → APPROVED → ARCHIVED with citations).  
- Full CRM intelligence (summaries, services-provided, follow-up scoring).  
- Advanced analytics / dashboards.  
- Full skill-based routing; assigned-only access; operator workload management.  
- Full payment gateway.  
- Real payment processing.  
- MCP implementation.  
- Notion / Slack / other third-party integrations.  
- Vertical-specific database schema.  
- Vertical-specific domain architecture (including any real-estate-specific or restaurant-specific domain/workflow).  
- Policy engine / OPA / Cedar / enterprise authorization engine — **unless a later audit proves it necessary**.  
- RLS (database-level row isolation) implementation — **unless the Area A audit finds a real leakage risk requiring it**.  
- Per-conversation / per-operator / per-channel / feature-flag AI-mode overrides (future-compatible, not alpha).

---

## 5\. AI Operating Levels

This amendment adopts the owner's three-level model as the **product-facing vocabulary**, mapped onto PRD-v1.0's finer S0–S4 engineering stages (which remain the safety reference). Mapping: **Level 1 ↔ S0**, **Level 2 ↔ S2 plus a thin business-context slice (partial S3)**, **Level 3 ↔ S4**. PRD-v1.0's S1 (internal AI classification) and S3 (full knowledge-aware drafting) remain valid engineering stages that may be partially or fully realized post-alpha.

### Level 1 — Manual Mode

- AI does not generate customer replies.  
- Humans receive, write, and send messages manually.  
- **Mandatory fallback and substrate.** The system must work fully if AI is disabled.

### Level 2 — AI-Assisted / Half Pilot Mode (Private Alpha target)

- AI generates draft replies, summaries, or contextual assistance.  
- Human operator reviews, edits, approves, and sends.  
- **No direct AI-to-customer sending.**  
- Runs **behind feature flags / kill switches**, per-business enablement.

### Level 3 — Auto Pilot Mode (future-only)

- AI replies directly to customers end-to-end.  
- Requires: strong safety controls, business-rule maturity, reliable knowledge configuration, conversation monitoring, audit logging, human override, quality evaluation, tenant isolation, error recovery, confidence/risk gating, and clear liability boundaries.  
- Cannot be enabled before PRD-v1.0 S4 gates pass.

### AI Mode Resolution (Alpha)

- AI mode is resolved at the **business level**. A business operates in either **Level 1 (Manual)** or **Level 2 (AI-Assisted)**.  
- **Alpha default:** per-business AI mode.  
- Per-conversation, per-operator, per-channel, and feature-flag-level overrides are **not required** in alpha, but the architecture must **not block** them as future options.

### 5.1 Level 2 Content Boundaries — Vertical-Sensitive (Real-Estate Alpha)

Because real-estate reception conversations may involve price, property availability, investment expectations / ROI, legal and regulatory questions, mortgage / financing, commissions, and contracts, **AI remains Level 2 / AI-assisted only in alpha**, and a human operator must review, edit if needed, approve, and send every reply.

**AI drafts must NOT make definitive claims about:**

- property availability  
- price  
- ROI  
- investment guarantees  
- legal requirements  
- regulatory requirements  
- mortgage / financing  
- commissions  
- contracts

**unless the information is explicitly present in verified business-provided context.**

**"Verified business-provided context" means:**

- business-entered profile  
- business-entered FAQ  
- business-entered minimal knowledge slice  
- business-provided structured information

**It does NOT mean:**

- model-prior knowledge  
- AI inference  
- unverified external data  
- assumptions  
- scraped or guessed market information

**Where verified business context is missing, the AI draft should:**

- hedge  
- ask for operator confirmation  
- defer to the human operator  
- suggest that the customer should be contacted by the business  
- avoid fabrication

This boundary is a **build-critical requirement for Area B** (AI runtime). It implies the minimal business-context slice must carry a **verified/unverified provenance signal**, so drafts can refuse definitive claims when verified context is absent. The same boundary pattern generalizes to future verticals (e.g., medical, financial) and is therefore a platform guardrail, not a real-estate-specific feature.

---

## 6\. Launch Market and Language Direction

- **First market:** UAE / Dubai.  
- **Launch:** English-first.  
- **Arabic:** added after core MVP is stable.  
- **Persian, Russian, others:** possible later.  
- Architecture must not lock to one locale, language, or market. **\[Verified — repo: entities are locale-aware; `User.locale` defaults `"en"`\]**  
- Existing `fa` / `Asia/Tehran` defaults are **legacy configuration** that must not define the launch direction and should be corrected to UAE/Dubai English-first defaults. **\[Verified — repo: `Business.locale` defaults `"fa"`, `Business.timezone` defaults `"Asia/Tehran"`\]**

Note: PRD-v1.0 §13 lists planned expansion as "Persian (Farsi), Arabic." For the UAE launch this amendment reorders priority to **Arabic before Persian**.

---

## 7\. Vertical Strategy — Real Estate First

- **First vertical:** real estate.  
- **First real-data design partner:** **one** real-estate business in UAE / Dubai (one separate real business — not a department inside one business).  
- **Real-estate-first means:** go-to-market focus, first vertical template, first demo/customer workflow, first business-profile assumptions, first AI prompt examples, first lead/customer conversation examples.  
- **Real-estate-first does NOT mean:** real-estate-specific schema, real-estate-specific domain architecture, hardcoded property workflow, real-estate-only CRM structure, or real-estate-only product foundation.  
- **Future planned verticals:** restaurants / food-service, polyclinics / medical clinics, salons, service businesses. (Restaurants / food-service is a **future** vertical, **not** the first vertical.)  
- The product foundation remains a **general AI Reception SaaS** with configurable vertical templates. **\[Verified — repo \+ PRD-v1.0 §8: templates are configuration/data; no vertical model in schema\]**

This remains consistent with PRD-v1.0's permanent anti-scope forbidding vertical-specific hardcoded workflows. Real-estate scope lives in **template content, prompt examples, and GTM**, not in code structure. (PRD-v1.0 §8 already ships a Real Estate starter template — this is template selection, not new architecture.)

---

## 8\. Access Control Direction — RBAC \+ ABAC

Authorization **must not be RBAC-only.** RBAC is necessary but insufficient. The architecture evolves toward **RBAC \+ ABAC**, formalizing the intent already stated in PRD-v1.0 §12 ("RBAC baseline \+ ABAC contextual constraints"). **\[Verified — repo: `MembershipRole` enum \+ permission strings exist; contextual enforcement is uneven\]**

**Architectural principles:**

- Access control must be **centralized** — a single authorization decision point invoked identically from API route guards and services.  
- It must be **testable** and **extensible**.  
- Authorization rules must **not** be scattered across UI components, API routes, and services.  
- **Do not overbuild** an enterprise policy engine (OPA / Cedar / DSL) before MVP. The MVP-correct shape is one `authorize(actor, action, resource, context)` chokepoint implementing RBAC plus a small set of hard-coded ABAC predicates, with the `context` object designed to accept more attributes over time.  
- **Authorization-context resolution is load-bearing and currently weak.** Active-business and membership must be resolved authoritatively server-side; a client-supplied business identifier is not a trust boundary. **\[Verified — repo: handoff notes no middleware-level business selection; relies on `x-business-id` header/param\]**

**Operator data-scope default (Alpha): shared business queue.** Any operator who belongs to a business may see that business's conversations. This is itself an ABAC decision (`actor.businessMembership` grants read over `resource.businessId`), not a bypass of authorization. The architecture must **not block** future stricter scopes:

- **Future option:** assigned-only conversations.  
- **Future option:** skill-based routing.  
- **Future option:** operator workload management.

Do not build full skill-based routing in alpha; **do** design the authorization `context` and assignment attributes so these layer on additively.

**ABAC attributes to consider over time** (classified by whether backing data exists today):

| Attribute | Backing data today |
| :---- | :---- |
| Tenant/business membership | ✅ `BusinessMembership` |
| businessId ownership | ✅ `businessId` on tenant-scoped models |
| Role within specific business | ✅ `MembershipRole` |
| Conversation ownership / operator assignment | ⚠️ `Conversation.assignedUserId` exists; `assignConversation` not implemented |
| Sensitive action type / audit requirements | ✅ Permission strings \+ `AuditEvent` |
| Feature flags | ⚠️ Global flags exist; per-business partial |
| AI mode enabled for the business | ❌ No `aiMode` field on `Business` |
| Subscription plan / entitlement | ❌ No billing/entitlement models |
| Operator skills | ❌ Not modeled |
| Channel ownership | ❌ `channels/` is scaffold-only |
| Customer/business relationship | ✅ via `Customer.businessId` |
| Future integration permissions | ❌ Not modeled (future) |

The audit must specify which attributes are **enforced now** vs **designed as context inputs but stubbed**, so ABAC grows additively as those domains land — without blocking product growth and without a premature policy engine.

---

## 9\. Tenant Isolation and Security Gate

- Tenant isolation is a **hard pre-real-data gate.**  
- Synthetic / internal controlled test-business data may be used first.  
- **No real partner/customer PII** before automated cross-tenant isolation tests exist.  
- **AI context assembly must be proven tenant-isolated** before real customer data is used in AI prompts (AI must be structurally incapable of reading another tenant's data).  
- Application-level tenant isolation may be acceptable for alpha **only if** test coverage is strong. **\[Verified — repo: isolation is application-layer only; no RLS; single database; every repository filters `businessId`\]**  
- RLS / database-level enforcement is to be **seriously evaluated in the Area A audit**, not implemented prematurely unless the audit finds a real leakage risk or insufficient safety.

**First real-data cohort and staging.** Design partners are **separate real businesses (separate tenants)**, not departments within one business. Sequence:

1. Synthetic / internal controlled test-business data first.  
2. **One** real-estate design-partner business in UAE / Dubai.  
3. Expand to **two or three separate businesses** only after tenant-isolation tests **and** operational flow are stable.

Real customer data is used only after automated cross-tenant isolation tests pass, and AI context isolation is proven before real customer data enters any AI prompt. Because real-estate customer data carries financial intent and PII (heavier than restaurant reservations), the data-sensitivity weighting of this gate is **raised**, and isolation tests must explicitly cover the **multiple-separate-tenant** case, not only single-tenant `businessId` correctness.

Defensive detail already present: `Conversation` carries a composite unique `[id, businessId]` and `Message → Conversation` uses a composite foreign key on `[id, businessId]`, preventing cross-tenant message/conversation linking at the DB level. **\[Verified — repo\]** Coverage is uneven across other models, so this is a strength to extend, not a guarantee to rely on.

---

## 10\. Billing and Entitlements

- **No real payment capture** in Private Alpha.  
- **No dependency** on personal bank account payment flows.  
- Plan-selection / subscription structure should exist (the product must not be "free with no subscription concept").  
- Entitlement scaffolding may exist where needed to gate features.  
- Acceptable alpha options: free plan presented as a real plan, 100% discount code, or manual invoicing.  
- Future payment gateway integration must remain possible. **\[Verified — repo: `billing/` is scaffold-only; no plan/subscription/entitlement models exist — this is net-new\]**

**Entitlement dimensions (Alpha).** Entitlements are mostly **structure / scaffolding**, not aggressive enforcement. The plan model should be shaped to support future limits — **operator seats, AI draft volume, number of channels, number of businesses, and (later) conversation volume** — but for alpha use simple plan-selection / subscription structure with **soft limits or internal/admin-controlled entitlements** only. No payment/billing enforcement, no real payment capture.

The audit covers billing/entitlements as **scaffolding decoupled from any gateway**, not full payments.

---

## 11\. Channel Strategy

- **First channel:** website chat.  
- Website chat becomes **embeddable** via a script / one-line snippet.  
- Web chat must feed conversations into the inbox, customer management, and AI draft workflow.  
- Channels use **adapter boundaries**; core conversation logic never imports provider SDKs (PRD-v1.0 §7 retained).  
- **WhatsApp** is high-priority **post-alpha / near-term**, prepared architecturally as a channel adapter.  
- WhatsApp must **not block** the first alpha unless the audit later proves design partners will not participate without it.  
- Do **not** hardcode web chat or WhatsApp into core business logic.

**Visitor identity (web widget).** The embeddable widget allows **anonymous-first** chat — a visitor can start a conversation without entering email or phone. The system supports **progressive contact capture**: ask for name / phone / email when needed, let the business configure required fields later, associate the anonymous session with a `Customer` record, and merge/update customer identity when contact information becomes available. For alpha, anonymous-first is acceptable and contact capture is optional. The **widget key must securely map each conversation to the correct business**, and public-ingest-endpoint security (origin allowlist, rate-limiting, spam/abuse, no cross-tenant leakage via the widget key) remains critical — this is an Area C item.

Implementation note for the audit: `ChannelType` is currently a Prisma **enum** (`INTERNAL`, `WEBSITE_CHAT`), not a `Channel`/`ChannelConnection` table, and the `channels/` domain is scaffold-only. The audit (Area G) must decide whether the enum suffices for the web widget or whether a channel-connection table is needed before WhatsApp. **\[Verified — repo\]**

---

## 12\. Self-Serve Onboarding

- Manual onboarding is acceptable initially.  
- Architecture should **prioritize future self-serve onboarding.**  
- Long-term owner flow allows: business registration, profile completion, operator creation, channel configuration, AI behavior configuration.  
- The **full onboarding wizard is not Private Alpha** unless later proven necessary. Alpha includes only minimal business-create \+ profile.

---

## 13\. Customer Memory / CRM Intelligence

- Future direction includes customer memory and CRM intelligence: customer identity, contact methods, conversation history, notes, summaries, services discussed/provided, feedback, and follow-up opportunities.  
- **Do not build full CRM intelligence in Private Alpha.**  
- Architecture must not block extracting value from customer/conversation data later. **\[Verified — repo: `Customer.notes`, `Customer.metadata` (Json), `Conversation.metadata` provide a forward-compatible path\]**

---

## 14\. Future MCP / Third-Party Integrations

- MCP is **future / post-stable.**  
- Notion, Slack, and other third-party integrations are **future.**  
- **Do not implement MCP in MVP.**  
- Architecture should not block future integration extension points.  
- **No MCP-specific workstream in Private Alpha.**

MCP is treated as a **principle, not an artifact** in alpha: the only related action is a one-paragraph extension-point sanity check (does the domain/adapter/audit structure permit a future integration layer without core rewrites?), folded into Area G. Interpreting "future-safe" as "build an integration layer now" is the gold-plating failure mode to avoid.

---

## 15\. Architecture Reality Correction

PRD-v1.0 §2 labels the product a "single Next.js 15 modular monolith." This is corrected: that label describes the **backend only**. The product is a **two-repository split**:

| Layer | Repo | Stack |
| :---- | :---- | :---- |
| Backend API | `workdabiri/ai-reception-saas` | Next.js 15 (API only), TypeScript, Prisma, PostgreSQL |
| Frontend UI | `workdabiri/ai-reception-saas-a7cff9d2` | TanStack Start (TanStack Router \+ React 19\) via Vite, scaffolded from Lovable.dev |

**\[Verified — repo: handoff §1A\]**

Frontend/backend **contract safety** is a real audit concern because API types are **manually mirrored** between repos and the frontend has weaker automated quality gates than the backend.

---

## 16\. Audit Implications

The next Architecture Audit prioritizes the following, in this order. Rigor must not be diluted by auditing all areas equally — **Area A is run first and alone as a launch gate.**

1. **Authorization: tenant isolation \+ RBAC \+ ABAC** (launch-blocking). Inputs include the operator shared-queue default (§8) and business-provided-context provenance (verified vs unverified, §5.1).  
2. **AI runtime for safe Level 2** (build-critical). Must enforce the §5.1 vertical-sensitive content boundaries; the minimal business-context slice must carry a verified/unverified provenance flag so drafts can refuse definitive claims absent verified context.  
3. **Outbound send path \+ web chat ingest** (build-critical). Includes anonymous-first widget ingest and widget-key → business mapping security.  
4. **Frontend/backend contract safety** (quality).  
5. **Billing / entitlement scaffolding** (readiness).  
6. **Self-serve onboarding architecture** (readiness).  
7. **Future channel adapter readiness** (readiness).  
8. **MCP / integration future-safety** — small extension-point check only, folded into (7).

Real-estate-first does **not** add a new audit area and does **not** change the priority order. It **raises the bar** on Area A (more sensitive data; explicit multiple-separate-tenant isolation) and Area B (content boundaries become build-critical, not optional). It introduces **no** real-estate schema, domain, or routing work.

---

## 17\. Resolved Decisions

All prior open questions are resolved and owner-approved:

1. **Operator data scope:** shared business queue is the alpha default; assigned-only, skills, and workload management are future, designed-for not built. (§8)  
2. **AI mode granularity:** per-business resolution for alpha (L1 or L2); conversation/operator/channel/flag overrides are future. (§5)  
3. **Web widget identity:** anonymous-first with progressive contact capture and identity association/merge; widget-key business mapping and ingest security mandatory. (§11)  
4. **Entitlement dimensions:** scaffolding with soft/admin-controlled limits; future dimensions enumerated; no payment. (§10)  
5. **First real-data cohort:** one real-estate business in UAE/Dubai first, expand to 2–3 separate tenants after isolation is stable; synthetic before real. (§7, §9)  
6. **Verified business-provided context (alpha):** business-entered profile / FAQ / minimal knowledge slice / business-provided structured information — **not** model-prior knowledge, AI inference, unverified external data, assumptions, or scraped/guessed market information. (§5.1)

No open questions remain that block locking.

---

## 18\. Final Output

### 18.1 Change Summary from PRD-v1.0

| \# | Change | PRD-v1.0 | PRD-v1.1 |
| :---- | :---- | :---- | :---- |
| 1 | Source of truth | Canonical | Baseline retained; v1.1 canonical for alpha scope |
| 2 | Architecture label | Single Next.js modular monolith | Two-repo split (Next.js API \+ TanStack Start UI) |
| 3 | Private Alpha (S2) breadth | Includes onboarding wizard, lead capture, action requests, knowledge-lite | Trimmed to tighter owner scope; those four deferred |
| 4 | Billing | Out of MVP | Plan-selection \+ entitlement scaffolding in alpha; no payment capture |
| 5 | AI levels | S0–S4 stages | S0–S4 retained; mapped to owner L1/L2/L3 vocabulary; L2 \= alpha target; per-business resolution |
| 6 | AI content safety | General "no fabrication" intent | Explicit vertical-sensitive content boundaries \+ verified-context provenance (§5.1) |
| 7 | Access control | "RBAC baseline \+ ABAC contextual constraints" (under-specified) | Formalized RBAC \+ ABAC; centralized chokepoint; attributes classified; shared-queue alpha default; no policy engine in alpha |
| 8 | Tenant isolation | Tenant-scoped; cross-tenant forbidden | Hard pre-real-data gate; automated isolation tests mandatory before PII; multiple-separate-tenant coverage; RLS evaluated in Area A |
| 9 | Launch defaults | `fa` / `Asia/Tehran` legacy defaults | UAE/Dubai English-first; legacy defaults to be corrected |
| 10 | Language expansion order | Persian, then Arabic | Arabic before Persian for UAE |
| 11 | First vertical focus | None privileged | Real-estate-first (GTM \+ template \+ prompt examples only; no schema/domain coupling) |
| 12 | Channels | Web widget S2; WhatsApp deferred | Same; anonymous-first widget; WhatsApp explicitly near-term post-alpha, adapter-prepared |
| 13 | MCP / integrations | Not addressed | Future-only; non-blocking extension-point principle; no alpha workstream |

### 18.2 Change Summary from the Previous Proposed PRD-v1.1

| \# | Change | Previous proposed v1.1 | Final LOCKED v1.1 |
| :---- | :---- | :---- | :---- |
| 1 | First vertical | Restaurant-first | **Real-estate-first**; restaurants moved to future verticals |
| 2 | First real-data partner | Restaurant business | **One real-estate business** in UAE/Dubai |
| 3 | AI content boundaries | Not specified | Added **§5.1** real-estate content boundaries \+ verified-context provenance |
| 4 | AI mode granularity | Open question | Resolved: **per-business** for alpha; overrides future |
| 5 | Operator data scope | Open question | Resolved: **shared business queue** default; stricter scopes future |
| 6 | Web widget identity | Open question | Resolved: **anonymous-first** \+ progressive capture |
| 7 | Entitlement dimensions | Open question | Resolved: **structure-first scaffolding**; dimensions enumerated; no enforcement |
| 8 | First real-data cohort | Open question | Resolved: **1 business → 2–3 separate tenants** after isolation stable |
| 9 | Open Questions section | 5 open questions | Replaced by **§17 Resolved Decisions** |
| 10 | Status | PROPOSED | **LOCKED** (owner approved) |

### 18.3 Private Alpha IN / OUT Summary

| IN (Private Alpha) | OUT (deferred / future) |
| :---- | :---- |
| Operator inbox; customer/conversation/message management | Level 3 Auto Pilot; AI auto-reply |
| Manual replies \+ outbound send path | Voice; WhatsApp implementation |
| Conversation status workflow | Full onboarding wizard |
| Level 1 manual (mandatory substrate) | Full knowledge-base lifecycle |
| Level 2 AI-assisted drafts (target, flag-gated, per-business) | Full CRM intelligence; advanced analytics |
| Level 2 vertical-sensitive content guardrails (real estate) | Full skill-based routing; assigned-only; workload mgmt |
| Human review/edit/approve/send; no auto-send | Full payment gateway; real payment processing |
| Embeddable web chat widget, anonymous-first (first channel) | MCP; Notion/Slack/third-party integrations |
| Minimal verified business context for AI drafts | Vertical-specific schema / domain / routing |
| Plan-selection UI \+ entitlement scaffolding; no payment | Policy engine (OPA/Cedar) unless audit proves needed |
| Google login (invite/email-password kept possible) | RLS unless Area A finds real risk |
| Tenant-isolation automated tests before real data | Per-conversation/operator/channel AI-mode overrides |
| RBAC \+ ABAC direction; shared-queue default; future-safe channel adapters |  |

### 18.4 Recommended Next Audit Area

**Area A — Authorization Architecture: Tenant Isolation \+ RBAC \+ ABAC.** Run first and alone as a launch gate. If isolation/authorization is unsound, the remaining areas are moot for real partner data. Recommended model: **Claude Opus 4.8** (high effort).

### 18.5 Commit Readiness

This amendment is ready to commit as **`docs/product/PRD-v1.1.md`**, alongside the retained `PRD-v1.md`.

### 18.6 Status

**LOCKED by owner approval (2026-06-13).** This is the final owner-approved PRD-v1.1 direction for Private Alpha.

### 18.7 Next Step

**Architecture Audit — Area A: Authorization Architecture (Tenant Isolation \+ RBAC \+ ABAC).**

---

*Amendment locked 2026-06-13 by owner approval. Reconciles owner-confirmed Private Alpha direction with PRD-v1.0 (locked 2026-05-22). PRD-v1.0 remains the baseline; PRD-v1.1 controls Private Alpha scope.*  
