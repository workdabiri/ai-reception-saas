# Decision Log

> **NON-AUTHORITATIVE — owner decisions only.**
> **NOT a status source. NOT a backlog. NOT a task queue.**
> **Checkpoints in `docs/audits/` and git history are authoritative and win on conflict.**

This file is an **append-only** record of decisions the owner has **already made** (accept / defer /
reject). It exists only to keep durable, non-derivable owner choices (e.g. "defer Y, do Z first") from
evaporating across sessions. It is read by
[ai-skills/next-task-selection-workflow.md](ai-skills/next-task-selection-workflow.md) as **one input**,
never as a command, and never as authorization to act.

**Rules:**

- **Append-only.** Never rewrite or delete an entry; supersede it with a new dated entry.
- **Decisions only.** No candidate list, no future task queue, no "current priority", no roadmap.
- **Never status.** It records *what was decided*, never the state of Area A/B, AI safety, or readiness —
  those live only in `docs/audits/*-closure-checkpoint.md`. On any conflict, checkpoints + git history win.
- **Compact + keyed by PR/commit.** One line per decision; name its PR or commit when one exists (`—` if the
  decision predates any PR). No sequencing/imperative phrasing that turns the log into a plan or task queue.
- **DEFER decays.** A `DEFER` entry must carry a re-derive cue (a date, or "re-derive after PR #NN"); once past
  that point, ignore the entry and re-derive the decision from the checkpoints + git, never from the log.
- **Reconciled every session.** Treat the log as a possibly-stale cache: each session re-derives it against git
  history (merged PRs) and the checkpoints before use; on any conflict the log loses.
- **Single-writer.** Append within the same PR/session that records the decision (keyed by PR/commit) so two
  branches don't interleave rows; never edit another session's entry.
- **Graduate when it grows.** If this log ever starts being read as the plan or the status, that is the signal to
  move to a proper GitHub Issues process — it must not accrete a backlog.
- **No sensitive content.** No secrets/env values, customer data, raw transcripts, or full terminal logs.
- Every entry below is a non-authoritative record; the header stamp applies to all of them.

## Entries

| Date | Type | Subject | PR / Commit | Risk |
| --- | --- | --- | --- | --- |
| 2026-06-17 | ACCEPT | Add root `CLAUDE.md` and base ai-skills playbooks | PR #108 / `1f1a04a` | low (docs) |
| 2026-06-17 | ACCEPT | Add second-wave AI skill playbooks | PR #109 / `4e67c0a` | low (docs) |
| 2026-06-17 | ACCEPT | Add external tooling / MCP adoption policy | PR #110 / `a9f7ef3` | low (docs) |
| 2026-06-17 | ACCEPT | Add real-DB AI-isolation CI gate (B-R7 parity) | PR #111 / `7f24caf` | test/CI-only |
| 2026-06-17 | ACCEPT | Use a non-authoritative decision log now for durable handoff | — (this PR) | low (docs) |
| 2026-06-18 | ACCEPT | Build next-task-selection and stale-doc cleanup as separate PRs | — (this PR = PR 1) | low (docs) |
| 2026-06-18 | ACCEPT | Later build Owner Decision Support as one separate playbook for Critical-safe advisory decisions | — | low (docs) |
| 2026-06-18 | ACCEPT | Keep external advisor as mandatory backstop for Critical/gated decisions only | — | low (policy) |
