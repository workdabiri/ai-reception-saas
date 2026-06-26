# Playbook: Real-provider readiness gate

## When to use

Anyone considering integrating a real model provider, wiring route-level AI generation, or enabling AI on real data. **Default outcome of this playbook is STOP** — real-provider production AI-assisted go-live is NOT YET APPROVED (`docs/audits/AREA-B-closure-checkpoint.md` §6).

## Required inputs

- Explicit written owner/Product-Owner approval naming this work.
- The closure checkpoint §6 gate list.
- A dedicated, scoped task and a dedicated PR plan (never bundled with other work).

## The gates (ALL must be separately reviewed and passed first)

1. Real-provider adapter review — real SDK behind the existing `AiProvider` interface; fake provider stays the test default; no domain-logic change.
2. API-key / env secret handling review — storage, injection, rotation, kept out of logs/audit; default-off and absent until enabled.
3. Token / usage cost guard — per-business spend limits and rate limits before any real call.
4. Provider error handling — timeouts/rate-limits/partial failures/retries through the fail-closed result contract and audit FAILED path.
5. Route-level generation wiring review — assembly → prompt → provider → audit → draft, only when `aiMode = AI_ASSISTED`; replaces the SYSTEM stub.
6. Audit wired to the real route — B-R6 audit invoked on every real generation (start + success/failure), not only in tests.
7. PII / data-minimization allowlist — explicit field allowlist for prompt inputs, proven by test to exclude unneeded PII.
8. Prompt-injection / untrusted-message strategy — defined before any customer/conversation/message content enters a prompt.
9. Real-DB AI-isolation CI gate — live-Postgres AI-isolation suite in `RUN_INTEGRATION_TESTS`, required by branch protection (parity with A-R1.1). **ALREADY CLOSED** (PR #111 / `7f24caf`, branch-protection-required 2026-06-19); confirm still green at go-live.
10. Human-approval enforcement — generate → review → edit → approve proven end-to-end; no draft reaches a customer without explicit approval.
11. Staging validation + kill-switch/rollback drill — default-off verified; revert-to-`MANUAL` disables generation business-wide without a deploy.
12. Production rollout approval — explicit owner sign-off recorded.

## Steps

1. Verify written approval exists and names this work. If not → STOP.
2. Confirm each gate above has an owner and an acceptance test. Missing any → STOP.
3. Only then proceed gate-by-gate, one dedicated PR per gate, each test-pinned.

## Validation commands

```bash
pnpm typecheck
pnpm test
pnpm lint
# plus the real-DB AI-isolation suite (exists since PR #111; needs a local Postgres):
RUN_INTEGRATION_TESTS=true pnpm exec vitest run __tests__/integration/ai-runtime-tenant-isolation.integration.test.ts
```

## Stop conditions

- No explicit owner approval → STOP.
- Any gate unmet → STOP.
- A change would add a provider SDK, read API keys, or enable a send path outside this approved sequence → STOP.

## Forbidden actions

- No provider SDK in `package.json` without an authorized real-provider-adapter task.
- No enabling AI on real data before all gates pass.
- No auto-send, ever, under this gate.
- No declaring readiness; this playbook does not grant approval — it only checks for it.

## Final report format

```
Owner approval present: yes/no (quote)
Gates status: 1..12 = PASS/OPEN
Blocking gates: <list>
Verdict: PROCEED (only if all gates + approval) / STOP
```
