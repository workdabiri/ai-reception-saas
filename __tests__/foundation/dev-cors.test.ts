// ===========================================================================
// Tests — Local-Development CORS Rules (DEV-ONLY)
//
// Verifies the pure devCorsHeaderRules() helper that backs the next.config
// headers() CORS for local smoke testing:
//   * real-data env                -> NO rules (fail-closed; zero prod surface)
//   * non-real-data env            -> one /api/:path* rule
//   * credentialed + origin-reflecting (never a wildcard)
//   * x-dev-* auth headers + JSON headers allowed
//   * localhost origin regex matches local origins only
//
// Pure logic — no Next runtime, no DB, no server.
// ===========================================================================

import { describe, it, expect } from 'vitest';

import {
  devCorsHeaderRules,
  LOCAL_ORIGIN_HAS_REGEX,
} from '@/lib/security/dev-cors';

type Env = Record<string, string | undefined>;

const DEV_ENV: Env = { NODE_ENV: 'development' };

/** Reads a header value from a rule's headers array. */
function headerValue(
  rule: { headers: Array<{ key: string; value: string }> },
  key: string,
): string | undefined {
  return rule.headers.find((h) => h.key === key)?.value;
}

// ---------------------------------------------------------------------------
// Fail-closed: real-data environments get no CORS
// ---------------------------------------------------------------------------

describe('devCorsHeaderRules — fail-closed in real-data envs', () => {
  it('returns no rules when NODE_ENV=production', () => {
    expect(devCorsHeaderRules({ NODE_ENV: 'production' })).toEqual([]);
  });

  it('returns no rules in a deployed Vercel env (production/preview)', () => {
    expect(devCorsHeaderRules({ VERCEL_ENV: 'production' })).toEqual([]);
    expect(devCorsHeaderRules({ VERCEL_ENV: 'preview' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Local dev: one scoped, credentialed, origin-reflecting rule
// ---------------------------------------------------------------------------

describe('devCorsHeaderRules — local dev', () => {
  it('returns a single rule scoped to /api/:path* for non-real-data envs', () => {
    const rules = devCorsHeaderRules(DEV_ENV);
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('/api/:path*');
  });

  it('also applies for an unset env (treated as non-real-data)', () => {
    expect(devCorsHeaderRules({})).toHaveLength(1);
  });

  it('reflects the origin with credentials (never a wildcard)', () => {
    const rule = devCorsHeaderRules(DEV_ENV)[0];
    // Reflects the matched origin via the named capture group, not "*".
    expect(headerValue(rule, 'Access-Control-Allow-Origin')).toBe(':origin');
    expect(headerValue(rule, 'Access-Control-Allow-Origin')).not.toBe('*');
    expect(headerValue(rule, 'Access-Control-Allow-Credentials')).toBe('true');
    expect(headerValue(rule, 'Vary')).toBe('Origin');
  });

  it('gates the rule on a localhost Origin header via `has`', () => {
    const rule = devCorsHeaderRules(DEV_ENV)[0];
    expect(rule.has).toHaveLength(1);
    expect(rule.has[0]).toMatchObject({ type: 'header', key: 'origin' });
    expect(rule.has[0].value).toBe(LOCAL_ORIGIN_HAS_REGEX);
  });

  it('allows the dev-header auth contract and JSON headers', () => {
    const rule = devCorsHeaderRules(DEV_ENV)[0];
    const allowed = headerValue(rule, 'Access-Control-Allow-Headers') ?? '';
    for (const h of [
      'x-dev-user-id',
      'x-dev-business-id',
      'x-dev-membership-id',
      'x-dev-role',
      'content-type',
    ]) {
      expect(allowed).toContain(h);
    }
  });

  it('allows the methods the frontend API client uses', () => {
    const rule = devCorsHeaderRules(DEV_ENV)[0];
    const methods = headerValue(rule, 'Access-Control-Allow-Methods') ?? '';
    for (const m of ['GET', 'POST', 'PATCH', 'OPTIONS']) {
      expect(methods).toContain(m);
    }
  });
});

// ---------------------------------------------------------------------------
// Origin regex: matches localhost only
// ---------------------------------------------------------------------------

describe('LOCAL_ORIGIN_HAS_REGEX', () => {
  const re = new RegExp(`^${LOCAL_ORIGIN_HAS_REGEX}$`);

  it('matches localhost / 127.0.0.1 origins on any port', () => {
    expect(re.test('http://localhost:5173')).toBe(true);
    expect(re.test('http://localhost:5199')).toBe(true);
    expect(re.test('http://127.0.0.1:3000')).toBe(true);
    expect(re.test('https://localhost:5173')).toBe(true);
  });

  it('does not match deployed or look-alike origins', () => {
    expect(re.test('https://evil.example.com')).toBe(false);
    expect(re.test('https://localhost.evil.com')).toBe(false);
    expect(re.test('http://notlocalhost:5173')).toBe(false);
  });
});
