# Playbook: Git / PR workflow

## When to use

You have been **explicitly** asked to commit, open a PR, or push. If the task did not ask for it, do not run this — stop after making and validating the change.

## Required inputs

- Confirmed task authorization to commit/push/PR (quote it).
- The intended scope (which files, which domain).
- Target branch (default base: `main`).

## Steps

1. Confirm branch: `git rev-parse --abbrev-ref HEAD`. If on `main`, create a branch first (`<type>/<short-topic>`); never commit directly to `main`.
2. Confirm scope is clean: `git status --short` and `git --no-pager diff --stat` — only intended files changed.
3. Stage explicitly (`git add <paths>`), never `git add -A` blindly.
4. Run the validation commands below; all must pass.
5. Commit with the convention `<type>(<scope>): <lowercase imperative subject>` (`docs/COMMIT_CONVENTION.md`); one domain per commit. Do not add co-author trailers unless the owner explicitly asks or the project convention requires it.
6. Push only if asked: `git push -u origin <branch>`.
7. Open a PR only if asked, using [pr-body-writing-workflow.md](pr-body-writing-workflow.md). Squash-merge only; do not self-merge without owner approval.

## Validation commands

```bash
pnpm lint
pnpm typecheck
pnpm build      # skip for docs-only changes
pnpm test       # skip for docs-only changes
git diff --check
git status --short
```

## Stop conditions

- Task did not explicitly authorize commit/push/PR → stop, report the change as uncommitted.
- Validation fails → stop, do not commit; create the smallest repair, re-validate.
- Out-of-scope files changed → stop, report; do not bundle unrelated changes.
- Schema/migration/dependency change appears unexpectedly → stop.

## Forbidden actions

- No `git commit --amend`/`rebase`/force-push on shared history.
- No merging without owner approval; no non-squash merge.
- No committing secrets, `.env*`, or generated artifacts.

## Final report format

```
Branch: <name>
Commits: <hash> <subject> (or "none — left uncommitted")
Pushed: yes/no   PR: <url or "not opened">
Validation: lint/typecheck/build/test = PASS/FAIL/skipped
Scope: docs-only? code/test/schema/migration changed? (yes/no each)
git status --short: <output>
```
