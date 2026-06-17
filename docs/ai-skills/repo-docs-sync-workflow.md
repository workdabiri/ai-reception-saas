# Playbook: Repo docs sync workflow

## When to use

After a PR merges (or a guardrail/status changes) and the **docs no longer match reality** — a checkpoint, `CLAUDE.md`, or a skill playbook still describes the pre-merge world. Keeps `docs/audits/*-closure-checkpoint.md` (the authoritative status) and the docs that point at it consistent. Docs-only; never bundled with code.

## Required inputs

- The merged PR number + squash commit subject, and what it changed (e.g. a new test/lock, a closed blocker).
- The authoritative checkpoint for the area (`docs/audits/AREA-*-closure-checkpoint.md`).
- `CLAUDE.md` and any `docs/ai-skills/*` that reference the changed status.

## What to update, and when

- Update a **checkpoint** when a blocker's state changed (opened/closed) or a new lock/test landed that the checkpoint should now cite. **Adjust the live status; never rewrite the historical audit or remediation-plan verdicts** — those are preserved as history.
- Update **`CLAUDE.md`** when a guardrail, gate, or "current status" line is now wrong (e.g. a new invariant is enforced).
- Update **`docs/ai-skills/*`** + its [README.md](README.md) when a playbook references a now-stale fact (commit hash, suite name, gate status), or when a new playbook should be listed.

## How to detect stale language

1. Diff the claim against the merge: `git --no-pager log --oneline -15` and the PR — find statements the merge falsified.
2. Grep for status phrases that go stale and verify each against the latest checkpoint:
   ```bash
   grep -rInE 'NOT YET|not wired|OUT OF SCOPE|CLOSED|GREEN|pending|TODO|as of (PR|commit) #?[0-9a-f]+' docs/ CLAUDE.md
   ```
3. Check cross-references resolve: cited PR/commit hashes, test-suite filenames, and checkpoint section numbers still exist.

## Examples (real)

- **B-R8 landed after the Area B closure checkpoint was first written.** The no-auto-send / human-approval lock (PR #106, commit `7f4eee0`) required the Area B checkpoint to be synced (PR #107) so its status cited the lock — the test and the doc sync were **separate** PRs.
- **`CLAUDE.md` and the skill playbooks now exist** (PR #108). Future sessions should be pointed at `docs/ai-skills/` from `CLAUDE.md` and `README.md`; when new playbooks are added, both indexes must be updated in the same docs PR.

## Steps (docs-only branch flow)

1. Branch: `docs/<short-topic>` (e.g. `docs/ai-skills-second-wave`); never edit docs on `main`.
2. Make the minimal text change so the doc matches reality; keep historical audit/plan verdicts intact.
3. Update every index/cross-reference that points at the changed doc (README tables, the `CLAUDE.md` reference list).
4. Validate (below). Docs-only: `build`/`test` are typically skipped; run `typecheck`/`lint` only if a code-adjacent file was touched — for a pure docs sync, none should be.
5. Report scope; do not commit/push/PR unless explicitly asked ([git-pr-workflow.md](git-pr-workflow.md)).

## Validation commands

- **Simple docs-only edits** — minimum validation is:
  ```bash
  git diff --check
  git --no-pager diff --stat
  git status --short
  ```
- **Governance docs** (`CLAUDE.md`, `docs/ai-skills/*`, closure checkpoints, or any project operating instructions) — additionally run the validation the **task** requests. If the task asks for `pnpm typecheck`, `pnpm test`, and `pnpm lint`, run them and report their **exact** results:
  ```bash
  pnpm typecheck
  pnpm test
  pnpm lint
  ```
- Never claim validation passed unless it was actually run.

## Stop conditions

- A "docs sync" would change a checkpoint's **historical verdict** rather than its live status → stop; history is immutable.
- Syncing the docs would require a code/test/schema change → stop; that's a separate, non-docs task.
- The merge's real effect is unclear (you can't tell what became stale) → stop, re-read the PR + checkpoint first.

## Forbidden actions

- No editing production code, tests, schema, or migrations under a docs-sync task.
- No rewriting audit/remediation-plan history; only the live status moves forward.
- No overstating status ("real-provider ready", "Private Alpha ready") — keep it conditional per the checkpoint.
- No commit/push/PR unless explicitly authorized.

## Final report format

```
Trigger: <PR #/commit> — <what changed>
Docs updated: <files> (checkpoint? CLAUDE.md? README? playbooks?)
Stale claims fixed: <list>
History preserved (audit/plan verdicts untouched): yes
Scope: docs-only? yes/no (code/test/schema/migration changed? no)
Validation: git diff --check clean, status: <output>
```
