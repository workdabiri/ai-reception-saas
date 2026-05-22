# CRM Domain

**Owner:** CRM module
**Responsibility:** Tenant-scoped customer profiles, contact methods, and customer identity resolution for reception workflows.

## Owns

- Customer profiles (business-scoped)
- Customer contact methods (email, phone, channel identities)
- Customer identity resolution (find-or-create by contact method)
- Customer lifecycle (ACTIVE, ARCHIVED)

## Dependencies

- Identity (user references for audit context)
- Tenancy (business scoping, tenant context)

## Consumed By

- Conversations (R2) — links conversations to customers
- Channels (R3/R8) — resolves sender identity to customer
- Leads (R10) — associates leads with customers
- AI Runtime (R6) — customer context for AI classification/drafting

## Key Rules

- Every customer belongs to exactly one business
- Same real person in different businesses = separate customer records
- Cross-tenant customer lookup is forbidden
- Customer notes are internal only — never exposed to customer-facing channels
- Contact method uniqueness is enforced per business+type+value

## Anti-Patterns

- ❌ Do NOT put conversation data here — that belongs in **Conversations**
- ❌ Do NOT put order data here — that belongs in **Orders**
- ❌ Do NOT put lead qualification here — that belongs in **Leads** (R10)
- ❌ Do NOT query customer tables from other domains — use CrmService
- ❌ Do NOT expose customer notes to external channels
