// ===========================================================================
// Tests — AI Runtime: Provider Boundary + Deterministic Fake Provider (B-R4)
//
// Proves the provider seam and the deterministic fake provider:
//  - the fake exposes providerId/modelId and implements AiProvider
//  - a valid REPLY_DRAFT request returns an ok result
//  - same input -> same output (text, usage, requestId)
//  - the output NEVER echoes the prompt / customer content
//  - usage is deterministic and internally consistent
//  - createdAt is deterministic when a clock is injected
//  - invalid / empty / non-UUID businessId fails closed
//  - empty prompt fails closed
//  - unsupported operation fails closed
//  - oversized prompt fails closed
//  - generation performs no network request (fetch is never invoked)
//
// And STATIC SCOPE GUARDS proving B-R4 added no real provider SDK, no network
// call, no env/secret/API-key path, no prompt builder, no customer/
// conversation/message path, no auto-send path, and no new package dependency.
// ===========================================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createFakeAiProvider,
  DEFAULT_FAKE_PROVIDER_ID,
  DEFAULT_FAKE_MODEL_ID,
  FAKE_AI_PROVIDER_MAX_PROMPT_CHARS,
  FAKE_AI_PROVIDER_RESPONSE_PREFIX,
  MAX_METADATA_KEYS,
  MAX_METADATA_KEY_CHARS,
  MAX_METADATA_VALUE_CHARS,
  AI_PROVIDER_OPERATION_VALUES,
  AI_PROVIDER_ERROR_CODES,
  AI_PROVIDER_FINISH_REASON_VALUES,
  type AiProvider,
  type AiProviderGenerateTextRequest,
} from '@/domains/ai-runtime';

// ---------------------------------------------------------------------------
// Constants / fixtures
// ---------------------------------------------------------------------------

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';
const FIXED_NOW = new Date('2026-06-16T08:30:00.000Z');

const RESPONSE_RE = new RegExp(
  `^\\[${FAKE_AI_PROVIDER_RESPONSE_PREFIX}:[0-9a-f]{16}\\]$`,
);

function makeProvider(now: () => Date = () => FIXED_NOW): AiProvider {
  return createFakeAiProvider({ now });
}

