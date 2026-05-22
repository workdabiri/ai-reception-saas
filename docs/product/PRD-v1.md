# PRD-v1 — AI Reception SaaS

> **Status:** LOCKED  
> **Date:** 2026-05-22  
> **Version:** 1.0  
> **Repository:** iranservice/ai-reception-saas

---

## 1. Executive Summary

AI Reception SaaS is a multi-tenant B2B platform for AI-assisted customer reception, triage, routing, and operator workflows. It helps small and service-oriented businesses centralize inbound customer communication, preserve customer context, help operators respond faster, and prepare a safe foundation for AI-assisted drafting.

The product follows a staged AI rollout: manual-first, then internal AI classification, then human-reviewed AI drafts, then knowledge-aware drafts, and only eventually guarded auto-reply. Voice is a separate product milestone.

**MVP Foundation** delivers Stage 0 (Manual Reception) + Stage 1 (AI Internal Classification).  
**MVP Product Demo / Private Alpha** adds Stage 2 (AI Draft Assist) with website chat widget.

This document is the canonical product source of truth. Any change to product scope, domains, or customer-facing AI behavior requires a PRD amendment with human approval.

---

## 2. Product Identity

| Field | Value |
|---|---|
| Product name | AI Reception SaaS |
| Description | Multi-tenant B2B AI-assisted receptionist platform for customer operations |
| Architecture | Modular monolith (Next.js 15 App Router, TypeScript, Prisma, PostgreSQL) |
| Deployment | Vercel + Supabase (staging verified) |

### What This Product Is NOT

- ❌ Not Mandoub
- ❌ Not a UAE service catalog
- ❌ Not a document-first service-ordering platform
- ❌ Not a service catalog/order platform
- ❌ Not Corporate Tax / Tourist Visa / Trade License / Banking Services

---

## 3. Target Customers and Personas

### Target Customers

- Small service businesses
- Clinics and appointment-based businesses
- Maintenance/service companies
- Restaurants or reservation-heavy businesses
- Real estate agencies
- Beauty centers and salons
- Local agencies
- Ecommerce/customer support teams

### User Personas

| Persona | Description | Primary Jobs | MVP? |
|---|---|---|---|
| **Business Owner** | Creates and manages business workspace | Create business, invite team, configure settings, review audit | ✅ |
| **Admin** | Configures settings, manages team | Manage members, settings, templates, knowledge | ✅ |
| **Operator / Receptionist** | Handles customer conversations | View queue, claim, reply, review AI drafts, resolve | ✅ |
| **Customer / Visitor** | Sends inbound messages | Send message, receive response, continue conversation | ✅ |
| **AI Receptionist** | Non-human assistant | Classify messages, generate draft responses | ✅ (Stage 1-2) |
| **System / Automation** | Background processes | Message routing, audit logging, scheduled tasks | ✅ |
| **AI Manager** | Manages AI configuration and knowledge | Configure AI policies, manage knowledge base, review AI quality | 🔮 Future |
| **Supervisor** | Reviews operator performance | Monitor metrics, review escalations | 🔮 Future |
| **Billing Admin** | Manages subscription and billing | Manage plan, review usage, payment | 🔮 Future |

---

## 4. MVP Scope

### MVP Foundation (Stage 0 + Stage 1)

| Capability | Description | Stage |
|---|---|---|
| Manual/Internal Test Channel | Internal message ingestion for development and testing | S0 |
| Customer Records (CRM) | Tenant-scoped customer profiles, identity resolution | S0 |
| Conversation Lifecycle | Conversation creation, status tracking, customer linking | S0 |
| Message Persistence | Message storage with sender, content, timestamp | S0 |
| Operator Workflow | Conversation queue, claim, respond, resolve | S0 |
| Routing / Assignment | Manual assignment, ownership, transfer | S0 |
| AI Internal Classification | Intent, urgency, category, missing fields, summary — internal only | S1 |
| AI Runtime Adapter | Provider-neutral AI provider integration (one real + one fake/test) | S1 |
| AI Config | Classification prompt templates, tenant-scoped | S1 |
| Audit Trail | Sensitive action logging (already implemented) | S0 |
| Auth / Tenancy / Authz | Identity, membership, RBAC (already implemented) | S0 |

### MVP Product Demo / Private Alpha (adds Stage 2)

