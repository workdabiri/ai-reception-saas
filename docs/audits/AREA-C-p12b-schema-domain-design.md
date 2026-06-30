# Area C — P12-B Schema & Domain Design Contract (Channels / Web Chat Channel Binding)

**Product:** AiA Reception SaaS
**Scope:** Channels domain foundation · `WebChatChannelBinding` schema contract · widget-key (hashed) + origin-allowlist storage · authz permissions · composition wiring · migration & test plan — **design only**
**Status:** DESIGN CONTRACT — **STOP-for-approval** (this document authorizes no implementation)
**Date:** 2026-06-30
**Phase:** P12-B (docs-only schema/domain design; the build is a later, separately-approved phase)
**Design baseline:** `42988b6` (PR #146 merged — Area C audit/design contract on `main`); baseline working tree was clean before this documentation change.
**Source of truth:** `docs/product/PRD-v1.1.md` (LOCKED, §3 / §9 / §11 / §16) · `docs/audits/AREA-C-web-chat-ingest-audit.md` (P12-A, §5 / §7 / §10) · `docs/engineering/production-migrations.md` (L4 policy) · `docs/architecture/prisma-schema-conventions.md`
**Companion docs:** `docs/audits/AREA-A-closure-checkpoint.md` (tenant-isolation substrate) · `src/domains/channels/README.md` · `src/domains/knowledge/` (tenant-scoped + provenance template) · `src/domains/authz/permissions.ts`

> **⚠ This is a documentation-only design contract. It contains no code, no Prisma schema edit, no migration, and no API route.** It is the **P12-B** deliverable: it freezes the exact schema/domain/authz/composition/migration/test contract for the Area C Channels foundation so the owner can review the precise shapes **before** any L4 migration or domain code is written. **Per `CLAUDE.md` and the P12-A audit, Area C remains OUT OF SCOPE / STOP until separately approved; this document does not change that.** Nothing here grants implementation authority. PRD-v1.1, `prisma/schema.prisma`, the API surface, the tests, and CI are unchanged by this file.
>
> **Evidence labels:** `[VERIFIED]` = read directly in current backend source/schema (`42988b6`); `[PROPOSED]` = a forward-looking design suggestion requiring explicit owner approval + a dedicated PR before it exists. Every Prisma/TypeScript block below is illustrative `[PROPOSED]` design — **not applied**.

---

## 1. Title and Status

| Field | Value |
| :---- | :---- |
| Title | Area C — P12-B Schema & Domain Design Contract |
| Scope | `channels` domain + `WebChatChannelBinding` foundation |
| Status | **DESIGN CONTRACT — STOP-for-approval** |
| Phase | P12-B (docs-only design) |
| Date | 2026-06-30 |
| Design baseline | `42988b6` (PR #146 merged); baseline working tree was clean before this documentation change |
| Risk class (this doc) | Low (docs-only) |
| Risk class (later schema+domain build) | **High / L4** (schema/migration) |
| Authorizes implementation? | **No** |

**Position in the Area C breakdown (from the P12-A audit §10):** P12-A (audit/design — **merged**, PR #146) → **P12-B (this doc: schema/domain design contract)** → *future, each separately approved:* schema+domain **build**, then P12-C public ingest API, P12-D widget, P12-E staging. This document is the design that the schema+domain **build** would implement; the build is **not** authorized here.

---

## 2. Locked Design Decisions (owner-confirmed for this contract)

These were confirmed by the owner for this contract; the rest of the document elaborates them.

1. **Names:** model `WebChatChannelBinding`; enum `WebChatChannelBindingStatus` with values `ACTIVE`, `REVOKED`.
2. **Authz:** add `channels.read` and `channels.manage`. **`channels.read`: OWNER + ADMIN only. `channels.manage`: OWNER + ADMIN only. OPERATOR receives neither in the initial alpha design. VIEWER denied both.** `channels.manage` is **sensitive / audit-required**. (`channels.read` sensitivity recommendation in §5.)
3. **Origin storage:** `allowedOrigins String[]` for alpha; **no** separate origin join table for alpha; a normalized origin table may be considered later if origin policy becomes complex.
4. **Widget key:** **plaintext is never stored** — store only a **hash**; the raw key is shown **once at creation time** in a future implementation; persist a **display-safe** field (`widgetKeyLast4` / `keyPreview`), never the full key.
5. **Tenant scoping:** every query is scoped by `businessId`; **resolve-by-widget-key returns only `ACTIVE` bindings** and **fails closed** for revoked/missing bindings.

**Not authorized by this document:** no public route, no Prisma schema edit, no migration, no Channels domain implementation, no widget.

---

## 3. Final Proposed Schema Contract `[PROPOSED]`

Mirrors the verified tenant-scoped + provenance template `BusinessContextItem` `[VERIFIED]` (composite `@@unique([id, businessId])`, `businessId` indexes, `@@map`, explicit `business` relation) and the schema conventions doc `[VERIFIED]` (PascalCase model, snake_case `@@map` plural, uuid PK, `created_at`/`updated_at`, enums for stable lifecycle states, index `businessId`).

### 3.1 Enum (proposed — not applied)
```prisma
// [PROPOSED] — design only; NOT added to prisma/schema.prisma in this phase.
enum WebChatChannelBindingStatus {
  ACTIVE
  REVOKED
}
```

### 3.2 Model (proposed — not applied)
```prisma
// [PROPOSED] — design only; NOT added to prisma/schema.prisma in this phase.
model WebChatChannelBinding {
  id                String                      @id @default(uuid()) @db.Uuid
  businessId        String                      @map("business_id") @db.Uuid

  label             String                      // operator-facing name, e.g. "Main site widget"
  status            WebChatChannelBindingStatus @default(ACTIVE)

  // Widget key: KEYED HASH ONLY (HMAC-SHA-256 / server-side peppered hash).
  // Plaintext is never persisted; the raw key is shown exactly once at
  // creation/rotation (future impl) and never read back. There is NO
  // previous-key column: alpha rotation is IMMEDIATE (no grace window).
  widgetKeyHash     String                      @map("widget_key_hash")
  widgetKeyLast4    String                      @map("widget_key_last4")   // display-safe preview only
  keyRotatedAt      DateTime?                   @map("key_rotated_at")      // when last rotated; old key invalid at once

  // Origin allowlist (alpha): denormalized array column — NO join table for alpha.
  allowedOrigins    String[]                    @map("allowed_origins")

  // Revocation (terminal): REVOKED bindings never resolve.
  revokedAt         DateTime?                   @map("revoked_at")
  revokedByUserId   String?                     @map("revoked_by_user_id") @db.Uuid

  createdByUserId   String?                     @map("created_by_user_id") @db.Uuid
  createdAt         DateTime                    @default(now()) @map("created_at")
  updatedAt         DateTime                    @updatedAt @map("updated_at")

  business Business @relation(fields: [businessId], references: [id])

  @@unique([id, businessId])
  @@unique([widgetKeyHash])
  @@index([businessId])
  @@index([businessId, status])
  @@map("web_chat_channel_bindings")
}
```

### 3.3 Back-relation on `Business` (proposed — not applied)
A one-line additive back-relation would be added to the existing `Business` relations block (which already lists peers such as `businessContextItems`, `aiGenerationAuditLogs`) `[VERIFIED]`:
```prisma
// [PROPOSED] — design only.
//   webChatChannelBindings WebChatChannelBinding[]
```

### 3.4 Field rationale & constraints

| Field | Purpose | Rule |
| :---- | :---- | :---- |
| `id` / `businessId` | PK + tenant owner | `@@unique([id, businessId])` enables composite-FK safety for any future child rows, mirroring `Conversation`. |
| `widgetKeyHash` | Server-side lookup target | **Keyed hash at rest only** (HMAC-SHA-256 / server-side peppered hash); `@@unique` so a key maps to exactly one binding; constant-time compare at resolve time (impl detail). |
| `widgetKeyLast4` / `keyPreview` | Operator display | Display-safe suffix/preview **only**; never the full key, never the hash, in any read DTO. |
| `keyRotatedAt` | Rotation | **Immediate rotation**: on rotate, the old key is invalid at once — **no previous-key grace window in alpha**. A grace window may be considered later **only** with a separate security review + owner approval. |
| `status` + `revokedAt`/`revokedByUserId` | Lifecycle | `ACTIVE` → `REVOKED` is **terminal**; revoked bindings never resolve. |
| `allowedOrigins String[]` | Origin allowlist | Alpha storage; normalized origin table deferred (§ below). |
| `createdByUserId` | Provenance | Who created the binding (audit/traceability). |

### 3.5 Tenant-scoping rules (binding on the future repository)
- Every read/write filters `businessId` from the **server-resolved tenant context** — never client input (extends the Area A rule). `[VERIFIED]` rule.
- **Resolve-by-widget-key** returns a binding **only** when `status = ACTIVE` **and** the hash matches; revoked/missing → **fail closed** (return nothing; the caller treats this as an invalid widget). The resolve path is the one query that is *not* pre-scoped by a known `businessId` (the binding *is* what yields the `businessId`), so it must be the most defensively written: hash-indexed lookup, ACTIVE-only, and it returns only the in-row `businessId` — it can never widen to another tenant.
- Cross-tenant management (read/manage a binding by id) is always `businessId`-scoped via `@@unique([id, businessId])`.

### 3.6 Origin storage decision (alpha)
- **Alpha:** `allowedOrigins String[]` denormalized column holding **origin-only, normalized** values (scheme + host + optional port; no path/query/hash). Simple, sufficient for a small allowlist, no extra table. `[PROPOSED]`
- **No wildcard origins in alpha** (no `*`, no `https://*.example.com`); each entry is an exact normalized origin. Validation rules + examples in §4.3.
- **Deferred:** a normalized `WebChatAllowedOrigin` table (per-origin rows, audit per origin, richer policy) **may be considered later** if origin policy becomes complex (wildcards, per-origin rate tiers, per-origin disable). **Not proposed for alpha.**

### 3.7 Widget key hashing strategy `[PROPOSED]` (design-only)

- **Plaintext widget key is never stored.**
- **Raw widget key is shown only once** — at creation and at rotation — and never read back.
- **Persist only a keyed hash**, preferably **HMAC-SHA-256** (or an equivalent server-side **peppered** hash).
- **The hash secret / pepper is server-side only** and must **never be logged or exposed** in any response, DTO, audit row, or log line. *(Design-only — env/secret handling is NOT implemented in this phase; see §9.)*
- **Hashing and key-generation are injected as dependencies**, not hardcoded or read at module load.
- **Read DTOs must never include** `widgetKeyHash`, the raw widget key, the hash secret/pepper, or the full key.
- **`widgetKeyLast4` / `keyPreview` is display-only** (a short non-secret suffix), never the full key or hash.

---

## 4. Final Proposed Channels Domain Contract `[PROPOSED]`

Today `src/domains/channels/` is **README-only** `[VERIFIED]`. The build phase would add the standard layered files (mirroring `crm`/`knowledge` `[VERIFIED]`). **No file is created in this phase.**

### 4.1 Files that would later be created under `src/domains/channels/`
| File | Responsibility |
| :---- | :---- |
| `types.ts` | Domain types + enum value constants (`WEB_CHAT_CHANNEL_BINDING_STATUS_VALUES`, record/input types). |
| `validation.ts` | Zod schemas (create/rotate/revoke inputs; origin format validation; label bounds). |
| `repository.ts` | `ChannelsRepositoryDb` narrow slice + `createChannelsRepository(db)`; reads/writes **only** `web_chat_channel_bindings`. |
| `service.ts` | `ChannelsService` interface + `ActionResult` error-code constants (pure interface; no impl). |
| `implementation.ts` | `createChannelsService(deps)` factory implementing the interface. |
| `index.ts` | Barrel — the only public entry point. |
| `README.md` | Update Owns / Key-Rules to reflect the web-chat binding (currently generic). |

### 4.2 Proposed types (illustrative)
```ts
// [PROPOSED] — design only.
export const WEB_CHAT_CHANNEL_BINDING_STATUS_VALUES = ['ACTIVE', 'REVOKED'] as const;
export type WebChatChannelBindingStatusValue =
  (typeof WEB_CHAT_CHANNEL_BINDING_STATUS_VALUES)[number];

export interface WebChatChannelBinding {
  id: string;
  businessId: string;
  label: string;
  status: WebChatChannelBindingStatusValue;
  widgetKeyLast4: string;          // display-safe; never the full key or hash
  allowedOrigins: string[];
  keyRotatedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
// NOTE: widgetKeyHash, the raw widget key, the hash secret/pepper, and the full
// key are NEVER part of a read DTO. (There is no previousWidgetKeyHash field —
// alpha rotation is immediate.)
```

### 4.3 Proposed validation schemas (illustrative)
```ts
// [PROPOSED] — design only.
export const createWebChatChannelBindingSchema = z.object({
  label: z.string().min(1).max(120),
  // NOTE: z.string().url() is NOT sufficient — it accepts full URLs with
  // path/query/hash. Origins must be validated + normalized to ORIGIN-ONLY
  // (scheme + host + optional port) via a dedicated refinement, not .url().
  allowedOrigins: z.array(webChatOriginSchema).min(1).max(20),
}).strict();                                            // unknown fields rejected
// businessId comes from tenant context, NOT the body (.omit pattern).
```

**Origin validation rules (`webChatOriginSchema`) `[PROPOSED]`:**
- `allowedOrigins` holds **origin-only** values: **scheme + hostname + optional port**. **No path, no query, no hash.**
- **Normalize before storage** (lowercase scheme/host, strip default ports / trailing slash; reject anything carrying a path/query/fragment).
- **No wildcard origins in alpha** (`*` and `https://*.example.com` are rejected).
- **Accepted:** `https://example.com` · `https://app.example.com` · `http://localhost:5173` *(local/dev only — not production unless explicitly configured)*.
- **Rejected:** `https://example.com/path` · `https://example.com?x=1` · `*` · `https://*.example.com`.

### 4.4 Proposed repository interface (narrow slice — mirrors `KnowledgeRepositoryDb`)
```ts
// [PROPOSED] — design only. Exposes ONLY the webChatChannelBinding delegate —
// no customer / conversation / message / reply-draft access.
export interface ChannelsRepositoryDb {
  webChatChannelBinding: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<unknown>;   // by widgetKeyHash (ACTIVE) or [id, businessId]
    findMany(args: unknown): Promise<unknown[]>;    // businessId-scoped list
    update(args: unknown): Promise<unknown>;        // rotate / revoke
  };
}

export interface ChannelsRepository {
  createBinding(input): Promise<ActionResult<WebChatChannelBinding>>;
  listBindings(businessId): Promise<ActionResult<WebChatChannelBinding[]>>;
  findBindingById(id, businessId): Promise<ActionResult<WebChatChannelBinding | null>>;
  resolveActiveByKeyHash(widgetKeyHash): Promise<ActionResult<{ id; businessId } | null>>; // ACTIVE only, fail-closed
  rotateKey(id, businessId, newKeyHash, newLast4): Promise<ActionResult<WebChatChannelBinding>>;
  revokeBinding(id, businessId, revokedByUserId): Promise<ActionResult<WebChatChannelBinding>>;
}
```

### 4.5 Proposed service interface (illustrative)
```ts
// [PROPOSED] — design only.
export interface ChannelsService {
  createWebChatBinding(input): Promise<ActionResult<{ binding: WebChatChannelBinding; rawWidgetKey: string }>>;
  //                                                  ^ rawWidgetKey returned ONCE here; never persisted, never re-returned
  listWebChatBindings(businessId): Promise<ActionResult<WebChatChannelBinding[]>>;
  rotateWebChatBindingKey(id, businessId): Promise<ActionResult<{ binding; rawWidgetKey: string }>>;
  revokeWebChatBinding(id, businessId, actorUserId): Promise<ActionResult<WebChatChannelBinding>>;
}
export const CHANNELS_ERRORS = {
  BINDING_NOT_FOUND: 'CHANNELS_BINDING_NOT_FOUND',
  BINDING_REVOKED: 'CHANNELS_BINDING_REVOKED',
  INVALID_ORIGIN: 'CHANNELS_INVALID_ORIGIN',
} as const;
```

### 4.6 Implementation responsibilities (build phase)
- Generate a high-entropy raw widget key via an **injected key-generator**, compute a **keyed hash (HMAC-SHA-256 / server-side peppered hash) via an injected hasher**, persist **only** the hash + `widgetKeyLast4`, and return the raw key **once** to the caller (creation/rotation only).
- **Immediate rotation:** rotation replaces the stored hash so the **old key is invalid at once** — there is **no previous-key grace window** in alpha.
- Enforce ACTIVE-only, fail-closed resolution by key hash; revoke is terminal.
- Validate + **normalize origins to origin-only** (per §4.3); reject path/query/hash and wildcards; bound `allowedOrigins` size.
- Never log or expose the raw key, the `widgetKeyHash`, or the hash secret/pepper.
- Emit content-free audit events on create/rotate/revoke (see §5 / audit reuse).
- **No cross-domain DB reads.** **No message/customer/conversation storage inside Channels** (its README anti-pattern `[VERIFIED]`). Channels stores binding/config only; it never persists conversation content. (Consuming `conversations`/`crm` services to create anonymous conversations/messages is a **P12-C** concern, not P12-B.)

---

## 5. Authz Contract Proposal `[PROPOSED]`

Extends the verified flat-enum pattern: `AUTHZ_PERMISSION_VALUES` + `ROLE_PERMISSIONS` + `SENSITIVE_PERMISSIONS` `[VERIFIED]`.

### 5.1 New permission strings (added to `AUTHZ_PERMISSION_VALUES`)
- `channels.read`
- `channels.manage`

### 5.2 Role mapping (owner-confirmed)
| Role | `channels.read` | `channels.manage` |
| :---- | :----: | :----: |
| OWNER | ✅ | ✅ |
| ADMIN | ✅ | ✅ |
| OPERATOR | ❌ (not in initial alpha) | ❌ |
| VIEWER | ❌ (**must be denied**) | ❌ (**must be denied**) |

Rationale: widget keys + origin allowlists are **business configuration / security settings**, not day-to-day operator inbox work — so they sit with OWNER/ADMIN, consistent with how `settings.update` and `members.*` are role-gated. OPERATOR can run the inbox without managing widget keys; it can be granted `channels.read` later additively if a need appears.

### 5.3 Sensitive classification
- **`channels.manage` → sensitive / audit-required** (added to `SENSITIVE_PERMISSIONS`). It creates/rotates/revokes credentials and changes the origin allowlist — clearly audit-worthy, consistent with `settings.update` / `ai_drafts.send` / `members.*`. **Confirmed.**
- **`channels.read` sensitivity — recommendation:** **keep NON-sensitive for alpha.** Rationale: (a) the existing convention is that **no plain `.read` permission is in `SENSITIVE_PERMISSIONS`** `[VERIFIED]` (reads are not currently audited), so marking `channels.read` sensitive would be a one-off departure; (b) the read DTO **never exposes secret material** (no `widgetKeyHash`, no hash secret/pepper, no full key — §4.2), so a read leaks only `label`, `status`, `allowedOrigins`, and the display-safe `widgetKeyLast4`. The origin/config metadata it exposes is low-sensitivity config, already inside the tenant boundary and OWNER/ADMIN-gated. **Recommendation:** do **not** classify `channels.read` sensitive now, but (i) guarantee the read DTO excludes all secret/hash fields, and (ii) revisit elevating it to sensitive **if** origin/config later carries higher-sensitivity data (e.g., signing secrets) — documented here so the decision is explicit, not accidental.

### 5.4 Non-broadening guarantee
- The addition is **purely additive**: existing roles gain nothing else; OPERATOR/VIEWER permission sets are unchanged except that they must **not** receive the two new strings. A test must assert VIEWER (and OPERATOR, for alpha) are denied both.

---

## 6. Composition Root Proposal `[PROPOSED]`

Mirrors the verified narrow-slice pattern (`toKnowledgeRepositoryDb` returns only `{ businessContextItem: prisma.businessContextItem }`) `[VERIFIED]`. **No full Prisma client is injected into the domain.**

```ts
// [PROPOSED] — design only; NOT added to _shared/composition.ts in this phase.
/** Extracts only the delegates required by ChannelsRepositoryDb */
function toChannelsRepositoryDb(prisma: PrismaCompatibleClient): ChannelsRepositoryDb {
  return {
    webChatChannelBinding: prisma.webChatChannelBinding, // ONLY this delegate
  };
}

// ... in createApiDependencies():
const channelsRepository = createChannelsRepository(toChannelsRepositoryDb(prisma));
const channelsService = createChannelsService({
  repository: channelsRepository,
  audit: auditService,            // content-free audit on create/rotate/revoke
  // crypto/hash + key-gen deps injected (no env/secret read at module load)
});
```
- Exposed via `getApiDependencies()` (lazy singleton) + covered by `resetApiDependenciesForTests()` `[VERIFIED]` pattern.
- **No full Prisma client injection; no customer/conversation/message/reply-draft delegate in the channels slice.**

---

## 7. Migration Plan Proposal `[PROPOSED]`

Per `docs/engineering/production-migrations.md` `[VERIFIED]`. **No migration is written or applied in this phase.**

- **Additive-only:** one new table (`web_chat_channel_bindings`) + one new enum (`web_chat_channel_binding_status`) + one additive back-relation array on `Business`. **No change to any existing table/column** → no data transformation, no backfill, minimal-corruption risk.
- **Why L4 / high-risk:** any change to `prisma/schema.prisma` or `prisma/migrations/` is **L4** by policy `[VERIFIED]` — "code deploy is not complete until `prisma migrate deploy` has run successfully against the production database" and "production smoke is not complete until backend logs show zero Prisma schema/table errors." Schema history is effectively permanent.
- **Production command (build phase only):**
  ```bash
  npx prisma migrate deploy --schema prisma/schema.prisma   # prod Direct URL
  ```
  After the schema edit: `pnpm prisma:generate`. **Never** `migrate dev` / `db push` / `migrate reset` / destructive SQL in production `[VERIFIED]`.
- **Rollback strategy:** because the change is purely additive and **no consumer exists until P12-C**, rollback is safe while the table is empty/unconsumed:
  - Application kill-switch: a default-off feature flag (exact-`"true"` `ENABLE_*` pattern) keeps the channels surface inert even after the table lands.
  - Schema rollback (down): `DROP TABLE web_chat_channel_bindings; DROP TYPE web_chat_channel_binding_status;` plus removing the additive `Business` back-relation — performed only with the same migrate-deploy discipline and only while unconsumed.
  - Existing functionality is unaffected by either the forward or the rollback (no existing model is touched).
- **Smoke test expectations (build phase):** after deploy, backend logs show **zero** Prisma errors referencing `web_chat_channel_bindings` / the new enum; a create→list→revoke round-trip against staging succeeds; no other model regresses.

---

## 8. Test Plan Proposal `[PROPOSED]`

Required green before any P12-B **build** PR merges (mirrors the knowledge/crm fake-delegate + Area A/B isolation patterns).

| Test class | Proves |
| :---- | :---- |
| **Unit (types/validation)** | Status value set; Zod create/rotate/revoke schemas; **origin-only validation + normalization** (accepts `https://example.com`/`https://app.example.com`/`http://localhost:5173`; rejects path/query/hash, `*`, and `https://*.example.com`); bounds; `.strict()` rejects unknown fields; `businessId` not accepted from input. |
| **Repository tests** (Prisma-`where`-faithful fakes) | Every query filters `businessId`; create persists **keyed-hash only** (no plaintext column); `resolveActiveByKeyHash` returns ACTIVE match, **fails closed** for REVOKED/missing; cross-tenant `findBindingById` returns nothing; `@@unique([widgetKeyHash])` enforced; revoke is terminal; **rotation is immediate** — the rotated-away key hash no longer resolves (no grace window); rotation updates hash + `widgetKeyLast4` + `keyRotatedAt`. |
| **Service tests** | Raw key returned **once** on create/rotate and **never** re-returned/persisted; **hashing/key-gen deps injected** (not module-load); read DTO + audit + logs exclude `widgetKeyHash`, raw key, full key, and the **hash secret/pepper**; content-free audit emitted on create/rotate/revoke; error codes (`BINDING_NOT_FOUND`/`BINDING_REVOKED`/`INVALID_ORIGIN`). |
| **Authz tests** | `channels.read`/`channels.manage` present for OWNER/ADMIN; **VIEWER denied both**; **OPERATOR denied both** (alpha); `channels.manage` in `SENSITIVE_PERMISSIONS`; no existing role broadened. |
| **Composition / typecheck** | `getApiDependencies()` wires channels via the **narrow** slice (only `webChatChannelBinding`); `resetApiDependenciesForTests()` covers it; no full Prisma client leak. |
| **Real-DB tenant-isolation** (gated `RUN_INTEGRATION_TESTS`) | Against real Postgres: a binding/key for business A never resolves to or lists under business B; revoked never resolves; parity with Area A/B isolation gates. |
| **No-go guard tests** (Area B guard style) | Channels source has **no** public route, **no** provider SDK import, **no** send/dispatch/deliver path, **no** AI import, and **no** `db.customer`/`db.conversation`/`db.message`/`db.replyDraft` access; widget key, hash, and hash secret/pepper never logged/echoed in clear. |
| **Merge gate** | `pnpm lint && typecheck && build && test` + clean `git status --short`; for the schema PR: migration plan + prod smoke. |

---

## 9. Explicit Non-Goals

This design contract and the P12-B phase explicitly **exclude** (and do not authorize):

- ❌ **No public ingest route** (P12-C, separately approved).
- ❌ **No widget** / embeddable client (P12-D).
- ❌ **No customer-facing API.**
- ❌ **No external provider** integration / no provider SDK.
- ❌ **No AI prompt ingestion** (customer-message-in-prompt remains STOP, Area B).
- ❌ **No auto-send** (the only outbound path remains the human-gated P11 operator send).
- ❌ **No real-time transport.**
- ❌ **No billing.**
- ❌ **No MCP** / third-party integrations.
- ❌ **No code** changes (`src/**` untouched).
- ❌ **No Prisma schema edit** (`prisma/schema.prisma` untouched).
- ❌ **No migration** files.
- ❌ **No Channels domain implementation.**
- ❌ No consumption of `conversations`/`crm` services (that is P12-C ingest).
- ❌ No env/secret/API-key handling.

---

## 10. Recommendation & Decision Required

**Recommendation:** accept this design contract as the frozen spec for the Area C Channels foundation. If approved, the next phase — the **schema + `channels` domain build** — should be a **single dedicated L4 PR** (schema model/enum + migration + the `channels` domain files + the two authz permissions + composition wiring + the §8 tests), carrying its own migration plan, rollback, and prod smoke. It must be **separately, explicitly approved**; this document does not authorize it.

**Decisions required from owner:**
1. Accept / revise this schema/domain/authz/composition/migration/test contract.
2. Confirm the `channels.read` sensitivity recommendation (§5.3: keep non-sensitive for alpha, with the read DTO excluding all secret/hash fields).
3. Confirm whether the later build lands as one combined schema+domain PR or splits schema (L4) from domain — recommendation: **one combined PR** (the migration with no consumer is dead schema otherwise), gated by approval.

**Status after this document: Area C remains STOP-for-approval. No implementation is authorized. This document grants no authority.**

---

*Area C P12-B design contract authored 2026-06-30 against `main` @ `42988b6`. Documentation-only; PRD-v1.1, `prisma/schema.prisma`, `src/**`, tests, and CI unchanged. Subordinate to PRD-v1.1 (LOCKED), `CLAUDE.md`, and the P12-A audit; on any conflict those win.*
