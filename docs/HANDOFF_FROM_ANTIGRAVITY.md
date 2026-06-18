# AiA Reception SaaS — AntiGravity Migration Handoff Report

---

> ## ⚠️ Historical / Superseded — not the current source of truth
>
> This file is **historical handoff context** captured during the AntiGravity migration (2026-06-11/12). It is preserved for background only.
>
> It is **not** the current source of truth for repo status, next tasks, security/audit status, or the Claude workflow. Many specifics here (PR/commit counts, "AI runtime not implemented", domain counts, branch/`develop` workflow, next-task lists) reflect a snapshot that later work has moved past. Do **not** quote it as live status.
>
> **Current source-of-truth order (highest wins on conflict):**
>
> 1. git history / merged PRs
> 2. `docs/audits/*-closure-checkpoint.md` (authoritative status)
> 3. `docs/audits/*-remediation-plan.md`
> 4. `CLAUDE.md`
> 5. `docs/ai-skills/*.md` (operational playbooks; grant no authority)
> 6. `docs/decision-log.md` — **non-authoritative** owner-decision record only
>
> The owner remains the final authorization authority. This file does not grant authority and must not be used to declare the product "Private Alpha ready" or "real-provider AI ready."

---

## 0. Report Metadata

| Field | Value |
|---|---|
| Date/time | 2026-06-11T16:32 +04:00 |
| Repository name | workdabiri/ai-reception-saas |
| Current branch | `main` |
| Commit hash | `345341ee5c8e4e93bce34581fdba519debba6030` |
| Commit message | `feat(reply-drafts): add send tracking permission schema (#86)` |
| Git remote origin | `git@github.com:workdabiri/ai-reception-saas.git` |
| Local workspace | `/Users/aria/Projects/AiA/ai-reception-saas` |
| Model/tool used | Claude Opus 4.6 (Thinking) via AntiGravity IDE |
| Production code modified | **No** |
| Documentation files created/updated | `docs/HANDOFF_FROM_ANTIGRAVITY.md` (this file) |
| Report scope | **Backend repo only** — see §1A for companion frontend repo |

---

## 1. Executive Summary

**What this project is:** AI Reception SaaS is a multi-tenant B2B platform for AI-assisted customer reception, triage, routing, and operator workflows. It enables small service-oriented businesses to centralize inbound customer communication and prepare for AI-assisted reply drafting.

**What problem it solves:** Small businesses (clinics, restaurants, salons, real estate agencies) lack tools to manage inbound customer conversations with context, triage, and AI assistance. This platform provides a unified reception workflow with staged AI rollout — from manual-only to human-reviewed AI drafts to eventual guarded auto-reply.

**Who it is for:** Small service-oriented businesses and their operator teams (receptionists, support agents, business owners).

**Stage:** The project is in **early-to-mid MVP foundation** (Stage 0). The backend API layer has solid implementation for identity, tenancy, authz, CRM, conversations, messages, and reply drafts. **This backend repo contains no frontend UI** beyond a "Hello world" placeholder — however, a separate companion frontend repo exists (see §1A). Auth.js integration is implemented and staging-verified with Google OAuth. The project has 86 merged PRs and a disciplined engineering process.

**Production readiness:** **Not production-ready.** The backend API is functionally solid for its implemented domains, but: (1) This repo has no frontend UI (the frontend lives in a separate repo — see §1A), (2) AI runtime is not implemented, (3) No realtime/WebSocket support, (4) No external channel integrations, (5) 12 of 19 domain directories are empty scaffolds (the architecture describes 18 domains; `reply-drafts` is a 19th domain added outside the original domain map).

**Main risks:** The biggest risks are: (1) AI runtime is entirely scaffolded with no actual AI provider integration, (2) The 18-domain architecture may be over-scoped for an MVP, (3) Reply drafts currently generate stub text with no real AI, (4) No E2E or integration tests against a real database, (5) Backend and frontend repos must keep API type contracts in sync manually.

**Best next move:** Wire remaining frontend pages to existing backend API endpoints, then implement AI runtime with a single provider.

> **⚠️ Important:** This report covers the **backend/API repository** only. The product also has a **companion frontend repository** (`workdabiri/ai-reception-saas-a7cff9d2`) built with TanStack Start + Lovable.dev. See §1A for details. Any architecture audit must consider both repos.

---

## 1A. Companion Frontend Repository

The AiA Reception SaaS product is a **two-repository architecture**: this backend repo provides the API, and a separate frontend repo provides the user-facing UI.

| Field | Value |
|---|---|
| Repository name | `workdabiri/ai-reception-saas-a7cff9d2` |
| Git remote | `git@github.com:workdabiri/ai-reception-saas-a7cff9d2.git` |
| Local path | `/Users/aria/Projects/AiA/ai-reception-saas-a7cff9d2` |
| Framework | TanStack Start (TanStack Router + React 19) via Vite 7 |
| Origin | **Lovable.dev** — scaffolded from `template: tanstack_start_ts_2026-05-06` |
| Build tool | Vite 7 + Nitro (Vercel preset) |
| Package manager | Bun (`bun.lock`) |
| Role | Product-facing frontend UI — operator dashboard, inbox, CRM, settings |
| Deployment | Vercel (separate project), with `/api/*` rewritten to backend Vercel deployment |
| UI components | 47 Radix-based primitives (shadcn/ui pattern) + 18 app-level components |
| Routes | 48 route files (TanStack Router file-based routing) |
| API hooks | 13 React hooks binding to this backend's API (`use-conversations.ts`, `use-customers.ts`, etc.) |
| Source files | 142 TS/TSX files, ~28,600 lines |
| PRs merged | 49 |
| Current branch | `main` |
| Working tree | Clean |

### How Frontend Connects to Backend

```
Frontend (ai-reception-saas-a7cff9d2)     Backend (ai-reception-saas)
┌──────────────────────────────────┐       ┌───────────────────────────┐
│ TanStack Start + Vite            │       │ Next.js 15 (API only)     │
│ src/lib/api-client.ts            │──────▶│ src/app/api/              │
│   fetch(VITE_API_BASE_URL + ...) │       │   35 route files          │
│                                  │       │   Auth.js + Prisma        │
│ vercel.json rewrites:            │       │                           │
│   /api/* → backend.vercel.app    │       │                           │
└──────────────────────────────────┘       └───────────────────────────┘
```

- Frontend's `src/lib/api-client.ts` is a typed fetch wrapper against this backend.
- Frontend's `src/lib/api-types.ts` manually mirrors backend domain types — **no automated sync**.
- Auth flows: Frontend fetches `/api/auth/session` via same-origin rewrite → backend Auth.js.
- Business context: Frontend's `src/contexts/business-context.tsx` resolves active business from session.

### Frontend Surfaces Implemented

| Surface | Routes | Status |
|---|---|---|
| Dashboard | `/` (index) | ✅ Wired to backend summary API |
| Inbox | `/inbox`, `/inbox/$conversationId` | ✅ Wired to backend conversations/messages APIs |
| Customers | `/customers`, `/customers/$customerId` | ✅ Wired to backend CRM API |
| Members | `/members` | ✅ Wired to backend memberships API |
| Channels | `/channels`, `/channels/$channelId` | Partially wired (static registry) |
| Settings | `/settings`, `/settings/ai` | Partially wired |
| Audit | `/audit` | ✅ Wired to backend audit API |
| Auth | `/login`, `/signup`, `/forgot-password`, `/verify-email` | UI exists, wired to Auth.js |
| Onboarding | `/onboarding/*` (5 steps) | UI exists, partially wired |
| Admin panel | `/admin/*` (7 routes) | UI exists, mock data |
| Chat widget | `/chat/$businessId`, `/widget-preview` | UI exists, not wired |
| Knowledge base | `/knowledge` | UI exists, not wired |

### Key Frontend Files for Claude Project Upload

| File | Why |
|---|---|
| `package.json` | Frontend dependencies and build scripts |
| `vite.config.ts` | Build config (Lovable + Nitro + Vercel) |
| `vercel.json` | API proxy rewrites linking frontend to backend |
| `.env.example` | Frontend env vars (`VITE_API_BASE_URL`, `VITE_DEV_BUSINESS_ID`) |
| `src/lib/api-client.ts` | How frontend calls backend API |
| `src/lib/api-types.ts` | Frontend mirror of backend domain types |
| `src/contexts/business-context.tsx` | Multi-tenant business context |
| `src/hooks/use-auth-session.ts` | Auth session hook |
| `src/hooks/use-conversations.ts` | Conversation API binding |
| `src/hooks/use-messages.ts` | Message API binding |
| `src/hooks/use-customers.ts` | Customer API binding |
| `src/hooks/use-dashboard-summary.ts` | Dashboard API binding |
| `src/hooks/use-current-reply-draft.ts` | Reply draft API binding |
| `src/hooks/use-reply-draft-actions.ts` | Reply draft mutation hooks |
| `src/components/app-shell.tsx` | Main app layout (sidebar, nav, responsive) |
| `src/components/ai-draft-panel.tsx` | AI draft review UI |
| `src/routes/__root.tsx` | Root route layout |
| `src/routes/index.tsx` | Dashboard page |
| `src/routes/inbox.$conversationId.tsx` | Conversation detail page |
| `docs/product/lovable-prototype-handoff.md` | Lovable handoff context |
| `docs/product/prototype-to-production-migration-plan.md` | Frontend migration strategy |
| `docs/architecture/design-system-reference.md` | Design system spec |
| `docs/architecture/ui-shell-and-navigation-reference.md` | Navigation architecture |

### Cross-Repo Risks

