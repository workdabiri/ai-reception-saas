# Playbook: Code quality rules

## When to use

Whenever you write or modify TypeScript/Prisma code in this repo (the backend/API). These are conventions enforced by review + `pnpm lint` / `pnpm typecheck`, **not** by new tool config — do not add or loosen eslint/prettier/tsconfig settings to satisfy them.

## Required inputs

- The file(s) you are about to change and the surrounding module (read it; match its style).
- The owning domain's `README.md` (Owns / Dependencies / Consumed-By / Key Rules).

## Rules

- **Strict TypeScript.** Code must pass `tsc --noEmit` under strict. No new `@ts-ignore` / `@ts-expect-error` without a one-line justification comment.
- **No `any`** unless justified in a comment; prefer `unknown` + a narrowing guard, or a precise type. Avoid unsafe casts (`as X`, `as unknown as X`) — justify in a comment only if truly unavoidable.
- **No hardcoded secrets/keys/URLs.** Read config through the shared kernel (`@/lib` env), never inline an API key, token, or connection string. Docs/security tasks must not read env at all.
- **Respect domain boundaries.** Import a domain only via its barrel (`@/domains/<name>`), and only if it's listed as a dependency in the README; no skip-level or circular deps; no cross-domain DB queries (reach other domains through their service layer). All domains may import `@/lib`.
- **Return `ActionResult<T>`** for expected/business errors via `ok()` / `err()`; don't throw for them.
- **Small pure helpers** over large stateful functions; keep side effects at the edges (repository/handler); keep services injectable (no globals inside a domain).
- **No broad refactors** bundled with a feature/fix, and **no unrelated reformatting** — keep the diff to the task. Match the file's existing comment density and naming.
- **No `console.*` in production code** paths unless the owner explicitly accepts it; use the project's logging/audit surfaces. Audit metadata stays PII-safe (no contact values, notes, message content).
- **Behavior changes require tests.** Security-sensitive work (auth, tenancy, RBAC, audit, AI safety, channels) is **test-first** — see [test-first-hardening-workflow.md](test-first-hardening-workflow.md).

## Steps

1. Read the target file and its domain `README.md`; mirror the local idiom.
2. Make the minimal change; keep helpers small and pure; keep `businessId` server-derived.
3. Add/adjust tests for any behavior change (test-first for security-sensitive work).
4. Run validation; fix lint/type errors at the source — never by widening a type or disabling a rule.

## Validation commands

```bash
pnpm typecheck
pnpm lint
pnpm test
git --no-pager diff --stat
```

## Stop conditions

- The only way to pass types/lint is `any`, an unsafe cast, or disabling a rule → stop, rethink the change.
- The change needs a cross-domain DB read or a skip-level import → stop; use the service layer.
- A behavior change has no accompanying test (or security work isn't test-first) → stop.
- You're tempted to apply frontend-only conventions (e.g. Tailwind / `className` rules) to backend files → don't; those belong to the frontend repo, not here.

## Forbidden actions

- No adding/loosening eslint/tsconfig/prettier config to make code pass.
- No hardcoded env/keys; no env reads during docs/security tasks.
- No unrelated formatting churn or opportunistic mega-refactor.
- No leaving `console.log` debugging in production code.

## Final report format

```
Files changed: <list>  (domain: <name>)
any / unsafe-cast introduced: none / <justified where>
Domain boundaries respected: yes/no
Tests for behavior change: added/updated/N-A (test-first? yes/N-A)
Validation: typecheck/lint/test = PASS/FAIL
Diff scope: task-only? yes/no
```
