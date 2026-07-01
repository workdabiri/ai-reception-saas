// ===========================================================================
// Channels Domain — Types
//
// Domain-level type definitions for the web-chat channel binding (Area C,
// P12-B). These mirror the Prisma `WebChatChannelBinding` model but are
// decoupled from it.
//
// SECURITY INVARIANTS (P12-B §3):
//  - The read DTO (`WebChatChannelBinding`) NEVER carries the widget key hash,
//    the raw widget key, the hash secret/pepper, or the full key. It exposes
//    only the display-safe `widgetKeyLast4` preview.
//  - Key generation and hashing are INJECTED dependencies — this module reads
//    no env/secret and performs no crypto at module load.
//
// This module defines data shapes only — it stores nothing, calls no provider,
// and has no send/delivery path (Channels README anti-pattern).
// ===========================================================================

// ---------------------------------------------------------------------------
// Status enum
// ---------------------------------------------------------------------------

/**
 * Lifecycle of a web-chat channel binding.
 *
 * - ACTIVE  = the binding resolves; its widget key may identify the business.
 * - REVOKED = TERMINAL; a revoked binding never resolves again (fail closed).
 */
export const WEB_CHAT_CHANNEL_BINDING_STATUS_VALUES = [
  'ACTIVE',
  'REVOKED',
] as const;

/** Web-chat channel binding lifecycle status */
export type WebChatChannelBindingStatusValue =
  (typeof WEB_CHAT_CHANNEL_BINDING_STATUS_VALUES)[number];

/** Default status for a newly created binding. */
export const DEFAULT_WEB_CHAT_CHANNEL_BINDING_STATUS: WebChatChannelBindingStatusValue =
  'ACTIVE';

/** Type guard for a valid WebChatChannelBindingStatus value */
export function isWebChatChannelBindingStatus(
  value: unknown,
): value is WebChatChannelBindingStatusValue {
  return (
    typeof value === 'string' &&
    (WEB_CHAT_CHANNEL_BINDING_STATUS_VALUES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Domain entity (read DTO)
// ---------------------------------------------------------------------------

/**
 * Domain representation of a web-chat channel binding.
 *
 * SECURITY: this read DTO deliberately has NO `widgetKeyHash`, no raw widget
 * key, and no hash secret/pepper. `widgetKeyLast4` is a display-safe preview
 * only. Dates are serialized as ISO strings at the repository boundary.
 */
export interface WebChatChannelBinding {
  id: string;
  businessId: string;
  label: string;
  status: WebChatChannelBindingStatusValue;
  /** Display-safe suffix of the raw key; never the full key or the hash. */
  widgetKeyLast4: string;
  allowedOrigins: string[];
  keyRotatedAt: string | null;
  revokedAt: string | null;
  revokedByUserId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Inputs (businessId is ALWAYS the server-resolved tenant id, never client body)
// ---------------------------------------------------------------------------

/** Input for creating a web-chat channel binding. */
export interface CreateWebChatBindingInput {
  businessId: string;
  label: string;
  /** Origin-only, normalized values; validated + normalized by the service. */
  allowedOrigins: string[];
  createdByUserId?: string | null;
}

/** Input for listing a business's web-chat channel bindings. */
export interface ListWebChatBindingsInput {
  businessId: string;
  limit?: number;
}

/** Input for fetching a single binding by id, scoped by businessId. */
export interface FindWebChatBindingInput {
  businessId: string;
  bindingId: string;
}

/**
 * Input for rotating a binding's widget key. Rotation is IMMEDIATE — the old
 * key is invalid at once (no previous-key grace window in alpha).
 */
export interface RotateWebChatBindingKeyInput {
  businessId: string;
  bindingId: string;
}

/** Input for revoking a binding (ACTIVE → REVOKED, terminal). */
export interface RevokeWebChatBindingInput {
  businessId: string;
  bindingId: string;
  revokedByUserId: string;
}

// ---------------------------------------------------------------------------
// Injected crypto dependencies (no env/secret read at module load)
// ---------------------------------------------------------------------------

/** A freshly generated widget key plus its display-safe preview. */
export interface GeneratedWidgetKey {
  /** Opaque, high-entropy raw key — returned to the caller exactly ONCE. */
  rawKey: string;
  /** Display-safe suffix persisted as `widgetKeyLast4`. */
  last4: string;
}

/** Generates opaque, high-entropy widget keys. Injected for testability. */
export interface WidgetKeyGenerator {
  generate(): GeneratedWidgetKey;
}

/**
 * Hashes a raw widget key into the at-rest keyed hash (HMAC-SHA-256 /
 * server-side peppered hash). Injected so the domain reads no secret/pepper and
 * the production default can fail closed when unconfigured.
 */
export interface WidgetKeyHasher {
  hash(rawKey: string): string;
}

// ---------------------------------------------------------------------------
// Create/rotate result (raw key surfaced ONCE)
// ---------------------------------------------------------------------------

/**
 * The result of a create/rotate operation. `rawWidgetKey` is returned to the
 * caller EXACTLY ONCE here and is never persisted, re-returned, or logged.
 */
export interface WebChatBindingWithRawKey {
  binding: WebChatChannelBinding;
  rawWidgetKey: string;
}
