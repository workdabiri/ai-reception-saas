# Area C — Public Web-Chat Ingest Audit & Design Contract

**Product:** AiA Reception SaaS
**Scope:** Public web-chat ingest · Embeddable widget · Widget-key → Business mapping · Anonymous-first customer/conversation/message creation · Public-endpoint security (origin allowlist · rate-limiting · abuse · tenant isolation)
**Status:** AUDIT / DESIGN PROPOSAL — **STOP-for-approval** (this document authorizes no implementation)
**Date:** 2026-06-30
**Audited baseline:** `de82109` (PR #145, operator "Send Approved Draft" merged); baseline working tree was clean before this documentation change.
**Source of truth:** `docs/product/PRD-v1.1.md` (LOCKED, §3 / §9 / §11 / §16 / §17) · PRD-v1.0 §7 (channel adapter boundaries), §23 (permanent anti-scope)
**Companion docs:** `docs/audits/AREA-A-closure-checkpoint.md` (tenant-isolation substrate, CLOSED) · `docs/audits/AREA-B-closure-checkpoint.md` (AI runtime, no-auto-send) · `src/domains/channels/README.md` · `src/domains/conversations/README.md`

> **⚠ This is a documentation-only audit/design proposal. It contains no code, no patches, no schema, and no migrations.** It is the **P12-A** deliverable. It defines the threat model, product contract, security design, API/schema/widget contract proposals, validation gates, and a staged implementation breakdown so the owner can review and decide whether to authorize any subsequent build phase. **Per `CLAUDE.md`, Area C remains OUT OF SCOPE / STOP until separately approved; this document does not change that.** Nothing here grants implementation authority. PRD-v1.1, the schema, the API surface, the tests, and CI are unchanged by this file.
>
> **Evidence labels:** `[VERIFIED]` = read directly in current backend source/schema (`de82109`); `[VERIFIED-TEST]` = confirmed by a test file; `[ABSENT]` = searched for and not present in the repo today; `[PROPOSED]` = a forward-looking design suggestion requiring owner approval and a dedicated PR before it exists.

---

## 1. Title and Status

| Field | Value |
| :---- | :---- |
| Title | Area C — Public Web-Chat Ingest Audit & Design Contract |
| Product | AiA Reception SaaS |
| Scope | Public web-chat ingest + embeddable widget + ingest security |
| Status | **AUDIT / DESIGN PROPOSAL — STOP-for-approval** |
| Phase | P12-A (audit/design only) |
| Date | 2026-06-30 |
| Audited baseline | `de82109` (PR #145, operator "Send Approved Draft" merged); baseline working tree was clean before this documentation change |
| Source of truth | PRD-v1.1 (LOCKED) §3/§9/§11/§16/§17 |
| Risk class (this doc) | Low (docs-only) |
| Risk class (implementation, future) | **Critical** (public, unauthenticated, tenant-isolation-sensitive) |
| Authorizes implementation? | **No** |

**Why this is build-critical (not optional).** PRD-v1.1 §3 lists "Website chat as the **first** customer channel" and the "Embeddable web chat widget, **anonymous-first** with progressive contact capture" as **IN** Private Alpha. §16 ranks "**Outbound send path + web chat ingest**" as **build-critical priority #3**. The outbound half shipped (operator "Send Approved Draft", PR #145). **This document covers the remaining inbound half.** Until it exists, there is no path for a real customer to initiate contact — the alpha is operator-only.

---

## 2. Current-State Baseline (what exists today)

| Capability | State | Evidence |
| :---- | :---- | :---- |
| Public/unauthenticated ingest route | `[ABSENT]` | No public web-chat ingest route exists today. The existing customer/conversation/message APIs are business-scoped and authenticated/operator-context routes; they are not public widget ingest routes. |
| `channels` domain implementation | `[ABSENT]` (scaffold) | `src/domains/channels/` contains **only `README.md`** — no `types/validation/repository/service/implementation/index`. |
| Widget key / public channel token / channel-connection table | `[ABSENT]` | No model in `prisma/schema.prisma`; `ChannelType` is a Prisma enum, not a connection table (PRD-v1.1 §11 flags this). |
| Origin allowlist (production) | `[ABSENT]` | Only `src/lib/security/dev-cors.ts` exists — **dev-only**, header-based, explicitly not a production trust boundary. |
| Rate limiting / abuse protection | `[ABSENT]` | No limiter, no token bucket, no IP/throttle middleware in `src/`. |
| `ChannelType.WEBSITE_CHAT` | `[VERIFIED]` | `prisma/schema.prisma` `enum ChannelType { INTERNAL, WEBSITE_CHAT }`; `CHANNEL_TYPE_VALUES` in `src/domains/conversations/types.ts`. |
| Inbound customer message taxonomy | `[VERIFIED]` | `MessageDirection.INBOUND` + `MessageSenderType.CUSTOMER` both exist; `Message.senderCustomerId` is optional FK to `Customer`. |
| Anonymous-friendly `Customer` model | `[VERIFIED]` | `Customer` requires only `displayName`; contact methods live in a separate `CustomerContactMethod` table; `Customer.metadata` Json is available. |
| Conversation ↔ customer linkage | `[VERIFIED]` | `Conversation.customerId` is **optional**; `Conversation.channel` defaults `INTERNAL`; `Conversation.channelMetadata` Json exists. |
| Cross-tenant linkage guards (DB-level) | `[VERIFIED]` | `Conversation @@unique([id, businessId])`; `Message → Conversation` composite FK on `[conversationId, businessId] → [id, businessId]` prevents cross-tenant message/conversation linking. |
| Tenant-isolation test substrate | `[VERIFIED]` | Area A real-DB isolation gate + Area B AI-isolation gate are branch-protection-required (`AREA-A`/`AREA-B` closure checkpoints). |
| Conversation/message create services | `[VERIFIED]` | `conversations` service exposes `createConversation`, `createMessage`; `crm` service exposes `createCustomer`, `findCustomerById`. |
| Operator assignment (`assignConversation`) | `[ABSENT]` (deferred) | TODO(R4); **out of alpha scope** per PRD-v1.1 §4/§8 (shared-queue default). Not part of Area C. |

**Net finding:** the **data model can already represent** an inbound web-chat message (existing enums + optional customer linkage + Json metadata). The Area C gap is **not** the message taxonomy — it is (a) a **public, unauthenticated ingress** that does not exist, (b) a **widget-key → business** trust mechanism that does not exist, and (c) the **public-endpoint security envelope** (origin allowlist, rate-limiting, abuse, replay/idempotency) that does not exist. Those three are the dangerous net-new surface this audit governs.

---

## 3. Threat Model

The public ingest endpoint is the **only** planned surface that is unauthenticated and internet-reachable. It is the highest-risk surface in the product because a single mistake can cross the tenant boundary — the platform's hardest invariant (PRD-v1.1 §9). Each threat below carries a mitigation that becomes a **mandatory validation gate** in §7.

| # | Threat | Description | Primary mitigation (see §5/§7) |
| :-- | :---- | :---- | :---- |
| T1 | **Unauthenticated request abuse** | Anyone on the internet can POST to the ingest route; there is no session/operator identity. | Public route accepts **only** a validated widget/channel token; never an operator/session assumption; fail-closed on missing/invalid token. |
| T2 | **Tenant isolation breach** | A request could be associated with the wrong business, leaking or cross-writing tenant data. | `businessId` is **derived server-side from the validated widget token only** — never read from client input; reuse Area A `businessId`-scoping + DB composite-key guards. |
| T3 | **Widget-key spoofing / forgery** | An attacker guesses, forges, or replays a widget key to post into another tenant. | High-entropy, opaque, non-enumerable public token; server-side lookup to an **active** channel binding; revocable; rotateable; constant-time comparison. |
| T4 | **Origin spoofing** | Requests from a non-allowlisted site impersonate a customer's embed. | Per-binding **origin allowlist**; reject disallowed `Origin`; treat `Origin` as defense-in-depth (spoofable by non-browser clients), never as the sole control. |
| T5 | **Spam / abuse / DoS** | Flooding the endpoint to exhaust DB/quota or bury the operator inbox. | Per-key + per-IP + per-conversation **rate limits**; payload size caps; message-count caps per session; fail-closed throttling; abuse counters. |
| T6 | **Anonymous PII over-collection / leakage** | Visitor free-text or captured contact data ends up in logs/audit or is over-retained. | Strict payload allowlist (§4); **PII-safe audit/logging** (metadata only, no message content) per existing project rule; progressive-capture is opt-in and minimal. |
| T7 | **Replay / idempotency** | Network retries or malicious replays create duplicate conversations/messages. | Client-supplied **idempotency key** per message; server dedup window; status-guarded inserts (mirror the P11 atomic-claim pattern). |
| T8 | **Cross-business data leakage via responses** | The ingest/poll response leaks another tenant's data or internal fields. | Responses expose **only** the caller's own conversation/session state, field-allowlisted; no operator identity, no internal ids beyond what the widget must echo. |
| T9 | **Injection into downstream AI prompt** | Untrusted visitor text later flows into an AI prompt as if trusted. | **Out of scope here and STOP:** Area B treats customer-message-in-prompt as STOP; web-chat content must be tagged UNTRUSTED and must not enter any prompt until the Area B prompt-injection gate is separately closed. This audit only **records** the boundary; it builds nothing. |
| T10 | **Widget-key exposure in client** | The public key is necessarily shipped in browser JS and is therefore public by design. | Treat the widget key as a **public, low-privilege** identifier (ingest-only, no read of history beyond own session); never reuse it as a secret/bearer for privileged APIs. |

**Trust posture (summary):** the public ingest endpoint trusts **nothing** from the client except an opaque widget token that the server independently resolves to an active business binding. All scope (`businessId`) is server-derived. This mirrors the Area A rule "never trust a client-supplied `businessId`" and extends it to an unauthenticated caller.

---

## 4. Required Product Contract

How an anonymous visitor's interaction maps onto existing domain records. All items are `[PROPOSED]` unless they restate a `[VERIFIED]` repo capability.

### 4.1 Anonymous visitor creates / continues a conversation
- **Start:** a visitor with a valid widget token and an active session may open a conversation **without** name/email/phone (anonymous-first, PRD-v1.1 §11). `[PROPOSED]`
- **Continue:** subsequent messages reference an existing session/conversation the same widget session owns; the server validates that the session token maps to a conversation **in the token's business**. `[PROPOSED]`
- A conversation is created with `channel = WEBSITE_CHAT`, `status = NEW`, `customerId` set to the anonymous customer (see 4.4), `channelMetadata` carrying non-PII widget/session provenance. `[VERIFIED]` model support; `[PROPOSED]` usage.

### 4.2 Widget identity → Business/Tenant mapping
- The widget embed carries a **public widget key**. The server resolves it via a server-side binding to exactly one `businessId`. `[PROPOSED]`
- The mapping is the **only** source of `businessId` for the request. Client-sent `businessId` (if any) is ignored/rejected. `[PROPOSED]` (extends Area A `[VERIFIED]` rule).
- The binding must be **active**, **origin-bound**, **revocable**, and **rotateable**. `[PROPOSED]`

### 4.3 `ChannelType.WEBSITE_CHAT` representation
- Reuse the **existing** `ChannelType.WEBSITE_CHAT` enum value for the conversation channel; no new channel enum value is required for alpha. `[VERIFIED]`
- The decision recorded in §5/§6: whether the widget key lives in `Conversation.channelMetadata` only, or in a dedicated **channel-binding table** (recommended). The PRD-v1.1 §11 implementation note explicitly defers this enum-vs-table decision to this audit. `[PROPOSED]`

### 4.4 Anonymous `Customer` creation / resolution
- On first contact, create a `Customer` with a generated `displayName` (e.g. "Website Visitor") and **no contact method**; store an anonymous/session marker in `Customer.metadata`. `[VERIFIED]` model support; `[PROPOSED]` usage.
- **Progressive capture (optional, alpha):** if the visitor later provides name/phone/email, attach a `CustomerContactMethod` and update identity; respect `CustomerContactMethod @@unique([businessId, type, value])` to merge rather than duplicate. `[VERIFIED]` constraint; `[PROPOSED]` flow.
- Identity creation/resolution must go through the **`crm` service** (`createCustomer` / `findCustomerById`), never a cross-domain DB write — per the no-cross-domain-query rule. `[VERIFIED]` service surface; `[PROPOSED]` ingest usage.

### 4.5 Inbound `Message` creation
- Each visitor message becomes one `Message` with `direction = INBOUND`, `senderType = CUSTOMER`, `senderCustomerId = <anonymous customer>`, `content = <visitor text>`, `contentType = text/plain`. `[VERIFIED]` taxonomy; `[PROPOSED]` usage.
- The composite FK `[conversationId, businessId] → Conversation[id, businessId]` guarantees the message cannot attach to another tenant's conversation. `[VERIFIED]`
- Message creation goes through the **`conversations` service** (`createMessage`), not direct DB. `[VERIFIED]` surface; `[PROPOSED]` usage.

### 4.6 Allowed public payload (allowlist — what the client MAY send)
`[PROPOSED]`
- `widgetKey` (opaque public token)
- `sessionToken` (opaque per-session identifier issued by the server on session start)
- `conversationRef` (server-issued reference for continuation; not a raw DB id)
- `message.text` (bounded length)
- `idempotencyKey` (client-generated, per message)
- optional `contact` block **only** for progressive capture (`name?`, `email?`, `phone?`), each validated and length-bounded
- optional `clientMeta` (coarse, non-PII: locale hint, widget version)

### 4.7 Forbidden public input (what the client MUST NEVER be trusted to set)
`[PROPOSED]`
- `businessId` / `tenantId` (server-derived from widget key only)
- `customerId`, `conversationId`, `messageId`, `assignedUserId`, operator/user ids (no client-chosen primary keys)
- `direction`, `senderType`, `channel`, `status` (server-fixed: INBOUND/CUSTOMER/WEBSITE_CHAT/NEW)
- any AI field (`aiClassificationStatus`, `aiDraftStatus`), any reply-draft field, any `sent*` field
- audit/role/permission fields
- arbitrary `metadata` / `channelMetadata` blobs (server constructs provenance; client cannot inject)

---

## 5. Security & Authorization Design

All `[PROPOSED]`. This section is the heart of the gate.

### 5.1 `businessId` is never client-trusted
- The public route resolves `businessId` **exclusively** from the validated widget-key binding. There is no route param and no body field that can set or override it.
- This is the unauthenticated analogue of the Area A canonical rule and the `assertBusinessRouteMatchesTenant` backstop: scope is server-derived, fail-closed.

### 5.2 Widget key / public channel token design
- **Public widget key:** opaque, high-entropy, non-enumerable, embedded in client JS — treated as a **public, ingest-only, low-privilege** identifier (T10). Maps to one business binding.
- **Session token:** issued server-side on session start (after widget-key + origin validation), scopes subsequent messages to one conversation/session; short-lived and revocable.
- Storage: key material hashed at rest where it functions as a secret; lookups constant-time; bindings carry `status` (active/revoked), `allowedOrigins`, and rotation metadata.
- Separation: the widget key must **not** be accepted as a bearer token by any authenticated/business-scoped API; it only reaches the public ingest surface.

### 5.3 Origin allowlist
- Each binding declares an `allowedOrigins` set. Requests whose `Origin` is not allowlisted are rejected.
- `Origin` is **defense-in-depth**, not the trust root (spoofable by non-browser clients); the widget-key binding remains the authority.
- Production CORS for the public route is a **first-class config**, distinct from the dev-only `src/lib/security/dev-cors.ts` (which is explicitly not a production boundary). `[VERIFIED]` that only the dev helper exists today.

### 5.4 Rate limiting
- Layered limits: **per widget key**, **per IP**, and **per conversation/session**; plus a global ceiling.
- Caps: message length, messages-per-session, new-conversations-per-origin-per-window.
- Fail-closed: when limits are exceeded, reject with a non-leaky error; never silently drop into the operator inbox unthrottled.

### 5.5 Abuse protection
- Spam/abuse counters per binding; automatic soft-block thresholds; payload-size ceilings; reject malformed/oversized bodies early (before any DB work).
- Bot/replay resistance via idempotency (T7) and optional challenge hooks (future-safe, not built in alpha).

### 5.6 Tenant boundary checks
- Reuse Area A invariants: every write is `businessId`-scoped; rely on the DB composite-key guards (`Conversation @@unique([id, businessId])`, `Message` composite FK) so a mis-scoped write cannot link across tenants. `[VERIFIED]`
- Continuation requests validate that `sessionToken`/`conversationRef` resolve to a conversation **in the widget key's business**, else fail-closed.

### 5.7 Audit requirements
- Emit content-free, PII-safe audit events on ingest mutations (e.g. `conversation.created`, `message.created` from the public channel), mirroring the existing rule that audit records **that** a message was created, never **what** it contained. `[VERIFIED]` (project rule + conversations README anti-pattern).
- Audit metadata: business id, conversation id, channel, idempotency outcome, rate-limit decision — **no** message text, **no** raw contact values.

### 5.8 Logging without leaking PII
- Application logs for the public route must exclude message content and raw contact values; log coarse outcomes (accepted/throttled/rejected + reason code) and ids only.
- No widget key / session token in logs in clear; redact or hash.

---

## 6. Suggested Backend API Contract (proposal only — no implementation)

All `[PROPOSED]`. Route names, request/response shapes, and error codes only. **No handler, no route file, is created by P12-A.** Final naming is owner's call at P12-C.

### 6.1 Routes (illustrative)
- `POST /api/public/web-chat/sessions` — start a widget session. Body: `{ widgetKey }`. Validates widget key + origin + rate limit; returns a `sessionToken` and (optionally) an initial `conversationRef`.
- `POST /api/public/web-chat/messages` — submit an inbound visitor message. Body: `{ sessionToken, conversationRef?, text, idempotencyKey, contact? }`. Creates/continues the conversation and appends one INBOUND/CUSTOMER message.
- `GET /api/public/web-chat/sessions/:sessionToken/state` *(optional, alpha-deferrable)* — poll own session/conversation state (own messages + status only). Realtime is OUT of alpha (PRD-v1.1 §4); polling is the fallback.

> Namespacing under `/api/public/**` is deliberate: it visually and structurally separates the unauthenticated surface from the authenticated `/api/businesses/:businessId/**` tree, so the public routes can be reasoned about and tested as a distinct trust zone, and never accidentally inherit the operator handler sequence.

### 6.2 Request/response contract notes
- Requests: strictly the §4.6 allowlist; unknown fields rejected (Zod `.strict()`-style), not ignored.
- Responses: field-allowlisted; expose only the caller's own session/conversation state; no operator identity, no other-tenant data, no internal-only ids beyond the opaque refs the widget must echo.
- All scope (`businessId`) server-derived; never echoed back as authority.

### 6.3 Error codes (illustrative, `ActionResult`-style)
- `WIDGET_KEY_INVALID` / `WIDGET_KEY_REVOKED`
- `ORIGIN_NOT_ALLOWED`
- `SESSION_INVALID` / `SESSION_EXPIRED`
- `RATE_LIMITED`
- `PAYLOAD_TOO_LARGE` / `VALIDATION_FAILED`
- `CONVERSATION_NOT_IN_SCOPE` (continuation crossing tenant/session boundary — fail-closed)
- All errors are **non-leaky** (no tenant existence oracle; generic messages for key/origin failures).

### 6.4 Idempotency strategy
- Per-message client `idempotencyKey`; server stores a short-window dedup record keyed by `(binding, sessionToken, idempotencyKey)`; a replay returns the original result without creating a second message.
- Inserts are status-/uniqueness-guarded so concurrent retries cannot double-write (mirror the P11 atomic-claim pattern).

### 6.5 Feature gating
- The public surface must respect a feature flag analogous to `ENABLE_API_HANDLERS` (exact `"true"`) and default **off** until explicitly enabled, so it cannot be reached in any environment before it is approved and configured. `[VERIFIED]` gate pattern; `[PROPOSED]` application to public routes.

---

## 7. Suggested Schema / Domain Change Proposal (proposal only — no migration)

All `[PROPOSED]`. **No schema edit and no migration are performed by P12-A.** Any of the below is High/Critical-risk and requires its own migration plan + dedicated PR.

### 7.1 Reuse without change
- `ChannelType.WEBSITE_CHAT`, `MessageDirection.INBOUND`, `MessageSenderType.CUSTOMER`, optional `Conversation.customerId`, `Message.senderCustomerId`, `Customer.displayName`-only requirement, `*.metadata` / `*.channelMetadata` Json. `[VERIFIED]` — no change needed to represent an inbound web-chat message.

### 7.2 New: channel-binding / widget-key table (recommended)
- A `WebChatChannelBinding` (or `ChannelConnection`) table owned by the **`channels`** domain: `{ id, businessId, widgetKeyHash, status (ACTIVE/REVOKED), allowedOrigins (String[]), rotation/created/updated, label }`, scoped `@@unique`/indexed by `businessId`. `[PROPOSED]`
- Rationale: PRD-v1.1 §11 explicitly asks this audit to decide enum-vs-table; a dedicated binding table is the clean home for key material, origin allowlist, revocation, and rotation, and it gives `channels` a real first model (today it is README-only `[VERIFIED]`).
- **Migration risk:** High (new table). `enforce_admins`-gated branch protection + migration plan required.

### 7.3 Optional: session / idempotency persistence
- A short-lived session-token store and/or idempotency-dedup table (or a TTL store) — design choice at P12-B (table vs. cache). `[PROPOSED]` **Migration risk:** Medium–High depending on approach.

### 7.4 Domain ownership / dependency fit (Level A only — no new Level-B coupling)
- **`channels`** *(owns the public ingest boundary + binding/key + origin/rate config)* → depends on **Identity, Tenancy** (per its README `[VERIFIED]`). It orchestrates, but **must not** store messages (its README anti-pattern) — it calls the `conversations` and `crm` **services**, never their tables.
- **`conversations`** — provides `createConversation` / `createMessage`; unchanged contract. `[VERIFIED]`
- **`crm`** — provides anonymous `createCustomer` / `findCustomerById` + progressive contact capture; unchanged contract. `[VERIFIED]`
- **`tenancy`** — source of the server-derived `businessId` binding; no client trust. `[VERIFIED]` rule.
- **`audit`** — content-free ingest audit events. `[VERIFIED]` rule.
- **No cross-domain DB queries; no skip-level calls; Level A only** — the ingest path composes Level-A services exactly like the sanctioned `composition.ts` cross-domain pattern. `[VERIFIED]` rule.

---

## 8. Suggested Frontend / Widget Contract (proposal only — no implementation)

All `[PROPOSED]`. The widget lives in the companion frontend repo (`ai-reception-saas-a7cff9d2`); **P12-A builds none of it.**

### 8.1 Widget responsibilities
- Render an embeddable chat surface from a one-line script/snippet (PRD-v1.1 §11).
- Hold only the **public widget key** + a server-issued session token; start a session; submit visitor messages; render the visitor's own conversation state.

### 8.2 What the widget MAY send
- The §4.6 allowlist only: `widgetKey`, `sessionToken`, `conversationRef`, bounded `message.text`, `idempotencyKey`, optional minimal `contact`, coarse `clientMeta`.

### 8.3 What the widget MUST NOT send
- The §4.7 forbidden set: no `businessId`/ids/`direction`/`senderType`/`channel`/`status`, no AI/reply-draft/sent fields, no arbitrary metadata, no operator/role data.

### 8.4 How the widget receives conversation/session state
- Via the server-issued `sessionToken` + `conversationRef`; state limited to the visitor's **own** messages and conversation status. Realtime is OUT of alpha → polling (`GET …/state`) is the fallback; design must not block a future realtime adapter.

### 8.5 Contract-safety note
- API types are **manually mirrored** between repos and the frontend has weaker automated gates (PRD-v1.1 §15/§16 priority #4). The public ingest contract must be specified precisely enough that the widget cannot drift into sending forbidden fields.

---

## 9. Validation Gates Required Before Implementation

Each gate below must be **green** before its phase can merge. These are the acceptance contract for P12-B…E; none is satisfied by P12-A.

| Gate | Proves | Phase |
| :---- | :---- | :---- |
| **Tenant isolation tests** | A widget key for business A can never create/read business B data; `businessId` is server-derived only; cross-tenant continuation fails closed. Extends the Area A/Area B real-DB isolation suites to the public path. | P12-C |
| **Origin allowlist tests** | Disallowed `Origin` rejected; allowlisted accepted; spoofed/absent origin handled fail-closed. | P12-C |
| **Rate-limit tests** | Per-key / per-IP / per-conversation limits enforced; over-limit fails closed and non-leaky. | P12-C |
| **Anonymous customer-creation tests** | First contact creates a `Customer` with no contact method; progressive capture merges (not duplicates) under `@@unique([businessId, type, value])`. | P12-C |
| **Inbound message-creation tests** | Visitor text → exactly one INBOUND/CUSTOMER `Message` in the correct conversation/business; server-fixed fields cannot be overridden by client input. | P12-C |
| **No cross-tenant leakage tests** | Responses expose only the caller's own session/conversation; no other-tenant fields, no operator identity, no tenant-existence oracle. | P12-C |
| **Idempotency/replay tests** | Duplicate `idempotencyKey` does not double-write; concurrent retries safe. | P12-C |
| **Audit tests** | Ingest mutations emit content-free, PII-safe audit events; no message text / raw contact in metadata. | P12-C |
| **No external-provider-dispatch tests** | The ingest path performs **no** WhatsApp/email/SMS/webhook/LLM call; it writes internal records only (parity with the P11 no-external-dispatch guarantee). | P12-C |
| **No-AI-prompt-ingress guard** | Web-chat content is tagged UNTRUSTED and does not enter any AI prompt (Area B customer-message-in-prompt remains STOP). | P12-C |
| **Build / lint / typecheck / test merge gate** | `pnpm lint && pnpm typecheck && pnpm build && pnpm test` + clean `git status --short` (merge-gate). | every phase |
| **Schema migration plan** | High-risk migration plan + reviewed `prisma migrate` for any new table. | P12-B |
| **Security review** | `docs/ai-skills/security-review-workflow.md` run over the public surface. | P12-C |

---

## 10. Implementation Breakdown Proposal

Staged, each phase **STOP-for-approval** with its own dedicated PR and owner sign-off. **Only P12-A (this document) is authorized.**

| Phase | Scope | Risk | Status |
| :---- | :---- | :---- | :---- |
| **P12-A** | This audit / design contract — **docs-only** | Low | **In review (this document)** |
| **P12-B** | Backend schema + domain contract: `WebChatChannelBinding` (+ optional session/idempotency store), `channels` domain implementation (types/validation/repository/service/implementation/index), migration plan. **No public route yet.** | High (schema/migration) | **STOP — not authorized** |
| **P12-C** | Public ingest API: `/api/public/web-chat/**` routes + handlers, widget-key/session validation, origin allowlist, rate-limiting, idempotency, anonymous customer/conversation/message creation via services, content-free audit. All §9 gates green. | **Critical** | **STOP — not authorized** |
| **P12-D** | Frontend/widget integration in the companion repo: embeddable snippet, session lifecycle, §8 contract. | Medium–High | **STOP — not authorized** |
| **P12-E** | Staging smoke test: end-to-end against non-production data, feature flag default-off verified, isolation + rate-limit + audit observed; rollback/kill (disable flag) rehearsed. | Medium | **STOP — not authorized** |

Each later phase requires: explicit written owner approval, a dedicated PR, the §9 gates for that phase, and the external-advisor/human backstop preserved (per `CLAUDE.md` decision-authority rules).

---

## 11. Explicit Non-Goals

This audit and the entire Area C web-chat workstream, as scoped for Private Alpha, explicitly **exclude**:

- **No WhatsApp** implementation (architectural readiness only; PRD-v1.1 §4/§11).
- **No email** sending/ingest.
- **No SMS** sending/ingest.
- **No voice / telephony.**
- **No real AI provider** integration (Area B real-provider gates remain STOP).
- **No AI auto-reply / no AI go-live** — Level 2 stays human-gated; customer-message-in-prompt remains STOP.
- **No auto-send** — ingest writes inbound records only; the only outbound path remains the human-gated operator "Send Approved Draft" (P11).
- **No external channel delivery** of any kind from the ingest path (internal `Message` records only).
- **No payment / billing.**
- **No MCP** and **no Notion / Slack / third-party integrations.**
- **No realtime** transport (polling fallback for alpha; realtime adapter is future-safe, not built).
- **No vertical-specific schema / domain / workflow.**
- **No operator assignment / skill-based routing / workload management** (shared-queue default; PRD-v1.1 §4/§8).

---

## 12. Recommendation & Decision Required

**Recommendation:** approve the Area C *design direction* recorded here, then authorize phases **individually**, beginning with **P12-B (backend schema + `channels` domain contract)** under a dedicated High-risk migration PR — **only if** you choose to proceed. The recommended sequence is B → C → D → E, never collapsing the public-route phase (P12-C) into another.

**Decision required from owner:**
1. Accept / revise this audit/design contract.
2. Confirm the enum-vs-table decision (§7.2 recommends a dedicated `channels` binding table).
3. Decide whether to authorize **P12-B** next, or to hold the entire workstream at STOP.

**Status after this document: Area C remains STOP-for-approval. No implementation is authorized. This document grants no authority.**

---

*Area C audit/design proposal authored 2026-06-30 against git HEAD `de82109`. Documentation-only; PRD-v1.1, schema, API surface, tests, and CI unchanged. Subordinate to PRD-v1.1 (LOCKED) and `CLAUDE.md`; on any conflict those win.*
