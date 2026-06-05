# Master PRD — AiA Reception SaaS

> **Status:** DRAFT — Requires Product Owner Review
> **Date:** 2026-06-04
> **Version:** 0.1
> **Extends:** [PRD-v1.md](./PRD-v1.md) (backend-scoped, locked 2026-05-22)
> **Repositories:** `iranservice/ai-reception-saas` (Backend) · `iranservice/ai-reception-saas-a7cff9d2` (Frontend)
> **Production:** `https://dashboard.aiautomations.ae`

---

## Relationship to PRD-v1

This Master PRD is the **unified cross-repo product document**. It extends the
backend-scoped PRD-v1 and adds frontend scope, production status, current
capabilities, and open product-owner questions that PRD-v1 did not cover.

PRD-v1 remains the locked backend architectural source of truth and is not
modified by this document. All product direction decisions in PRD-v1 (anti-scope,
AI safety stages, channel priority) remain in force.

The following PRD-v1 sections remain the **sole authoritative source** for their
respective domains and are not duplicated here. Any implementation or future
agent reading this Master PRD must consult PRD-v1 for these:

- **§8 Template System** — template strategy, registry, starter templates, versioning
- **§9 Lead Capture** — lead lifecycle states (INCOMPLETE → NEW → QUALIFIED → CONVERTED → ARCHIVED), rules, template-driven fields
- **§10 Booking / Action Requests** — action request types, future stages, no-calendar-in-MVP rule
- **§11 Knowledge Base / Guardrails** — entry lifecycle (DRAFT → APPROVED → ARCHIVED), citation rules, RAG boundary, must-escalate-if-insufficient rule
- **§14 Conversation Lifecycle** — full status set including future states (TRIAGING, CLOSED, ARCHIVED), AI classification status enum, AI draft status enum
- **§17 Quality Gates / Metrics** — technical gates (typecheck, lint, test, build, tenant isolation, authz, API contract, staging smoke) and product metrics
- **§21 Feature Flags / Kill Switches** — existing flags, required new flags per AI stage, kill-switch rules
- **§23 Product Boundary Gate** — PRD amendment requirements; anti-scope registry (permanently excluded concepts)

---

## 1. Product Vision

**AiA Reception SaaS** is a multi-tenant B2B platform that gives service
businesses an AI-assisted receptionist for customer communication. The platform
centralizes inbound messages across channels into a unified operator inbox,
preserves customer context, and progressively introduces AI capabilities —
classification, draft assistance, and eventually guarded auto-reply — while
keeping humans in control at every stage.

### Vision Statement

> *Every service business deserves a receptionist that never sleeps, never
> forgets, and always asks a human before speaking on behalf of the business.*

### Design Principles

| Principle | Meaning |
|---|---|
| **Human-first** | AI assists, operators decide. No AI message reaches a customer without human approval in Stages S0–S3. Stage 4 auto-reply requires explicit safety gates and Product Owner approval before activation — it is not default behavior. |
| **Tenant-isolated** | Every byte of data is scoped to a business. Cross-tenant access is a security violation. |
| **Channel-neutral** | Core conversation logic never imports a channel SDK. Adding a channel = adding an adapter. |
| **Progressive AI** | AI rollout is staged (S0→S4). Each stage has explicit safety gates. Businesses can be at different stages. |
| **Operator-calm** | The UI is neutral, professional, premium. No gamification, no notification spam, no dark patterns. |

### What This Product Is NOT

| Explicitly Forbidden | Reason |
|---|---|
| Mandoub / delivery management | Wrong product — reverted 2026-05-20 |
| UAE service catalog / document-first ordering | Wrong product — reverted 2026-05-20 |
| Corporate Tax / Tourist Visa / Trade License | Wrong product domain |
| ServiceCategory / Service / ServiceRequest models | Wrong domain models |
| Fully autonomous AI agent | Safety violation — human review required through S3 |

---

## 2. Target Customers

### Primary Market

Small-to-medium service businesses in the MENA region (initial focus: UAE, Iran)
that receive high volumes of inbound customer inquiries across multiple channels.

### Industry Verticals

| Vertical | Typical Inquiry Types |
|---|---|
| Real estate agencies | Property inquiries, viewing requests, buyer/renter qualification |
| Clinics / medical offices | Appointment requests, patient intake, insurance questions |
| Restaurants | Reservation requests, menu questions, hours/location |
| Beauty centers / salons | Appointment requests, service menu, pricing |
| Maintenance / service companies | Service requests, quotes, scheduling |
| Ecommerce / customer support | Order status, returns, product questions |
| Local agencies | General inquiry, callback requests, lead capture |

### Market Characteristics

- Businesses currently manage inquiries across WhatsApp, Instagram DM, phone,
  and website forms — often manually with no CRM.
- Operators switch between 3–6 messaging apps daily.
- Customer context is lost between conversations.
- Response time is the primary competitive differentiator for service businesses.

---

## 3. User Personas

### MVP Personas

