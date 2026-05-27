# TASK-R2 — API Handlers Staging Authenticated Smoke Verified

**Status:** R2_AUTHENTICATED_SMOKE_AND_AUDIT_VERIFIED
**Date:** 2026-05-28
**Main commit:** fb5d5e6

---

## 1. Purpose

Record R2 Conversation + Message API authenticated smoke verification on staging.

- Main commit: `fb5d5e6`.
- Builds on previous unauthenticated smoke checkpoint (`TASK-R2-api-handlers-staging-unauthenticated-smoke-verified.md`).
- Authenticated smoke executed against Vercel staging with a valid Auth.js browser session.
- All 7 R2 conversation and message endpoints tested with authentication.
- State machine exercised through full lifecycle: NEW → OPEN → ASSIGNED → RESOLVED.
- Negative test confirmed SYSTEM direction rejection at API boundary.
- Audit events verified via read-only SQL.

---

## 2. Preconditions

| Precondition | Status |
|---|---|
| Cookie jar created at `/tmp/` via hidden `read -s` prompt | ✅ |
| Cookie jar deleted after smoke run | ✅ |
| Session verified: `user.id` present | ✅ |
| Staging user status: ACTIVE | ✅ |
| Staging business status: ACTIVE | ✅ |
| Staging membership status: ACTIVE | ✅ |
| Staging membership role: OWNER | ✅ |
| Feature flag `ENABLE_API_HANDLERS`: `true` | ✅ |
| Feature flag `ENABLE_AUTHJS_RUNTIME`: `true` | ✅ |
| Feature flag `ENABLE_AUTHJS_REQUEST_CONTEXT`: `true` | ✅ |
| Feature flag `ENABLE_DEV_AUTH_CONTEXT`: `false` | ✅ |

**Redaction policy:** No credentials, cookies, tokens, auth headers, user IDs, business IDs, membership IDs, or generated conversation/message IDs are recorded in this document.

---

## 3. Smoke Execution Results

### 3.1 Health Check

| Check | Expected | Actual | Pass |
|---|---|---|---|
| HTTP status | 200 | 200 | ✅ |
| Body | `HEALTH_BODY_OK` | `HEALTH_BODY_OK` | ✅ |

### 3.2 Authenticated Endpoint Results

| # | Step | Method | Expected | Actual | Pass |
|---|---|---|---|---|---|
| 1 | List conversations | GET | 200, ok true | 200, ok true | ✅ |
| 2 | Create conversation | POST | 201, conversation_id present | 201, conversation_id_present=true, status=NEW, channel=INTERNAL, messageCount=1 | ✅ |
| 3 | Get conversation | GET | 200, ok true | 200, status=NEW | ✅ |
| 4 | List messages | GET | 200, count ≥ 1 | 200, ok true | ✅ |
| 5 | Create internal note | POST | 201, message_id present | 201, message_id_present=true | ✅ |
| 6 | Reject SYSTEM message | POST | 400, INVALID_MESSAGE_INPUT | 400, INVALID_MESSAGE_INPUT | ✅ |

**Result: 6/6 endpoint tests PASS**

### 3.3 Status Transition Results

| # | Transition | Expected | Actual | Pass |
|---|---|---|---|---|
| 1 | NEW → OPEN | 200, status=OPEN | 200, actual=OPEN | ✅ |
| 2 | OPEN → ASSIGNED | 200, status=ASSIGNED | 200, actual=ASSIGNED | ✅ |
| 3 | ASSIGNED → RESOLVED | 200, status=RESOLVED, closedAt present | 200, actual=RESOLVED, closedAt_present=true | ✅ |

**Result: 3/3 status transitions PASS**

### 3.4 Combined Result

**10/10 PASS** — All endpoint tests and status transitions succeeded.

---

## 4. Audit Verification

### 4.1 SQL Design

Read-only audit event count query (no metadata JSON values selected):

