# Engineering Workflow

> This page is the short, stable summary. The operational detail lives in the
> playbooks and the merge gate; when they disagree, those win:
> [docs/ai-skills/README.md](../ai-skills/README.md),
> [git-pr-workflow.md](../ai-skills/git-pr-workflow.md),
> [session-bootstrap-workflow.md](../ai-skills/session-bootstrap-workflow.md),
> [next-task-selection-workflow.md](../ai-skills/next-task-selection-workflow.md),
> [owner-decision-support-workflow.md](../ai-skills/owner-decision-support-workflow.md),
> [merge-gate.md](merge-gate.md), and `CLAUDE.md`.

## Branch and PR Policy

- **One task per branch/PR.**
- Branch naming: `<type>/<short-topic>` (e.g. `docs/stale-doc-cleanup`); never commit directly to `main`.
- Each branch targets **`main`**. There is no long-lived `develop` branch.
- **Squash-merge only**, after owner approval — keeps a clean linear history.
- Commit subject follows `<type>(<scope>): <lowercase imperative subject>` ([COMMIT_CONVENTION.md](../COMMIT_CONVENTION.md)).
- Commit/push/open-PR only when the task **explicitly** asks ([git-pr-workflow.md](../ai-skills/git-pr-workflow.md)).

## Change Scope

- Keep changes **small and focused** to the task scope.
- Do not bundle unrelated fixes into a single PR.
- Do not add provider SDKs, domain models, or product features unless the task explicitly requires them.

## Before Reporting

Run the backend merge-gate checks before marking a task complete (all five must pass — see [merge-gate.md](merge-gate.md)):

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
git status --short   # must be clean
```

- For **docs-only** changes, `pnpm build` / `pnpm test` are typically skipped; still run `git diff --check` and confirm a clean `git status --short`.
- Do **not** skip failures silently.
- If a check fails, fix it if it is in scope. If it is out of scope, report the exact failure reason.

## Final Report Requirements

Every completed task must include:

1. **Commit SHA** or **PR link**
2. **List of files created and modified**
3. **List of checks run** with pass/fail status
4. **Scope confirmation** — explicit statement that no out-of-scope code was added
5. **Risks or notes** — anything the reviewer should know