| Persona | Role | Primary Jobs | How They Use AiA |
|---|---|---|---|
| **Business Owner** | Creates workspace, manages team | Create business, invite operators, configure settings, review audit trail | Sets up workspace, selects template, monitors team performance |
| **Admin** | Configures platform for the business | Manage members, settings, templates, knowledge base | Configures AI behavior, manages team roles, reviews audit |
| **Operator / Receptionist** | Handles customer conversations | View inbox queue, claim conversations, reply, review AI drafts, resolve | Primary daily user — lives in the inbox |
| **Customer / Visitor** | Sends inbound messages | Send message, receive response, continue conversation | Interacts via web chat widget or future channels |
| **AI Receptionist** | Non-human assistant | Classify messages, generate draft responses | Internal actor — never directly faces customer (S0–S3) |
| **System / Automation** | Background processes | Message routing, audit logging, scheduled tasks | Invisible — infrastructure actor |

### Post-MVP Personas

| Persona | When | Purpose |
|---|---|---|
| AI Manager | Post-MVP | Manages AI config, knowledge base, reviews AI quality |
| Supervisor | Post-MVP | Reviews operator performance, monitors metrics |
| Billing Admin | Post-MVP | Manages subscription and billing |

---

## 4. Core Workflows

### 4.1 Conversation Lifecycle (S0 — Manual Reception)

```
Customer sends message
    → Message arrives via channel adapter
    → Conversation created (status: NEW)
    → Appears in operator inbox
    → Operator claims conversation (→ ASSIGNED)
    → Operator reads message history
    → Operator composes reply (OUTBOUND) or internal note (INTERNAL)
    → Operator sends reply
    → Status → WAITING_CUSTOMER
    → Customer replies
    → Status → WAITING_OPERATOR
    → Cycle repeats until resolution
    → Operator resolves (→ RESOLVED)
    → Operator may reopen (RESOLVED → OPEN)
```

> **Note:** The lifecycle above is simplified for readability. The authoritative
> state machine is `VALID_TRANSITIONS` in
> `src/domains/conversations/validation.ts`; frontend status controls and
> backend handlers must follow that implementation, not this summary.

### 4.2 AI Classification Workflow (S1)

```
Conversation reaches inbox
    → AI classification triggered (aiClassificationStatus: PENDING)
    → AI analyzes message content
    → AI produces: intent, urgency, category, missing fields, summary
    → aiClassificationStatus → READY
    → Classification displayed to operator (internal only)
    → Operator uses classification to prioritize and respond
    → Classification NEVER shown to customer
```

### 4.3 AI Draft Assist Workflow (S2)

```
Operator views conversation
    → Operator requests AI draft (aiDraftStatus: PENDING)
    → AI generates suggested reply
    → aiDraftStatus → READY
    → Draft displayed in composer panel
    → Operator reviews draft
    → Operator edits, approves, or rejects
    → If approved: operator sends (human-triggered)
    → If rejected: operator composes manual reply
    → AI draft NEVER auto-sent
```

### 4.4 Onboarding Workflow

```
New user signs up (Google OAuth)
    → If no business: onboarding wizard
        → Step 1: Business name
        → Step 2: Industry template selection
        → Step 3: Default language
        → Step 4: Basic business profile
    → Business created with user as OWNER
    → Progressive setup checklist:
        - Complete business profile
        - Add knowledge entries
        - Configure lead fields
        - Invite operators
        - Send test conversation
```

### 4.5 Member Invitation Workflow

```
Owner/Admin invites user by email
    → BusinessMembership created (status: INVITED, role: selected)
    → Invite notification sent (mechanism TBD)
    → Invitee accepts → status: ACTIVE
    → Invitee declines → status: DECLINED
    → Invite expires → status: EXPIRED
    → Owner/Admin can remove → status: REMOVED
    → Member can leave → status: LEFT
```

---

## 5. MVP Scope

### MVP Foundation (Stage 0 + Stage 1)

| Module | Capability | Stage |
|---|---|---|
| **Auth / Identity** | Google OAuth login, session management, user profile | S0 |
| **Tenancy** | Multi-tenant business workspaces, membership management | S0 |
| **RBAC** | 4-role permission system (OWNER, ADMIN, OPERATOR, VIEWER) | S0 |
| **CRM** | Customer records, contact methods, identity resolution | S0 |
| **Conversations** | Conversation lifecycle, message persistence, state machine | S0 |
| **Inbox** | Operator inbox with filters, pagination, conversation detail | S0 |
| **Composer** | Reply and internal note composition | S0 |
| **Status Controls** | Conversation status transitions with audit | S0 |
| **Audit Trail** | Sensitive action logging with actor/target/result tracking | S0 |
| **Internal Channel** | Manual/internal test channel for development | S0 |
| **AI Classification** | Intent, urgency, category, missing fields, summary — internal only | S1 |
| **AI Runtime** | Provider-neutral AI adapter (one real + one fake/test) | S1 |

### MVP Product Demo / Private Alpha (adds Stage 2)

