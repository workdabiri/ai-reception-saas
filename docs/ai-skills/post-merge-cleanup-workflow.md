# Playbook: Post-merge cleanup workflow

## When to use

After an authorized PR has been squash-merged, to sync local `main` and verify the merge landed cleanly. Use only when told a merge happened.

## Required inputs

- The merged PR number / squash commit subject.
- Confirmation the merge was squash (the only allowed method).

## Steps

1. `git switch main`
2. `git fetch origin main`
3. `git pull --ff-only origin main`
4. `git status --short` — must be clean.
5. `git --no-pager log --oneline -5` — confirm the squash commit appears on `main`.
6. Confirm the feature branch commits did **not** land individually (squash, not merge-commit).
7. Delete the merged local branch only if the squash is confirmed on `main`: `git branch -d <branch>` (never `-D` to force-delete unmerged work).
8. For a schema PR: remember production is not healthy until `prisma migrate deploy` + `prisma migrate status` are confirmed in the deploy environment — flag this, do not run it yourself unless authorized.

## Validation commands

```bash
git status --short
git --no-pager log --oneline -5
```

## Stop conditions

- Working tree dirty after pull → stop, do not delete branches.
- The squash commit is missing or feature commits landed individually → stop, report.
- Unmerged local work would be lost by branch deletion → stop, keep the branch.

## Forbidden actions

- No force-push, no history rewrite on `main`.
- No `git branch -D` on a branch whose work isn't confirmed merged.
- No running production migrations without explicit authorization.

## Final report format

```
main synced: yes/no
Squash commit on main: <hash> <subject> (confirmed yes/no)
Feature commits landed individually: yes/no
Branch deleted: <name> / kept (reason)
Schema PR follow-up needed: yes/no (migrate deploy + status)
git status --short: <output>
```
