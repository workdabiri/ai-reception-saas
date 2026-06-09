# Merge Gate / Validation Policy

> **Effective:** 2026-06-05 — applies to all PRs in both frontend and backend repos.

## Core Rule

No PR may be merged based only on implementation reports, Vercel deploy previews, or GitHub UI status checks.

Before merge, every PR **must** pass all of the following:

1. **Source / diff review** — reviewer reads the actual GitHub diff, not just the PR description.
2. **Approved scope check** — only files approved in the task scope were modified; no backend/PRD/auth/AI/lockfile/env changes unless explicitly authorized.
3. **CLI validation** — lint + build pass locally on the reviewer's machine or in the agent session (not just in CI).
4. **Relevant smoke tests** — manual or automated verification that the changed feature works as expected.
5. **Clean working tree** — `git status --short` shows no untracked or modified files after validation.
6. **CTO / Product Owner approval** — explicit human sign-off before merge.
7. **Squash merge only** — all PRs are squash-merged to maintain a clean linear history.

---

## Frontend Required CLI Validation

Run from the frontend repo root:

```bash
bun run lint
bun run build
git status --short
```

All three must pass with zero errors before merge is authorized.

---

## Backend Required CLI Validation

Run from the backend repo root:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
git status --short
```

All five must pass with zero errors before merge is authorized.

---

## Pre-Merge Checklist (Copy Into PR Review)

```markdown
## Merge Gate Checklist

- [ ] GitHub diff reviewed — only approved files changed
- [ ] Scope check — no out-of-scope code (backend, PRD, auth, AI, lockfiles, env)
- [ ] `bun run lint` / `pnpm lint` — PASS
- [ ] `bun run build` / `pnpm build` — PASS
- [ ] `pnpm typecheck` (backend) — PASS
- [ ] `pnpm test` (backend) — PASS
- [ ] `git status --short` — clean
- [ ] Smoke test — feature works as expected
- [ ] CTO / Product Owner approval — received
- [ ] Merge method — squash merge only
```

---

## Rejection Criteria

A PR will **not** be merged if:

- CLI validation was not run (reports alone are insufficient).
- Lint or build fails and the failure is not resolved.
- Out-of-scope files were modified without explicit authorization.
- The diff does not match the reported changes.
- Working tree is dirty after validation.
- Backend tests fail.
- No human reviewer has approved the PR.
- A non-squash merge method is used.

---

## Why This Policy Exists

1. **Vercel previews can succeed even when lint fails** — deploy previews skip eslint.
2. **GitHub status checks may not cover all local validations** — CI may not run the same lint rules or build flags.
3. **Agent reports can be inaccurate** — the only source of truth is the actual diff and local CLI output.
4. **Permission mismatches are caught late** — only a real build + lint cycle catches type errors from wrong permission assumptions (e.g., PR #27 OPERATOR/business.read fix).
5. **Linear history matters** — squash merge keeps `git log --oneline` readable for rollback and bisect.

---

## Applies To

| Repo | Validation Commands | Merge Method |
|---|---|---|
| `ai-reception-saas-a7cff9d2` (frontend) | `bun run lint` · `bun run build` | Squash merge |
| `ai-reception-saas` (backend) | `pnpm lint` · `pnpm typecheck` · `pnpm build` · `pnpm test` | Squash merge |

---

## Frontend Route/UI Smoke Tests

For frontend route or UI changes, smoke tests must cover the changed user path:

- Open the changed route in local, preview, or staging.
- Verify auth-gated behavior where applicable.
- Verify loading state when data is pending.
- Verify empty state when API returns no rows.
- Verify error state when API fails.
- Verify forbidden/access-denied state when role lacks permission.
- Verify no stale mock-data appears in fully wired routes.
- Verify active business context is correct for business-scoped screens.
- Verify no console/runtime crash is introduced.

---

## Backend/API Smoke Tests

For backend/API PRs, smoke tests must cover the changed endpoint or domain path:

- Authenticated allowed request.
- Unauthenticated request when applicable.
- Forbidden role/permission case.
- Cross-tenant access denial.
- Invalid route/query/body validation.
- Not-found behavior.
- Response shape matches domain/API contract.
- Audit logging behavior when relevant.
- Rate-limit/guard behavior when relevant.

---

## Security-Sensitive PRs

For auth, RBAC, tenancy, identity, audit, billing, AI safety, and channel adapter work, add targeted checks:

- Tenant isolation is preserved.
- Frontend is never authoritative for permissions.
- Sender identity is derived from auth context, not client body.
- Cross-tenant user/business enumeration is blocked.
- Removed/expired membership behavior is explicit.
- Internal notes are not exposed to customers.
- Audit events do not leak cross-tenant user data.
- Identity lookup does not expose email/name across tenants.
- AI stages S0–S4 are not weakened.
- No direct AI send behavior is introduced without Product Owner approval.
- Channel adapters do not leak provider-specific SDK logic into core domains.

---

## Merge Discipline

- Merge only after CTO/Product approval.
- Use **Squash and merge** only.
- After merge, sync local main and verify:

```bash
git switch main
git fetch origin main
git pull origin main
git status --short
git log --oneline -5
```

- Confirm the squash commit appears on main.
- Confirm feature branch commits did not land individually.

---

## Schema Migration Gate

Any PR that modifies `prisma/schema.prisma` or adds files under `prisma/migrations/` is **L4** regardless of other scope considerations.

**Before merge:**

- Migration file reviewed — SQL is additive or destructive operations have explicit CTO approval.
- PR body includes a production migration plan (migration name, affected tables/enums, deploy steps, rollback note).

**After merge — production is NOT healthy until:**

- `prisma migrate deploy` has run against the production database (using the **Direct Database URL**, not the pooler).
- `prisma migrate status` shows "Database schema is up to date".
- Vercel backend logs show zero Prisma schema/table errors for the affected model.
- Affected endpoint/UI smoke passes.

> **Full policy and commands:** [docs/engineering/production-migrations.md](production-migrations.md)

---

## Failure Rule

If any CLI validation or smoke test fails:

- Do not merge.
- Do not start a new feature.
- Create the smallest repair branch.
- Fix only the failing scope.
- Rerun validation and smoke tests.
- Request CTO/Product review again.