function validRequest(
  overrides: Partial<AiProviderGenerateTextRequest> = {},
): AiProviderGenerateTextRequest {
  return {
    operation: 'REPLY_DRAFT',
    businessId: BIZ_A,
    prompt: 'Caller-supplied prompt placeholder for the B-R4 provider seam.',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// Error-code / operation surface
// ===========================================================================

describe('AI Provider — code surface', () => {
  it('exposes exactly the expected provider error codes', () => {
    expect([...AI_PROVIDER_ERROR_CODES]).toEqual([
      'AI_PROVIDER_INVALID_REQUEST',
      'AI_PROVIDER_UNSUPPORTED_OPERATION',
      'AI_PROVIDER_INVALID_BUSINESS_ID',
      'AI_PROVIDER_INVALID_PROMPT',
      'AI_PROVIDER_PROMPT_TOO_LARGE',
    ]);
  });

  it('supports only the REPLY_DRAFT operation', () => {
    expect([...AI_PROVIDER_OPERATION_VALUES]).toEqual(['REPLY_DRAFT']);
  });

  it('exposes a vendor-neutral finish-reason set including STOP', () => {
    expect([...AI_PROVIDER_FINISH_REASON_VALUES]).toContain('STOP');
  });
});

// ===========================================================================
// Provider identity / interface shape
// ===========================================================================

describe('AI Provider — fake provider identity', () => {
  it('exposes non-empty providerId and modelId (defaults)', () => {
    const provider = makeProvider();
    expect(provider.providerId).toBe(DEFAULT_FAKE_PROVIDER_ID);
    expect(provider.modelId).toBe(DEFAULT_FAKE_MODEL_ID);
    expect(provider.providerId.length).toBeGreaterThan(0);
    expect(provider.modelId.length).toBeGreaterThan(0);
    expect(typeof provider.generateText).toBe('function');
  });

  it('allows overriding providerId / modelId via deps', () => {
    const provider = createFakeAiProvider({
      providerId: 'custom-provider',
      modelId: 'custom-model',
      now: () => FIXED_NOW,
    });
    expect(provider.providerId).toBe('custom-provider');
    expect(provider.modelId).toBe('custom-model');
  });

  it('is usable polymorphically through the AiProvider interface', async () => {
    // The only coupling is the interface — swapping providers requires no
    // change to calling code.
    const provider: AiProvider = makeProvider();
    const res = await provider.generateText(validRequest());
    expect(res.ok).toBe(true);
  });
});

// ===========================================================================
// Valid generation
// ===========================================================================

describe('AI Provider — valid generation', () => {
  it('returns an ok result for a valid REPLY_DRAFT request', async () => {
    const provider = makeProvider();
    const res = await provider.generateText(validRequest());

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.text).toMatch(RESPONSE_RE);
      expect(res.data.providerId).toBe(DEFAULT_FAKE_PROVIDER_ID);
      expect(res.data.modelId).toBe(DEFAULT_FAKE_MODEL_ID);
      expect(res.data.finishReason).toBe('STOP');
      // requestId is the same deterministic digest the response text carries.
      expect(res.data.requestId).toMatch(/^fake-[0-9a-f]{16}$/);
      const digest = (res.data.requestId ?? '').slice('fake-'.length);
      expect(res.data.text).toBe(
        `[${FAKE_AI_PROVIDER_RESPONSE_PREFIX}:${digest}]`,
      );
    }
  });

  it('reflects the provider/model identity from the producing provider', async () => {
    const provider = createFakeAiProvider({
      providerId: 'p1',
      modelId: 'm1',
      now: () => FIXED_NOW,
    });
    const res = await provider.generateText(validRequest());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.providerId).toBe('p1');
      expect(res.data.modelId).toBe('m1');
    }
  });

  it('accepts a prompt exactly at the maximum length', async () => {
    const provider = makeProvider();
    const res = await provider.generateText(
      validRequest({ prompt: 'a'.repeat(FAKE_AI_PROVIDER_MAX_PROMPT_CHARS) }),
    );
    expect(res.ok).toBe(true);
  });

  it('accepts a valid prompt with surrounding whitespace', async () => {
    const provider = makeProvider();
    const res = await provider.generateText(
      validRequest({ prompt: ' valid ' }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.text).toMatch(RESPONSE_RE);
  });

  it('accepts optional contextHash and metadata', async () => {
    const provider = makeProvider();
    const res = await provider.generateText(
      validRequest({
        contextHash: 'ctx-abc123',
        metadata: { operationLabel: 'review', locale: 'en' },
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.text).toMatch(RESPONSE_RE);
  });
});

// ===========================================================================
// Determinism
// ===========================================================================

describe('AI Provider — determinism', () => {
  it('returns the same output for the same input', async () => {
    const provider = makeProvider();
    const a = await provider.generateText(validRequest());
    const b = await provider.generateText(validRequest());
    expect(a).toEqual(b);
  });

  it('returns the same output across separate provider instances', async () => {
    const a = await makeProvider().generateText(validRequest());
    const b = await makeProvider().generateText(validRequest());
    expect(a).toEqual(b);
  });

  it('produces a deterministic createdAt when a clock is injected', async () => {
    const provider = makeProvider(() => FIXED_NOW);
    const res = await provider.generateText(validRequest());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.createdAt).toBe(FIXED_NOW.toISOString());
  });

  it('produces deterministic, internally consistent usage', async () => {
    const provider = makeProvider();
    const a = await provider.generateText(validRequest());
    const b = await provider.generateText(validRequest());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.data.usage).toEqual(b.data.usage);
      expect(a.data.usage.promptTokens).toBeGreaterThan(0);
      expect(a.data.usage.completionTokens).toBeGreaterThan(0);
      expect(a.data.usage.totalTokens).toBe(
        a.data.usage.promptTokens + a.data.usage.completionTokens,
      );
    }
  });

  it('is independent of metadata property insertion order', async () => {
    const provider = makeProvider();
    const a = await provider.generateText(
      validRequest({ metadata: { a: '1', b: '2' } }),
    );
    const b = await provider.generateText(
      validRequest({ metadata: { b: '2', a: '1' } }),
    );
    expect(a).toEqual(b);
  });

  it('yields different output for materially different prompts', async () => {
    const provider = makeProvider();
    const a = await provider.generateText(validRequest({ prompt: 'alpha' }));
    const b = await provider.generateText(validRequest({ prompt: 'bravo' }));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.data.text).not.toBe(b.data.text);
  });

  it('yields different output when the businessId differs', async () => {
    const provider = makeProvider();
    const a = await provider.generateText(validRequest({ businessId: BIZ_A }));
    const b = await provider.generateText(validRequest({ businessId: BIZ_B }));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.data.text).not.toBe(b.data.text);
  });

  it('preserves prompt content (does not trim before hashing)', async () => {
    const provider = makeProvider();
    const a = await provider.generateText(validRequest({ prompt: ' valid ' }));
    const b = await provider.generateText(validRequest({ prompt: 'valid' }));
    expect(a.ok && b.ok).toBe(true);
    // Surrounding whitespace is part of the content, so the digest differs.
    if (a.ok && b.ok) expect(a.data.text).not.toBe(b.data.text);
  });
});

