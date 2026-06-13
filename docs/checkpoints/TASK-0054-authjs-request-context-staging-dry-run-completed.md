# TASK-0054 — Auth.js Request-Context Staging Dry-Run: Completed

> **Decision: GO — Auth/Tenancy Foundation Accepted**
>
> Date: 2026-05-20
> Repository: `workdabiri/ai-reception-saas`
> Staging domain: `https://ai-reception-saas.vercel.app`
> Fix commit: `f5ef6ff`

---

## 1. Infrastructure Provisioning

### 1.1 Supabase Staging

- Supabase staging project was provisioned.
- Prisma migrations were applied successfully (`prisma db push` / `prisma migrate deploy`).
- Database schema includes: `users`, `accounts`, `sessions`, `businesses`, `business_memberships`, `audit_events`.

### 1.2 Vercel Staging

- Vercel staging deployment was provisioned and linked to `workdabiri/ai-reception-saas` on GitHub.
- **Deployment protection was disabled** to allow unauthenticated API testing (e.g. `curl` without Vercel auth).

### 1.3 DATABASE_URL Switch

- Initial deployment used the **direct Supabase database host**.
- Vercel serverless functions could not reach the direct host.
- `DATABASE_URL` was switched to the **Supabase connection pooler** (`pooler` host, port 6543).
- After the switch, database connectivity was confirmed.

---

## 2. Feature Flag Enablement

| Flag | Value |
|---|---|
| `ENABLE_API_HANDLERS` | `true` |
| `ENABLE_AUTHJS_RUNTIME` | `true` |
| `ENABLE_AUTHJS_GOOGLE_PROVIDER` | `true` |
| `ENABLE_AUTHJS_REQUEST_CONTEXT` | `true` |
| `ENABLE_DEV_AUTH_CONTEXT` | `false` |

---

## 3. Google OAuth Login

- Google OAuth provider was enabled and configured.
- A test login was performed via the browser.
- Result:
  - **1 user** created in the `users` table.
  - **1 google account** linked in the `accounts` table.
  - User ID, email, and OAuth tokens are **redacted** per evidence policy.

---

## 4. Bug Found and Fixed

### 4.1 Symptom

| Endpoint | Result |
|---|---|
| `GET /api/auth/session` (browser) | ✅ Non-null session with `user.id` |
| `GET /api/businesses` (browser) | ❌ 401 UNAUTHENTICATED |

The browser sent the `__Secure-authjs.session-token` cookie on both requests. The cookie was confirmed present in the `Cookie` header via DevTools Network tab.

### 4.2 Root Cause

In `src/lib/auth/authjs-route-handlers.ts`, the `requestAwareAuth` wrapper called:

```typescript
// BROKEN — triggers Auth.js v5 middleware overload
const session = await nextAuth.auth(request as never);
```

Auth.js v5's `auth()` has multiple overloaded signatures:

| Overload | Purpose | Returns |
|---|---|---|
| `auth()` | App Router session read via `next/headers` | `Session \| null` ✅ |
| `auth(request)` | Middleware invocation | `Response` ❌ |
| `auth(handlerFn)` | Route handler wrapper | `AppRouteHandlerFn` |
| `auth(req, res)` | Pages Router API routes | `Session \| null` |

Passing a `Request` object triggered the **middleware path**, which returned a `Response` object instead of a `Session`. The adapter layer saw `session.user === undefined` on the `Response` and returned 401 UNAUTHENTICATED.

`/api/auth/session` was unaffected because it uses `nextAuth.handlers.GET` — Auth.js's own internal route handler — not `requestAwareAuth`.

### 4.3 Fix

```diff
- const session = await nextAuth.auth(request as never);
+ const session = await nextAuth.auth();
```

Auth.js v5's `auth()` with **no arguments** reads the session from `next/headers` automatically in App Router route handlers. This is the correct and documented pattern.

### 4.4 Fix Commit