| Capability | Description | Stage |
|---|---|---|
| Website Chat Widget | First customer-facing channel via provider-neutral adapter | S2 |
| AI Draft Assist | AI generates suggested replies, operator reviews/approves/sends | S2 |
| Human Review Flow | Edit, approve, reject AI drafts — no auto-send | S2 |
| Escalation | Operator escalation path when AI is insufficient | S2 |
| Approved Knowledge Lite | Lightweight tenant-scoped knowledge base for AI context | S2 |
| Lead Capture | Configurable lead fields, lightweight qualification | S2 |
| Reception Action Requests | Request-only action capture (appointments, reservations, callbacks) | S2 |
| Onboarding Wizard | Guided setup: business name, template, language, profile | S2 |

---

## 5. Non-Goals / Anti-Scope

### Explicitly Forbidden

| Item | Reason |
|---|---|
| Mandoub | Wrong product — reverted and cleaned |
| UAE service catalog | Wrong product — reverted and cleaned |
| Document-first service-ordering | Wrong product — reverted and cleaned |
| Corporate Tax / Tourist Visa / Trade License | Wrong product domain |
| ServiceCategory / Service / ServiceRequest | Wrong product domain models |
| AI auto-send before Stage 4 | Safety violation |
| Provider-specific core logic | Architecture violation |
| Cross-tenant data access | Security violation |
| Unapproved knowledge used by AI | Safety violation |

### Out of MVP

| Item | Reason |
|---|---|
| WhatsApp / Instagram / SMS / Email providers | Deferred external integrations |
| Voice reception | Separate product milestone |
| Billing / payment implementation | Deferred |
| Full CRM pipeline | Deferred — lightweight lead capture only in MVP |
| Full admin panel | Deferred — minimal admin setup in MVP |
| Template marketplace | Deferred — architecture must not block |
| Full RAG / document ingestion | Deferred — lightweight KB only in MVP |
| Advanced analytics | Deferred |
| Enterprise compliance suite | Deferred |
| External calendar integrations | Deferred |
| AI auto-reply | Stage 4 only |

---

## 6. AI Rollout

### Stage Definitions

| Stage | Name | Customer-Facing AI? | Description |
|---|---|---|---|
| **S0** | Manual Reception Foundation | ❌ No | Customer, Conversation, Message, Operator Queue, Manual Reply, Audit. No AI. |
| **S1** | AI Internal Classification | ❌ No | AI/rules generate intent, urgency, category, missing fields, summary. Internal only. |
| **S2** | AI Draft Assist | ❌ No (human sends) | AI generates suggested replies. Operator must edit/approve/send. No auto-send. |
| **S3** | Knowledge-Aware AI Draft | ❌ No (human sends) | AI uses only approved business knowledge. Shows internal source/citation. Escalates if knowledge insufficient. |
| **S4** | Guarded Auto-Reply | ✅ Yes | Low-risk FAQ and allowlisted intents only. Business opt-in. Human takeover. Audit. Confidence thresholds. |
| **Voice** | Voice Reception | ✅ Yes | Separate product milestone. Only after chat, knowledge base, escalation, and guarded auto-reply are stable. |

### Milestone Mapping

| Milestone | Stages | Description |
|---|---|---|
| MVP Foundation | S0 + S1 | Manual reception + AI internal classification |
| MVP Product Demo / Private Alpha | + S2 | AI draft assist + website chat + human review |
| Post-MVP | S3, S4 | Knowledge-aware drafts, guarded auto-reply |
| Separate milestone | Voice | Voice reception — requires separate discovery |

### AI Safety Gates

- No AI auto-send before Stage 4.
- No AI draft without human approval in Stages 2-3.
- No unapproved knowledge used by AI.
- No cross-tenant AI access.
- AI classification and draft states are separate from conversation status.
- Manual reception must work even if all AI is disabled.

### Per-Business AI Stage Controls

- Each business can be at a different AI stage.
- Business owner/admin controls which AI features are enabled.
- Platform operator can set maximum allowed stage per business.
- Stage transitions require explicit opt-in.
- Feature flag changes are audit-relevant.

---

## 7. Channel Strategy

| Channel | Priority | Status |
|---|---|---|
| Manual / Internal Test Channel | MVP Foundation | First — for development and testing |
| Website Chat Widget | MVP Demo / Alpha | Second — first real customer-facing channel |
| WhatsApp | Deferred | External provider integration |
| Instagram | Deferred | External provider integration |
| SMS | Deferred | External provider integration |
| Email | Deferred | External provider integration |
| Voice / Telephony | Deferred | Separate product milestone |

### Architecture Requirements

