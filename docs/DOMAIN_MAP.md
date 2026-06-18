# Domain Map

## 18-Domain Architecture

| #   | Domain            | Folder           | Owns                                                                      |
| --- | ----------------- | ---------------- | ------------------------------------------------------------------------- |
| 1   | **Identity**      | `identity/`      | Users, authentication, sessions, user status, login/me/logout foundations |
| 2   | **Tenancy**       | `tenancy/`       | Businesses, memberships, config, teams, working hours, service areas      |
| 3   | **Authz**         | `authz/`         | Roles, permissions, policies, RBAC/ABAC enforcement                       |
| 4   | **CRM**           | `crm/`           | Customers, channel identities, addresses, notes, tags, memory profiles    |
| 5   | **Channels**      | `channels/`      | WhatsApp/email/SMS/webhook foundations, inbound/outbound, adapters        |
| 6   | **Conversations** | `conversations/` | Conversations, messages, attachments, inbox views                         |
| 7   | **Routing**       | `routing/`       | Ownership, assignment, transfer, handoff, release-to-AI                   |
| 8   | **AI Runtime**    | `ai-runtime/`    | AI inference, provider abstraction, interaction logs                      |
| 9   | **Knowledge**     | `knowledge/`     | Knowledge bases, entries (FAQ, menu, data)                                |
| 10  | **AI Config**     | `ai-config/`     | Prompt templates, AI policies, versioning                                 |
| 11  | **Actions**       | `actions/`       | Action definitions, execution, handler registry                           |
| 12  | **Orders**        | `orders/`        | Order lifecycle, items, pricing, refunds                                  |
| 13  | **Reservations**  | `reservations/`  | Reservation lifecycle, availability                                       |
| 14  | **Cases**         | `cases/`         | Tickets, callbacks, escalation                                            |
| 15  | **Approvals**     | `approvals/`     | Approval requests, decisions, lifecycle                                   |
| 16  | **Audit**         | `audit/`         | Universal audit trail, state diffs                                        |
| 17  | **Billing**       | `billing/`       | Subscriptions, usage ledgers, payment foundations                         |
| 18  | **Analytics**     | `analytics/`     | Conversation/handoff/order metrics, dashboards                            |

> **Repo reality note (count/list):** This table enumerates the **18 canonical Level-A/Level-B domains**. `src/domains/` currently contains a **19th directory, `reply-drafts/`**, that this map does not list as a numbered domain. It is a real, implemented module (reply-draft generate/edit/approve/discard workflow). When the directory and this map disagree, **trust `src/domains/` and each domain's `README.md`**. Do not treat the "18" here as the directory count.

## Domain Dependency Rules

### Allowed

- **Downstream → Upstream**: A domain may call domains it lists as dependencies in its README.
- **Shared Kernel**: All domains may import from `src/lib/` (errors, types, prisma).

### Forbidden

- ❌ **Circular dependencies**: Domain A → Domain B → Domain A is **never** allowed.
- ❌ **Skip-level calls**: If Domain A depends on Domain B which depends on Domain C, Domain A should call Domain B — not Domain C directly (unless Domain C is also a direct dependency).
- ❌ **Cross-domain database queries**: Each domain owns its tables. Other domains access data through the owning domain's service layer.

## Level A / Level B Boundary

| Level       | Scope                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Level A** | Core platform: Identity, Tenancy, Authz, CRM, Channels, Conversations, Routing, AI Runtime, Knowledge, AI Config, Actions, Audit |
| **Level B** | Business verticals: Orders, Reservations, Cases, Approvals, Billing, Analytics                                                   |

**Rule:** Level B domains may depend on Level A domains. Level A domains must **never** depend on Level B domains.

## Anti-Patterns

- ❌ God services that span multiple domains
- ❌ Direct SQL across domain boundaries
- ❌ Putting UI component logic inside domain modules
- ❌ Client-only enforcement of money or state transitions