| Module | Capability | Stage |
|---|---|---|
| **Website Chat Widget** | First customer-facing channel via channel adapter | S2 |
| **AI Draft Assist** | AI-generated suggested replies, operator review/approve/send | S2 |
| **Knowledge Base Lite** | Tenant-scoped approved knowledge entries (S3 prerequisite — infrastructure built in S2, consumed by AI drafts starting in S3) | S2–S3 |
| **Lead Capture** | Configurable lead fields, lightweight qualification | S2 |
| **Action Requests** | Request-only action capture (appointments, reservations, callbacks) | S2 |
| **Onboarding Wizard** | Guided setup: business name, template, language, profile | S2 |

### Explicitly Out of MVP

| Item | Reason |
|---|---|
| WhatsApp / Instagram / SMS / Email integrations | Deferred external provider work |
| Voice reception | Separate product milestone |
| Billing / payments | Deferred — architecture must be entitlement-ready |
| Full CRM pipeline | Deferred — lightweight lead capture only |
| Full admin panel | Deferred — minimal admin in MVP |
| Template marketplace | Deferred — architecture must not block |
| Full RAG / document ingestion | Deferred — lightweight KB only |
| AI auto-reply | Stage 4 only — requires explicit safety gates |

---

## 6. Current Completed Scope

### Backend (Implemented & Staging-Verified)

| Domain | Status | API Endpoints | Tests |
|---|---|---|---|
| Identity (User, Session, Account) | ✅ Implemented | 5 | ✅ |
| Tenancy (Business, Membership) | ✅ Implemented | 9 | ✅ |
| Authz (RBAC permissions) | ✅ Implemented | 3 | ✅ |
| Audit (AuditEvent) | ✅ Implemented | 2 | ✅ |
| CRM (Customer, ContactMethod) | ✅ Implemented | 9 | ✅ |
| Conversations (Conversation, Message) | ✅ Implemented | 7 | ✅ |
| Auth.js (Google OAuth) | ✅ Implemented | 2 (catch-all) | ✅ |
| Health | ✅ Implemented | 1 | ✅ |
| **Total** | | **~38 route files** | **1152 passed, 7 skipped** |

### Frontend (Implemented & Deployed)

| Feature | Status | Data Source |
|---|---|---|
| Auth gate (login redirect) | ✅ Implemented | Auth.js session |
| Inbox conversation list | ✅ Implemented | Real API |
| Conversation detail + message timeline | ✅ Implemented | Real API |
| Message composer (reply + internal note) | ✅ Implemented | Real API |
| Conversation status controls | ✅ Implemented | Real API |
| Dashboard home | ⚠️ Implemented | Mock data |
| Customer list + detail | ⚠️ Implemented | Mock data |
| Members page | ⚠️ Implemented | Mock data |
| Settings page | ⚠️ Implemented | Mock data |
| Channels page | ⚠️ Implemented | Mock data |
| Audit log page | ⚠️ Implemented | Mock data |
| Admin panel (7 pages) | ⚠️ Implemented | Mock data |
| Auth pages (login, signup, etc.) | ⚠️ Implemented | Static/mock |
| Onboarding pages | ⚠️ Implemented | Static/mock |
| Web chat widget | ⚠️ Implemented | Static/mock |
| **Total routes** | **~45** | **5 real API, ~40 mock** |

### Infrastructure

| Component | Status |
|---|---|
| Vercel deployment (backend) | ✅ Production |
| Vercel deployment (frontend) | ✅ Production |
| Custom domain (`dashboard.aiautomations.ae`) | ✅ Active |
| Same-origin API proxy (vercel.json rewrites) | ✅ Active |
| Google OAuth in production | ✅ Working |
| Supabase PostgreSQL | ✅ Running (4 migrations applied) |
| CI pipeline (GitHub Actions) | ✅ Lint + typecheck + build + test |
| Google Safe Browsing | ✅ Cleared |
| Google Search Console | ✅ Submitted |

---

## 7. Current Production Capabilities

**Verified at:** `https://dashboard.aiautomations.ae`
**Google login:** ✅ Working in production

What a user can do **today**:

1. **Sign in** with Google OAuth
2. **View** a list of conversations in the inbox (filtered by status, channel)
3. **Open** a conversation to see the message timeline
4. **Send** an outbound reply to a conversation
5. **Write** an internal note (visible to operators only)
6. **Transition** conversation status through the state machine
   (NEW → OPEN → ASSIGNED → WAITING_CUSTOMER → RESOLVED, etc.)

What a user **cannot** do yet:

- Create a new conversation from the UI (button shows "Coming soon")
- Search or manage customers (mock data)
- Invite team members (mock data)
- Configure business settings (mock data)
- View audit logs from real data
- Use any AI features
- Receive messages from external channels
- Use the web chat widget

---

## 8. Pending Roadmap

### Backend Roadmap (from PRD-v1)

