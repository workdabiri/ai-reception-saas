# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Multi-tenant B2B AI receptionist SaaS. Next.js 15 (App Router) + TypeScript (strict) + Prisma/PostgreSQL. Package manager is **pnpm** (Node 20+). The codebase is organized as domain modules under `src/domains/` plus a shared kernel in `src/lib/`. Do not rely on a hardcoded domain count; inspect `src/domains/` and `docs/DOMAIN_MAP.md` before changing dependencies. (Note: `docs/DOMAIN_MAP.md` enumerates 18 Level-A/Level-B domains, but `src/domains/` currently contains a 19th module, `reply-drafts/`, that the map does not list — trust the directory, and read each domain's `README.md`.) There is a companion **frontend repo** (`ai-reception-saas-a7cff9d2`, Bun/Vite); this repo is the backend/API.

## Current security/audit status

The `docs/audits/*-closure-checkpoint.md` files are the **authoritative status reference** — read them before any auth, tenancy, or AI work. Summary as of the latest checkpoints:

- **Area A (backend authorization / tenant isolation): CLOSED / GREEN** through PR #94. Tenant-context resolution, RBAC enforcement, repository `businessId` scoping, the dev-bypass deployment guard, the tenant-route backstop, and the real-DB isolation CI gate are all closed.
- **Area B (AI runtime): B-R1 through B-R8 CLOSED.** The B-R8 dedicated no-auto-send / human-approval lock was merged as **PR #106 / commit `7f4eee0`**. The foundational AI-runtime / provenance / tenant-isolation / no-auto-send boundary is **closed for the implemented fake-provider / provenance / isolation / no-auto-send scope only**.
- **Real-provider production AI-assisted go-live: NOT YET APPROVED.** No real model provider is integrated; there is no real-provider SDK in `package.json`, no API-key/env wiring, and no network path. All AI generation runs against a **deterministic fake provider** over synthetic/test data.
- **Route-level real AI generation: NOT APPROVED / not wired.** The reply-draft `generate` route returns a deterministic SYSTEM stub (it does not call an LLM) and is gated by per-business `aiMode` (default `MANUAL`, fail-closed).
- **Level 3 / autonomous AI / auto-send: OUT OF SCOPE and BLOCKED.** No auto-pilot mode exists and no send path exists.
- **Area C (public web widget ingest): OUT OF SCOPE** unless separately audited and approved.

Do **not** describe the product as "Private Alpha ready" or "real-provider AI ready" — the checkpoints show real-data readiness is conditional and not declared.

## Remaining AI go-live gates

Each of these is a **hard future gate** that must pass its own review before real customer data may enter an AI prompt in production. None is satisfied today; none is authorized by routine work.

- Real-provider adapter review (a real SDK behind the existing `AiProvider` interface; fake provider stays the test default).
- Route-level generation wiring review (assembly → prompt → provider → audit → draft, only when `aiMode = AI_ASSISTED`).
- Real-DB AI-isolation CI gate (a live-Postgres AI-isolation suite wired into `RUN_INTEGRATION_TESTS`, parity with the Area A gate).
- PII / data-minimization allowlist (explicit field allowlist for anything entering a prompt, proven by test).
- Cost / rate-limit / observability (per-business spend limits, provider error handling, AI-usage metrics/alerting).
- Staging validation (full end-to-end exercise against realistic non-production data, default-off verified).
- Human-approval enforcement (generate → review → edit → approve proven end-to-end; no draft reaches a customer without explicit human approval).
- Production rollout approval (explicit owner sign-off + rehearsed kill-switch/rollback drill).

## Never do (without an explicit, scoped, authorized task + dedicated PR)

- **Never auto-send AI output** or transition a draft to a sent/delivered state automatically.
- **Never wire the AI runtime to message delivery** (channels/conversations send paths) without explicit owner approval and a dedicated PR.
- **Never read env vars or API keys** during docs/security/audit tasks.
- **Never add a model-provider SDK** (openai/anthropic/google/cohere/mistral/bedrock or any) unless the task explicitly authorizes a real-provider adapter.
- **Never modify `prisma/schema.prisma` or add migrations** unless the task explicitly requires it (such changes are L4 / high-risk).
- **Never broaden tenant scope** or read another tenant's data; keep `businessId` server-derived.
- **Never bypass or weaken RBAC/ABAC** enforcement, the dev-bypass guard, or the human-review boundary.
- **Never trust a client-supplied `businessId`** (or `x-business-id` for scope when a route param exists) — resolve scope from the server-side tenant context / route param.

## Commands