- **SHA**: `f5ef6ff`
- **Message**: `fix(auth): read Auth.js session via App Router auth context`
- **Files changed**:
  - `src/lib/auth/authjs-route-handlers.ts` — core fix
  - `__tests__/api/authjs-session-reader-regression.test.ts` — 9 new regression tests
  - `__tests__/api/authjs-request-context-adapter.test.ts` — 2 new scope guard tests

---

## 5. Post-Fix Verification

### 5.1 Browser Tests (Authenticated)

| Endpoint | Expected | Actual |
|---|---|---|
| `GET /api/auth/session` | Non-null session with `user.id` | ✅ Pass |
| `GET /api/businesses` | 200 with business list | ✅ Pass |
| `GET /api/businesses/:id` | 200 with business details | ✅ Pass |

### 5.2 Unauthenticated Tests

| Endpoint | Expected | Actual |
|---|---|---|
| `curl /api/businesses` (no cookies) | 401 UNAUTHENTICATED | ✅ Pass |

### 5.3 Kill-Switch Test

| State | Endpoint | Expected | Actual |
|---|---|---|---|
| `ENABLE_AUTHJS_REQUEST_CONTEXT=false` | `GET /api/businesses` | 501 AUTH_CONTEXT_UNAVAILABLE | ✅ Pass |
| Re-enabled `ENABLE_AUTHJS_REQUEST_CONTEXT=true` | `GET /api/businesses` | 200 | ✅ Pass |

---

## 6. Local Test Suite

| Command | Result |
|---|---|
| `pnpm typecheck` | ✅ Pass — 0 type errors |
| `pnpm lint` | ✅ Pass — 0 errors |
| `pnpm test` | ✅ 855 passed, 7 skipped (DB integration) |
| `pnpm build` | ✅ Production build successful |

---

## 7. Final Environment State

| Variable | Value | Purpose |
|---|---|---|
| `ENABLE_API_HANDLERS` | `true` | API route handlers enabled |
| `ENABLE_AUTHJS_RUNTIME` | `true` | Auth.js NextAuth runtime enabled |
| `ENABLE_AUTHJS_GOOGLE_PROVIDER` | `true` | Google OAuth provider enabled |
| `ENABLE_AUTHJS_REQUEST_CONTEXT` | `true` | Auth.js session-backed request context enabled |
| `ENABLE_DEV_AUTH_CONTEXT` | `false` | Dev header auth mode disabled |
| `DATABASE_URL` | `[REDACTED — Supabase pooler]` | Prisma database connection |
| `AUTH_SECRET` | `[REDACTED]` | Auth.js JWT signing secret |
| `AUTH_GOOGLE_ID` | `[REDACTED]` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | `[REDACTED]` | Google OAuth client secret |

---

## 8. Decision

### GO — Auth/Tenancy Foundation Accepted

The Auth.js request-context integration is confirmed working in staging:

1. Google OAuth login succeeds and creates user + account records.
2. Auth.js JWT session is readable by both `/api/auth/session` and protected API handlers.
3. Protected handlers correctly authenticate requests using the Auth.js session cookie.
4. Unauthenticated requests are correctly rejected with 401.
5. Kill-switch (`ENABLE_AUTHJS_REQUEST_CONTEXT=false`) correctly returns 501.
6. All 855 local tests pass.
7. Production build succeeds.

---

## 9. Next Recommended Task

**Product Task 0001 — Service Catalog + Order Foundation**

The auth/tenancy foundation is now stable and staging-verified. The next product milestone is to build the service catalog and order management domain on top of this foundation.

---

## 10. Redaction Notice

Per the evidence redaction checklist (TASK-0050):

- All user IDs, emails, and names have been redacted.
- All OAuth tokens, session tokens, and cookie values have been redacted.
- All secret values (AUTH_SECRET, AUTH_GOOGLE_SECRET) have been redacted.
- DATABASE_URL has been redacted (only "Supabase pooler" descriptor retained).
- No screenshots containing PII have been included.

---

*Document created: 2026-05-20*
*Author: Automated staging dry-run documentation*
*Fix commit: `f5ef6ff`*
