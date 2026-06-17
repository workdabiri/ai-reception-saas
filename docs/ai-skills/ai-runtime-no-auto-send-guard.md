# Playbook: AI runtime no-auto-send guard

## When to use

Any change that touches `src/domains/ai-runtime/`, reply-draft generation, or anything that could connect AI output to message delivery. This is a hard guardrail, not a suggestion.

## Required inputs

- The diff under review/implementation.
- `docs/audits/AREA-B-closure-checkpoint.md` §5/§9 (enforced properties + standing instructions).
- The regression suites: `__tests__/domains/ai-runtime-no-auto-send-lock.test.ts` (B-R8), `__tests__/domains/ai-runtime-cross-tenant-isolation.test.ts` (B-R7).

## Invariants that must hold (and stay test-pinned)

- **AI is default-off**: `Business.aiMode` defaults to `MANUAL`; generation enabled only on explicit `AI_ASSISTED`; resolver fails closed on missing/invalid/error.
- **No send path**: no AI-runtime file may call send/dispatch/deliver/message-create, carry a `sent*`/`SENT`/`APPROVED` delivery token, or import the conversations/channels/actions/reply-drafts send surfaces.
- **No customer/conversation/message content** enters AI context or prompts.
- **Audit is metadata-only**: `ai_generation_audit_logs` stores counts/ids/hashes/redacted text — never raw prompt, generated text, or PII; statuses are only `STARTED`/`SUCCEEDED`/`FAILED` and are terminal-immutable.
- **Draft metadata is review-only**: no `status`/`sent*`/`autoSend`/message-id/raw-text fields.
- **Fake provider only**: deterministic, no network, no env/API-key read, no prompt echo.

## Steps

1. Diff-scan `src/domains/ai-runtime/` for any forbidden import/call-site above.
2. Confirm the reply-draft `generate` path still returns the deterministic SYSTEM stub and remains `aiMode`-gated (fail-closed).
3. Run the B-R7 and B-R8 suites first, then the full suite.
4. If adding fields to audit/draft metadata, confirm none is a delivery/approval/content field.

## Validation commands

```bash
pnpm exec vitest run __tests__/domains/ai-runtime-no-auto-send-lock.test.ts
pnpm exec vitest run __tests__/domains/ai-runtime-cross-tenant-isolation.test.ts
pnpm test
pnpm typecheck
pnpm lint
```

## Stop conditions (any → STOP and escalate to owner)

- A send/dispatch/deliver path, `SENT`/approval token, or message-delivery import appears in AI-runtime.
- Customer/conversation/message content reaches AI context or a prompt.
- A real provider SDK, network call, or env/API-key read is introduced.
- B-R7 or B-R8 goes red, or is modified to pass.

## Forbidden actions

- Never auto-send AI output or auto-approve a draft.
- Never wire AI runtime to delivery without explicit owner approval + dedicated PR.
- Never store prompt/generated text/PII in the audit log.

## Final report format

```
AI-runtime files touched: <list>
Forbidden patterns found: none / <list>
aiMode gating intact: yes/no    Stub generate path intact: yes/no
B-R7: PASS/FAIL   B-R8: PASS/FAIL   Full suite: <N> passed / <M> skipped
Verdict: SAFE / STOP-ESCALATE
```
