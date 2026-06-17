# Playbook: Task risk classifier

## When to use

At the **start of any task**, before editing, to set the right mode: how much validation, whether to ask first, whether Plan Mode and owner approval are required. Run this right after [session-bootstrap-workflow.md](session-bootstrap-workflow.md).

## Required inputs

- The task description and the exact files/areas it will touch.
- The `CLAUDE.md` "Never do" list and the relevant `docs/audits/*-closure-checkpoint.md`.

## Risk levels

| Level | Examples | Allowed mode | Required validation | Ask before edit | Plan Mode | Owner approval before edits |
| --- | --- | --- | --- | --- | --- | --- |
| **Low** | Docs-only, comments, no behavior change | Edit directly | `typecheck` + `lint` + `git diff --check` (build/test skip for docs-only) | No | No | No |
| **Medium** | Tests-only, non-security behavior, small non-security code | Edit, keep diff minimal | `typecheck` + `lint` + `test` (+ `build` if code) | Recommended for code | Optional | No |
| **High** | Production code in authz / tenancy / identity / audit / channels / ai-runtime / billing; Prisma client usage; RBAC/ABAC | Test-first, minimal change | Full gate: `lint` + `typecheck` + `build` + `test` + clean `git status` + the area's regression suite | Yes | Yes | Yes — confirm scope/plan first |
| **Critical** | `schema.prisma` / migrations, real model-provider SDK, env/secrets/API keys, auto-send / message delivery, production deploy, RLS / row-level changes | **Default STOP** — gated future work | Full gate **plus** the gated integration / AI-isolation suites named in the relevant gate doc | Yes | Yes | Yes — explicit written owner approval + dedicated PR |

## How to classify

1. Map the task to the **highest** level any part of it touches — a "small" change that edits `schema.prisma` is Critical, not Low.
2. Cross-check the `CLAUDE.md` "Never do" list: schema/migration, provider SDK, env/key reads, auto-send, tenant-scope widening, RBAC bypass → Critical/STOP unless the task explicitly authorizes it with a dedicated PR.
3. For High, pick the regression suite to keep green (AI work → [ai-runtime-no-auto-send-guard.md](ai-runtime-no-auto-send-guard.md); auth/tenancy → [security-review-workflow.md](security-review-workflow.md)).
4. For Critical, route to the matching gate ([real-provider-readiness-gate.md](real-provider-readiness-gate.md)) and confirm written owner approval **before** any edit.
5. State the level and the required mode back to the owner before editing.

## Validation commands

```bash
# minimum (all levels)
pnpm typecheck
pnpm lint
# medium+ adds
pnpm test
pnpm build
git status --short
```

## Stop conditions

- Task is Critical and lacks explicit written owner approval + a dedicated PR → STOP.
- Classification is ambiguous between two levels → treat it as the higher one; if still unsure, ask.
- A "low/medium" task is discovered mid-flight to touch a High/Critical surface → stop, re-classify, re-confirm.

## Forbidden actions

- No downgrading a level to skip validation or approval.
- No starting Critical work as if it were routine — schema, provider SDK, env, and auto-send are never routine.
- No proceeding past a STOP without owner sign-off.

## Final report format

```
Task: <one line>
Surfaces touched: <files/areas>
Risk level: low / medium / high / critical (reason)
Mode: direct / ask-first / plan-mode / stop-for-approval
Required validation: <commands>
Regression suite to keep green: <name / N-A>
Owner approval required before edits: yes/no (present? yes/no)
```