| Task | Scope | Dependencies | Stage | Status |
|---|---|---|---|---|
| **R4** | Routing + Operator Assignment | R2 ✅, R3 ✅ | S0 | ⬜ Not started |
| **R5** | Business Profile + Template Setup | R1 ✅ | S0 | ⬜ Not started |
| **R6** | AI Runtime + AI Config + S1 Classification | R2 ✅, R4 | S1 | ⬜ Not started |
| **R7** | Approved Knowledge Lite (S3 prerequisite — KB infrastructure built during S2, AI consumes KB starting in S3) | R5, R6 | S2–S3 | ⬜ Not started |
| **R8** | Website Chat Widget Channel Adapter | R3 ✅, R4 | S2 | ⬜ Not started |
| **R9** | AI Draft Assist Stage 2 (plain suggested replies without KB; KB-grounded drafts begin in S3) | R6 | S2 | ⬜ Not started |
| **R10** | Lead Capture | R1 ✅, R2 ✅ | S2 | ⬜ Not started |
| **R11** | Reception Action Requests | R2 ✅, R5 | S2 | ⬜ Not started |
| **R12** | Metrics + Quality Gates | R4, R6 | S1–S2 | ⬜ Not started |

### Frontend Roadmap (from prototype-to-production plan)

| Phase | Scope | Status |
|---|---|---|
| **Phase 1** | Tenant / Identity / Auth wiring | 🟡 Partial (auth gate done, most pages mock) |
| **Phase 2** | Dashboard, Customers, Members, Audit data wiring | ⬜ Not started |
| **Phase 3** | Inbox and Conversations polish | 🟡 Core done via R3B |
| **Phase 4** | AI and Knowledge UI | ⬜ Not started |
| **Phase 5** | Notifications / Profile / Admin data wiring | ⬜ Not started |
| **Phase 6** | Provider integrations, billing, advanced admin | ⬜ Not started |

### Infrastructure Roadmap

| Item | Status | Blocker |
|---|---|---|
| Same-origin custom domain | ✅ Done | — |
| End-to-end browser auth smoke test | ⬜ Pending | — |
| Seed data utility | ⬜ Not started | Developer experience |
| CI integration tests with Postgres | ⬜ Not started | CI configuration |
| Structured logging | ⬜ Not started | Observability |
| Error tracking (Sentry) | ⬜ Not started | Reliability |

---

## 9. Feature Priority Order

### P0 — Must Ship for Private Alpha

| # | Feature | Backend | Frontend | Estimated Complexity |
|---|---|---|---|---|
| 1 | **Dashboard data wiring** (home KPIs from real data) | Needs analytics endpoints | Wire to real API | Medium |
| 2 | **Customer list + detail data wiring** | ✅ API exists | Wire to real API | Low |
| 3 | **Members page data wiring** | ✅ API exists | Wire to real API | Low |
| 4 | **Settings page data wiring** | Needs business profile endpoints | Wire to real API | Medium |
| 5 | **New conversation creation** (from UI) | ✅ API exists | Enable "New Conversation" button | Low |
| 6 | **Assignment workflow** (R4) | Implement assignment endpoint | Assignment UI | Medium |
| 7 | **Audit log data wiring** | ✅ API exists | Wire to real API | Low |
| 8 | **Web Chat Widget** (R8) | Channel adapter + WebSocket/SSE | Widget embed component | High |
| 9 | **AI Classification** (R6) | AI runtime + provider integration | Classification display panel | High |
| 10 | **AI Draft Assist** (R9) | Draft generation endpoint | Draft review UI in composer | High |

### P1 — Should Ship for Private Alpha

| Feature | Complexity |
|---|---|
| Knowledge Base CRUD | Medium |
| Business profile + template setup | Medium |
| Onboarding wizard with server-side state | Medium |
| Lead capture fields | Low |
| Action request capture | Medium |

### P2 — Nice to Have for Alpha

| Feature | Complexity |
|---|---|
| Customer search + identity resolution from inbox | Low |
| Message pagination beyond first 50 | Low |
| Optimistic message append | Low |
| Rich text editor | Medium |
| File upload / attachments | Medium |

### P3 — Deferred to Post-Alpha

| Feature |
|---|
| WhatsApp / Instagram / SMS / Email integrations |
| Voice reception |
| Billing / payments |
| Analytics dashboards |
| Template marketplace |
| Full RAG / document ingestion |
| AI auto-reply (Stage 4) |
| Custom roles |
| ABAC contextual constraints |
| Mobile app |

---

## 10. RBAC and Permissions Assumptions

### Current Implementation (Hardcoded MVP)