- Website widget built via provider-neutral channel adapter architecture.
- Channel adapters implement a common adapter interface.
- Core conversation domain never imports provider SDKs.
- Adding a new channel = adding a new adapter, not changing core.

---

## 8. Template System

### Template Strategy

- Core architecture is vertical-agnostic.
- Templates are configuration/data, not hardcoded business logic.
- One primary industry template per business.
- Multiple building block templates can be applied.
- Template versioning required.
- Applied templates become tenant-scoped instances.
- AI can only use approved template/knowledge data.

### Initial Starter Templates

| Template | Vertical | Key Capabilities |
|---|---|---|
| Real Estate | Real estate agencies | Property inquiry, viewing requests, buyer/renter qualification |
| Clinic / Medical Office | Healthcare | Appointment requests, patient intake, insurance questions |
| Restaurant | Food & beverage | Reservation requests, menu questions, hours/location |
| Beauty Center / Salon | Personal care | Appointment requests, service menu, pricing |
| Generic Small Business | Any | General inquiry, callback requests, lead capture |

### Template Registry

- Must support adding new templates over time.
- Future marketplace must not be blocked, but marketplace is out of MVP.
- Templates define: knowledge starters, lead fields, action request types, AI prompt context, onboarding defaults.

---

## 9. Lead Capture

| Field | Value |
|---|---|
| Scope | Configurable per business/template |
| MVP depth | Lightweight qualification |
| Lifecycle | `INCOMPLETE` → `NEW` → `QUALIFIED` / `UNQUALIFIED` → `CONVERTED` / `ARCHIVED` |

### Rules

- AI can suggest missing fields and qualification.
- Operator remains final decision-maker in MVP.
- Lead fields are template-driven and tenant-configurable.
- Full CRM pipeline deferred but architecture must allow it.

---

## 10. Booking / Action Requests

### MVP Model

- Request-only action capture with operator confirmation.
- No real slot booking in MVP.
- No external calendar integration in MVP.
- Generic **Reception Action Request** concept.

### Action Request Types

| Type | Description |
|---|---|
| `APPOINTMENT_REQUEST` | Request for an appointment (clinic, salon, etc.) |
| `RESERVATION_REQUEST` | Request for a reservation (restaurant, etc.) |
| `CALLBACK_REQUEST` | Request for a callback from the business |
| `PROPERTY_VIEWING_REQUEST` | Request to view a property (real estate) |
| `CONSULTATION_REQUEST` | Request for a consultation |
| `CUSTOM_REQUEST` | Custom/other request type |

### Future Stages

- Availability management
- Slot booking
- Calendar adapters
- Guarded automation of confirmations

---

## 11. Knowledge Base / Guardrails

| Aspect | Value |
|---|---|
| Requirement | Approved Knowledge Base required for AI drafting |
| Entry lifecycle | `DRAFT` → `APPROVED` → `ARCHIVED` |
| Scope | Tenant-scoped — AI consumes only APPROVED knowledge for the requesting tenant |
| Citations | AI drafts should expose internal source/citation to operators |
| RAG | Full RAG/document ingestion deferred |
| Architecture | Must scale to future embeddings/RAG |

### Rules

- AI must never use unapproved knowledge entries.
- AI must never use knowledge from another tenant.
- If knowledge is insufficient, AI must escalate rather than fabricate.
- Knowledge entries are versioned.

---

## 12. Access Control

### MVP Roles

| Role | Description |
|---|---|
| `OWNER` | Full control of business workspace |
| `ADMIN` | Manages settings, members, customers, operator workflow |
| `OPERATOR` | Handles customer conversations and messages |
| `VIEWER` | Read-only access to permitted data |

### Future Roles

| Role | Description | When |
|---|---|---|
| `AI_MANAGER` | Manages AI configuration, knowledge, reviews AI quality | Post-MVP |
| `SUPERVISOR` | Reviews operator performance, monitors metrics | Post-MVP |
| `BILLING_ADMIN` | Manages subscription and billing | Post-MVP |

### Rules

- RBAC baseline + ABAC contextual constraints.
- All authorization server-side.
- Client checks are UX convenience only, never security.
- Money and state transitions server-enforced.

---

## 13. Language / Localization

| Aspect | Value |
|---|---|
| MVP language | English-first |
| Architecture | Locale-aware from day one |
| Planned expansion | Persian (Farsi), Arabic |
| Locale-aware entities | Knowledge entries, templates, conversations, AI drafts, UI |
| Deferred | Full multilingual UI, RTL polish |

---

## 14. Conversation Lifecycle

### Conversation Status

