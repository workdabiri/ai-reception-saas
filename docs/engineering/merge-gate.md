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