| Permission | OWNER | ADMIN | OPERATOR | VIEWER |
|---|---|---|---|---|
| `business.read` | ✅ | ✅ | — | ✅ |
| `business.update` | ✅ | ✅ | — | — |
| `business.delete` | ✅ | — | — | — |
| `members.read` | ✅ | ✅ | — | — |
| `members.invite` | ✅ | ✅ | — | — |
| `members.remove` | ✅ | ✅ | — | — |
| `members.change_role` | ✅ | ✅ | — | — |
| `customers.read` | ✅ | ✅ | ✅ | ✅ |
| `customers.update` | ✅ | ✅ | ✅ | — |
| `conversations.read` | ✅ | ✅ | ✅ | ✅ |
| `conversations.reply` | ✅ | ✅ | ✅ | — |
| `conversations.assign` | ✅ | ✅ | ✅ | — |
| `conversations.close` | ✅ | ✅ | ✅ | — |
| `messages.read` | ✅ | ✅ | ✅ | ✅ |
| `messages.create` | ✅ | ✅ | ✅ | — |
| `ai_drafts.read` | ✅ | ✅ | ✅ | — |
| `ai_drafts.generate` | ✅ | ✅ | ✅ | — |
| `ai_drafts.approve` | ✅ | ✅ | ✅ | — |
| `audit.read` | ✅ | ✅ | — | — |
| `settings.read` | ✅ | ✅ | — | — |
| `settings.update` | ✅ | ✅ | — | — |

### Assumptions

- OWNER is the only role that can delete a business.
- ADMIN cannot promote a user to OWNER (future consideration).
- OPERATOR has no access to audit logs, settings, or member management.
- VIEWER can only read — no write access to anything.
- All AI draft permissions are granted to OPERATOR — the human-in-the-loop
  principle applies to the approve/send step, not the generate step.

### Open Questions

> **Q10.1:** Should OPERATOR see `business.read`? Currently not granted but
> they work within the business.
>
> **Q10.2:** Should custom roles be planned in the data model now, even if MVP
> uses hardcoded map?
>
> **Q10.3:** Should ADMIN be able to view (but not manage) audit logs?

---

## 11. AI Receptionist Behavior

### Stage Definitions

| Stage | AI Behavior | AI May Reply to Customer? | Customer Sees AI? | Safety Gate |
|---|---|---|---|---|
| **S0** Manual Reception | No AI involved. Operators handle all messages. AI does not participate in any form. | ❌ Never | No | — |
| **S1** AI Internal Classification | AI classifies intent, urgency, category, missing fields, and summary. Output is internal only for operators/admins. AI must not generate customer-facing responses. AI must not send anything to customers. | ❌ Never | No | Feature flag per business |
| **S2** AI Draft Assist | AI generates suggested replies only. Drafts are visible only to operators/admins. A human must review, edit if needed, and explicitly send. AI must not send directly under any circumstance. | ❌ Never | No (human sends) | Feature flag + mandatory human review + human-triggered send |
| **S3** Knowledge-Aware AI Draft | AI generates suggested replies using **only approved Knowledge Base content**. Drafts remain internal only. A human must review and send. AI must not send directly. Unapproved knowledge must not be used. AI must escalate if approved knowledge is insufficient rather than fabricating a response. | ❌ Never | No (human sends) | Approved knowledge gate + mandatory human review + escalation on insufficient knowledge |
| **S4** Guarded Auto-Reply | AI may send limited direct replies **only after** all required safety gates are implemented and explicitly enabled. S4 is **not default behavior** and requires explicit Product Owner approval and business opt-in. | ✅ Yes — guarded, conditional, explicit activation only | Yes (guarded) | Business opt-in + allowlisted intents + confidence threshold + approved knowledge only + full audit logging + rate limiting + human takeover available at any time + instant kill switch |

### AI Safety Rules (Invariant Across All Stages)

1. **No AI auto-send before Stage 4.** Architecture + feature flags enforce this.
2. **No AI draft without human approval in S2–S3.** UI + API enforce this.
3. **No unapproved knowledge used by AI.** Service layer verifies knowledge
   entry status.
4. **No cross-tenant AI access.** Tenant context enforcement on every AI call.
5. **AI classification and draft states are separate from conversation status.**
   They are tracked independently on the Conversation model.
6. **Manual reception must work even if all AI is disabled.** The core inbox
   workflow has zero AI dependencies.
7. **Feature flag changes for AI are audit-relevant.**

### AI Runtime Architecture

- **Provider-neutral adapter pattern:** Core conversation domain never imports
  AI SDKs.
- **One real provider + one fake/test provider** for S1.
- **Tenant-scoped:** All AI calls carry businessId. AI context is limited to
  the requesting tenant's data.
- **Timeout/fallback-safe:** If AI fails, the conversation remains in manual
  mode.

### Per-Business AI Stage Controls

- Each business can be at a different AI stage.
- Business owner/admin controls which AI features are enabled.
- Platform operator (SaaS admin) can set maximum allowed stage per business.
- Stage transitions require explicit opt-in.

---

## 12. Human-in-the-Loop Rules

### Invariant Rules

| Rule | Enforcement Layer | Stages |
|---|---|---|
| No message reaches customer without human action | API + UI | S0–S3 |
| Operator can always override/reject AI suggestion | UI | S1–S3 |
| AI draft requires explicit approve before send | API (reject auto-send at endpoint) | S2–S3 |
| Operator can escalate at any time | State machine | All |
| Internal notes are never visible to customers | API + DB (direction=INTERNAL) | All |
| System messages are never sent via API boundary | API rejects direction=SYSTEM | All |
| Sender identity derived from auth context, not client body | API handler | All |

