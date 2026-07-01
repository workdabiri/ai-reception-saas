// ===========================================================================
// Tests — Channels: Types + Validation (Area C, P12-B)
//
// Covers the status value set, origin-only normalization (the security-critical
// rule that `.url()` is NOT used), label/array bounds, `.strict()` rejection of
// unknown fields, and that `businessId` is never accepted from the public body.
// ===========================================================================

import { describe, it, expect } from 'vitest';

import {
  WEB_CHAT_CHANNEL_BINDING_STATUS_VALUES,
  DEFAULT_WEB_CHAT_CHANNEL_BINDING_STATUS,
  isWebChatChannelBindingStatus,
  normalizeWebChatOrigin,
  webChatOriginSchema,
  createWebChatBindingBodySchema,
  createWebChatBindingServiceSchema,
  rotateWebChatBindingKeySchema,
  revokeWebChatBindingSchema,
  MAX_BINDING_LABEL_LENGTH,
  MAX_ALLOWED_ORIGINS,
} from '@/domains/channels';

const BIZ = '11111111-1111-4111-8111-111111111111';
const BINDING = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

describe('channels status values', () => {
  it('is exactly ACTIVE / REVOKED', () => {
    expect([...WEB_CHAT_CHANNEL_BINDING_STATUS_VALUES]).toEqual([
      'ACTIVE',
      'REVOKED',
    ]);
  });

  it('default status is ACTIVE', () => {
    expect(DEFAULT_WEB_CHAT_CHANNEL_BINDING_STATUS).toBe('ACTIVE');
  });

  it('type guard accepts known values and rejects others', () => {
    expect(isWebChatChannelBindingStatus('ACTIVE')).toBe(true);
    expect(isWebChatChannelBindingStatus('REVOKED')).toBe(true);
    expect(isWebChatChannelBindingStatus('SENT')).toBe(false);
    expect(isWebChatChannelBindingStatus(null)).toBe(false);
  });
});

describe('normalizeWebChatOrigin', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['https://app.example.com', 'https://app.example.com'],
    ['http://localhost:5173', 'http://localhost:5173'],
    // Normalization: lowercase + strip default port + strip trailing slash.
    ['HTTPS://Example.COM', 'https://example.com'],
    ['https://example.com:443', 'https://example.com'],
    ['http://example.com:80', 'http://example.com'],
    ['https://example.com/', 'https://example.com'],
    ['  https://example.com  ', 'https://example.com'],
  ])('accepts + normalizes %s -> %s', (input, expected) => {
    expect(normalizeWebChatOrigin(input)).toBe(expected);
  });

  it.each([
    'https://example.com/path',
    'https://example.com?x=1',
    'https://example.com#frag',
    '*',
    'https://*.example.com',
    'example.com', // bare host, no scheme
    'ftp://example.com', // non-http(s) scheme
    'https://user:pass@example.com', // userinfo
    '',
    '   ',
  ])('rejects %s', (input) => {
    expect(normalizeWebChatOrigin(input)).toBeNull();
  });

  it('rejects an over-long origin', () => {
    expect(normalizeWebChatOrigin(`https://${'a'.repeat(300)}.com`)).toBeNull();
  });
});

describe('webChatOriginSchema', () => {
  it('parses and normalizes a valid origin', () => {
    const parsed = webChatOriginSchema.safeParse('HTTPS://App.Example.com:443');
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe('https://app.example.com');
  });

  it('fails a path-bearing URL (proves .url() is not used)', () => {
    expect(webChatOriginSchema.safeParse('https://example.com/embed').success).toBe(
      false,
    );
  });
});

describe('createWebChatBindingBodySchema (public allowlist)', () => {
  it('accepts a valid body and normalizes origins', () => {
    const parsed = createWebChatBindingBodySchema.safeParse({
      label: 'Main site widget',
      allowedOrigins: ['https://example.com/', 'HTTP://localhost:5173'],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.allowedOrigins).toEqual([
        'https://example.com',
        'http://localhost:5173',
      ]);
    }
  });

  it('rejects unknown fields via .strict()', () => {
    const parsed = createWebChatBindingBodySchema.safeParse({
      label: 'x',
      allowedOrigins: ['https://example.com'],
      extra: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('NEVER accepts businessId from the body', () => {
    const parsed = createWebChatBindingBodySchema.safeParse({
      label: 'x',
      allowedOrigins: ['https://example.com'],
      businessId: BIZ,
    });
    // businessId is an unknown field for the strict body schema → rejected.
    expect(parsed.success).toBe(false);
  });

  it('rejects an empty / over-long label', () => {
    expect(
      createWebChatBindingBodySchema.safeParse({
        label: '',
        allowedOrigins: ['https://example.com'],
      }).success,
    ).toBe(false);
    expect(
      createWebChatBindingBodySchema.safeParse({
        label: 'a'.repeat(MAX_BINDING_LABEL_LENGTH + 1),
        allowedOrigins: ['https://example.com'],
      }).success,
    ).toBe(false);
  });

  it('rejects empty or over-large origin arrays', () => {
    expect(
      createWebChatBindingBodySchema.safeParse({ label: 'x', allowedOrigins: [] })
        .success,
    ).toBe(false);
    expect(
      createWebChatBindingBodySchema.safeParse({
        label: 'x',
        allowedOrigins: Array.from(
          { length: MAX_ALLOWED_ORIGINS + 1 },
          (_, i) => `https://h${i}.example.com`,
        ),
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid origin inside the array', () => {
    expect(
      createWebChatBindingBodySchema.safeParse({
        label: 'x',
        allowedOrigins: ['https://example.com', 'https://*.evil.com'],
      }).success,
    ).toBe(false);
  });
});

describe('service-level schemas', () => {
  it('createWebChatBindingServiceSchema requires a uuid businessId', () => {
    expect(
      createWebChatBindingServiceSchema.safeParse({
        businessId: 'not-a-uuid',
        label: 'x',
        allowedOrigins: ['https://example.com'],
      }).success,
    ).toBe(false);
    expect(
      createWebChatBindingServiceSchema.safeParse({
        businessId: BIZ,
        label: 'x',
        allowedOrigins: ['https://example.com'],
      }).success,
    ).toBe(true);
  });

  it('rotate/revoke schemas require uuid scope ids', () => {
    expect(
      rotateWebChatBindingKeySchema.safeParse({
        businessId: BIZ,
        bindingId: BINDING,
      }).success,
    ).toBe(true);
    expect(
      revokeWebChatBindingSchema.safeParse({
        businessId: BIZ,
        bindingId: BINDING,
        revokedByUserId: USER,
      }).success,
    ).toBe(true);
    expect(
      revokeWebChatBindingSchema.safeParse({
        businessId: BIZ,
        bindingId: BINDING,
      }).success,
    ).toBe(false);
  });
});
