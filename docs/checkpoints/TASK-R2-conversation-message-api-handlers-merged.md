# Checkpoint: R2 Conversation + Message API Handlers Merged

## Purpose

Record merge of R2 Conversation + Message API handlers into main.

- **PR:** #64 — feat(r2): add conversation and message API handlers
- **Main commit:** `be1e007`
- **Merged:** 2026-05-26
- **Merge strategy:** Squash merge

---

## Scope Included

### 7 API Handlers

| Method | Path | Permission |
|---|---|---|
| GET | `/api/businesses/:businessId/conversations` | `conversations.read` |
| POST | `/api/businesses/:businessId/conversations` | `conversations.reply` |
| GET | `/api/businesses/:businessId/conversations/:conversationId` | `conversations.read` |
| PATCH | `/api/businesses/:businessId/conversations/:conversationId` | `conversations.reply` |
| POST | `/api/businesses/:businessId/conversations/:conversationId/status` | `conversations.close` (RESOLVED) / `conversations.reply` (others) |
| GET | `/api/businesses/:businessId/conversations/:conversationId/messages` | `messages.read` |
| POST | `/api/businesses/:businessId/conversations/:conversationId/messages` | `messages.create` |

### Supporting Changes

- API error mappings (7 new error codes)
- Feature-gated route skeletons (501 when `ENABLE_API_HANDLERS` is not `true`)
- Handler module with dependency injection for testability
- Route skeleton tests (7 tests)
- Handler tests (68 tests)

---

## Files Changed

| Type | File |
|---|---|
| Modified | `src/app/api/_shared/errors.ts` |
| New | `src/app/api/businesses/[businessId]/conversations/handler.ts` |
| New | `src/app/api/businesses/[businessId]/conversations/route.ts` |
| New | `src/app/api/businesses/[businessId]/conversations/[conversationId]/route.ts` |
| New | `src/app/api/businesses/[businessId]/conversations/[conversationId]/status/route.ts` |
| New | `src/app/api/businesses/[businessId]/conversations/[conversationId]/messages/route.ts` |
| New | `__tests__/api/conversation-route-skeletons.test.ts` |
| New | `__tests__/api/conversations-handler.test.ts` |

---

## Safety / Integrity Decisions

### Audit

- Handler-level duplicate audit removed during CTO review.
- Domain service remains the single source of truth for audit events.
- Handler does not emit `conversation.create`, `conversation.update`, or `message.create` audit events.
- Domain service emits: `conversation.created`, `conversation.customer_linked`, `conversation.status_changed`, `message.created`, `message.internal_note_created`.

### Sender Impersonation Prevention

- `initialMessage` body schema rejects `senderType` and `senderUserId` from client.
- Handler derives `senderType` from `direction`:
  - `INBOUND` → `CUSTOMER`
  - `OUTBOUND` → `OPERATOR`
  - `INTERNAL` → `OPERATOR`
- Handler derives `senderUserId` from authenticated user context for `OUTBOUND` and `INTERNAL` messages.
- `senderCustomerId` is only allowed for `INBOUND` messages; rejected for `OUTBOUND`, `INTERNAL`.

### API Boundary Restrictions

- `SYSTEM` message direction is rejected at the API boundary (400 `INVALID_MESSAGE_INPUT`).
- `SYSTEM` messages remain available for internal domain service use only.
- Query parameters `assignedUserId`, `customerId`, and `cursor` must be valid UUIDs.
- Invalid `limit` values return 400.
- All routes remain feature-gated by `ENABLE_API_HANDLERS`.

### Assignment

- No assignment endpoint is included.
- Assignment remains deferred to R4 (requires membership verification).
- `ASSIGNED` status transition is allowed by the state machine but does not set `assignedUserId`.

---

## Explicit Exclusions

| Scope | Status |
|---|---|
| Prisma schema changes | ❌ Not included |
| Migration changes | ❌ Not included |
| Staging DB changes | ❌ Not included |
| Seed | ❌ Not included |
| AI runtime | ❌ Not included |
| AI draft generation | ❌ Not included |
| AI auto-reply | ❌ Not included |
| Channel adapters | ❌ Not included |
| Website widget frontend | ❌ Not included |
| Booking / actions / leads / billing | ❌ Not included |
| Assignment endpoint | ❌ Deferred to R4 |

---

## Validation

| Command | Result |
|---|---|
| `pnpm typecheck` | ✅ pass |
| `pnpm lint` | ✅ 0 errors, 13 pre-existing warnings |
| `pnpm test` | ✅ 1152 passed, 7 skipped |
| `pnpm build` | ✅ production build succeeds |

---

## Final Status

**R2_API_HANDLERS_MERGED_VERIFIED**

### Next Allowed Step

R2 API Handler Staging Smoke Gate / Feature Gate Verification.
Do not start R3/R4 before this checkpoint is reviewed and merged.