```bash
pnpm dev              # Next.js dev server
pnpm build            # Production build
pnpm typecheck        # tsc --noEmit (strict)
pnpm lint             # eslint . (lint:fix to autofix)
pnpm test             # vitest run (all tests)
pnpm test:watch       # vitest watch
pnpm format           # prettier --write
pnpm prisma:generate  # regenerate client — REQUIRED after editing schema.prisma
pnpm prisma:migrate   # prisma migrate dev (local only)
pnpm prisma:studio
```

Run a single test file or filter:

```bash
pnpm exec vitest run __tests__/domains/crm-service.test.ts
pnpm exec vitest run -t "cross-tenant"      # filter by test name
```

Integration tests that need a real DB are **gated** by `RUN_INTEGRATION_TESTS=true` and refuse to run against a non-localhost host. They are skipped in the normal `pnpm test` run:

```bash
RUN_INTEGRATION_TESTS=true pnpm exec vitest run __tests__/integration/tenant-identity-repositories.integration.test.ts
```

The merge gate (`docs/engineering/merge-gate.md`) requires all five to pass locally before merge: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, and a clean `git status --short`.

## Domain architecture

Each domain in `src/domains/<name>/` follows the same layered shape, wired by dependency injection (no globals inside a domain):

- `types.ts` — domain types and enum value constants.
- `validation.ts` — Zod schemas + validated types.
- `repository.ts` — `create<Domain>Repository(db)` where `db` is a narrow interface listing only the Prisma delegates it uses (e.g. `{ customer, customerContactMethod }`). Never imports the full Prisma client.
- `service.ts` — pure **interface** definitions and error-code constants. No implementation.
- `implementation.ts` — `create<Domain>Service(deps)` factory implementing the service interface; deps are other services/repositories injected in.
- `index.ts` — the **only** public entry point (barrel). Import a domain via `@/domains/<name>`, not its internal files.
- `README.md` — declares the domain's Owns / Dependencies / Consumed-By / Key Rules. Read it before changing a domain.

Services return `ActionResult<T>` (`src/lib/result.ts`): `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. Use the `ok()` / `err()` helpers. Don't throw for expected/business errors — return an `err`.

### Dependency rules (`docs/DOMAIN_MAP.md`)

- A domain may only call domains listed as dependencies in its README. **No circular deps, no skip-level calls.**
- **No cross-domain database queries** — each domain owns its tables; reach other domains only through their service layer (see `composition.ts`'s `customerLookup` for the sanctioned cross-domain lookup pattern).
- **Level A** (core: identity, tenancy, authz, crm, channels, conversations, routing, ai-runtime, knowledge, ai-config, actions, audit) must **never** depend on **Level B** (verticals: orders, reservations, cases, approvals, billing, analytics). B may depend on A.
- All domains may import the shared kernel `@/lib` (errors, types, result, env, time, ids, prisma).

## API layer (`src/app/api/`)

Three layers per endpoint:

1. **`route.ts`** — thin Next.js route export. Checks the feature gate, wires deps from the composition root, awaits `context.params` (Next 15 params are async), and delegates to a handler.
2. **`handler.ts`** — `create<X>Handler(deps)` factories with injected services (typed as `Pick<Service, ...>`). This is where the request logic lives and what tests target directly.
3. Domain **service** — business logic.

`_shared/composition.ts` is the composition root: it adapts the Prisma client into per-domain `RepositoryDb` slices, wires repositories → services, and exposes `getApiDependencies()` (lazy singleton) + `resetApiDependenciesForTests()`.

**Canonical handler sequence for business-scoped routes — keep this order:**

```
validate route params (zod, businessId as uuid)
  -> resolveTenantRequestContext(request, { businessId, source: 'route-param' })
  -> assertBusinessRouteMatchesTenant(context, businessId)   // tenant/route backstop, fails closed 403
  -> requirePermission (authz)
  -> domain service call
  -> emitAudit(...) on successful mutations (fire-and-forget; never breaks the response)
