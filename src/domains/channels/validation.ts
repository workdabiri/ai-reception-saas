// ===========================================================================
// Channels Domain — Validation
//
// Zod schemas for web-chat channel binding operations (Area C, P12-B).
//
// ORIGIN RULES (P12-B §4.3): `allowedOrigins` holds ORIGIN-ONLY values
// (scheme + host + optional non-default port). `z.string().url()` is NOT
// sufficient — it accepts full URLs with path/query/hash. Origins are validated
// and normalized via `normalizeWebChatOrigin`, not `.url()`. No wildcards in
// alpha (`*`, `https://*.example.com` are rejected).
// ===========================================================================

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export const MAX_BINDING_LABEL_LENGTH = 120;
export const MAX_ALLOWED_ORIGINS = 20;
export const MAX_ORIGIN_LENGTH = 255;

// ---------------------------------------------------------------------------
// Origin normalization (origin-only; scheme + host + optional port)
// ---------------------------------------------------------------------------

/**
 * Normalizes a single allowlist entry to an ORIGIN-ONLY value, or returns
 * `null` when the input is not a valid bare origin.
 *
 * Accepts:  https://example.com · https://app.example.com · http://localhost:5173
 * Rejects:  https://example.com/path · https://example.com?x=1 ·
 *           https://example.com#h · '*' · https://*.example.com · bare hosts
 *
 * Normalization: lowercases scheme + host, strips default ports (80/443) and
 * any trailing slash, and rejects anything carrying a path/query/fragment,
 * userinfo, or a wildcard.
 */
export function normalizeWebChatOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ORIGIN_LENGTH) return null;

  // No wildcards in alpha.
  if (trimmed.includes('*')) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  // Only http/https origins.
  const scheme = url.protocol.toLowerCase();
  if (scheme !== 'http:' && scheme !== 'https:') return null;

  // No userinfo (user:pass@host).
  if (url.username !== '' || url.password !== '') return null;

  // Origin-only: no path beyond root, no query, no fragment.
  if (url.pathname !== '' && url.pathname !== '/') return null;
  if (url.search !== '' || url.hash !== '') return null;

  // A host is required (rejects e.g. "http:///").
  const host = url.hostname.toLowerCase();
  if (host === '') return null;

  // Strip default ports; keep explicit non-default ports.
  const isDefaultPort =
    url.port === '' ||
    (scheme === 'http:' && url.port === '80') ||
    (scheme === 'https:' && url.port === '443');
  const portSuffix = isDefaultPort ? '' : `:${url.port}`;

  return `${scheme}//${host}${portSuffix}`;
}

/** Zod schema for a single origin-only allowlist entry (normalized on parse). */
export const webChatOriginSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_ORIGIN_LENGTH)
  .superRefine((value, ctx) => {
    if (normalizeWebChatOrigin(value) === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Invalid origin: must be an origin-only value (scheme + host + optional port), no path/query/hash, no wildcards',
      });
    }
  })
  .transform((value) => normalizeWebChatOrigin(value) as string);

// ---------------------------------------------------------------------------
// Operation schemas
// ---------------------------------------------------------------------------

/**
 * The PUBLIC create body the future route would parse — the client allowlist.
 * `.strict()` rejects unknown fields (not ignore). `businessId` is intentionally
 * NOT here — it is the server-resolved tenant id, never client-supplied.
 */
export const createWebChatBindingBodySchema = z
  .object({
    label: z.string().trim().min(1).max(MAX_BINDING_LABEL_LENGTH),
    allowedOrigins: z.array(webChatOriginSchema).min(1).max(MAX_ALLOWED_ORIGINS),
  })
  .strict();

export type CreateWebChatBindingBody = z.infer<
  typeof createWebChatBindingBodySchema
>;

/** Service-level create input: server-constructed (businessId from tenant ctx). */
export const createWebChatBindingServiceSchema = z.object({
  businessId: z.string().uuid(),
  label: z.string().trim().min(1).max(MAX_BINDING_LABEL_LENGTH),
  allowedOrigins: z.array(webChatOriginSchema).min(1).max(MAX_ALLOWED_ORIGINS),
  createdByUserId: z.string().uuid().nullish(),
});

export const listWebChatBindingsSchema = z.object({
  businessId: z.string().uuid(),
  limit: z.number().int().positive().optional(),
});

export const findWebChatBindingSchema = z.object({
  businessId: z.string().uuid(),
  bindingId: z.string().uuid(),
});

export const rotateWebChatBindingKeySchema = z.object({
  businessId: z.string().uuid(),
  bindingId: z.string().uuid(),
});

export const revokeWebChatBindingSchema = z.object({
  businessId: z.string().uuid(),
  bindingId: z.string().uuid(),
  revokedByUserId: z.string().uuid(),
});
