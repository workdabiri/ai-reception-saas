# Playbook: Session bootstrap workflow

## When to use

The **first thing in every new Claude Code session** in this repo, before reading task-specific files or making any edit. Prevents acting on stale context — wrong branch, unmerged work, or an outdated view of status.

## Required inputs

- None to start. By the end you must hold: the current branch, the working-tree state, recent history, and the live status from `CLAUDE.md` + the relevant audit checkpoint(s).

## Steps

1. Confirm the branch: `git rev-parse --abbrev-ref HEAD`. Verify it matches the branch the task expects. If on `main`, do not edit — branch first, or stop and confirm.
2. Check the working tree: `git status --short`. Note any pre-existing changes you did not make; do not silently bundle or revert them.
3. Read recent history: `git --no-pager log --oneline -10`. Identify what landed last (most recent PR/commit) so you don't redo or contradict it.
4. Read `CLAUDE.md` fully — current status, guardrails, architecture, and the "Never do" list. It overrides defaults.
5. Read the authoritative status: the relevant `docs/audits/*-closure-checkpoint.md` for any auth / tenancy / AI work. When a checkpoint and another doc disagree, the checkpoint wins.
6. Read the matching `docs/ai-skills/*` playbook(s) for the task type (see [README.md](README.md)), and classify the task with [task-risk-classifier.md](task-risk-classifier.md).
7. Summarize current status back to the owner **before editing**: branch, last commit, what's open, which guardrails apply. If the next task is undecided (or the owner asks "what's next?"), run [next-task-selection-workflow.md](next-task-selection-workflow.md) to derive a recommendation — it recommends, it does not authorize.
8. For anything classified medium+ or security-sensitive, propose a short plan and get approval before the first edit.

## Validation commands

```bash
git rev-parse --abbrev-ref HEAD
git status --short
git --no-pager log --oneline -10
```

## Stop conditions

- Branch is `main` (or not the expected branch) and the task implies edits → stop, branch or confirm first.
- Working tree has unexpected/unexplained changes → stop, report them; do not edit over them.
- `CLAUDE.md` or the relevant checkpoint is missing or contradicts the task → stop, surface the conflict.
- Task is medium+ risk and no plan has been approved → stop before editing.

## Forbidden actions

- No edits before steps 1–7 are complete.
- No assuming status from memory or a prior session — re-read `CLAUDE.md` and the checkpoints each session.
- No "Private Alpha ready" / "real-provider ready" claims; status is conditional (`docs/audits/`).

## Final report format

```
Branch: <name> (expected? yes/no)
Working tree: clean / <summary>
Last commits: <top 1-3 from log>
Status read: CLAUDE.md + <checkpoint(s)> — key guardrails: <list>
Task risk: low/medium/high/critical (per task-risk-classifier)
Plan approval needed before edits: yes/no
Ready to proceed: yes / blocked (<reason>)
```