### Stage 4 Human-in-the-Loop Relaxation (Future)

When Stage 4 is implemented, the following conditions must ALL be met:

1. Business explicitly opts in to auto-reply
2. Intent is in the business's allowlist
3. AI confidence exceeds configurable threshold
4. Knowledge source is APPROVED
5. Auto-reply is audit-logged with full context
6. Human takeover is available at any point
7. Auto-reply count is metered and rate-limited
8. Business can disable auto-reply instantly (kill switch)

---

## 13. Channels Roadmap

### Current State

| Channel | Status | Data Model |
|---|---|---|
| **INTERNAL** | ✅ Active (development/test) | `ChannelType.INTERNAL` in Prisma enum |
| **WEBSITE_CHAT** | 📋 Enum exists, no adapter | `ChannelType.WEBSITE_CHAT` in Prisma enum |

### Planned Channel Rollout

| Priority | Channel | When | Architecture Impact |
|---|---|---|---|
| 1st | **Website Chat Widget** | MVP Demo / Private Alpha (R8) | New channel adapter + embed JS + WebSocket/SSE |
| 2nd | **WhatsApp Business** | Post-MVP | WhatsApp Business API adapter + webhook receiver |
| 3rd | **Instagram** | Post-MVP | Instagram Graph API adapter + webhook receiver |
| 4th | **Email** | Post-MVP | SMTP/IMAP adapter or email provider API |
| 5th | **Telegram** | Post-MVP | Telegram Bot API adapter |
| 6th | **SMS** | Post-MVP | SMS provider adapter (Twilio/etc.) |
| 7th | **Voice / Telephony** | Separate milestone | Separate product — requires discovery |

### Channel Adapter Architecture Requirements

- All channels implement a common adapter interface.
- Core conversation domain never imports provider SDKs.
- Adding a new channel = adding a new adapter module + ChannelType enum value.
- Channel-specific metadata stored in `channelMetadata` JSON field on
  Conversation and Message.
- Inbound webhook endpoints are channel-specific but feed into the same
  conversation domain.

### Open Questions

> **Q13.1:** Website chat widget — WebSocket, SSE, or long-polling for
> real-time messages?
>
> **Q13.2:** Should the widget be a standalone npm package or an inline
> `<script>` embed?
>
> **Q13.3:** Anonymous vs. identified chat sessions — is there a lead capture
> gate before chat?
>
> **Q13.4:** WhatsApp Business API — direct integration or via a provider
> (Twilio, MessageBird)?

---

## 14. Billing Assumptions and Missing Decisions

### Current State

- Billing domain exists as a **scaffold only** (`src/domains/billing/README.md`).
- No Prisma models, no API endpoints, no UI.
- PRD-v1 explicitly states: "No Stripe/checkout/invoice in MVP."
- Architecture must be "entitlement-ready."

### Assumptions

| Assumption | Confidence |
|---|---|
| Subscription-based pricing (monthly/annual) | High — standard B2B SaaS |
| Per-business billing (not per-user) | Medium — needs confirmation |
| Usage-based metering for AI calls | High — AI cost is per-call |
| Free tier / trial period exists | Medium — common for SMB SaaS |
| Stripe as payment provider | Medium — standard, but needs confirmation |

### Missing Decisions

> **Q14.1:** What are the plan tiers? (Free / Starter / Pro / Enterprise?)
>
> **Q14.2:** What are the entitlement dimensions? (Users per business?
> Conversations/month? AI calls/month? Channels enabled?)
>
> **Q14.3:** Per-seat pricing or flat per-business pricing?
>
> **Q14.4:** Should AI cost be passed through to the business or absorbed?
>
> **Q14.5:** Is there a free trial? How long? What features are included?
>
> **Q14.6:** Payment provider: Stripe? Local MENA payment options needed?
>
> **Q14.7:** Should billing enforcement gate feature access (hard gate) or
> show warnings (soft gate)?
>
> **Q14.8:** Currency: USD, AED, or multi-currency?

---

## 15. Data / Security / Compliance Requirements

### Current Implementation

| Aspect | Status |
|---|---|
| Tenant data isolation (businessId scoping) | ✅ Enforced in every query |
| Auth.js JWT sessions | ✅ Production |
| RBAC permission checks | ✅ Server-side on every mutation |
| Audit trail for sensitive actions | ✅ 9 sensitive permissions tracked |
| Internal notes hidden from customers | ✅ direction=INTERNAL never exposed |
| Sender impersonation prevention | ✅ senderUserId derived from auth context |
| SYSTEM messages rejected at API boundary | ✅ 400 error |
| Secrets not logged | ✅ No tokens/IDs in checkpoint docs |
| Feature flags checked before runtime access | ✅ Kill switch semantics |

### Missing / Deferred