```sql
SELECT action, target_type, result, COUNT(*) AS count
FROM audit_events
WHERE action IN (
  'conversation.created',
  'conversation.status_changed',
  'message.created',
  'message.internal_note_created'
)
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY action, target_type, result
ORDER BY action;
```

### 4.2 Audit Event Counts

| action | target_type | result | expected | actual | pass |
|---|---|---|---|---|---|
| `conversation.created` | `conversation` | `SUCCESS` | 1 | 1 | ✅ |
| `conversation.status_changed` | `conversation` | `SUCCESS` | 3 | 3 | ✅ |
| `message.internal_note_created` | `message` | `SUCCESS` | 1 | 1 | ✅ |

**Total audit events verified: 5**

### 4.3 Audit Interpretation

- `message.created` was **not present** because the initial outbound message was created through the `createConversation.initialMessage` path, not the standalone `createMessage` handler.
- Current R2 domain code emits `conversation.created` for `createConversation` and emits `message.created` only for the standalone `createMessage` OUTBOUND path.
- The standalone `createMessage` with direction `INTERNAL` emits `message.internal_note_created`, which was verified.
- This behavior is accepted for R2 authenticated smoke. See §6 for architecture observation.

### 4.4 Metadata Leak Check

| Check | Expected | Actual | Pass |
|---|---|---|---|
| Metadata content leak count | 0 | 0 | ✅ |

No audit metadata content was selected or printed. Only action names, target types, result values, and counts were queried.

---

## 5. Safety

| Safety Check | Status |
|---|---|
| Cookie/token printed | ❌ Not printed |
| Auth header printed | ❌ Not printed |
| Raw session JSON printed | ❌ Not printed |
| Cookie jar deleted after smoke | ✅ |
| businessId/userId/membershipId recorded | ❌ Not recorded |
| Generated conversation/message IDs recorded | ❌ Not recorded |
| R2 SMOKE test strings used exclusively | ✅ |
| Real PII used | ❌ No |
| Repo files modified during smoke | ❌ None |
| Prisma commands run | ❌ None |
| Environment variables changed | ❌ None |
| Staging redeployed | ❌ No |
| R3/R4 started | ❌ No |
| AI/channel/widget/assignment scope tested | ❌ No |

---

## 6. Architecture Observation (Non-Blocking)

**Observation:** The `createConversation` service method creates an initial message (if provided) but only emits `conversation.created` audit event. It does not emit a separate `message.created` audit event for the initial message.

**Impact:** When a conversation is created with an `initialMessage`, the audit trail shows `conversation.created` but not `message.created` for the initial message. The standalone `createMessage` path correctly emits `message.created` (OUTBOUND) and `message.internal_note_created` (INTERNAL).

**Decision:** No action required in R2. Future audit-policy cleanup may decide whether `initialMessage` should also emit `message.created`. This is a design choice, not a bug.

---

## 7. Repo State

| Check | Value |
|---|---|
| HEAD | `fb5d5e6` |
| Branch | `main` |
| Working tree before smoke | Clean |
| Working tree after smoke | Clean |

Recent history:

```
fb5d5e6 docs(checkpoint): record R2 API unauthenticated smoke verification (#66)
f894479 docs(checkpoint): record R2 API handlers merge verification (#65)
be1e007 feat(r2): add conversation and message API handlers (#64)
a913214 docs(checkpoint): record R2 staging migration verification (#63)
804400f feat(r2): Conversation + Message Domain Layer (#62)
a212491 docs(checkpoint): record migration tracking bootstrap (#61)
```

---

## 8. Final Status

```
R2_AUTHENTICATED_SMOKE_AND_AUDIT_VERIFIED
```

### Next Allowed Steps

- Commit and merge this checkpoint document.
- CTO decides whether to proceed to R3 or add optional audit-policy cleanup for initialMessage path.
- Do not start R3/R4 before this checkpoint is reviewed and merged.
