// ===========================================================================
// Security — Default Widget-Key Crypto (Area C, P12-B)
//
// Production-default implementations of the Channels domain's injected
// `WidgetKeyGenerator` / `WidgetKeyHasher`. These live OUTSIDE the channels
// domain so the domain itself reads no env/secret and performs no crypto at
// module load. They are wired in the composition root.
//
// SECURITY:
//  - The hasher reads the server-side pepper at HASH-CALL time (never at module
//    load) and FAILS CLOSED if it is unconfigured — so a binding can never be
//    created with an unprotected key in a misconfigured environment.
//  - No route invokes this in production in this PR (no public ingest / no
//    binding-management route is wired yet). It exists so the composition root
//    has honest, fail-closed production defaults.
//  - The raw key, the pepper, and the hash must never be logged.
// ===========================================================================

import { createHmac, randomBytes } from 'node:crypto';

import type {
  GeneratedWidgetKey,
  WidgetKeyGenerator,
  WidgetKeyHasher,
} from '@/domains/channels';

/** Env var holding the server-side HMAC pepper for widget-key hashing. */
export const WIDGET_KEY_PEPPER_ENV = 'WIDGET_KEY_PEPPER';

/** Raw-key entropy (bytes) before base64url encoding. */
const RAW_KEY_BYTES = 32;

/**
 * Default widget-key generator: a high-entropy, opaque, URL-safe token.
 * The last 4 characters are surfaced as the display-safe preview.
 */
export function createDefaultWidgetKeyGenerator(): WidgetKeyGenerator {
  return {
    generate(): GeneratedWidgetKey {
      const rawKey = randomBytes(RAW_KEY_BYTES).toString('base64url');
      const last4 = rawKey.slice(-4);
      return { rawKey, last4 };
    },
  };
}

/**
 * Default widget-key hasher: HMAC-SHA-256 keyed by a server-side pepper read at
 * call time. FAILS CLOSED (throws) when the pepper is unconfigured so no binding
 * can be created with an unprotected key. The caller (Channels service) maps the
 * throw to a clean `CHANNELS_KEY_GENERATION_FAILED` result.
 */
export function createDefaultWidgetKeyHasher(): WidgetKeyHasher {
  return {
    hash(rawKey: string): string {
      const pepper = process.env[WIDGET_KEY_PEPPER_ENV];
      if (!pepper) {
        throw new Error(
          `${WIDGET_KEY_PEPPER_ENV} is not configured — refusing to hash a widget key (fail closed)`,
        );
      }
      return createHmac('sha256', pepper).update(rawKey).digest('hex');
    },
  };
}
