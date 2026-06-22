# Access Control Matrix

## Purpose

Define the planned MVP access-control matrix before implementation begins.

This document is planning only. It does not create roles, permissions, Prisma models, middleware, API routes, or UI.

## Roles

- Owner: full control of the business workspace
- Admin: manages settings, members, customers, and operator workflow
- Operator: handles customer conversations and messages
- Viewer: read-only access to permitted data

## Permission Naming Convention

Permissions use:

resource.action

Examples:

- business.read
- business.update
- members.invite
- members.remove
- customers.read
- conversations.read
- conversations.reply
- conversations.assign
- audit.read
- settings.update

## MVP Permission Groups

- Business Settings
- Memberships
- Customers
- Conversations
- Messages
- AI Drafts
- Knowledge
- Audit

## Matrix

| Permission | Owner | Admin | Operator | Viewer | Notes |
| --- | --- | --- | --- | --- | --- |
| business.read | yes | yes | yes | yes | read business workspace |
| business.update | yes | yes | no | no | update business profile/settings |
| business.delete | yes | no | no | no | audit-required; protect last owner |
| members.read | yes | yes | no | no | list business members |
| members.invite | yes | yes | no | no | audit-required |
| members.remove | yes | yes | no | no | audit-required; cannot remove last owner |
| members.change_role | yes | yes | no | no | audit-required; admin cannot assign owner unless allowed later |
| customers.read | yes | yes | yes | yes | read customer records |
| customers.update | yes | yes | yes | no | audit-required when sensitive fields change |
| conversations.read | yes | yes | yes | yes | read conversation queue/thread |
| conversations.reply | yes | yes | yes | no | send operator response |
| conversations.assign | yes | yes | yes | no | audit-required |
| conversations.close | yes | yes | yes | no | audit-required |
| messages.read | yes | yes | yes | yes | read messages in permitted conversations |
| messages.create | yes | yes | yes | no | create operator-authored messages |
| ai_drafts.read | yes | yes | yes | no | future AI draft review |
| ai_drafts.generate | yes | yes | yes | no | future; must not auto-send |
| ai_drafts.approve | yes | yes | yes | no | audit-required; future |
| knowledge.read | yes | yes | yes | yes | read verified business-context items; also gates GET ?status=VERIFIED and the default (no-status) list |
| knowledge.create | yes | yes | yes | no | create DRAFT business-context items (not AI-eligible) |
| knowledge.verify | yes | yes | no | no | audit-required; DRAFT -> VERIFIED (AI-eligible); also gates GET ?status=DRAFT list and single-item GET /knowledge/:itemId |
| knowledge.archive | yes | yes | no | no | audit-required; any status -> ARCHIVED; also gates GET ?status=ARCHIVED list |
| audit.read | yes | yes | no | no | sensitive |
| settings.read | yes | yes | no | no | read configurable settings |
| settings.update | yes | yes | no | no | audit-required |

Rules:

- Owner has all permissions
- Admin has most management permissions except business.delete
- Operator handles customer/conversation/message operations
- Viewer is read-only and restricted

## Sensitive Actions

Audit-required actions:

- business.delete
- members.invite
- members.remove
- members.change_role
- customers.update
- conversations.assign
- conversations.close
- ai_drafts.approve
- knowledge.verify
- knowledge.archive
- settings.update

## Audit Requirements

For sensitive actions, record:

- actor
- tenant
- action
- target
- timestamp
- result
- reason or metadata when available

Denied sensitive actions should also be audit-relevant.

## Non-Goals

- No custom roles
- No ABAC implementation
- No middleware implementation
- No API route implementation
- No Prisma models
- No UI permission components
- No billing enforcement
- No provider-specific access logic
