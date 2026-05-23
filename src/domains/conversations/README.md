# Conversations Domain

## Responsibility

Owns conversation lifecycle, message persistence, and conversation state machine.

**This domain owns:**
- `Conversation` model — lifecycle record for customer interactions
- `Message` model — immutable message records within conversations
- Conversation state machine (status transitions)
- Message direction/sender type rules
- Customer linkage (via `customerId` FK to CRM)
- Operator assignment (via `assignedUserId` FK to User)
- AI placeholder fields (`aiClassificationStatus`, `aiDraftStatus`)
- Channel type identification (`ChannelType` enum)

## Files

| File | Purpose |
|---|---|
| `types.ts` | Domain types, enum value arrays, entity interfaces, input types |
| `validation.ts` | Input validation, state machine transitions, enum type guards |
| `repository.ts` | Prisma-backed persistence (injected DB client) |
| `service.ts` | Service interface definitions |
| `implementation.ts` | Service implementation with validation + audit |
| `index.ts` | Public API re-exports |

## Anti-Patterns

- **Never store message content in audit metadata** — audit records *that* a message was created, not *what* it contains
- **Never expose INTERNAL messages to customers** — channel adapters must filter by direction
- **Never modify message content after creation** — messages are immutable
- **Never call CRM service from this domain** — the caller resolves customerId before passing to conversations
- **Never implement AI logic here** — AI status fields are placeholders only
- **Never implement channel delivery here** — Channels domain owns adapters
- **Never implement routing/assignment logic here** — R2 stores `assignedUserId` only; assignment operation deferred to R4 (requires membership verification)

## Data Integrity Invariants

### Message.businessId (denormalized)

`Message.businessId` is denormalized for tenant-scoped queries (e.g., listing all messages for a business). A DB-level **composite foreign key** enforces consistency:

```
messages(conversation_id, business_id)
  → conversations(id, business_id)
```

This guarantees a message's `businessId` always matches its parent conversation's `businessId`. The composite FK is backed by `@@unique([id, businessId])` on `Conversation`.

### Customer / Business ownership

Customer ownership (`Conversation.customerId`, `Message.senderCustomerId`) is validated at the **service layer** in R2 via `findCustomerInBusiness`. The service rejects any `customerId` or `senderCustomerId` that does not belong to the conversation's business.

A DB-level composite FK for customer/business was considered but deferred due to Prisma's limitations with nullable composite FKs where one field (customerId) is optional and the other (businessId) is required.