```

`businessId`/`customerId` etc. come from the **route param**, never from the request body (bodies `.omit()` them). Audit metadata must be PII-safe (no contact values, notes, message content).

## Auth, feature gates & tenant isolation

Behavior is controlled by env feature flags (exact string `"true"` only — no trimming/truthiness):

- `ENABLE_API_HANDLERS` — when not `"true"`, routes return `NOT_IMPLEMENTED`.
- `ENABLE_AUTHJS_REQUEST_CONTEXT` — selects the real Auth.js tenant adapter (DB-validated membership).
- `ENABLE_DEV_AUTH_CONTEXT` — dev-only `x-dev-*` header adapter that trusts headers with **no membership check**. Set only in `.env.local`.
- `ENABLE_AUTHJS_RUNTIME`, `ENABLE_AUTHJS_GOOGLE_PROVIDER` — Auth.js wiring.

The **dev-bypass guard** (`src/lib/security/dev-bypass-guard.ts`, enforced at boot via `src/instrumentation.ts`) fails the app closed in a "real-data environment" (NODE_ENV=production, or VERCEL_ENV production/preview) if dev-bypass auth is enabled or the real adapter is off. `next dev` / NODE_ENV development/test are never real-data. Do not weaken this guard or the `isRealDataEnvironment` logic.

Tenant isolation is a hard invariant: every customer/conversation/etc. belongs to exactly one business; cross-tenant lookup is forbidden; the same person across businesses is separate records. Security-sensitive changes (auth, RBAC, tenancy, audit, billing, AI safety, channels) have extra smoke-test requirements in `docs/engineering/merge-gate.md`.

## AI runtime (`src/domains/ai-runtime/`)

Composes existing services (ai-config policy + verified knowledge) and a provenance-aware prompt builder over a deterministic **fake provider** — there is no real model provider, no network path, and no route-level generation wired (see **Current security/audit status**).

The AI runtime must **not** read customer/conversation/message content and must **not** send messages. It **does** include a metadata-only audit-log persistence boundary for AI generation attempts (`ai_generation_audit_logs`) introduced by **B-R6** — so it is no longer free of any Prisma surface. That audit boundary stores **metadata only** (counts, ids, hashes, redacted/bounded free text) and must **never** become a customer-message, prompt-content, or delivery path.

Enforced and pinned by tests:

- **No customer/conversation/message content reads** — static scope guards forbid those domain reads/imports across AI-runtime source.
- **No send path / no auto-send** — the **B-R8** dedicated no-auto-send / human-approval lock (`__tests__/domains/ai-runtime-no-auto-send-lock.test.ts`) makes this a first-class invariant; draft metadata carries no `status`/`sent*` fields.
- **Audit log is metadata-only** — `ai_generation_audit_logs` has no column for raw prompt, generated text, transcript, or customer PII.

`__tests__/domains/ai-runtime-cross-tenant-isolation.test.ts` (B-R7) is the hard regression suite for any AI change and must stay green. Do not introduce direct AI-send behavior, real-provider integration, or route-level generation without explicit owner approval and a dedicated PR (see **Remaining AI go-live gates**).

## Prisma

Prisma 7: the datasource URL lives in `prisma.config.ts` (`DATABASE_URL`), **not** in `schema.prisma`. After any schema edit, run `pnpm prisma:generate`. Production migrations use `prisma migrate deploy` (never `migrate dev`) against the Direct DB URL — see `docs/engineering/production-migrations.md`. Any PR touching `schema.prisma` or `prisma/migrations/` is treated as high-risk and needs a migration plan.

## Tests (`__tests__/`)

Organized by layer: `foundation/` (toolchain + guard smoke), `domains/`, `api/` (handler-level with injected fake deps), `auth/`, `integration/` (gated, real DB). Path alias `@` → `src` is configured in both `tsconfig.json` and `vitest.config.ts`.

## Commits

Format: `<type>(<domain>): <lowercase imperative subject>` (see `docs/COMMIT_CONVENTION.md`). Types: `feat fix test refactor chore docs style perf`. Scope is the `src/domains/` folder name, or special scopes `infra` / `shared` (src/lib) / `prisma` / `deps`. One domain per commit; squash-merge only.

## Reference docs

- `docs/ai-skills/` — **repo-local operational playbooks** (session bootstrap, task-risk classifier, code-quality rules, git/PR workflow, security review, remediation, test-first hardening, PR-body writing, post-merge cleanup, AI no-auto-send guard, real-provider readiness gate, session-handoff summary, terminal output capture, repo-docs sync). Start here for "how do I safely do X."
- `docs/DOMAIN_MAP.md` — domain dependency rules and Level A/B boundary (enumerates 18; see the note in **What this is** about the 19th module).
- `docs/audits/` — Area A / Area B audits, remediation plans, and **closure checkpoints** (authoritative status).
- `docs/architecture/` — auth/tenant/schema design notes; `access-control-matrix.md` for RBAC.
- `docs/engineering/` — merge-gate, production-migrations, workflow, task-review-policy.
- `docs/QA_STRATEGY.md`, `docs/HANDOFF_FROM_ANTIGRAVITY.md`, `docs/checkpoints/`.
