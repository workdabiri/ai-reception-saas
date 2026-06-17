# Playbook: Security review workflow

## When to use

Reviewing a diff or branch that touches auth, tenancy, RBAC/ABAC, identity, audit, channels, billing, or AI safety — or any PR labeled security-sensitive in `docs/engineering/merge-gate.md`.

## Required inputs

- The diff under review (`git --no-pager diff <base>...<head>`).
- The relevant audit/checkpoint in `docs/audits/` for the affected area.
- The route/domain map of what changed.

## Steps

1. Read the actual diff, not the PR description.
2. Tenant isolation: confirm `businessId` is server-derived (route param / tenant context), never from client body or trusted `x-business-id` when a route param exists. Confirm repository queries are scoped by `businessId`.
3. Handler order: validate params → resolve tenant context → `assertBusinessRouteMatchesTenant` → `requirePermission` → service call. Flag any reordering or omission.
4. RBAC/ABAC: confirm permission checks exist and match the role map in `src/domains/authz/permissions.ts`; the frontend is never authoritative.
5. Audit: confirm sensitive mutations emit audit events and metadata is PII-safe (no contact values, notes, message content).
6. AI safety (if `ai-runtime`/reply-drafts touched): run [ai-runtime-no-auto-send-guard.md](ai-runtime-no-auto-send-guard.md).
7. Dev-bypass guard: confirm `src/lib/security/dev-bypass-guard.ts` and `isRealDataEnvironment` are not weakened.
8. Cross-tenant enumeration: confirm no endpoint leaks another tenant's users/businesses/customers (allow + deny cases).

## Validation commands

```bash
pnpm typecheck
pnpm test
pnpm lint
git --no-pager diff --stat
```

## Stop conditions

- Any tenant-scope widening, client-trusted `businessId`, or missing permission check → stop, report as a blocker.
- AI send path, real-provider SDK, or env/API-key read introduced → stop, escalate to owner.
- A security regression suite (A-R1, B-R7, B-R8, RBAC negative-boundary) is removed or weakened → stop.

## Forbidden actions

- Do not "fix" findings silently inside a review task — report them; fixes are a separate authorized change.
- Do not approve based on CI/preview status alone.
- Do not weaken any guard to make a test pass.

## Final report format

```
Scope reviewed: <files/routes>
Findings: [BLOCKER|WARN|NOTE] <description> @ <file:line>
Tenant isolation: OK/issue
RBAC/ABAC: OK/issue
Audit PII-safety: OK/issue
AI safety: OK/N-A/issue
Verdict: PASS / CHANGES REQUIRED / BLOCKED
```