// ===========================================================================
// No prompt echo / no content leakage
// ===========================================================================

describe('AI Provider — no prompt echo / no leakage', () => {
  const SECRET = 'ZZZ_TOP_SECRET_CUSTOMER_PII_8675309';

  it('does not echo the full prompt text into the output', async () => {
    const provider = makeProvider();
    const prompt = `Draft a reply. Customer note: ${SECRET}. End.`;
    const res = await provider.generateText(validRequest({ prompt }));

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.text).not.toContain(prompt);
      expect(res.data.text).not.toContain(SECRET);
      // Output is only the bounded placeholder + hash, never prompt-sized.
      expect(res.data.text.length).toBeLessThan(prompt.length);
      expect(res.data.text).toMatch(RESPONSE_RE);
    }
  });

  it('does not leak metadata or contextHash values into the output', async () => {
    const provider = makeProvider();
    const res = await provider.generateText(
      validRequest({
        contextHash: 'CTX_SECRET_FINGERPRINT',
        metadata: { note: SECRET },
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.text).not.toContain(SECRET);
      expect(res.data.text).not.toContain('CTX_SECRET_FINGERPRINT');
    }
  });
});

// ===========================================================================
// Fail-closed validation
// ===========================================================================

describe('AI Provider — fails closed on invalid input', () => {
  it('rejects an empty businessId', async () => {
    const res = await makeProvider().generateText(
      validRequest({ businessId: '' }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROVIDER_INVALID_BUSINESS_ID');
  });

  it('rejects a non-UUID businessId', async () => {
    const res = await makeProvider().generateText(
      validRequest({ businessId: 'not-a-uuid' }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROVIDER_INVALID_BUSINESS_ID');
  });

  it('rejects an empty prompt', async () => {
    const res = await makeProvider().generateText(
      validRequest({ prompt: '' }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROVIDER_INVALID_PROMPT');
  });

  it('rejects a whitespace-only prompt', async () => {
    const provider = makeProvider();
    for (const blank of ['   ', '\n\t ', '\n', '\t\t']) {
      const res = await provider.generateText(
        validRequest({ prompt: blank }),
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('AI_PROVIDER_INVALID_PROMPT');
    }
  });

  it('rejects an unsupported operation', async () => {
    const res = await makeProvider().generateText(
      validRequest({ operation: 'SUMMARIZE' as never }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('AI_PROVIDER_UNSUPPORTED_OPERATION');
    }
  });

  it('rejects an oversized prompt', async () => {
    const res = await makeProvider().generateText(
      validRequest({
        prompt: 'a'.repeat(FAKE_AI_PROVIDER_MAX_PROMPT_CHARS + 1),
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROVIDER_PROMPT_TOO_LARGE');
  });

  it('rejects a missing request object', async () => {
    const res = await makeProvider().generateText(
      undefined as never,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROVIDER_INVALID_REQUEST');
  });

  it('rejects an over-long contextHash', async () => {
    const res = await makeProvider().generateText(
      validRequest({ contextHash: 'a'.repeat(1000) }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROVIDER_INVALID_REQUEST');
  });

  it('rejects an empty or whitespace-only contextHash', async () => {
    const provider = makeProvider();
    for (const blank of ['', '   ', '\n\t ']) {
      const res = await provider.generateText(
        validRequest({ contextHash: blank }),
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('AI_PROVIDER_INVALID_REQUEST');
    }
  });

  it('accepts a valid contextHash', async () => {
    const res = await makeProvider().generateText(
      validRequest({ contextHash: 'ctx-abc123' }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.text).toMatch(RESPONSE_RE);
  });
});

// ===========================================================================
// Metadata bounds
// ===========================================================================

describe('AI Provider — metadata bounds', () => {
  async function expectMetadataRejected(
    metadata: AiProviderGenerateTextRequest['metadata'],
  ): Promise<void> {
    const res = await makeProvider().generateText(validRequest({ metadata }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROVIDER_INVALID_REQUEST');
  }

  it('rejects a non-object metadata bag', async () => {
    await expectMetadataRejected('nope' as never);
    await expectMetadataRejected(['a', 'b'] as never);
  });

  it('rejects a Date instance as metadata', async () => {
    await expectMetadataRejected(new Date() as never);
  });

  it('rejects a class instance as metadata', async () => {
    class MetaBag {
      note = 'x';
    }
    await expectMetadataRejected(new MetaBag() as never);
  });

  it('accepts a null-prototype metadata object with valid entries', async () => {
    // Object.create(null) is treated as a plain bag (allowed) — made explicit.
    const bag = Object.create(null) as Record<string, string>;
    bag.note = 'ok';
    const res = await makeProvider().generateText(
      validRequest({ metadata: bag }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.text).toMatch(RESPONSE_RE);
  });

  it('rejects a non-string metadata value', async () => {
    await expectMetadataRejected({ count: 1 } as never);
  });

  it('rejects an empty metadata key', async () => {
    await expectMetadataRejected({ '': 'v' });
  });

  it('rejects a whitespace-only metadata key', async () => {
    await expectMetadataRejected({ '   ': 'v' });
    await expectMetadataRejected({ '\n\t': 'v' });
  });

  it('rejects a metadata key longer than the max', async () => {
    await expectMetadataRejected({ ['k'.repeat(MAX_METADATA_KEY_CHARS + 1)]: 'v' });
  });

  it('rejects a metadata value longer than the max', async () => {
    await expectMetadataRejected({ note: 'v'.repeat(MAX_METADATA_VALUE_CHARS + 1) });
  });

  it('rejects more than the maximum number of metadata keys', async () => {
    const tooMany: Record<string, string> = {};
    for (let i = 0; i < MAX_METADATA_KEYS + 1; i++) tooMany[`k${i}`] = 'v';
    await expectMetadataRejected(tooMany);
  });

  it('accepts metadata exactly at the bounds', async () => {
    const boundary: Record<string, string> = {};
    // 49 short keys + 1 key at the key-length max whose value is at the
    // value-length max => keys.length === MAX_METADATA_KEYS and both
    // per-entry maxima are exercised.
    for (let i = 0; i < MAX_METADATA_KEYS - 1; i++) boundary[`k${i}`] = 'v';
    boundary['x'.repeat(MAX_METADATA_KEY_CHARS)] =
      'y'.repeat(MAX_METADATA_VALUE_CHARS);

    expect(Object.keys(boundary)).toHaveLength(MAX_METADATA_KEYS);

    const res = await makeProvider().generateText(validRequest({ metadata: boundary }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.text).toMatch(RESPONSE_RE);
      // Even bounded metadata never leaks into the output.
      expect(res.data.text).not.toContain('y'.repeat(MAX_METADATA_VALUE_CHARS));
    }
  });
});

// ===========================================================================
// No network
// ===========================================================================

describe('AI Provider — no network', () => {
  it('does not invoke global fetch during generation', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const provider = makeProvider();
    const res = await provider.generateText(validRequest());

    expect(res.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Static scope guards (meta tests over the new B-R4 source files)
// ===========================================================================

describe('AI Provider — static scope guards', () => {
  const PROVIDER_FILES = [
    'src/domains/ai-runtime/provider.ts',
    'src/domains/ai-runtime/fake-provider.ts',
  ];

  function read(rel: string): string {
    return fs.readFileSync(path.resolve(rel), 'utf8');
  }

  /** Import specifiers (the path in `from '...'`) for a source file. */
  function importPaths(src: string): string[] {
    return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  }

  /** Allowlisted import paths for the provider files — nothing else. */
  const ALLOWED_IMPORTS = new Set([
    'zod',
    '@/lib/result',
    './provider',
    './types',
  ]);

  it.each(PROVIDER_FILES)('%s imports no real provider/LLM SDK', (rel) => {
    const src = read(rel);
    // No vendor SDK identifiers anywhere (incl. comments).
    expect(src).not.toMatch(
      /openai|anthropic|@anthropic-ai|@google|googleapis|gemini|vertex|cohere|mistral|llama|bedrock/i,
    );
    expect(src).not.toMatch(
      /require\(['"](?:openai|anthropic|@google|cohere|mistral)/,
    );
  });

  it.each(PROVIDER_FILES)('%s uses only allowlisted imports (no new deps)', (rel) => {
    for (const imp of importPaths(read(rel))) {
      expect(ALLOWED_IMPORTS.has(imp)).toBe(true);
    }
  });

  it.each(PROVIDER_FILES)('%s makes no network request', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(
      /\bfetch\b|XMLHttpRequest|node:http\b|node:https\b|http\.request|https\.request|axios|undici/i,
    );
  });

  it.each(PROVIDER_FILES)('%s reads no environment / API-key path', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/api[_-]?key/i);
  });

  it.each(PROVIDER_FILES)('%s uses no randomness', (rel) => {
    expect(read(rel)).not.toMatch(/Math\.random/);
  });

  it.each(PROVIDER_FILES)('%s has no prompt builder / template construction', (rel) => {
    expect(read(rel)).not.toMatch(
      /\b(buildPrompt|promptBuilder|systemPrompt|promptTemplate|renderPrompt)\b/,
    );
  });

  it.each(PROVIDER_FILES)(
    '%s has no customer/conversation/message/reply-draft path',
    (rel) => {
      const src = read(rel);
      expect(src).not.toMatch(
        /\b(db|prisma)\.(customer|conversation|message|replyDraft)\b/,
      );
      for (const imp of importPaths(src)) {
        expect(imp).not.toMatch(/domains\/(crm|conversations|reply-drafts)/);
      }
    },
  );

  it.each(PROVIDER_FILES)('%s has no auto-send / dispatch / deliver path', (rel) => {
    expect(read(rel)).not.toMatch(
      /\b(sendMessage|autoSend|dispatch|deliver|sendDraft)\s*\(/,
    );
  });

  it('the only third-party import across the provider files is zod', () => {
    const thirdParty = PROVIDER_FILES.flatMap((rel) =>
      importPaths(read(rel)),
    ).filter((imp) => !imp.startsWith('.') && !imp.startsWith('@/'));
    expect([...new Set(thirdParty)]).toEqual(['zod']);
  });

  it.each(PROVIDER_FILES)(
    '%s uses no cryptographic / one-way wording for the digest',
    (rel) => {
      const src = read(rel);
      // Patterns are assembled from fragments so this guard file itself does
      // not contain the very phrases it forbids (keeps a repo-wide grep clean).
      const forbidden = [
        new RegExp(['one', 'way'].join('-') + ' digest', 'i'),
        new RegExp('cannot be ' + 'reversed', 'i'),
        new RegExp('crypto' + 'graphic', 'i'),
      ];
      for (const re of forbidden) {
        expect(src).not.toMatch(re);
      }
    },
  );

  it('package.json declares no real AI provider SDK dependency', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    for (const name of names) {
      expect(name).not.toMatch(
        /openai|anthropic|@google\/|googleapis|gemini|cohere|mistral|llama|bedrock|@aws-sdk/i,
      );
    }
  });
});