| Requirement | Status | Priority |
|---|---|---|
| HTTPS everywhere | ✅ Vercel provides TLS | — |
| CORS configuration | ❌ Not configured (Next.js default) | P1 |
| Rate limiting | ❌ Not implemented | P1 |
| Data retention policy | ❌ Not defined | P2 |
| GDPR compliance (right to deletion) | ❌ Not implemented | P2 |
| Data export capability | ❌ Not implemented | P2 |
| Audit retention policy | ❌ Not defined | P2 |
| Encryption at rest | ⚠️ Supabase provides this | — |
| Backup policy | ⚠️ Supabase provides this | — |
| SOC 2 / ISO 27001 | ❌ Not applicable for MVP | P3 |
| Content Security Policy headers | ❌ Not configured | P1 |
| API key authentication (for integrations) | ❌ Not implemented | P2 |
| Webhook signature verification | ❌ Not implemented (no webhooks yet) | P2 |

### Open Questions

> **Q15.1:** Is GDPR compliance required for MVP or post-MVP?
>
> **Q15.2:** What is the data retention period for messages? Conversations?
> Audit events?
>
> **Q15.3:** Should customers be able to request data deletion?
>
> **Q15.4:** Is there a requirement for data residency (data must stay in
> specific region)?

---

## 16. Acceptance Criteria per Major Module

### 16.1 Authentication & Identity

| Criteria | Status |
|---|---|
| User can sign in with Google OAuth | ✅ Production |
| User can sign out and session is invalidated | ✅ Implemented |
| Unauthenticated users are redirected to login | ✅ Frontend AuthGate |
| User profile (name, avatar) is accessible via `/api/identity/me` | ✅ Implemented |
| Session list and revocation works | ✅ Implemented |
| AC: Email/password login | ⬜ Not in scope (Google OAuth only for MVP) |

### 16.2 Tenancy & Membership

| Criteria | Status |
|---|---|
| User can create a new business workspace | ✅ API exists |
| User can list their business memberships | ✅ API exists |
| Owner can invite members by email | ✅ API exists |
| Owner can change member roles | ✅ API exists |
| Owner can remove members | ✅ API exists |
| Member cannot access business they don't belong to | ✅ Enforced |
| AC: Frontend membership management wired to real API | ⬜ Still on mock data |
| AC: Invitation email delivery | ⬜ Not implemented |

### 16.3 CRM / Customers

| Criteria | Status |
|---|---|
| Operator can list customers for their business | ✅ API exists |
| Operator can create a new customer | ✅ API exists |
| Operator can search customers | ✅ API exists (`?search=`) |
| Operator can add/remove contact methods | ✅ API exists |
| Identity resolution via contact method works | ✅ `/customers/resolve` |
| AC: Frontend customer pages wired to real API | ⬜ Still on mock data |

### 16.4 Conversations & Messages

| Criteria | Status |
|---|---|
| Operator can list conversations with status/channel filters | ✅ Frontend + API |
| Operator can view conversation detail with message timeline | ✅ Frontend + API |
| Operator can send outbound reply | ✅ Frontend + API |
| Operator can write internal note | ✅ Frontend + API |
| Operator can transition conversation status | ✅ Frontend + API |
| State machine prevents invalid transitions | ✅ Enforced |
| Sender identity is server-derived | ✅ Enforced |
| SYSTEM direction rejected at API boundary | ✅ Enforced |
| AC: New conversation creation from UI | ⬜ Button disabled |
| AC: Assignment workflow (assign to specific operator) | ⬜ R4 — not started |

### 16.5 Audit

| Criteria | Status |
|---|---|
| Sensitive actions create audit events | ✅ Backend |
| Audit events include actor, target, action, result | ✅ Backend |
| No message content leaks into audit metadata | ✅ Design |
| AC: Frontend audit page wired to real API | ⬜ Mock data |

### 16.6 AI Classification (S1 — Not Started)

| Criteria | Status |
|---|---|
| AI classifies new conversations (intent, urgency, category) | ⬜ |
| Classification is internal-only, never shown to customer | ⬜ |
| Classification displayed to operator in conversation detail | ⬜ |
| Classification runs behind feature flag | ⬜ |
| Classification failure does not block conversation | ⬜ |
| AC: Provider-neutral AI runtime adapter | ⬜ |

### 16.7 AI Draft Assist (S2 — Not Started)

| Criteria | Status |
|---|---|
| Operator can request AI draft | ⬜ |
| AI generates suggested reply (without Knowledge Base requirement) | ⬜ |
| Draft displayed in composer for operator review | ⬜ |
| Operator can approve, edit, or reject draft | ⬜ |
| Approved draft is sent as operator's reply (human-triggered) | ⬜ |
| Draft generation failure does not block manual reply | ⬜ |
| AI draft is never auto-sent | ⬜ |
| AC: `ENABLE_AI_DRAFT` feature flag | ⬜ |

### 16.7b Knowledge-Aware AI Draft (S3 — Not Started)

| Criteria | Status |
|---|---|
| AI generates draft using only APPROVED knowledge entries | ⬜ |
| Unapproved knowledge entries are never used | ⬜ |
| AI shows internal citation/source to operator | ⬜ |
| AI escalates if approved knowledge is insufficient (no fabrication) | ⬜ |
| Draft remains internal only — human reviews and sends | ⬜ |
| AC: `ENABLE_KNOWLEDGE_BASE` feature flag required | ⬜ |

