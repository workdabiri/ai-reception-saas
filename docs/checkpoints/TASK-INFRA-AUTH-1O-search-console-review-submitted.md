# TASK-INFRA-AUTH-1O — Search Console Review Submitted

## 1. Status

INFRA_AUTH_1O_REVIEW_SUBMITTED_WAITING_FOR_GOOGLE

## 2. Scope

* Domain property: `aiautomations.ae`
* Custom domain: `dashboard.aiautomations.ae`
* Security issue type: Deceptive pages
* Review submitted: yes — manually submitted via Google Search Console Security Issues panel
* Review result: pending (Google review in progress)
* UI commit at submission: `f729500`
* Backend commit at submission: `f827e31`
* Smoke writes run: no
* R3C/R4 started: no

## 3. Remediation Summary

Two PRs were completed and deployed before the review was submitted.

### 3.1 UI Auth Gate — PR #20 (UI repo `f729500`)

* Added `useAuthSession` hook — fetches `/api/auth/session` same-origin with
  `credentials: "include"`. Exposes `user`, `isLoading`, `isAuthenticated`, `error`,
  `refresh`.
* Added `AuthGate` component in `__root.tsx` — wraps `AppShell` and `AdminShell`.
  Shows `Checking session…` loading state at SSR time. On unauthenticated session,
  redirects to `/login`.
* Replaced mock login form in `login.tsx` — removed fake `setTimeout → navigate("/")`
  flow. Added real "Continue with Google" button using CSRF-safe POST to
  `/api/auth/signin/google`.
* Cleaned login page preview panel in `auth-layout.tsx` — removed mock business name,
  mock customer names, mock message content from the login page side panel.

**Public routes (unprotected):**
`/login`, `/signup`, `/forgot-password`, `/verify-email`, `/invite/$token`,
`/access-denied`, `/session-expired`, `/chat/$businessId`, `/widget-preview`,
`/onboarding/*`

**Protected routes (require authenticated session):**
`/`, `/inbox`, `/channels`, `/customers`, `/knowledge`, `/notifications`,
`/members`, `/settings`, `/audit`, `/states`, `/role-preview`, `/profile`,
`/studio`, `/admin/*`

### 3.2 Backend Auth.js pages.signIn — PR #70 (backend repo `f827e31`)

* Added `pages: { signIn: '/login' }` to the `NextAuth()` configuration in
  `src/lib/auth/authjs-route-handlers.ts`.
* `GET /api/auth/signin` now returns HTTP 302 to
  `/login?callbackUrl=https://dashboard.aiautomations.ae`.
* No providers, callbacks, session strategy, or adapter was changed.
* No migrations, no env changes, no lock file drift.

## 4. Pre-Review Verification Evidence

All checks were run read-only via curl before review submission.

| Check | Result |
| --- | --- |
| `/api/auth/session` (unauthenticated) | `null` |
| `GET /api/auth/signin` HTTP status | 302 |
| `GET /api/auth/signin` redirect target | `/login?callbackUrl=https%3A%2F%2Fdashboard.aiautomations.ae` |
| `/` public HTML scan — mock customer data | `ROOT_PUBLIC_SCAN_CLEAN` |
| `/inbox` public HTML scan — mock customer data | `INBOX_PUBLIC_SCAN_CLEAN` |
| `/login` public HTML scan — mock customer data | `LOGIN_MOCK_SCAN_CLEAN` |
| `/` SSR body contains | `Checking session…` (auth gate loading state) |
| `/login` SSR body contains | `AI Reception` branding only |
| `/api/auth/providers` callbackUrl domain | `dashboard.aiautomations.ae` |
| `/api/auth/providers` signinUrl domain | `dashboard.aiautomations.ae` |
| Raw Auth.js default sign-in page exposed | no |
| Mock customer/business data in public HTML | no |

## 5. What Was NOT Changed During Remediation

* DNS records — unchanged.
* Tasjeel/BusyRack DNS — unchanged.
* Vercel env variables — unchanged.
* Vercel custom domains — unchanged.
* Google OAuth client ID, secret, redirect URIs — unchanged (redirect URI for
  `dashboard.aiautomations.ae/api/auth/callback/google` was added in a prior gate,
  not during this remediation).
* `AUTH_URL` backend env — unchanged (was set in a prior gate).
* No credentials rotated.
* No cookies, tokens, or session values printed or stored.
* No full userId/businessId/conversationId/messageId exposed.

## 6. Current Restrictions While Waiting for Google

The following are blocked until Google clears the Deceptive pages issue and Chrome
removes the Dangerous Site warning:

* Browser smoke with Google sign-in: blocked — do not click through Chrome warning.
* Browser Read/Write smoke gate: blocked.
* R3C/R4: blocked.

The following remain allowed:

* Read-only curl checks.
* Repo maintenance PRs unrelated to auth.
* Observing Vercel deployment status.

## 7. Safety

* Backend source changed during this checkpoint: no.
* UI source changed during this checkpoint: no.
* No schema or migration changes.
* No env changes.
* No redeploy triggered.
* No smoke writes.
* No customer writes.
* No cookies or tokens printed.
* No full IDs recorded.
* No PII recorded.
* Search Console review: submitted once by user — no additional review requests.

## 8. Next Gates

### Immediately after Google clears the issue

* **INFRA-AUTH-1P — Safe Browsing Clearance Verification**
  Verify via `curl` and browser that Chrome no longer shows Dangerous Site warning
  on `dashboard.aiautomations.ae`. Confirm Search Console Security Issues report
  is resolved. Report clearance.

### After clearance is confirmed

* **Browser Smoke Read/Write Gate** — complete the full browser Google sign-in flow
  on `dashboard.aiautomations.ae` and verify authenticated session, inbox access,
  and write operations.
* **R3C/R4** — may start after browser smoke passes.

## 9. Final Status

INFRA_AUTH_1O_REVIEW_SUBMITTED_WAITING_FOR_GOOGLE

Next required human action:
Monitor Google Search Console for review completion.
When the Deceptive pages issue is marked resolved, initiate INFRA-AUTH-1P.
