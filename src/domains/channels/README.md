# Channels Domain

**Owner:** Channels module
**Responsibility:** WhatsApp/email/SMS/webhook/channel foundations, inbound event ingestion, outbound delivery abstraction, integration logs, provider adapter contracts, provider registry, Level A vs Level B channel capabilities.

The first implemented capability (Area C, P12-B) is the **web-chat channel binding**: a tenant-scoped mapping from a public, opaque widget key to exactly one business, so an embeddable web-chat widget can later identify which tenant an anonymous visitor is contacting. The public ingest route and the widget are **not** part of this domain's current scope (P12-C / P12-D, separately approved).

## Owns

- Channel definitions and configurations
- **Web-chat channel bindings** (`web_chat_channel_bindings`): widget-key → business mapping, keyed-hash key material, origin allowlist, rotation/revocation lifecycle
- Inbound event ingestion pipeline (future)
- Outbound delivery abstraction (future)
- Provider adapter contracts and registry (future)
- Integration logs (future)

## Dependencies

- Identity, Tenancy
- Audit (content-free events on binding create/rotate/revoke)

## Key Rules

- **`businessId` is server-derived.** Every query is scoped by the server-resolved tenant id; `resolveActiveByKeyHash` is the only query not pre-scoped (the binding yields the `businessId`) — it is ACTIVE-only and fails closed.
- **Widget key plaintext is never stored.** Only a keyed hash (HMAC-SHA-256 / server-side peppered hash) is persisted; the raw key is returned **exactly once** at create/rotation and never read back. `widgetKeyLast4` is a display-safe preview only — never the full key or the hash.
- **Key generation + hashing are injected dependencies.** The domain reads no env/secret and performs no crypto at module load. The production default hasher fails closed when the pepper is unconfigured.
- **Rotation is immediate.** Rotating replaces the stored hash so the old key is invalid at once — there is no previous-key column and no grace window in alpha.
- **Revocation is terminal.** `ACTIVE → REVOKED` cannot be undone; a revoked binding never resolves and cannot be rotated.
- **Origins are origin-only.** `allowedOrigins` holds normalized scheme+host(+port) values — no path/query/hash, no wildcards (alpha).

## Anti-Patterns

- ❌ Do NOT put message storage here — that belongs in **Conversations**
- ❌ Do NOT put AI inference here — that belongs in **AI Runtime**
- ❌ Do NOT hardcode provider logic — use the adapter pattern
- ❌ Do NOT expose or log the raw widget key, the full key, the `widgetKeyHash`, or the hash secret/pepper
- ❌ Do NOT add a public ingest route, a send/delivery path, or any provider/AI call here (P12-C+ only, separately approved)
