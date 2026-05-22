# TASK-PRD-v1-lock: PRD-v1 Lock Checkpoint

## Summary

Locked the canonical PRD-v1 document for AI Reception SaaS after wrong-scope remediation. This checkpoint records that the product direction has been formally locked before any further domain implementation begins.

## Why PRD Was Locked

1. **Wrong-scope remediation completed.** UAE/Mandoub/service-catalog work was reverted in commit `56b850a` on 2026-05-20. All wrong-direction code was removed from the codebase.
2. **Foundation is stable.** Auth.js, tenancy, authz, and audit are implemented and staging-verified (TASK-0054, 855 tests passing).
3. **Product direction was undefined.** No formal PRD existed — only scattered planning docs. The AI Reception product identity, AI rollout strategy, channel priority, and MVP scope needed to be canonically defined before building the next domains.
4. **PRD Recovery Gate completed.** A read-only analysis confirmed the codebase is clean and identified 11 product decisions that needed human resolution.

## Wrong-Scope Work Remediated

| Item | Status |
|---|---|
| Mandoub | Reverted and cleaned |
| UAE service catalog | Reverted and cleaned |
| ServiceCategory / ServiceRequest models | Reverted and cleaned |
| Document-first service-ordering | Reverted and cleaned |
| AED catalog data | Reverted and cleaned |
| Codebase grep verification | All wrong-direction terms return 0 results |

## Key Product Decisions Locked

| Decision | Value |
|---|---|
| Product identity | AI Reception SaaS — multi-tenant B2B AI receptionist platform |
| MVP Foundation scope | Stage 0 (Manual) + Stage 1 (AI Classification) |
| MVP Demo / Alpha scope | + Stage 2 (AI Draft Assist) + Website Chat Widget |
| AI safety principle | No auto-send before Stage 4 |
| First channel | Manual/Internal test → Website Chat Widget |
| Voice | Separate product milestone, not MVP |
| Templates | Vertical-agnostic engine + 5 starter templates |
| Language | English-first, locale-aware architecture |
| Lead capture | Lightweight in MVP, full CRM pipeline deferred |
| Action requests | Request-only capture, no slot booking in MVP |
| Knowledge base | Approved-only, tenant-scoped, no RAG in MVP |
| Billing | Out of MVP, entitlement-ready architecture |
| Anti-scope | Mandoub, UAE catalog, service-ordering permanently forbidden |

## Files Created

- `docs/product/PRD-v1.md` — Canonical PRD
- `docs/checkpoints/TASK-PRD-v1-lock.md` — This checkpoint

## Files Modified

None.

## Code Changes

None. This is a documentation-only task.

## Checks Run

| Check | Result |
|---|---|
| `git status --short` | Only new doc files (untracked) |
| `pnpm typecheck` | ✅ 0 errors |
| `pnpm lint` | ✅ 0 errors |
| `pnpm test` | ✅ All tests pass |
| `pnpm build` | ✅ Production build successful |

## Decision

PRD-v1 locked. Product direction is formally defined. Ready for domain implementation.

## Recommended Next Task

**R1 — CRM / Customer Domain** (first domain in the PRD-v1 roadmap after R0 PRD Lock).

Design and implement the CRM domain: tenant-scoped customer records, customer identity resolution, and customer profile management. This is the first prerequisite for Conversations (R2) and all downstream product domains.
