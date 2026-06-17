# Playbook: PR body writing workflow

## When to use

Writing a PR description that satisfies the merge gate (`docs/engineering/merge-gate.md`). Use only when a PR is authorized.

## Required inputs

- The diff (`git --no-pager diff <base>...<head>` and `--stat`).
- Local validation output (lint/typecheck/build/test).
- The blocker id / task reference, if any.
- For schema PRs: the migration plan.

## Steps

1. Summarize **what** changed and **why** (the why matters more than the what).
2. List the scope: files/domains touched; confirm nothing out of scope.
3. Paste the merge-gate checklist and mark each item honestly.
4. Include validation evidence: the actual commands and their results (not "tests pass").
5. Add smoke-test notes for the changed path (allowed request, denied/forbidden, cross-tenant denial, invalid input, not-found).
6. For security-sensitive PRs, add the extra checklist (tenant isolation preserved, frontend not authoritative, no auto-send, etc.).
7. For schema PRs, add the production migration plan (migration name, affected tables/enums, deploy steps, rollback note) and mark it **L4**.
8. End the PR body with the required generated-with trailer.

## Validation commands

```bash
pnpm lint
pnpm typecheck
pnpm build      # skip note for docs-only
pnpm test       # skip note for docs-only
git --no-pager diff --stat
```

## Stop conditions

- Validation has not actually been run locally → stop; run it, do not write "passes" from assumption.
- The diff does not match the intended scope → stop, fix scope first.
- Schema/migration present without a migration plan → stop.

## Forbidden actions

- No overstating coverage ("fully tested") beyond what was run.
- No claiming real-data/Private-Alpha readiness.
- No omitting security caveats to make the PR look cleaner.

## Final report format (the PR body skeleton)

```
## Summary
<what + why>

## Scope
Files: <list>   Out-of-scope changes: none

## Merge Gate Checklist
- [ ] diff reviewed — only approved files
- [ ] lint / typecheck / build / test — PASS (evidence below)
- [ ] git status --short — clean
- [ ] smoke test — <path/result>
- [ ] (security) tenant isolation / no auto-send / frontend-not-authoritative
- [ ] (schema) L4 migration plan included

## Validation evidence
<commands + results>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
