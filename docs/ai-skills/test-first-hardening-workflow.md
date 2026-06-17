# Playbook: Test-first hardening workflow

## When to use

Pinning a safety/security invariant with a regression or lock test before (or instead of) changing behavior — e.g. a no-auto-send lock, a tenant-isolation proof, an RBAC negative-boundary.

## Required inputs

- The exact invariant to lock, in one sentence ("AI runtime has no send path").
- The source files the lock should guard.
- Existing similar suites to mirror (see `__tests__/domains/ai-runtime-no-auto-send-lock.test.ts`, `__tests__/domains/ai-runtime-cross-tenant-isolation.test.ts`, `__tests__/api/rbac-negative-boundary.test.ts`).

## Steps

1. Write the test first and watch it **describe** the property (prefer structural/static guards for "no X path": scan source for forbidden imports/call-sites, assert absence).
2. Use in-memory, Prisma-`where`-faithful fakes for multi-tenant proofs; assert tenant A artifacts never contain tenant B markers and vice versa.
3. For negative tests, assert the deny path returns the exact error envelope/status (e.g. `403`, `TENANT_ACCESS_DENIED`).
4. Run the single file first, then the full suite.
5. If a behavior change accompanies the lock, make it minimal and re-run.
6. Name per convention and place under the right layer (`__tests__/domains|api|integration/...`).

## Validation commands

```bash
pnpm exec vitest run <new-test-file>
pnpm test
pnpm typecheck
pnpm lint
```

## Stop conditions

- The only way to make the test pass is to weaken a guard or widen scope → stop.
- The invariant requires real-DB and you'd have to disable the localhost guard → stop; use the gated integration path instead.
- The test would require adding a dependency → stop.

## Forbidden actions

- No skipping/`.only`/`xit` left in committed tests.
- No asserting on PII or secrets; no real network calls.
- No deleting an existing regression suite to make a change land.

## Final report format

```
Invariant locked: <sentence>
Test file: <path> (<N> tests)
Type: structural-guard / multi-tenant-proof / negative-boundary
Accompanying source change: yes/no (<files>)
Validation: file PASS, full suite <N> passed / <M> skipped, typecheck/lint PASS
```