| Status | Full PRD? | MVP? | Description |
|---|---|---|---|
| `NEW` | ✅ | ✅ | Just created, not yet triaged |
| `TRIAGING` | ✅ | ❌ | Being classified/routed |
| `OPEN` | ✅ | ✅ | Ready for operator attention |
| `ASSIGNED` | ✅ | ✅ | Claimed by an operator |
| `WAITING_CUSTOMER` | ✅ | ✅ | Operator replied, awaiting customer response |
| `WAITING_OPERATOR` | ✅ | ✅ | Customer replied, awaiting operator |
| `ESCALATED` | ✅ | ✅ | Requires supervisor/owner attention |
| `RESOLVED` | ✅ | ✅ | Issue addressed, pending close |
| `CLOSED` | ✅ | ❌ | Finalized and archived |
| `ARCHIVED` | ✅ | ❌ | Long-term storage |

### AI Classification Status (Separate from Conversation)

| Status | Description |
|---|---|
| `NOT_REQUESTED` | No classification requested |
| `PENDING` | Classification in progress |
| `READY` | Classification complete |
| `FAILED` | Classification failed |

### AI Draft Status (Separate from Conversation)

| Status | Description |
|---|---|
| `NOT_REQUESTED` | No draft requested |
| `PENDING` | Draft generation in progress |
| `READY` | Draft available for review |
| `APPROVED` | Operator approved the draft |
| `REJECTED` | Operator rejected the draft |
| `FAILED` | Draft generation failed |

---

## 15. UI Scope

### MVP UI

| Component | Description |
|---|---|
| Admin Setup (Minimal) | Business profile, template selection, basic configuration |
| Operator Inbox | Conversation queue, message view, reply, AI draft review |
| AI Review Panel | Classification display, draft preview, approve/reject/edit |
| Onboarding Wizard | Guided initial setup |

### Deferred UI

- Full admin panel
- Analytics dashboards
- Knowledge management UI (beyond basic CRUD)
- Template marketplace UI
- Billing/subscription UI

### Rules

- UI must use real domain APIs.
- UI must respect RBAC/ABAC.
- No demo-only shortcuts.
- Must remain scalable.

---

## 16. Onboarding

### Wizard (First Run)

1. Business name
2. Industry template selection
3. Default language
4. Basic business profile

### Progressive Setup Checklist

| Step | Description | Required? |
|---|---|---|
| Business profile | Complete business information | ✅ |
| Template blocks | Select and configure template building blocks | ✅ |
| Approved knowledge | Add initial knowledge entries and approve | ✅ (for AI) |
| Lead fields | Configure lead capture fields | Optional |
| Action rules | Configure action request types | Optional |
| Invite operators | Add team members | ✅ |
| Internal test conversation | Verify setup with test message | ✅ |
| AI classification test | Verify classification on test conversation | ✅ (S1) |
| AI draft test | Verify draft generation on test conversation | ✅ (S2) |
| Website widget setup | Configure and embed chat widget | ✅ (S2) |

---

## 17. Quality Gates / Metrics

### Technical Gates (Per Task)

| Gate | Description |
|---|---|
| `pnpm typecheck` | Zero type errors |
| `pnpm lint` | Zero lint errors |
| `pnpm test` | All tests pass |
| `pnpm build` | Production build succeeds |
| Tenant isolation | Tenant-scoped query verification |
| Authz | Role-based access matrix verification |
| API contract | Handler contract tests pass |
| Staging smoke | Staging deployment smoke test |

### Product Metrics

| Metric | Description |
|---|---|
| Message capture rate | % of inbound messages successfully stored |
| Conversation creation accuracy | Correct customer-conversation linking |
| Customer match rate | Identity resolution accuracy |
| Response workflow completion | % conversations reaching resolved status |
| Resolution rate | Conversations resolved vs total |
| Lead completion rate | % leads reaching QUALIFIED or CONVERTED |
| Action request rate | Action requests captured per conversation |

### AI Safety Gates

| Gate | Enforced |
|---|---|
| No auto-send before Stage 4 | Architecture + feature flags |
| No unapproved knowledge usage | Service layer enforcement |
| No AI draft without human approval | UI + API enforcement |
| No cross-tenant AI access | Tenant context enforcement |

---

## 18. AI Runtime

| Aspect | Value |
|---|---|
| Provider strategy | Provider-neutral adapter (one real + one fake/test) |
| Provider SDK location | Behind adapter boundary only — never in core domains |
| Tenant scoping | All AI calls are tenant-scoped |
| Feature flags | AI features individually flag-gated |
| Error handling | Timeout/fallback-safe — manual reception works if AI fails |