### 16.8 Website Chat Widget (S2 — Not Started)

| Criteria | Status |
|---|---|
| Business can embed widget on their website | ⬜ |
| Customer can send message via widget | ⬜ |
| Message appears in operator inbox as INBOUND | ⬜ |
| Operator reply appears in customer widget | ⬜ |
| Widget supports anonymous and identified sessions | ⬜ |
| Widget is responsive and mobile-friendly | ⬜ |
| AC: `ENABLE_WEBSITE_WIDGET` feature flag | ⬜ |

---

## 17. Open Questions Requiring Product Owner Decision

### Product Direction

> **Q1:** Is the MVP Foundation (S0+S1) target sufficient for a private alpha,
> or must S2 (AI Draft + Widget) be included?
>
> **Q2:** What is the target date for private alpha launch?
>
> **Q3:** How many pilot businesses are targeted for alpha? What verticals?

### AI Decisions

> **Q4:** Which AI provider should be used for S1 classification?
> (OpenAI GPT-4o, Anthropic Claude, Google Gemini, other?)
>
> **Q5:** Should classification be automatic on conversation creation or
> operator-triggered?
>
> **Q6:** What is the acceptable latency for AI classification? For draft
> generation?
>
> **Q7:** Should AI cost per tenant be tracked from day one?

### Channel Decisions

> **Q8:** Website chat widget — real-time protocol: WebSocket, SSE, or polling?
>
> **Q9:** Should the widget require lead capture (name/email) before chat
> starts?
>
> **Q10:** Is offline message collection (customer sends when no operator
> online) required for MVP?

### UX Decisions

> **Q11:** Should the ~30 mock-data frontend routes be wired to real APIs
> before alpha, or can they remain mock?
>
> **Q12:** Is the admin panel required for alpha, or only the business panel?
>
> **Q13:** Should onboarding be implemented for alpha, or can businesses be
> manually provisioned?
>
> **Q14:** Is multi-language UI (Farsi, Arabic) required for alpha?

### Infrastructure Decisions

> **Q15:** Should the backend support email/password login in addition to
> Google OAuth?
>
> **Q16:** Is a staging environment separate from production needed?
>
> **Q17:** Should invitation emails be implemented for alpha, or manual
> onboarding only?
>
> **Q18:** Is a seed data utility needed for local development?

### Business Model Decisions

> **Q19:** What are the billing plan tiers and pricing?
>
> **Q20:** Per-seat or per-business pricing?
>
> **Q21:** When should billing be implemented relative to alpha launch?
>
> **Q22:** Should AI usage be metered and billed separately?

### Compliance Decisions

> **Q23:** Is GDPR compliance required before alpha?
>
> **Q24:** What is the data retention policy for conversations and messages?
>
> **Q25:** Is data residency (region-specific hosting) required?

---

## 18. Product Owner Change-Control Rule

### Governance

No feature, workflow, AI stage definition, safety gate, role permission, channel
priority, domain boundary, data model assumption, acceptance criterion, or
product detail in this document or in PRD-v1 may be removed, weakened,
reordered, reinterpreted, or altered without explicit Product Owner approval.

### Agent and Automation Rules

1. **AI-assisted or agent-generated changes must preserve all existing approved
   details** unless the Product Owner explicitly approves deletion or alteration.
2. **If a conflict exists between this document and PRD-v1**, the agent must
   report the conflict and request Product Owner resolution before changing or
   deleting anything in either document.
3. **PRD-v1 is LOCKED.** No agent may modify `PRD-v1.md` under any circumstance.
4. **This Master PRD is a DRAFT.** Agents may propose additions or strengthening
   edits, but must not remove or weaken existing content without Product Owner
   approval.
5. **Before removing or compressing any detail**, the agent must first confirm
   that the detail is duplicated in full in another approved document. If it is
   not, it must not be removed.

### AI Safety Change-Control

The AI stage definitions (S0–S4) are safety-critical. The following changes
are **absolutely forbidden** without explicit Product Owner approval and must
never be performed by any automated process:

- Allowing AI to generate customer-facing content before Stage 2.
- Allowing AI to send messages to customers before Stage 4.
- Removing or weakening human-in-the-loop requirements for Stages S0–S3.
- Enabling Stage 4 auto-reply without all 8 required safety gates being
  implemented and explicitly enabled.
- Treating Stage 4 as default or expected behavior.
- Using unapproved knowledge in any AI operation.
- Allowing cross-tenant AI data access.
- Removing the mandatory human review step from any AI draft workflow.
- Silently merging S2 and S3 behavior (approved-knowledge requirement belongs
  to S3 only; S2 drafts do not require a knowledge base gate).

Any violation of these rules is a **product safety incident** and must be
reverted immediately and reported to the Product Owner.

---

*This document is a DRAFT. No decisions are final until approved by the product
owner. No implementation should begin based on this document until explicit
approval is granted.*
