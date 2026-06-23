// ===========================================================================
// Local-Development CORS Rules (DEV-ONLY) — next.config headers()
//
// Produces the `next.config.ts` `headers()` rules that let the companion local
// Vite frontend call this backend cross-origin during LOCAL smoke testing.
//
// Why this is config, not middleware
// ----------------------------------
// This repo deliberately has NO Next.js middleware — auth/tenant context is
// resolved per route handler, and a `middleware.ts` is forbidden by scope-guard
// tests. CORS is therefore expressed as next.config response headers (the
// Next-blessed non-middleware mechanism), which does NOT centralize auth and
// leaves the per-route auth path untouched.
//
// Why it is needed
// ----------------
// Production is SAME-ORIGIN: the frontend's vercel.json rewrites /api/* to this
// backend, so CORS never applies there. LOCAL smoke testing runs the frontend on
// http://localhost:5173 and this backend on http://localhost:3000 — cross-origin
// — so the browser issues a CORS preflight for credentialed/custom-header
// requests (e.g. the dev-only x-dev-* auth headers) that the backend must answer.
//
// SAFETY
// ------
//   - Fail-closed: returns NO rules in a real-data environment (the existing
//     `isRealDataEnvironment` signal), so production gains ZERO CORS surface.
//   - The `has` matcher reflects ONLY localhost / 127.0.0.1 origins back into
//     Access-Control-Allow-Origin (a wildcard is invalid with credentials, and
//     non-local origins simply do not match → no CORS headers).
//   - Adds NO authentication and changes NO authorization — the dev-header /
//     Auth.js adapters and RBAC still run exactly as before.
// ===========================================================================

import { isRealDataEnvironment } from './dev-bypass-guard';

/** Request methods the local frontend's API client uses. */
const ALLOWED_METHODS = 'GET, POST, PATCH, OPTIONS';

/**
 * Request headers the local frontend may send: the dev-header auth contract
 * (x-dev-*) plus the standard JSON headers and scope/request ids.
 */
const ALLOWED_HEADERS = [
  'content-type',
  'accept',
  'x-request-id',
  'x-business-id',
  'x-dev-user-id',
  'x-dev-business-id',
  'x-dev-membership-id',
  'x-dev-role',
  'x-dev-system',
].join(', ');

/** How long (seconds) a browser may cache the preflight result. */
const MAX_AGE = '600';

/**
 * next.config `has` regex matching http(s)://localhost:<port> or
 * http(s)://127.0.0.1:<port>, capturing the whole origin as the named group
 * `origin` so it can be reflected back into Access-Control-Allow-Origin
 * (required because credentials forbid a `*` wildcard).
 */
export const LOCAL_ORIGIN_HAS_REGEX =
  '(?<origin>https?://(?:localhost|127\\.0\\.0\\.1)(?::\\d+)?)';

/** Structural shape of a next.config headers() rule (avoids importing next types here). */
export interface DevCorsHeaderRule {
  source: string;
  has: Array<{ type: 'header'; key: string; value: string }>;
  headers: Array<{ key: string; value: string }>;
}

/**
 * Returns the next.config headers() rules for local-dev CORS.
 *
 * Empty (no CORS) in a real-data environment; otherwise a single rule scoped to
 * /api/:path* that reflects a localhost Origin with credentials enabled.
 */
export function devCorsHeaderRules(
  env: Record<string, string | undefined> = process.env,
): DevCorsHeaderRule[] {
  // Fail-closed: never emit any CORS surface in a real-data / production env.
  if (isRealDataEnvironment(env)) return [];

  return [
    {
      source: '/api/:path*',
      has: [{ type: 'header', key: 'origin', value: LOCAL_ORIGIN_HAS_REGEX }],
      headers: [
        // Reflect the matched localhost origin (never a wildcard with credentials).
        { key: 'Access-Control-Allow-Origin', value: ':origin' },
        { key: 'Access-Control-Allow-Credentials', value: 'true' },
        { key: 'Access-Control-Allow-Methods', value: ALLOWED_METHODS },
        { key: 'Access-Control-Allow-Headers', value: ALLOWED_HEADERS },
        { key: 'Access-Control-Max-Age', value: MAX_AGE },
        { key: 'Vary', value: 'Origin' },
      ],
    },
  ];
}