1. **No automated type sync** — `api-types.ts` (frontend) must be manually updated when backend domain types change.
2. **Reply draft send-tracking** (backend PR #86) may not yet be reflected in frontend hooks.
3. **API contract changes** in backend handlers are not automatically detected by frontend.
4. **Different package managers** — backend uses pnpm, frontend uses Bun.
5. **Different frameworks** — backend is Next.js 15, frontend is TanStack Start. Merging them would require a major rewrite.

---

## 2. Product Identity

| Field | Value |
|---|---|
| Product name | AI Reception SaaS |
| Target users | Business owners, admins, operators/receptionists, customers |
| Target businesses | Small service businesses (clinics, restaurants, salons, real estate, beauty centers) |
| Initial vertical | None (vertical-agnostic with template system planned) |
| Main use case | AI-assisted customer reception and conversation management |
| MVP goal | Manual reception + AI internal classification (Stage 0 + S1), then AI draft assist + website chat (Stage 2) |
| Long-term direction | Full AI receptionist with guarded auto-reply, voice reception, multi-channel, knowledge-aware drafts |
| Core product scope | Tenancy, identity, RBAC, CRM, conversations, messages, operator workflow, AI draft review |
| Future scope | Billing, analytics, full CRM pipeline, WhatsApp/SMS/email/voice, marketplace, advanced AI |

Evidence: `docs/product/PRD-v1.md`, `docs/product/mvp-scope.md`, `README.md`

---

## 3. Product Scope Classification

### 3.1 Confirmed MVP Scope

| Item | Implementation Status | Evidence |
|---|---|---|
| User identity / auth | ✅ Implemented | `src/domains/identity/`, `src/lib/auth/`, Auth.js + Google OAuth |
| Business / tenancy model | ✅ Implemented | `src/domains/tenancy/`, `prisma/schema.prisma` |
| Membership / role model | ✅ Implemented | `BusinessMembership` model, RBAC in `src/domains/authz/` |
| RBAC permissions | ✅ Implemented | `src/domains/authz/permissions.ts` — hardcoded role→permission map |
| Customer records (CRM) | ✅ Implemented | `src/domains/crm/`, `Customer` + `CustomerContactMethod` models |
| Conversation lifecycle | ✅ Implemented | `src/domains/conversations/`, status FSM with transitions |
| Message persistence | ✅ Implemented | `Message` model, create/list/find operations |
| Audit trail | ✅ Implemented | `src/domains/audit/`, `AuditEvent` model + API endpoints |
| Reply draft workflow | ✅ Implemented | `src/domains/reply-drafts/`, generate/edit/approve/discard/send-tracking |
| Dashboard aggregates | ✅ Implemented | Summary, operator workload, AI drafts dashboard endpoints |

### 3.2 Likely MVP Scope — Needs Verification

| Item | Status | Notes |
|---|---|---|
| AI internal classification (S1) | ❌ Not implemented | Schema fields exist (`aiClassificationStatus`), but no AI logic |
| Manual/internal test channel | Partially implemented | `ChannelType.INTERNAL` enum exists, API supports `channel` field, but no dedicated channel adapter |
| Conversation assignment/routing | Partially implemented | `assignedUserId` field exists, but `assignConversation` is explicitly deferred to R4 |
| Operator inbox UI | ❌ Not implemented | No frontend pages exist — only "Hello world" placeholder |

### 3.3 Future Roadmap / Non-MVP Scope

| Item | Status | Notes |
|---|---|---|
| Website chat widget | ❌ Not implemented | Documented as S2 |
| AI draft assist (real AI) | Documented only | Reply draft CRUD exists, but drafts are system-generated stubs with no AI provider |
| Knowledge base | ❌ Not implemented | `src/domains/knowledge/` contains only README.md |
| WhatsApp / Instagram / SMS / Email | ❌ Not implemented | `src/domains/channels/` contains only README.md |
| Voice reception | ❌ Not implemented | Documented as separate milestone |
| Billing / subscriptions | ❌ Not implemented | `src/domains/billing/` contains only README.md |
| Analytics dashboards | Partially implemented | Basic aggregate endpoints exist, no UI |
| Orders / Reservations / Cases | ❌ Not implemented | Scaffold folders only |
| Approvals workflow | ❌ Not implemented | Scaffold only |
| Onboarding wizard | ❌ Not implemented | Documented in PRD |
| Template system | ❌ Not implemented | Documented in PRD |
| Lead capture | ❌ Not implemented | Documented in PRD |

### 3.4 Unclear or Conflicting Scope

| Item | Notes |
|---|---|
| AI runtime provider integration | PRD says "one real + one fake/test" provider needed for S1, but the `ai-runtime/` domain is empty |
| Conversation status FSM | Schema has 7 statuses (NEW through RESOLVED); PRD lists 10 (adds TRIAGING, CLOSED, ARCHIVED) — mismatch |
| Per-business AI stage controls | Documented in PRD but no implementation in code |

---

## 4. Tech Stack

| Category | Tool / Library | Evidence File | Confidence | Notes |
|---|---|---|---|---|
| Frontend framework | Next.js 15.5.16 (App Router) | `package.json` L25 | High | React 19.1.0 |
| Language | TypeScript 5.x (strict) | `tsconfig.json`, `package.json` L47 | High | `strict: true` in tsconfig |
| Database | PostgreSQL via Prisma 7 | `prisma/schema.prisma`, `package.json` L24 | High | Using `@prisma/adapter-pg` driver adapter |
| ORM | Prisma 7 | `package.json` L24-45, `src/lib/prisma.ts` | High | Prisma Client + PrismaPg adapter |
| Auth | next-auth 5.0.0-beta.31 (Auth.js v5) | `package.json` L26, `src/lib/auth/` | High | JWT sessions, Google OAuth, feature-gated |
| Hosting target | Vercel | `.vercel/repo.json` | High | Project ID and org configured |
| Testing | Vitest 4.x | `vitest.config.ts`, `package.json` L48 | High | Node environment, 45 test files |
| Linting | ESLint 9 (flat config) | `eslint.config.mjs` | High | — |
| Formatting | Prettier 3 | `.prettierrc`, `package.json` L43 | High | With TailwindCSS plugin |
| Styling | Tailwind CSS 4 | `package.json` L46, `postcss.config.mjs` | High | Dev dependency, minimal use (no UI) |
| Package manager | pnpm 10.30.2 | `package.json` L53 | High | `packageManager` field set |
| Validation | Zod 3 | `package.json` L30 | High | Used in API handlers and domain validation |
| Build tool | Next.js built-in | `next.config.ts` | High | — |
| State management | None | — | High | No UI exists |
| Form validation | None | — | High | No UI exists |
| AI providers | None installed | `package.json` | High | No AI SDK in dependencies |
| Realtime | None | — | High | Not implemented |

---

## 5. Repository Structure

```
ai-reception-saas/
├── src/
│   ├── app/                           # Next.js App Router
│   │   ├── api/                       # All API routes (35 route files)
│   │   │   ├── _shared/               # 13 shared API modules (context, auth, composition)
│   │   │   ├── auth/[...nextauth]/    # Auth.js NextAuth route
│   │   │   ├── authz/                 # Permission evaluation endpoints
│   │   │   ├── businesses/            # Tenant-scoped business CRUD + nested routes
│   │   │   │   └── [businessId]/
│   │   │   │       ├── audit-events/  # Audit log endpoints
│   │   │   │       ├── conversations/ # Conversation + message CRUD
│   │   │   │       │   └── [conversationId]/
│   │   │   │       │       ├── messages/        # Message endpoints
│   │   │   │       │       ├── reply-drafts/    # Draft generate/edit/approve/discard/current
│   │   │   │       │       └── status/          # Status change endpoint
│   │   │   │       ├── customers/     # CRM customer CRUD + contact methods
│   │   │   │       ├── dashboard/     # Summary, operator workload, AI drafts
│   │   │   │       └── memberships/   # Membership CRUD + role/status changes
│   │   │   ├── health/               # Health check
│   │   │   └── identity/             # Self-profile, sessions, user lookup
│   │   ├── globals.css               # Minimal (1 line)
│   │   ├── layout.tsx                # Root layout (minimal)
│   │   └── page.tsx                  # "Hello world" placeholder
│   ├── domains/                      # 19 domain directories (7 implemented, 12 scaffold). Architecture defines 18 domains; reply-drafts is a 19th addition.
│   │   ├── identity/                 # ✅ Users, sessions (6 files)
│   │   ├── tenancy/                  # ✅ Businesses, memberships (6 files)
│   │   ├── authz/                    # ✅ RBAC permissions (6 files)
│   │   ├── audit/                    # ✅ Audit events (6 files)
│   │   ├── crm/                      # ✅ Customers, contacts (6 files)
│   │   ├── conversations/            # ✅ Conversations, messages (6 files)
│   │   ├── reply-drafts/             # ✅ Reply draft workflow (3 files)
│   │   ├── actions/                  # 📋 README.md only
│   │   ├── ai-config/               # 📋 README.md only
│   │   ├── ai-runtime/              # 📋 README.md only
│   │   ├── analytics/               # 📋 README.md only
│   │   ├── approvals/               # 📋 README.md only
│   │   ├── billing/                 # 📋 README.md only
│   │   ├── cases/                   # 📋 README.md only
│   │   ├── channels/                # 📋 README.md only
│   │   ├── knowledge/               # 📋 README.md only
│   │   ├── orders/                  # 📋 README.md only
│   │   ├── reservations/            # 📋 README.md only
│   │   └── routing/                 # 📋 README.md only
│   └── lib/                         # Shared kernel
│       ├── auth/                    # Auth.js adapter boundary (9 files including index.ts)
│       ├── env.ts                   # Environment config
│       ├── errors.ts                # Error hierarchy (AppError + 6 subtypes)
│       ├── ids.ts                   # UUID helpers
│       ├── index.ts                 # Barrel export
│       ├── prisma.ts                # Prisma client singleton (lazy init)
│       ├── result.ts                # ActionResult<T> monad (ok/err)
│       ├── time.ts                  # Time helpers
│       └── types.ts                 # UUID, ISOTimestamp, JsonValue
├── prisma/
│   ├── schema.prisma                # 12 models, 16 enums, 441 lines
│   └── migrations/                  # 6 migrations (tenant → auth → CRM → conversations → reply-drafts)
├── __tests__/                       # 45 test files, ~23k lines
│   ├── api/                         # 27 handler/route tests
│   ├── auth/                        # 5 Auth.js adapter tests
│   ├── domains/                     # 8 domain service/repo tests
│   ├── foundation/                  # 4 smoke/schema tests
│   └── integration/                 # 1 integration test (DB-dependent, skipped in CI)
├── docs/                            # Extensive documentation
│   ├── product/                     # PRD, MVP scope, requirements, service blueprint
│   ├── architecture/                # 15 architecture decision docs
│   ├── checkpoints/                 # ~50 task checkpoint docs
│   ├── engineering/                 # Merge gate, workflow, migration policy
│   ├── operations/                  # Auth.js staging runbooks
│   └── api/                         # API documentation
├── .github/workflows/ci.yml         # GitHub Actions CI
├── .vercel/                         # Vercel deployment config
├── package.json                     # Dependencies and scripts
├── pnpm-lock.yaml                   # Lock file (176KB)
├── tsconfig.json                    # TypeScript config (strict)
└── vitest.config.ts                 # Test configuration
```

### How to Navigate This Repo (for Claude Code)

1. **Start with `prisma/schema.prisma`** — this is the canonical data model. All 10 models and 17 enums are defined here.
2. **Read `src/domains/` modules** — each implemented domain follows the pattern: `types.ts` → `validation.ts` → `repository.ts` → `service.ts` → `implementation.ts` → `index.ts`.
3. **Read `src/app/api/_shared/`** — this contains the request context system, composition root, auth adapters, and shared handler utilities.
4. **API routes follow Next.js App Router conventions** — each `route.ts` delegates to a `handler.ts` in the same or parent directory.
5. **The `src/lib/` shared kernel** is small and focused: error types, result monad, Prisma client, environment config.
6. **Tests in `__tests__/`** mirror the source structure. All tests use in-memory mocks (no real DB in CI).
7. **Documentation is extensive** — `docs/product/PRD-v1.md` is the locked product spec. `docs/DOMAIN_MAP.md` is the architecture reference.

---

## 6. Important Files and Risk Map

| File / Folder | Purpose | Why It Matters | Risk | Inspect First? | Notes |
|---|---|---|---|---|---|
| `prisma/schema.prisma` | Data model | Source of truth for all tables, relations, enums | High | Yes | 10 models, 17 enums |
| `src/app/api/_shared/composition.ts` | Dependency injection root | Wires all repos → services for API | High | Yes | Lazy singleton |
| `src/app/api/_shared/request-context.ts` | Request context contracts | Auth/tenant context for all API routes | High | Yes | All request flows depend on this |
| `src/app/api/_shared/auth-context-adapter.ts` | Auth resolution | Dev headers + Auth.js adapter selection | High | Yes | Controls real vs dev auth |
| `src/app/api/_shared/authjs-context-adapter.ts` | Auth.js session → tenant context | Maps Auth.js sessions to tenant contexts | High | Yes | 15KB, complex adapter |
| `src/lib/auth/` | Auth.js adapter boundary | Google OAuth, route handlers, feature gates | High | Yes | 9 files (8 modules + index.ts), carefully gated |
| `src/domains/authz/permissions.ts` | RBAC permission map | Hardcoded role→permission mapping | Medium | Yes | Must match PRD access matrix |
| `src/domains/conversations/implementation.ts` | Conversation service | Core business logic for conversations | High | Yes | Tenant integrity checks |
| `src/domains/conversations/validation.ts` | Status FSM + validation | Conversation status transitions | Medium | Yes | Controls valid state changes |
| `src/domains/reply-drafts/repository.ts` | Reply draft persistence | Draft lifecycle (generate/edit/approve/discard) | Medium | Yes | 667 lines, complex state machine |
| `src/lib/result.ts` | ActionResult monad | Return type pattern used everywhere | Low | Yes | Small but critical to understand |
| `src/lib/errors.ts` | Error hierarchy | AppError + typed error classes | Low | Yes | Used across all domains |
| `docs/product/PRD-v1.md` | Product requirements | LOCKED product spec | High | Yes | Source of truth for product intent |
| `.github/workflows/ci.yml` | CI pipeline | Lint + typecheck + build + test | Low | No | Standard setup |
| `.env.example` | Environment template | Required vars for development | Medium | Yes | Only 2 vars listed |

---

## 7. Implemented Features Verified in Code

### 7.1 User Identity & Auth

| Aspect | Detail |
|---|---|
| What works | User model, session model, account model. Auth.js v5 with Google OAuth behind feature flag. JWT sessions. Self-profile (`/api/identity/me`), session list/revoke, user lookup. |
| Key files | `src/domains/identity/`, `src/lib/auth/`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/identity/` |
| Evidence | 6 domain files, 9 auth files (8 modules + index.ts), 5 API routes, 5 auth tests |
| Confidence | High |
| Risk level | Medium — Auth.js v5 is beta (5.0.0-beta.31) |
| Missing tests | No E2E auth flow test, no token refresh test |
| Recommended next action | Monitor Auth.js v5 for stable release; add session expiry handling |

### 7.2 Tenancy / Business Model

| Aspect | Detail |
|---|---|
| What works | Business CRUD (create, read, update, list). Business status (ACTIVE/SUSPENDED/ARCHIVED). Slug uniqueness. Timezone/locale. Membership CRUD with role and status management. |
| Key files | `src/domains/tenancy/`, `src/app/api/businesses/` |
| Evidence | 6 domain files, 4 API routes for businesses, 5 for memberships |
| Confidence | High |
| Risk level | Low |
| Missing tests | No multi-business membership conflict tests |
| Recommended next action | Add business deletion flow (currently only status change) |

### 7.3 RBAC / Permissions

| Aspect | Detail |
|---|---|
| What works | 4 roles (OWNER, ADMIN, OPERATOR, VIEWER). 22 permissions. Hardcoded role→permission map. `evaluateAccess`, `hasPermission`, `requirePermission`. API endpoints for evaluate/require/role-permissions. |
| Key files | `src/domains/authz/permissions.ts`, `src/domains/authz/types.ts`, `src/domains/authz/service.ts`, `src/domains/authz/implementation.ts` |
| Evidence | 22 permission constants, role map, 3 API endpoints |
| Confidence | High |
| Risk level | Medium — hardcoded, no database-backed custom roles |
| Missing tests | No tests for OPERATOR permission boundary (what they can't do) |
| Recommended next action | Add permission tests for each role boundary |

### 7.4 CRM / Customer Records

| Aspect | Detail |
|---|---|
| What works | Customer CRUD (create, read, update, list, archive). Contact methods (email, phone, WhatsApp, etc.) with CRUD. Customer identity resolution by contact method. Tenant-scoped. |
| Key files | `src/domains/crm/`, `src/app/api/businesses/[businessId]/customers/` |
| Evidence | 6 domain files, 6 API routes, validation tests |
| Confidence | High |
| Risk level | Low |
| Missing tests | No deduplication edge case tests |
| Recommended next action | None immediate |

### 7.5 Conversations & Messages

| Aspect | Detail |
|---|---|
| What works | Conversation CRUD with status FSM (NEW→OPEN→ASSIGNED→WAITING_CUSTOMER→WAITING_OPERATOR→ESCALATED→RESOLVED). Message create/list/find. Initial message on conversation creation. Customer linking with tenant integrity check. Pagination with cursor. |
| Key files | `src/domains/conversations/`, `src/app/api/businesses/[businessId]/conversations/` |
| Evidence | 6 domain files, 4 API routes, comprehensive validation |
| Confidence | High |
| Risk level | Medium — `countNeedingFollowUp` uses in-memory filtering (see scale note in code) |
| Missing tests | No concurrent status change tests |
| Recommended next action | Implement `assignConversation` (deferred to R4) |

### 7.6 Reply Draft Workflow

| Aspect | Detail |
|---|---|
| What works | Generate stub draft (SYSTEM source), edit draft text, approve/discard drafts, get current draft, send tracking schema (sentMessageId, sentAt, sentByUserId). Dashboard with pending count and preview. |
| Key files | `src/domains/reply-drafts/`, `src/app/api/.../reply-drafts/` |
| Evidence | 3 domain files, 5 API routes, permission-gated (ai_drafts.*) |
| Confidence | High |
| Risk level | Medium — drafts are system-generated stubs, not real AI |
| Missing tests | No concurrency test (two operators editing same draft) |
| Recommended next action | Connect to AI runtime for actual draft generation |

### 7.7 Audit Trail

| Aspect | Detail |
|---|---|
| What works | AuditEvent model with actor type (USER/SYSTEM/AI_RECEPTIONIST), action, target, result. Conversation and message actions emit audit. API endpoints for list/detail. |
| Key files | `src/domains/audit/`, `src/app/api/businesses/[businessId]/audit-events/` |
| Evidence | 6 domain files, 2 API routes |
| Confidence | High |
| Risk level | Low |
| Missing tests | No audit volume/performance tests |
| Recommended next action | None immediate |

### 7.8 Dashboard Aggregates

| Aspect | Detail |
|---|---|
| What works | Summary endpoint (open conversations, new, escalated, waiting, drafts pending review, needing follow-up). Operator workload (per-assignee open + resolved-today + unassigned). AI drafts dashboard (pending/edited drafts with conversation context). |
| Key files | `src/app/api/businesses/[businessId]/dashboard/` |
| Evidence | 3 handler files, 3 route files, 3 test files |
| Confidence | High |
| Risk level | Low-Medium — `countNeedingFollowUp` is O(n) in-memory |
| Missing tests | No performance tests for large datasets |
| Recommended next action | Monitor for scale issues |

---

## 8. Partially Implemented Features

### 8.1 Conversation Assignment

| Aspect | Detail |
|---|---|
| What exists | `assignedUserId` field on Conversation model, `conversations.assign` permission, `ASSIGNED` status |
| What is missing | `assignConversation` service method not implemented. Code comment: "deferred to R4. Requires membership verification." |
| Key files | `src/domains/conversations/implementation.ts` L323-327 |
| Evidence | TODO comment in implementation.ts |
| Risk level | Medium |
| Recommended next step | Implement assignment with membership check (verify assignee is member of business) |
| Recommended model | Opus 4.8 |

### 8.2 Reply Draft Send Flow

| Aspect | Detail |
|---|---|
| What exists | `SENT` status in ReplyDraftStatus enum, `sentMessageId`, `sentAt`, `sentByUserId` fields in schema, `ai_drafts.send` permission |
| What is missing | No `sendDraft` repository method. No API endpoint to send an approved draft as a message. Send tracking columns exist but no code writes to them. |
| Key files | `prisma/schema.prisma` L425-427, `src/domains/reply-drafts/types.ts` |
| Evidence | Schema fields present but no implementation |
| Risk level | Medium |
| Recommended next step | Implement `sendDraft` that creates a Message from the approved draft text |
| Recommended model | Opus 4.8 |

### 8.3 Auth.js Session → Tenant Context Mapping

| Aspect | Detail |
|---|---|
| What exists | `src/app/api/_shared/authjs-context-adapter.ts` (15KB) — maps Auth.js sessions to tenant contexts via DB lookup |
| What is missing | No automatic business selection for multi-business users. Relies on `x-business-id` header or route param. No middleware-level session enforcement. |
| Key files | `src/app/api/_shared/authjs-context-adapter.ts` |
| Evidence | 15KB file with comprehensive implementation |
| Risk level | Medium |
| Recommended next step | Add UI-level business switcher when frontend is built |
| Recommended model | Opus 4.8 |

---

## 9. Pending / Not Implemented Features

### 9.1 MVP-Critical Pending Items

| Item | Source/Evidence | Why It Matters | Recommended Model | Priority |
|---|---|---|---|---|
| **Operator inbox UI wiring** | PRD §15; frontend UI exists in companion repo but some pages not fully wired to backend | Remaining pages need API integration | Opus 4.8 | P0 |
| **AI runtime adapter** | PRD §18, `src/domains/ai-runtime/` empty | AI classification/drafting requires a provider | Fable 5 (design) / Opus 4.8 (impl) | P0 |
| **AI classification pipeline** | PRD §6, `ENABLE_AI_CLASSIFICATION` flag planned | S1 milestone requirement | Opus 4.8 | P1 |
| **Conversation assignment** | Implementation deferred to R4 | Operators can't claim conversations | Opus 4.8 | P1 |
| **Reply draft send flow** | Schema exists, no implementation | Operators can't send approved drafts | Opus 4.8 | P1 |

### 9.2 Future Roadmap Items

| Item | Source/Evidence | Recommended Model | Priority |
|---|---|---|---|
| Website chat widget | PRD §7, R8 | Fable 5 (design) / Opus 4.8 (impl) | P2 |
| Knowledge base | PRD §11, R7 | Opus 4.8 | P2 |
| AI draft assist (real AI) | PRD §6, R9 | Fable 5 (design) / Opus 4.8 (impl) | P2 |
| Lead capture | PRD §9, R10 | Sonnet 4.6 | P2 |
| Onboarding wizard | PRD §16 | Opus 4.8 | P2 |
| Template system | PRD §8, R5 | Fable 5 (design) | P2 |

### 9.3 Nice-to-Have Items

| Item | Source/Evidence | Priority |
|---|---|---|
| Advanced analytics | PRD §18, R12 | P3 |
| Full admin panel | PRD §15 | P3 |
| Multi-language UI | PRD §13 | P3 |
| Action requests (appointments, reservations) | PRD §10, R11 | P3 |

### 9.4 Unclear Items

| Item | Notes | Priority |
|---|---|---|
| Per-business AI stage controls | PRD describes stage toggles per business, but no schema for this | P1 |
| Routing rules engine | PRD §7 mentions routing domain, but no design exists | P2 |
| Business profile / settings page | Referenced but no API endpoints for settings | P2 |

---

## 10. Supabase / Database Status

> **Note:** This project uses **Prisma ORM with PostgreSQL directly**, not Supabase. There is no Supabase client, no Supabase edge functions, no Supabase auth. Despite the PRD mentioning "Supabase (staging verified)" for hosting, the database is accessed purely through Prisma.

### Existing Tables (12 models in Prisma schema)

| Table | Domain | Description |
|---|---|---|
| `users` | Identity | User accounts |
| `sessions` | Identity | Login sessions (token hash, expiry, revocation) |
| `accounts` | Auth | OAuth provider accounts (Auth.js adapter) |
| `verification_tokens` | Auth | Email verification tokens (Auth.js) |
| `businesses` | Tenancy | Tenant workspaces |
| `business_memberships` | Tenancy | User-to-business role assignments |
| `audit_events` | Audit | Audit trail records |
| `customers` | CRM | Customer profiles (tenant-scoped) |
| `customer_contact_methods` | CRM | Customer contact info (email, phone, WhatsApp, etc.) |
| `conversations` | Conversations | Conversation threads (tenant-scoped) |
| `messages` | Conversations | Individual messages |
| `reply_drafts` | Reply Drafts | AI/system draft replies for operator review |

### Migrations (6 total)

1. `20260509163715_add_tenant_identity_foundation` — Users, sessions, businesses, memberships, audit events
2. `20260514_auth_provider_persistence` — Accounts, verification tokens (Auth.js)
3. `20260522_add_crm_customer_foundation` — Customers, contact methods
4. `20260523124455_add_conversation_message_foundation` — Conversations, messages
5. `20260608_add_reply_drafts` — Reply drafts model
6. `20260610_add_reply_draft_sent_tracking` — Added sentMessageId, sentAt, sentByUserId to reply_drafts

### RLS Policies

**None.** This project uses Prisma (not Supabase), so there are no Row-Level Security policies. Tenant isolation is enforced at the application layer — every repository method filters by `businessId`.

### Database Client Setup

`src/lib/prisma.ts` — Lazy singleton with Prisma 7 driver adapter pattern (`PrismaPg`). Throws if `DATABASE_URL` is missing. Hot-reload safe via `globalThis` caching.

### Multi-Tenant Readiness

- **Application-level tenant scoping:** All queries filter by `businessId`. Repository methods accept `businessId` as a required parameter.
- **No database-level isolation:** Single database, no schema-per-tenant, no RLS.
- **Data isolation risk:** A bug in a repository method could expose cross-tenant data. The code is well-written but relies on correct implementation, not database-enforced boundaries.

### Missing Schema Pieces

- No `AI classification result` table (needed for S1)
- No `knowledge base entry` table (needed for S2-S3)
- No `channel adapter config` table (needed for S2)
- No `business settings` / `AI config` table (needed for per-business AI stage)
- No `action request` / `booking` table (needed for R11)

### Migration Risks

- Migrations are standard Prisma migrations — safe to run in order.
- The `prisma.config.ts` uses the Prisma 7 config pattern (datasource URL in config, not schema).
- No seed data file exists.
- No generated Prisma types file is committed (generated at build time).

---

## 11. Auth Status

### Verified in Code

| Aspect | Status | Evidence |
|---|---|---|
| Auth mechanism | Auth.js v5 (next-auth 5.0.0-beta.31) with JWT sessions | `package.json`, `src/lib/auth/` |
| OAuth provider | Google OAuth behind `ENABLE_AUTHJS_GOOGLE_PROVIDER` flag | `src/lib/auth/authjs-google-provider.ts` |
| Feature gate | `ENABLE_AUTHJS_RUNTIME` kills all auth if false (501) | `src/lib/auth/authjs-feature-gate.ts` |
| Route handler | `src/app/api/auth/[...nextauth]/route.ts` | Flag checked before cache on every request |
| Session reading | `readAuthjsSession(request)` → `AuthjsSessionLike` | `src/lib/auth/authjs-runtime.ts` |
| Adapter boundary | Custom Prisma adapter wrapping Auth.js types | `src/lib/auth/authjs-adapter.ts` |
| User mapping | Auth.js user ↔ internal User model mapping | `src/lib/auth/authjs-user-mapping.ts` |
| Dev auth mode | `ENABLE_DEV_AUTH_CONTEXT` for development header auth | `src/app/api/_shared/auth-context-adapter.ts` |
| Auth.js context adapter | Maps Auth.js sessions to tenant contexts via DB lookup | `src/app/api/_shared/authjs-context-adapter.ts` |
| Protected routes | All API handlers resolve auth context before service calls | Pattern in all handler.ts files |

### Documented Only / Not Verified

| Aspect | Notes |
|---|---|
| Signup flow UI | No UI exists |
| Login page UI | No UI exists |
| Logout behavior | Auth.js provides signout, but no UI to trigger it |
| Session refresh | Depends on Auth.js JWT refresh behavior |
| Password auth | Only Google OAuth implemented |

### Missing / Unclear

| Aspect | Risk |
|---|---|
| No middleware-level auth enforcement | Each route handler resolves context individually — easy to forget |
| `ENABLE_DEV_AUTH_CONTEXT` must be false in production | Security risk if misconfigured |
| Auth.js v5 is beta | API surface may change |
| No CSRF protection verification | Auth.js should handle this, but not explicitly verified |
| No rate limiting on auth endpoints | No rate limiting anywhere in the codebase |

---

## 12. RBAC / Permissions / Roles Status

### Existing Roles

| Role | Scope | Permissions Count |
|---|---|---|
| `OWNER` | Full control | 22 (all permissions) |
| `ADMIN` | Everything except `business.delete` | 21 |
| `OPERATOR` | Customer/conversation/message/draft operations | 12 |
| `VIEWER` | Read-only on business, customers, conversations, messages | 4 |

### Permission Map (22 permissions)

```
business.read, business.update, business.delete
members.read, members.invite, members.remove, members.change_role
customers.read, customers.update
conversations.read, conversations.reply, conversations.assign, conversations.close
messages.read, messages.create
ai_drafts.read, ai_drafts.generate, ai_drafts.approve, ai_drafts.send
audit.read
settings.read, settings.update
```

### Permission Checks

- **API layer:** Handlers call `authzService.requirePermission()` before service calls.
- **Service layer:** Services do NOT check permissions — they trust the caller.
- **Sensitive permissions** (require audit): `business.delete`, `members.invite`, `members.remove`, `members.change_role`, `customers.update`, `conversations.assign`, `conversations.close`, `ai_drafts.approve`, `ai_drafts.send`, `settings.update`.

### Access Control Risks

1. **No super admin concept** — no platform-level admin role above tenant OWNER.
2. **VIEWER role can read all conversations and messages** — may be too permissive depending on business context.
3. **Hardcoded permissions** — no ability to customize per-tenant without code change.
4. **No UI permission checks** — no frontend exists, so no UX enforcement.
5. **Service layer trusts caller** — if a service is called without going through an API handler, no permission check occurs.

---

## 13. Multi-Tenant / Business Boundary Status

### How Tenancy Works

| Aspect | Detail |
|---|---|
| Tenant = Business | Each business is a tenant with its own data scope |
| User ↔ Business | Many-to-many via `BusinessMembership` (unique constraint on userId + businessId) |
| Multi-business membership | ✅ Supported — a user can belong to multiple businesses |
| Role per membership | ✅ Each membership has its own role (OWNER/ADMIN/OPERATOR/VIEWER) |
| Operator-to-business assignment | Via membership with OPERATOR role |
| Tenant context resolution | `TenantRequestContext` contains userId, businessId, membershipId, role |

### Tenant Isolation

| Layer | Status | Notes |
|---|---|---|
| Database schema | ⚠️ Application-enforced | No RLS, no schema-per-tenant. All tables share one schema. |
| Repository layer | ✅ businessId filtering | Every find/list method filters by businessId |
| Service layer | ✅ Tenant integrity checks | Customer linking verifies customer belongs to same business |
| API layer | ✅ Tenant context required | Tenant-scoped endpoints require TenantRequestContext |
| Message ↔ Conversation | ✅ Composite reference | Message references Conversation via `[conversationId, businessId]` |

### Current Risks

1. **No database-level enforcement** — a single missed `WHERE businessId = ?` could leak data.
2. **Customer lookup uses injected function** — `CustomerLookup` in conversations repo is injected at composition time, which is correct but adds indirection.
3. **No automated tenant isolation tests** — no test verifies that querying with wrong businessId returns empty.
4. **Audit events can have null businessId** — system-level audit events don't require a business scope.

### Missing Pieces

- No tenant deletion / data export flow.
- No tenant suspension behavior enforcement (status exists but no middleware blocks suspended tenants).
- No tenant-level feature flags in schema.

---

## 14. Inbox / Conversations Status

### Conversation Model

| Aspect | Status |
|---|---|
| Model exists | ✅ `Conversation` in Prisma schema |
| Status FSM | ✅ 7 statuses: NEW, OPEN, ASSIGNED, WAITING_CUSTOMER, WAITING_OPERATOR, ESCALATED, RESOLVED |
| Transition validation | ✅ `validateTransition()` in `conversations/validation.ts` |
| Customer linking | ✅ Optional customerId with tenant integrity check |
| Assignment | ⚠️ Field exists (`assignedUserId`) but `assignConversation` operation is deferred |
| AI fields | ✅ `aiClassificationStatus`, `aiDraftStatus` columns (NOT_REQUESTED/PENDING/READY/FAILED) |
| Channel | ✅ `ChannelType` enum (INTERNAL, WEBSITE_CHAT) |

### Message Model

| Aspect | Status |
|---|---|
| Model exists | ✅ `Message` in Prisma schema |
| Direction | ✅ INBOUND, OUTBOUND, SYSTEM, INTERNAL |
| Sender types | ✅ CUSTOMER, OPERATOR, SYSTEM, AI_RECEPTIONIST |
| Content | ✅ Text content with contentType (default `text/plain`) |
| Attachments | ❌ Not implemented |

### Inbox UI

**Not implemented in this backend repo.** The only page in this repo is `src/app/page.tsx` which renders "Hello world". However, the companion frontend repo (`ai-reception-saas-a7cff9d2`) has a full inbox UI at `/inbox` and `/inbox/$conversationId`, wired to this backend's conversations and messages APIs. See §1A.

### Operator Workflow

| Aspect | Status |
|---|---|
| View conversation list | ✅ API endpoint exists (GET `/api/businesses/:id/conversations`) |
| View conversation detail | ✅ API endpoint exists (GET `/api/businesses/:id/conversations/:id`) |
| Send message | ✅ API endpoint exists (POST `/api/businesses/:id/conversations/:id/messages`) |
| Change status | ✅ API endpoint exists (PATCH `/api/businesses/:id/conversations/:id/status`) |
| Assign conversation | ⚠️ Deferred to R4 |
| Internal notes | ✅ `INTERNAL` direction messages are supported |
| Reply drafts | ✅ Generate/edit/approve/discard/current endpoints |

### AI Handoff/Release

**Not implemented.** No AI-to-human or human-to-AI handoff logic exists. The `AI_RECEPTIONIST` sender type exists in the enum but is not used in any code.

### Realtime Behavior

**Not implemented.** No WebSocket, no Server-Sent Events, no polling mechanism. All data is fetched via REST API calls.

### Risks and Missing Parts

1. **No UI** — operators cannot interact with conversations.
2. **No realtime** — operators must manually refresh to see new messages.
3. **No assignment flow** — operators can't claim conversations.
4. **No notification system** — no alerts for new messages or escalations.
5. **In-memory follow-up counting** — `countNeedingFollowUp` loads all active conversations to check last message age (O(n)).

---

## 15. AI Receptionist Logic Status

### Where AI Logic Exists

**It doesn't.** The 12 AI-related domain folders are empty scaffolds:
- `src/domains/ai-runtime/` — README.md only
- `src/domains/ai-config/` — README.md only
- `src/domains/knowledge/` — README.md only

### AI-Related Schema Elements

| Element | Status | Notes |
|---|---|---|
| `AiClassificationStatus` enum | ✅ In schema | NOT_REQUESTED, PENDING, READY, FAILED |
| `AiDraftStatus` enum | ✅ In schema | NOT_REQUESTED, PENDING, READY, APPROVED, REJECTED, FAILED |
| `aiClassificationStatus` column on Conversation | ✅ In schema | Not written to by any code |
| `aiDraftStatus` column on Conversation | ✅ In schema | Updated by reply draft operations |
| `ReplyDraft` model | ✅ Implemented | System-generated stubs only — no AI |
| `AI_RECEPTIONIST` sender type | ✅ In enum | Not used in any code |
| `AI_RECEPTIONIST` audit actor type | ✅ In enum | Not used in any code |
| `modelProvider`, `modelName`, `promptVersion` on ReplyDraft | ✅ In schema | Null for all current stubs |

### What Should Be Designed Before Deeper AI Implementation

1. **AI runtime adapter interface** — define provider-neutral contract for classification and draft generation
2. **Provider selection** — choose initial AI provider (OpenAI, Anthropic, Google Gemini, etc.)
3. **Prompt template system** — tenant-scoped prompt configuration
4. **Context window management** — what conversation history to pass to AI
5. **Error handling** — timeout/fallback behavior when AI fails
6. **Cost tracking** — per-tenant AI usage metering
7. **Safety guardrails** — content filtering, hallucination detection
8. **Per-business AI stage flags** — schema for controlling which AI features each business can use

---

## 16. Integrations Status

| Integration | Status | Evidence | Risk | Recommended Next Step | Model |
|---|---|---|---|---|---|
| WhatsApp | ❌ Not implemented | No code, no SDK | Low (deferred) | Design channel adapter pattern first | Fable 5 |
| Twilio | ❌ Not implemented | No code, no SDK | Low (deferred) | — | — |
| Email | ❌ Not implemented | No code, no SDK | Low (deferred) | — | — |
| Voice/STT/TTS | ❌ Not implemented | No code, no SDK | Low (deferred) | Separate product milestone | — |
| Payment/billing | ❌ Not implemented | No code, no SDK | Low (deferred) | — | — |
| CRM/external APIs | ❌ Not implemented | No code | Low (deferred) | — | — |
| Webhooks | ❌ Not implemented | No webhook handlers | Low (deferred) | — | — |
| Storage/file uploads | ❌ Not implemented | No storage code | Medium | Needed for attachments | — |
| Google OAuth | ✅ Implemented | `src/lib/auth/authjs-google-provider.ts` | Low | Working and verified | — |

---

## 17. Billing / Plans / Usage Limits Status

**Not implemented.** The `src/domains/billing/` folder contains only a `README.md` scaffold.

| Aspect | Status |
|---|---|
| Plans | ❌ Not implemented |
| Seats | ❌ Not implemented (no membership limits) |
| Conversation limits | ❌ Not implemented |
| Usage metering | ❌ Not implemented |
| Subscription logic | ❌ Not implemented |
| Payment provider | ❌ Not implemented |
| Overages | ❌ Not implemented |
| Tenant billing ownership | ❌ Not implemented |
| Admin billing UI | ❌ Not implemented |

The PRD explicitly states billing is out of MVP scope. The architecture should be "entitlement/usage-ready" per PRD §20.

---

## 18. Testing Status

### Test Framework

Vitest 4.x with Node environment. Configuration in `vitest.config.ts`.

### Test Files (45 total, ~23,000 lines)

| Category | Files | Description |
|---|---|---|
| API handler tests | 27 | Test handler functions with mock dependencies |
| Auth adapter tests | 5 | Test Auth.js adapter, mapping, config, providers |
| Domain service tests | 8 | Test service/repo logic with mock repos |
| Foundation tests | 4 | Smoke test, Prisma schema validation, shared helpers |
| Integration tests | 1 | DB-dependent test (skipped in CI — no DB service) |

### What's Tested

- Handler contract tests (all API handlers have corresponding tests)
- Auth.js adapter/mapping unit tests
- Domain validation logic
- Permission evaluation
- Conversation service operations
- CRM service operations
- Reply draft operations
- Prisma schema structural validation

### What's Not Tested

1. **No E2E tests** — no browser-based testing (no UI exists)
2. **No integration tests in CI** — the one integration test requires a real database
3. **No performance/load tests**
4. **No security tests** (injection, XSS, CSRF)
5. **No tenant isolation boundary tests**
6. **No concurrent operation tests** (race conditions)
7. **No error recovery tests** (database failures, network timeouts)

### Recommended First 10 Tests to Add

1. Tenant isolation: query with wrong businessId returns empty
2. RBAC boundary: VIEWER cannot create messages
3. RBAC boundary: OPERATOR cannot delete business
4. Conversation status FSM: invalid transitions rejected
5. Reply draft: concurrent edit by two operators
6. Auth.js session expiry handling
7. API error responses: malformed JSON body
8. API error responses: missing required fields
9. Customer deduplication edge cases
10. Rate limiting / abuse protection (when implemented)

---

## 19. Build / Lint / Typecheck / Dev Commands

| Command | Script | Status |
|---|---|---|
| Install | `pnpm install` | ✅ Available |
| Dev server | `pnpm dev` | ✅ Available (`next dev`) |
| Build | `pnpm build` | ✅ Available (`next build`) |
| Lint | `pnpm lint` | ✅ Available (`eslint .`) |
| Lint fix | `pnpm lint:fix` | ✅ Available |
| Typecheck | `pnpm typecheck` | ✅ Available (`tsc --noEmit`) |
| Test | `pnpm test` | ✅ Available (`vitest run`) |
| Test watch | `pnpm test:watch` | ✅ Available (`vitest`) |
| Format | `pnpm format` | ✅ Available (`prettier --write .`) |
| Format check | `pnpm format:check` | ✅ Available (`prettier --check .`) |
| Prisma generate | `pnpm prisma:generate` | ✅ Available |
| Prisma migrate | `pnpm prisma:migrate` | ✅ Available (`prisma migrate dev`) |
| Prisma studio | `pnpm prisma:studio` | ✅ Available |
| E2E test | — | ❌ Missing |
| Preview | — | ❌ Missing (use `pnpm start` after build) |

**Note:** `pnpm build` requires `DATABASE_URL` to be set (Prisma client generation at build time). The CI sets a dummy `DATABASE_URL`.

---

## 20. Deployment Status

### Deployment Target

| Aspect | Detail |
|---|---|
| Platform | Vercel |
| Config | `.vercel/repo.json` — project linked |
| Project ID | `prj_QBBKlTdeTfOtYlJ18HVC4HOKIltH` |
| Org ID | `team_xvsjAaXBPtcz6jnTC5JXIALt` |

### CI Pipeline

`.github/workflows/ci.yml` — runs on push to main/develop and PRs:
1. Checkout
2. Setup pnpm
3. Setup Node.js 20
4. Install dependencies (frozen lockfile)
5. Generate Prisma client
6. Lint
7. Typecheck
8. Build
9. Test

### Environment Variables for Deployment

See Section 21 below.

### Deployment Risks

1. **No `vercel.json` configuration file** — relies on Vercel auto-detection.
2. **Auth.js requires `AUTH_SECRET`** — must be set in Vercel environment.
3. **Google OAuth requires callback URL** — must be configured in Google Console for production domain.
4. **`ENABLE_DEV_AUTH_CONTEXT` must be `false` in production** — security critical.
5. **No health check monitoring** beyond the `/api/health` endpoint.
6. **No error tracking service** (Sentry, etc.).

---

## 21. Environment Variables

| Variable | Where Used | Required? | Client/Server | Risk if Missing | Safe to Expose? |
|---|---|---|---|---|---|
| `DATABASE_URL` | `src/lib/env.ts`, `prisma.config.ts` | Yes | Server | App won't start (Prisma throws) | ❌ No (contains password) |
| `NEXT_PUBLIC_APP_URL` | `src/lib/env.ts` | No (defaults to localhost:3000) | Client | Incorrect URLs | ✅ Yes (public URL) |
| `AUTH_SECRET` | `src/lib/auth/authjs-runtime.ts` | Yes (if auth enabled) | Server | Auth.js fails | ❌ No (secret) |
| `AUTH_GOOGLE_ID` | `src/lib/auth/authjs-google-provider.ts` | Yes (if Google auth enabled) | Server | Google OAuth fails | ❌ No (credential) |
| `AUTH_GOOGLE_SECRET` | `src/lib/auth/authjs-google-provider.ts` | Yes (if Google auth enabled) | Server | Google OAuth fails | ❌ No (secret) |
| `ENABLE_AUTHJS_RUNTIME` | `src/lib/auth/authjs-feature-gate.ts` | No (defaults disabled) | Server | Auth routes return 501 | ✅ Yes (flag) |
| `ENABLE_AUTHJS_GOOGLE_PROVIDER` | `src/lib/auth/authjs-google-provider.ts` | No (defaults disabled) | Server | Google OAuth disabled | ✅ Yes (flag) |
| `ENABLE_AUTHJS_REQUEST_CONTEXT` | `src/app/api/_shared/authjs-context-adapter.ts` | No (defaults disabled) | Server | Auth.js sessions not used for context | ✅ Yes (flag) |
| `ENABLE_DEV_AUTH_CONTEXT` | `src/app/api/_shared/auth-context-adapter.ts` | No (defaults disabled) | Server | Dev headers not accepted | ✅ Yes (flag) |
| `ENABLE_API_HANDLERS` | `src/app/api/_shared/feature-gate.ts` | No (defaults disabled) | Server | API routes return 501 | ✅ Yes (flag) |
| `NODE_ENV` | `src/lib/prisma.ts`, `src/lib/auth/authjs-runtime.ts` | No (auto-set) | Server | Debug logging level | ✅ Yes |

---

## 22. Current Architecture Overview

### Frontend Architecture (This Repo)

**None in this repo.** `src/app/page.tsx` renders "Hello world". `src/app/layout.tsx` is a minimal HTML wrapper. `src/app/globals.css` contains only `@import "tailwindcss"`. The product-facing frontend lives in the companion repo (`ai-reception-saas-a7cff9d2`) — see §1A.

### Routing Architecture

Next.js 15 App Router with file-based routing. All routes in this repo are API routes under `src/app/api/`. No page routes exist beyond the root placeholder. Frontend routing (48 routes) lives in the companion repo using TanStack Router.

### Component Architecture (This Repo)

**None in this repo.** No React components exist here. The companion frontend repo has 47 Radix-based UI primitives and 18 app-level components — see §1A.

### Data Access Architecture

```
API Route (route.ts)
  → Handler (handler.ts) — validates input, resolves context, checks authz
    → Service (implementation.ts) — business logic, validation, audit
      → Repository (repository.ts) — Prisma queries
        → Prisma Client (lib/prisma.ts)
```

Each domain follows the **Service + Repository** pattern with injected dependencies via factory functions. The composition root (`src/app/api/_shared/composition.ts`) wires everything together.

### Domain/Service Boundaries

- **Strong boundaries:** Identity, Tenancy, Authz, Audit, CRM, Conversations, Reply Drafts — each has clear service/repo interfaces.
- **Weak boundaries:** Conversations depends on CRM (customer lookup), Reply Drafts depends on Conversations (conversation context for dashboard). These cross-domain dependencies are handled via injected functions.
- **Missing boundaries:** 12 domains are empty scaffolds with no implementation.

### Auth Boundary

Well-defined three-layer auth:
1. **Auth.js adapter** (`src/lib/auth/`) — handles OAuth, session management, user mapping
2. **Request context resolver** (`src/app/api/_shared/`) — maps sessions to typed contexts
3. **Authz service** (`src/domains/authz/`) — evaluates role-based permissions

### Tenant Boundary

- `TenantRequestContext` required for all business-scoped operations
- `businessId` filtering in every repository method
- Customer linking verified at service layer (tenant integrity)
- **Weakness:** No database-level enforcement

### AI Boundary

**Not yet established.** Empty domain scaffolds exist but no AI code, no provider SDK, no prompt logic.

### Integration Boundary

**Not yet established.** No external service integrations beyond Google OAuth.

### Testing Boundary

Good unit test coverage of handlers and services with mock dependencies. No integration or E2E tests.

---

## 23. Architecture Risks

| Risk | Severity | Description |
|---|---|---|
| **No UI in this repo** | Low | This backend repo has no frontend UI. The product-facing UI exists in the companion frontend repo (`ai-reception-saas-a7cff9d2`). See §1A. |
| **No AI runtime** | High | The core differentiator (AI-assisted reception) has zero implementation. |
| **12 empty domains** | Medium | 19 domain directories exist (18-domain architecture + reply-drafts); 12 are empty scaffolds. May be premature for MVP. Navigation overhead. |
| **Application-level tenant isolation only** | High | A single missing `WHERE businessId = ?` could leak data across tenants. |
| **Auth.js v5 beta** | Medium | Using pre-release auth library. API may change. |
| **No rate limiting** | High | No protection against abuse on any endpoint. |
| **No error tracking** | Medium | No Sentry/similar. Errors in production will be invisible. |
| **No realtime** | Medium | Operators must poll for new messages. Poor UX for a messaging product. |
| **In-memory follow-up counting** | Medium | `countNeedingFollowUp` loads all active conversations. O(n) scaling risk. |
| **No middleware auth enforcement** | Medium | Each route handler individually resolves auth. Easy to miss. |
| **Conversation ↔ Reply Draft coupling** | Low | Reply draft dashboard queries join across conversation + customer. |
| **Over-documentation** | Low | ~50 checkpoint docs, 15 architecture docs. High documentation overhead. |

---

## 24. Refactor Assessment

### Primary Recommendation: **B) Small Targeted Refactor**

The codebase is well-structured and follows consistent patterns. The main issues are scope-related (empty domains, missing UI) rather than code quality issues. No major rewrite is needed.

### What Should Be Refactored First

1. **Consolidate empty domain scaffolds** — Consider removing README-only domain folders to reduce navigation noise. Or accept them as planned placeholders.
2. **Extract `countNeedingFollowUp` to SQL** — Current in-memory approach won't scale.
3. **Add Next.js middleware for auth** — Move from per-handler auth resolution to middleware-based.

### What Should NOT Be Refactored Yet

- Domain service/repository patterns (they work well)
- Prisma schema (stable and well-designed)
- Auth.js integration (complex but functional)
- Error hierarchy (simple and adequate)
- ActionResult monad (used consistently)

### What Would Be Over-Engineering at This Stage

- Event sourcing or CQRS
- Microservice extraction
- GraphQL layer
- Custom permission DSL
- Multi-database tenant isolation

### What Should Wait Until After MVP

- Database-level tenant isolation (RLS)
- Custom role/permission management
- Advanced audit log querying
- AI cost tracking/billing
- Multi-language support

### Model Recommendations for Refactoring

| Refactor | Model |
|---|---|
| Auth middleware extraction | Opus 4.8 |
| SQL optimization for aggregates | Sonnet 4.6 |
| Empty domain cleanup | Sonnet 4.6 |
| Tenant isolation hardening | Fable 5 (design) / Opus 4.8 (impl) |

---

## 25. Recommended Target Architecture for MVP

### Suggested Structure (MVP-Focused)

Keep the existing structure but focus implementation on:

```
src/
├── app/
│   ├── (auth)/                    # Login/signup pages
│   ├── (dashboard)/               # Operator dashboard
│   │   ├── inbox/                 # Conversation list
│   │   ├── conversations/[id]/    # Conversation detail + messages
│   │   └── settings/              # Business settings
│   ├── api/                       # (existing — keep as-is)
│   └── components/                # Shared UI components
├── domains/                       # (existing — keep implemented ones)
│   ├── identity/                  # ✅ Keep
│   ├── tenancy/                   # ✅ Keep
│   ├── authz/                     # ✅ Keep
│   ├── audit/                     # ✅ Keep
│   ├── crm/                       # ✅ Keep
│   ├── conversations/             # ✅ Keep
│   ├── reply-drafts/              # ✅ Keep
│   └── ai-runtime/                # 🆕 Implement next
└── lib/                           # ✅ Keep as-is
```

### Domain Boundaries

- Keep existing 7 implemented domains unchanged.
- Implement `ai-runtime` next (single provider, classification + draft generation).
- Defer all other domains until MVP validation.

### Service Layer

- Keep existing service/repository/implementation pattern.
- Services remain stateless and injected via factory functions.
- Composition root (`composition.ts`) continues as the DI container.

### Data Access

- Keep Prisma ORM with direct PostgreSQL.
- Add `@index` annotations for performance-critical queries.
- Extract `countNeedingFollowUp` to raw SQL when conversation volume grows.

### Auth/RBAC

- Keep Auth.js v5 with JWT sessions.
- Add Next.js middleware for session validation (reduce per-handler boilerplate).
- Keep hardcoded RBAC permissions (sufficient for MVP).

### Tenant Isolation

- Keep application-level isolation.
- Add automated tenant boundary tests.
- Consider RLS post-MVP if multi-tenant security is a concern.

### AI Receptionist Boundary

- Create provider-neutral adapter interface in `ai-runtime`.
- Start with one provider (e.g., OpenAI or Google Gemini).
- Keep AI logic strictly behind the adapter — never in conversation domain.
- Use feature flags for AI stage control.

### Integration Adapter Boundary

- Design channel adapter interface but implement only INTERNAL channel for MVP.
- Website chat widget as second channel (S2).

### Testing Strategy

- Continue unit testing all handlers and services.
- Add tenant isolation boundary tests.
- Add RBAC boundary tests for each role.
- Skip E2E until UI exists.

### What to Intentionally Avoid for Now

- Event-driven architecture
- Message queues
- Caching layer
- CDN configuration
- Mobile app
- Multi-region deployment
- Custom domain support

---

## 26. Model Delegation Strategy

| Project Area | Recommended Model | Why |
|---|---|---|
| Product architecture | Fable 5 | Complex product decisions, multi-domain trade-offs |
| System architecture | Fable 5 | Auth, tenancy, AI boundary decisions |
| Database/multi-tenant design | Fable 5 | Schema design affects everything downstream |
| Auth/RBAC | Opus 4.8 | Well-defined scope, existing patterns to follow |
| AI receptionist orchestration | Fable 5 (design) / Opus 4.8 (impl) | Design needs strategic thinking; implementation is bounded |
| High-risk refactor | Fable 5 (review) / Opus 4.8 (impl) | Fable reviews approach, Opus executes |
| Medium-risk implementation | Opus 4.8 | Standard feature implementation with existing patterns |
| UI cleanup | Sonnet 4.6 | Styling and layout adjustments |
| Test creation | Sonnet 4.6 | Pattern-following, repetitive work |
| Documentation | Sonnet 4.6 | Straightforward writing |
| Bug fixing | Opus 4.8 | Requires understanding of domain logic |
| Final pre-merge review | Fable 5 | Cross-cutting review requires highest reasoning |

---

## 27. Next Development Sequence

### T-001: Complete Operator Inbox API Wiring

| Field | Value |
|---|---|
| Goal | Ensure all frontend inbox pages in the companion repo are fully wired to backend API endpoints |
| Risk | Low-Medium |
| Model | Opus 4.8 |
| Files | Frontend: `src/hooks/use-conversations.ts`, `src/routes/inbox.$conversationId.tsx`. Backend: verify all referenced API endpoints exist and return correct shapes. |
| Acceptance criteria | Operator can view conversations, read messages, and send replies via the existing frontend UI |
| Tests | API contract tests, visual smoke test |
| Owner approval required | No (UI already exists in companion repo) |
| Note | The frontend UI already exists in `ai-reception-saas-a7cff9d2`. This task is about completing API integration, not building new UI. See §1A. |

### T-002: Implement Conversation Assignment

| Field | Value |
|---|---|
| Goal | Enable operators to claim/assign conversations |
| Risk | Low |
| Model | Opus 4.8 |
| Files | `src/domains/conversations/implementation.ts`, new API handler |
| Acceptance criteria | Operator can claim a conversation, assignment persists, membership verified |
| Tests | Unit tests for assignment with membership check, RBAC boundary test |
| Owner approval required | No |

### T-003: Implement Reply Draft Send Flow

| Field | Value |
|---|---|
| Goal | Allow operators to send approved drafts as messages |
| Risk | Low-Medium |
| Model | Opus 4.8 |
| Files | `src/domains/reply-drafts/repository.ts`, new API handler |
| Acceptance criteria | Approved draft creates a message, draft status → SENT, sentMessageId/sentAt/sentByUserId populated |
| Tests | Unit tests for send flow, idempotency test |
| Owner approval required | No |

### T-004: Add Auth Login/Signup UI Pages

| Field | Value |
|---|---|
| Goal | Create login page with Google OAuth button and session management UI |
| Risk | Low |
| Model | Opus 4.8 |
| Files | `src/app/(auth)/login/`, `src/app/(auth)/signup/` |
| Acceptance criteria | User can log in with Google, session is created, redirected to dashboard |
| Tests | Component tests, Auth.js integration verification |
| Owner approval required | Yes (design choices) |

### T-005: Add Next.js Auth Middleware

| Field | Value |
|---|---|
| Goal | Add middleware-level session validation to reduce per-handler boilerplate |
| Risk | Medium |
| Model | Opus 4.8 |
| Files | `src/middleware.ts`, update `src/app/api/_shared/request-context.ts` |
| Acceptance criteria | Unauthenticated requests to protected routes redirect to login. API routes return 401. |
| Tests | Middleware unit tests, regression tests for existing handlers |
| Owner approval required | No |

### T-006: Design AI Runtime Adapter Interface

| Field | Value |
|---|---|
| Goal | Define provider-neutral interface for AI classification and draft generation |
| Risk | High (architecture decision) |
| Model | Fable 5 |
| Files | `src/domains/ai-runtime/` — new types, service, adapter interface |
| Acceptance criteria | Interface designed, fake/test provider implemented, design document approved |
| Tests | Interface contract tests with fake provider |
| Owner approval required | Yes |

### T-007: Implement AI Runtime with First Provider

| Field | Value |
|---|---|
| Goal | Connect one real AI provider for classification and draft generation |
| Risk | High |
| Model | Opus 4.8 |
| Files | `src/domains/ai-runtime/`, new provider adapter |
| Acceptance criteria | Real AI generates classification + draft for a conversation |
| Tests | Unit tests with mock provider, integration test with real API |
| Owner approval required | Yes (provider selection, API key management) |

### T-008: Add Tenant Isolation Boundary Tests

| Field | Value |
|---|---|
| Goal | Automated tests verifying cross-tenant data isolation |
| Risk | Low |
| Model | Sonnet 4.6 |
| Files | `__tests__/domains/tenant-isolation.test.ts` |
| Acceptance criteria | Tests verify all repositories return empty for wrong businessId |
| Tests | 10+ isolation tests across all implemented domains |
| Owner approval required | No |

### T-009: Add RBAC Boundary Tests

| Field | Value |
|---|---|
| Goal | Tests verifying each role's permission boundaries |
| Risk | Low |
| Model | Sonnet 4.6 |
| Files | `__tests__/domains/rbac-boundary.test.ts` |
| Acceptance criteria | Tests verify VIEWER cannot write, OPERATOR cannot manage members, etc. |
| Tests | 15+ permission boundary tests |
| Owner approval required | No |

### T-010: Business Settings / Profile API

| Field | Value |
|---|---|
| Goal | Add settings management (AI stage, language, timezone) per business |
| Risk | Low-Medium |
| Model | Opus 4.8 |
| Files | New settings API endpoints, possible schema changes |
| Acceptance criteria | Business owner can view/update settings via API |
| Tests | Handler tests, validation tests |
| Owner approval required | Yes (settings schema) |

---

## 28. Critical Questions for the Owner

### Product

1. What is the target launch timeline for MVP? This affects prioritization of UI vs backend.
2. Should the MVP support multiple businesses per user, or start with one business per user?
3. Is Persian (Farsi) language support needed for MVP UI, or English-only?
4. Should the onboarding wizard be in MVP, or can it wait?

### Architecture

5. Should empty domain scaffolds (12 folders) be removed to reduce confusion, or kept as planned placeholders?
6. Is the 18-domain architecture the right scope, or should it be simplified to focus on implemented domains?

### Database

7. Is the current PostgreSQL provider (direct connection) the production target, or will you use a managed service like Supabase/Neon?
8. Should database-level tenant isolation (RLS) be added before production launch?

### Auth/RBAC

9. Will email/password login be needed in addition to Google OAuth?
10. Is the current 4-role model (OWNER/ADMIN/OPERATOR/VIEWER) sufficient for MVP?

### AI Behavior

11. Which AI provider should be used first (OpenAI, Google Gemini, Anthropic)?
12. What is the minimum viable AI feature — just classification (S1), or does draft assist (S2) need to work for MVP?
13. Should AI drafts use a real AI model from the start, or can the MVP demo with hardcoded/template-based drafts?

### Billing

14. When does billing need to be implemented? Is it blocking for private alpha?

### Integrations

15. Is the website chat widget needed for MVP, or can the product launch with API-only + operator inbox?

### Deployment

16. Is Vercel the confirmed production deployment target?
17. Are staging and production environments already set up?

---

## 29. Do Not Change Without Review

| File / Module | Reason |
|---|---|
| `prisma/schema.prisma` | Data model is the foundation. Changes cascade to all domains. |
| `prisma/migrations/` | Never modify existing migrations. Only add new ones. |
| `src/lib/auth/` | Auth boundary is complex and carefully gated with feature flags. |
| `src/app/api/_shared/request-context.ts` | All API handlers depend on this contract. |
| `src/app/api/_shared/composition.ts` | DI root — changes affect all services. |
| `src/domains/authz/permissions.ts` | RBAC map affects security for all roles. |
| `src/domains/conversations/validation.ts` | Status FSM affects conversation lifecycle. |
| `docs/product/PRD-v1.md` | LOCKED product spec. Requires owner amendment. |
| `.github/workflows/ci.yml` | CI pipeline — changes could break the merge gate. |
| `package.json` dependencies | Adding/removing deps affects build and security surface. |

---

## 30. Suggested Claude Code Onboarding Plan

### Files to Read First (in order)

1. `docs/HANDOFF_FROM_ANTIGRAVITY.md` (this file)
2. `prisma/schema.prisma` — understand the data model
3. `src/lib/result.ts` — understand the return type pattern
4. `src/lib/errors.ts` — understand the error hierarchy
5. `src/app/api/_shared/request-context.ts` — understand auth context
6. `src/app/api/_shared/composition.ts` — understand DI wiring
7. `src/domains/authz/permissions.ts` — understand RBAC
8. `docs/product/PRD-v1.md` — understand product vision

### Checks to Run

```bash
pnpm install
pnpm prisma:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Reports to Generate

1. API endpoint inventory (automated from route.ts files)
2. Permission matrix validation (compare code to PRD access matrix)
3. Test coverage analysis (if coverage tool is added)

### Model Delegation Plan

| What | Ready? | Model |
|---|---|---|
| Architecture audit | ✅ Ready | Fable 5 |
| UI development | ✅ Ready (backend APIs exist) | Opus 4.8 |
| Test additions | ✅ Ready | Sonnet 4.6 |
| AI runtime design | ✅ Ready | Fable 5 |
| AI runtime implementation | ⚠️ Needs design approval first | Opus 4.8 |
| Channel adapter design | ⚠️ Needs design approval first | Fable 5 |

### What Should NOT Be Touched Until Owner Approval

- AI provider selection
- New database models/migrations
- External SDK additions
- Billing implementation
- New feature flag additions
- Any changes to PRD-v1

---

## 31. Final Summary

| Aspect | Assessment |
|---|---|
| **Project maturity** | Early-to-mid MVP foundation. Backend API is solid for implemented domains. Frontend UI exists in companion repo. |
| **Code quality** | High. Consistent patterns, good separation of concerns, well-documented. |
| **Main risks** | No AI runtime, application-only tenant isolation, Auth.js beta, no rate limiting, manual API type sync between repos. |
| **Best next move** | Complete frontend-to-backend API wiring for remaining pages. Then implement AI runtime. |
| **Architecture audit needed?** | ⚠️ Recommended. Must cover both backend and frontend repos. The 18-domain scope may need pruning. |
| **Refactor needed before feature dev?** | No. Codebase is clean enough to build on directly. |
| **Can Claude Code safely continue?** | **Yes.** The codebase is well-structured with clear patterns to follow. This report provides sufficient context for safe continuation. |
| **Two-repo product?** | **Yes.** Backend = `ai-reception-saas`. Frontend = `ai-reception-saas-a7cff9d2`. See §1A. |

### Top 5 Risks

1. **No AI runtime** — the core differentiator is unimplemented
2. **Application-only tenant isolation** — a single missed query filter could leak cross-tenant data
3. **No automated API type sync** — frontend `api-types.ts` must be manually updated when backend types change
4. **Auth.js v5 beta dependency** — pre-release library in production path
5. **No rate limiting or abuse protection** — all endpoints are unprotected

---

## 32. Remaining Unknowns

The following items could not be determined from code inspection alone. They must be resolved by the owner or by runtime verification.

| # | Unknown | Why It Matters | How to Resolve |
|---|---|---|---|
| U1 | Staging deployment state | Unknown whether Vercel staging is currently live and functional | Owner confirms staging URL and last deploy date |
| U2 | Database hosting provider | PRD mentions Supabase; code uses raw PostgreSQL. Unclear which provider hosts production/staging DB | Owner confirms (Supabase Postgres, Neon, Railway, direct PG, etc.) |
| U3 | Google OAuth callback URL configuration | Unknown whether Google Console has correct callback URLs for production/staging | Owner verifies Google Console configuration |
| U4 | Auth.js `AUTH_SECRET` generation | Unknown whether a production-grade secret has been generated and deployed | Owner verifies Vercel env vars |
| U5 | CI pipeline passing status | Unknown whether current `main` branch passes all CI checks | Run `pnpm lint && pnpm typecheck && pnpm build && pnpm test` locally |
| U6 | Actual endpoint count beyond route files | 35 route files exist, but each may export multiple HTTP methods. Total endpoint count (GET+POST+PATCH+DELETE) not enumerated | Automated scan of route files for exported method names |
| U7 | Whether `ENABLE_DEV_AUTH_CONTEXT` is set in staging | Critical security variable — must be `false` in non-dev environments | Owner confirms Vercel env var settings |
| U8 | Whether existing Prisma migrations have been applied to staging DB | Unknown migration state of production/staging database | Run `prisma migrate status` against staging |
| U9 | Lock file integrity | `pnpm-lock.yaml` exists but has not been integrity-checked | Run `pnpm install --frozen-lockfile` |
| U10 | ~~Second workspace divergence~~ **RESOLVED** | `ai-reception-saas-a7cff9d2` is the **companion frontend repo** — a separate GitHub repository (`workdabiri/ai-reception-saas-a7cff9d2`), not a stale copy. See §1A. | Resolved 2026-06-12 |

---

## 33. Verification Checklist for Claude Code

Run these checks **before making any changes** to verify the codebase is in a known-good state.

### Phase 1: Environment

- [ ] `node --version` → must be ≥ 20.0.0
- [ ] `pnpm --version` → should be 10.30.2 (from `packageManager` field)
- [ ] `git remote get-url origin` → must be `git@github.com:workdabiri/ai-reception-saas.git`
- [ ] `git branch --show-current` → note current branch
- [ ] `git status --short` → should be clean (no uncommitted changes except this report)
- [ ] `.env` or `.env.local` exists with at least `DATABASE_URL`

### Phase 2: Build chain

- [ ] `pnpm install --frozen-lockfile` → exits 0
- [ ] `pnpm prisma:generate` → exits 0
- [ ] `pnpm lint` → exits 0, zero errors
- [ ] `pnpm typecheck` → exits 0, zero errors
- [ ] `pnpm build` → exits 0 (requires `DATABASE_URL`)
- [ ] `pnpm test` → exits 0, all tests pass

### Phase 3: Structure validation

- [ ] `find src/domains -maxdepth 1 -type d | wc -l` → should be 20 (19 domains + `domains/` itself)
- [ ] `find src/app/api -name 'route.ts' | wc -l` → should be 35
- [ ] `grep -c '^model ' prisma/schema.prisma` → should be 12
- [ ] `grep -c '^enum ' prisma/schema.prisma` → should be 16
- [ ] `find __tests__ -name '*.test.ts' -o -name '*.test.tsx' | wc -l` → should be 45

### Phase 4: Pattern verification

Read one implemented domain end-to-end to understand the pattern before making changes:

- [ ] Read `src/domains/crm/types.ts` → `validation.ts` → `repository.ts` → `service.ts` → `implementation.ts` → `index.ts`
- [ ] Read matching handler: `src/app/api/businesses/[businessId]/customers/handler.ts`
- [ ] Read matching route: `src/app/api/businesses/[businessId]/customers/route.ts`
- [ ] Read matching test: `__tests__/api/customers-handler.test.ts`

---

## 34. High-Risk Areas Requiring Owner Approval

The following changes **must not** proceed without explicit owner sign-off.

| # | Area | Why Owner Approval Is Required | Risk If Changed Without Approval |
|---|---|---|---|
| H1 | AI provider selection | Commercial, cost, and compliance implications | Wrong provider could lock in costs or violate data residency |
| H2 | New Prisma schema models/migrations | Schema changes cascade to all layers; hard to undo in production | Data loss, migration conflicts, breaking changes |
| H3 | External SDK additions to `package.json` | Adds security surface, bundle size, and maintenance burden | Supply chain risk, license conflicts |
| H4 | Feature flag additions or changes | Flags control production behavior; incorrect state could expose dev-only features | Security exposure (`ENABLE_DEV_AUTH_CONTEXT` in prod) |
| H5 | Any change to `docs/product/PRD-v1.md` | LOCKED product spec — contractual constraint | Product direction drift |
| H6 | Auth.js configuration changes | Auth affects all users; breakage means lockout | Users locked out of the system |
| H7 | RBAC permission map changes | Security-critical; adding/removing permissions affects all roles | Privilege escalation or denial of service |
| H8 | Billing/payment integration | Financial, legal, and compliance implications | Unauthorized charges, legal liability |
| H9 | Customer-facing endpoints | Any endpoint that accepts external user data | Data ingestion from untrusted sources |
| H10 | CI/CD pipeline changes | Affects merge gate and deployment safety | Broken CI could allow bad code to reach production |

---

## 35. Suggested First Claude Code Prompt

Use this prompt (or adapt it) as the **first instruction** when starting Claude Code in this repository:

```
You are continuing development on the AI Reception SaaS project.

Before doing anything:
1. Read docs/HANDOFF_FROM_ANTIGRAVITY.md — this is the migration handoff report.
2. Run the verification checklist in §33 of that report.
3. Read prisma/schema.prisma to understand the data model.
4. Read src/lib/result.ts to understand the ActionResult<T> return pattern.
5. Read src/app/api/_shared/composition.ts to understand the dependency injection pattern.
6. Read src/domains/authz/permissions.ts to understand RBAC.

Project conventions:
- All services use factory functions with injected dependencies (no classes).
- All service methods return ActionResult<T> (never throw).
- All API handlers resolve auth context before service calls.
- All repository methods filter by businessId (application-level tenant isolation).
- Tests use Vitest with in-memory mocks (no real database in CI).
- Commit convention: <type>(<domain>): TASK-XXXX <description>
- Branch convention: task-XXXX-<description> from develop

Do NOT:
- Modify prisma/schema.prisma without explicit approval
- Add external SDKs without explicit approval
- Change feature flags without explicit approval
- Change docs/product/PRD-v1.md
- Modify existing Prisma migrations
- Change src/lib/auth/ without understanding the feature gate system

Current state: Backend API is functional for 7 domains (identity, tenancy, authz, audit, crm, conversations, reply-drafts). No AI runtime exists.

IMPORTANT: This is the BACKEND repo only. The product also has a companion
frontend repo (workdabiri/ai-reception-saas-a7cff9d2) built with TanStack Start.
See docs/HANDOFF_FROM_ANTIGRAVITY.md §1A for details. Do not build a new
frontend in this repo — the frontend already exists in the companion repo.
```

---

## 36. Suggested First Fable 5 Architecture Audit Scope

When using Fable 5 for architecture review, focus on these areas:

### Priority 1: Validate Domain Architecture

- Is the 18-domain architecture (19 directories) appropriate for this MVP, or should it be simplified?
- Are the Level A / Level B boundaries correctly defined?
- Should `reply-drafts` be formally added to the domain map, or merged into `conversations`?
- Are the cross-domain dependency rules (DOMAIN_MAP.md §Domain Dependency Rules) being followed?

### Priority 2: Validate AI Runtime Design

- What should the provider-neutral adapter interface look like?
- How should prompt templates be stored (database? files? config?)?
- What context should be passed to the AI (full conversation? last N messages? summary?)?
- How should AI failures be handled (timeout? fallback? circuit breaker?)?
- What is the right boundary between `ai-runtime`, `ai-config`, and `knowledge` domains?

### Priority 3: Validate Tenant Isolation

- Is application-level tenant isolation sufficient for MVP, or should RLS be added?
- Are there any repository methods that could accidentally leak cross-tenant data?
- Should tenant suspension enforcement be added at the middleware level?

### Priority 4: Validate Auth Architecture

- Is the three-layer auth model (Auth.js → request context → authz) correct long-term?
- Should a Next.js middleware be added for global session enforcement?
- How should multi-business users select their active workspace?

### Priority 5: Evaluate Feature Flag Strategy

- Are the existing 5 feature flags sufficient?
- Should per-business AI stage flags be stored in the database?
- What is the safest way to add new flags without breaking existing deployments?

### Audit Inputs

Provide Fable 5 with:
1. `docs/HANDOFF_FROM_ANTIGRAVITY.md` (this file)
2. `docs/DOMAIN_MAP.md`
3. `docs/product/PRD-v1.md`
4. `prisma/schema.prisma`
5. `src/app/api/_shared/composition.ts`
6. `src/domains/authz/permissions.ts`

### Expected Audit Outputs

1. Architecture decision record (ADR) for domain simplification (if needed)
2. AI runtime adapter interface design document
3. Tenant isolation risk assessment with recommendations
4. Feature flag strategy document

---

## 37. Claude Project Upload Guidance

When uploading files to a Claude Project for architecture audit, **upload selected files from both repos** and label them clearly.

### From Backend Repo (`ai-reception-saas`) — Upload These

| File | Why |
|---|---|
| `docs/HANDOFF_FROM_ANTIGRAVITY.md` | This report — complete project context |
| `package.json` | Dependencies and scripts |
| `prisma/schema.prisma` | Canonical data model (12 models, 16 enums) |
| `docs/product/PRD-v1.md` | Locked product requirements |
| `docs/product/mvp-scope.md` | MVP scope boundaries |
| `docs/DOMAIN_MAP.md` | 18-domain architecture reference |
| `docs/DEVELOPMENT_PIPELINE.md` | Dev workflow |
| `docs/COMMIT_CONVENTION.md` | Commit convention |
| `.env.example` | Backend env vars |
| `src/app/api/_shared/composition.ts` | DI root |
| `src/app/api/_shared/request-context.ts` | Auth/tenant context contracts |
| `src/domains/authz/permissions.ts` | RBAC permission map |
| `src/domains/authz/types.ts` | Permission type definitions |
| `src/lib/result.ts` | ActionResult pattern |
| `src/lib/errors.ts` | Error hierarchy |
| `src/lib/env.ts` | Environment config |
| `src/domains/conversations/validation.ts` | Conversation status FSM |

### From Frontend Repo (`ai-reception-saas-a7cff9d2`) — Upload These

| File | Why |
|---|---|
| `package.json` | Frontend dependencies (TanStack, Radix, Lovable, Vite) |
| `vite.config.ts` | Build config |
| `vercel.json` | API proxy rewrites — links frontend to backend |
| `.env.example` | Frontend env vars |
| `src/lib/api-client.ts` | How frontend calls backend |
| `src/lib/api-types.ts` | Frontend mirror of backend types |
| `src/contexts/business-context.tsx` | Multi-tenant context |
| `src/hooks/use-auth-session.ts` | Auth session hook |
| `src/hooks/use-conversations.ts` | Conversation API binding |
| `src/hooks/use-messages.ts` | Message API binding |
| `src/hooks/use-customers.ts` | Customer API binding |
| `src/hooks/use-dashboard-summary.ts` | Dashboard API binding |
| `src/components/app-shell.tsx` | Main layout |
| `src/routes/index.tsx` | Dashboard page |
| `src/routes/inbox.$conversationId.tsx` | Conversation detail |
| `docs/product/lovable-prototype-handoff.md` | Lovable handoff |
| `docs/architecture/design-system-reference.md` | Design system |

### Upload Rules

1. **Label every file** as `[BACKEND]` or `[FRONTEND]` in the Claude Project.
2. Upload backend files first (they contain the authoritative schema and product docs).
3. Upload frontend files second (they provide UI architecture and API bindings).
4. **Never mix** the two repos without clear labels — they use different frameworks, package managers, and build tools.
5. Architecture audit must consider **both repos together** to be meaningful.

---

*Report generated: 2026-06-11. QA-reviewed: 2026-06-11. Frontend companion section added: 2026-06-12. No production code was modified.*