### Future (Must Not Be Blocked)

- Multi-provider routing
- Cost tracking per tenant
- RAG pipeline
- Voice model stack
- AI quality evaluation pipeline

---

## 19. Audit / Privacy

| Aspect | Value |
|---|---|
| Audit scope | Sensitive-action audit + privacy-by-design |
| Data scoping | All data tenant-scoped |
| Customer privacy | Internal notes never exposed to customers |
| AI context | Minimum necessary context passed to AI |
| Secrets | No secrets in logs or audit records |
| Actor types | `USER`, `SYSTEM`, `AI_RECEPTIONIST` (Prisma enum exists) |

### Future (Must Not Be Blocked)

- Compliance suite (GDPR, data retention policies)
- Data export
- Audit retention policies

---

## 20. Billing Boundary

| Aspect | Value |
|---|---|
| MVP billing | ❌ Out of scope |
| Architecture | Must be entitlement/usage-ready |
| Domain scaffold | `billing/` domain exists as scaffold |

### Future

- Subscription plans
- Usage limits / metering
- AI cost tracking per tenant
- Billing admin role
- Payment gateway integration (Stripe or equivalent)

No Stripe/checkout/invoice in MVP.

---

## 21. Feature Flags / Kill Switches

### Existing Flags

| Flag | Purpose | Current Value (Staging) |
|---|---|---|
| `ENABLE_API_HANDLERS` | API route handler activation | `true` |
| `ENABLE_AUTHJS_RUNTIME` | Auth.js NextAuth runtime | `true` |
| `ENABLE_AUTHJS_GOOGLE_PROVIDER` | Google OAuth provider | `true` |
| `ENABLE_AUTHJS_REQUEST_CONTEXT` | Auth.js session-backed request context | `true` |
| `ENABLE_DEV_AUTH_CONTEXT` | Dev header auth (must be `false` in production) | `false` |

### Required New Flags (Per Domain Implementation)

| Flag | Purpose | Stage |
|---|---|---|
| `ENABLE_AI_CLASSIFICATION` | AI classification pipeline | S1 |
| `ENABLE_AI_DRAFT` | AI draft generation | S2 |
| `ENABLE_AI_AUTO_REPLY` | AI auto-reply (cannot enable before S4 gates) | S4 |
| `ENABLE_WEBSITE_WIDGET` | Website chat widget channel | S2 |
| `ENABLE_KNOWLEDGE_BASE` | Knowledge base features | S2-S3 |

### Rules

- Global + per-business feature flags.
- Emergency kill switches for all AI features.
- Manual reception must work even if all AI is disabled.
- Feature flag changes are audit-relevant.
- Auto-reply flag cannot be enabled before Stage 4 quality gates pass.

---

## 22. Roadmap

| Task | Goal | Dependencies | Stage |
|---|---|---|---|
| **R0** | PRD Lock + Remediation Checkpoint | None | — |
| **R1** | CRM / Customer Domain | Auth/Tenancy (done) | S0 |
| **R2** | Conversation + Message Domain | R1 | S0 |
| **R3** | Internal / Manual Channel | R2 | S0 |
| **R4** | Routing + Operator Inbox Foundation | R2, R3 | S0 |
| **R5** | Business Profile + Template Setup Minimal | R1 | S0 |
| **R6** | AI Runtime + AI Config + Stage 1 Classification | R2, R4 | S1 |
| **R7** | Approved Knowledge Lite | R5, R6 | S2 |
| **R8** | Website Chat Widget via Provider-Neutral Channel Adapter | R3, R4 | S2 |
| **R9** | AI Draft Assist Stage 2 | R6, R7 | S2 |
| **R10** | Lead Capture | R1, R2 | S2 |
| **R11** | Reception Action Requests | R2, R5 | S2 |
| **R12** | Metrics + Quality Gates | R4, R6 | S1-S2 |

---

## 23. Product Boundary Gate

### Requires PRD Amendment (Human Approval)

Any of the following requires a formal PRD amendment before implementation:

- Any new product domain not listed in this PRD
- Any customer-facing AI automation
- Any external provider integration
- Any billing/payment implementation
- Any vertical-specific hardcoded workflow
- Any new role with security impact
- Any public endpoint accepting customer data

### Anti-Scope Registry

The following concepts are permanently excluded from this product:

| Concept | Status | Reason |
|---|---|---|
| Mandoub | ❌ Forbidden | Wrong product — reverted 2026-05-20 |
| UAE service catalog | ❌ Forbidden | Wrong product — reverted 2026-05-20 |
| Document-first service-ordering | ❌ Forbidden | Wrong product direction |
| Corporate Tax / Tourist Visa / Trade License | ❌ Forbidden | Wrong product domain |
| ServiceCategory / Service / ServiceRequest | ❌ Forbidden | Wrong domain models |
| Business service catalog/order foundation | ❌ Forbidden | Wrong product direction |
| AI auto-send before Stage 4 | ❌ Forbidden | Safety violation |
| Provider-specific core logic | ❌ Forbidden | Architecture violation |
| Cross-tenant data access | ❌ Forbidden | Security violation |
| Unapproved knowledge used by AI | ❌ Forbidden | Safety violation |

---

## Appendix A: Domain Architecture Reference

The 18-domain modular monolith architecture is documented in [DOMAIN_MAP.md](../DOMAIN_MAP.md).

### Implementation Status (as of PRD-v1 lock)

| Domain | Status | Notes |
|---|---|---|
| Identity | ✅ Implemented | User, Session, Account models + services + API |
| Tenancy | ✅ Implemented | Business, BusinessMembership + services + API |
| Authz | ✅ Implemented | RBAC permissions + evaluate/require API |
| Audit | ✅ Implemented | AuditEvent model + services + API |
| CRM | 📋 Scaffold | Next: R1 |
| Channels | 📋 Scaffold | Next: R3 |
| Conversations | 📋 Scaffold | Next: R2 |
| Routing | 📋 Scaffold | Next: R4 |
| AI Runtime | 📋 Scaffold | Next: R6 |
| Knowledge | 📋 Scaffold | Next: R7 |
| AI Config | 📋 Scaffold | Next: R6 |
| Actions | 📋 Scaffold | Next: R11 |
| Orders | 📋 Scaffold | Future — generic order lifecycle |
| Reservations | 📋 Scaffold | Future — availability/booking |
| Cases | 📋 Scaffold | Future — tickets/escalation |
| Approvals | 📋 Scaffold | Future — approval workflows |
| Billing | 📋 Scaffold | Future — subscription/usage |
| Analytics | 📋 Scaffold | Future — metrics/dashboards |

### Existing API Surface (22 endpoints)

All behind `ENABLE_API_HANDLERS` feature gate. Auth via Auth.js JWT sessions.

- Health: 1 endpoint
- Identity: 5 endpoints (self-profile, sessions)
- Business: 4 endpoints (CRUD)
- Membership: 5 endpoints (CRUD + role/status)
- Audit: 2 endpoints (list, detail)
- Authz: 3 endpoints (evaluate, require, role permissions)
- Auth.js: 2 endpoints (NextAuth catch-all)

---

## Appendix B: Evidence Sources

| Source | Path | Used For |
|---|---|---|
| README.md | `README.md` | Product name, tech stack, project structure |
| Product Requirements | `docs/product/requirements.md` | Problem statement, personas, MVP goals, FRs, NFRs |
| MVP Scope | `docs/product/mvp-scope.md` | In/out scope, anti-scope rules |
| Service Blueprint | `docs/product/service-blueprint.md` | Actor definitions, workflows, failure modes |
| Onboarding Flows | `docs/product/onboarding-and-workspace-flows.md` | Business/member lifecycle flows |
| Domain Map | `docs/DOMAIN_MAP.md` | 18-domain architecture |
| Development Pipeline | `docs/DEVELOPMENT_PIPELINE.md` | Phase plan |
| Access Control Matrix | `docs/architecture/access-control-matrix.md` | Permission matrix |
| Tenant Identity Model | `docs/architecture/tenant-identity-access-model.md` | Tenant/role/permission design |
| Runtime Auth Strategy | `docs/architecture/runtime-authentication-strategy.md` | Auth.js selection rationale |
| Prisma Schema | `prisma/schema.prisma` | Data model (7 models, 6 enums) |
| TASK-0025 Checkpoint | `docs/checkpoints/TASK-0025-*` | API handler baseline (21 endpoints) |
| TASK-0054 Checkpoint | `docs/checkpoints/TASK-0054-*` | Auth.js staging verification |
| PRD Recovery Gate | Prior conversation analysis | Wrong-scope remediation confirmation |
| AI Rollout Review | Prior conversation analysis | Staged AI rollout review |

---

*Document locked: 2026-05-22. Any changes require PRD amendment with human approval.*
