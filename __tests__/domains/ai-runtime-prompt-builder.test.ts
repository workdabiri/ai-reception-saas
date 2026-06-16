// ===========================================================================
// Tests — AI Runtime: Provenance-Aware Prompt Builder (B-R5)
//
// Proves the prompt builder:
//  - converts an assembled context into a B-R4 REPLY_DRAFT provider request
//  - uses context.businessId; records promptVersion + contextHash
//  - injects verified context values; emits the §5.1 refusal/hedging rules,
//    the human-review / no-auto-send rules, and (zero context) strict
//    missing-context rules
//  - is deterministic and independent of input item order
//  - produces a stable contextHash for the same context and a different one
//    when verified context changes
//  - never leaks verifiedByUserId / sourceMetadata / internal item ids into the
//    prompt text, and exposes no customer/conversation/message fields
//  - fails closed on invalid context / instruction / oversized prompt
//  - calls no provider (build is a pure, synchronous, network-free operation)
//
// And STATIC SCOPE GUARDS proving B-R5 added no provider SDK, no fake-provider
// import, no network/env/API-key path, no customer/conversation/message/
// reply-draft path, no auto-send, and no new package dependency.
// ===========================================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createAiPromptBuilder,
  REPLY_DRAFT_PROMPT_VERSION,
  MAX_REPLY_DRAFT_PROMPT_CHARS,
  MAX_OPERATOR_INSTRUCTION_CHARS,
  AI_PROMPT_BUILDER_ERROR_CODES,
  type AiPromptBuilder,
  type AssembledAiContext,
  type AssembledBusinessContextItem,
} from '@/domains/ai-runtime';

// ---------------------------------------------------------------------------
// Constants / fixtures
// ---------------------------------------------------------------------------

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';
const VERIFIER = '44444444-4444-4444-8444-444444444444';

function item(
  overrides: Partial<AssembledBusinessContextItem> = {},
): AssembledBusinessContextItem {
  return {
    id: 'item-1',
    category: 'hours',
    key: 'monday',
    value: 'Open 9:00–17:00',
    sourceType: 'OWNER_APPROVED',
    sourceLabel: 'Owner dashboard',
    sourceUrl: null,
    sourceMetadata: null,
    verifiedByUserId: VERIFIER,
    verifiedAt: '2026-06-10T09:00:00.000Z',
    ...overrides,
  };
}

function context(
  overrides: Partial<AssembledAiContext> = {},
): AssembledAiContext {
  return {
    businessId: BIZ_A,
    aiMode: 'AI_ASSISTED',
    aiGenerationEnabled: true,
    businessContextItems: [item()],
    assembledAt: '2026-06-16T08:30:00.000Z',
    ...overrides,
  };
}

function makeBuilder(): AiPromptBuilder {
  return createAiPromptBuilder();
}

function buildOk(ctx: AssembledAiContext, instruction?: string) {
  const res = makeBuilder().buildReplyDraftPrompt({ context: ctx, instruction });
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error('expected ok');
  return res.data;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// Code surface
// ===========================================================================

describe('Prompt Builder — code surface', () => {
  it('exposes exactly the expected error codes', () => {
    expect([...AI_PROMPT_BUILDER_ERROR_CODES]).toEqual([
      'AI_PROMPT_INVALID_CONTEXT',
      'AI_PROMPT_INVALID_INSTRUCTION',
      'AI_PROMPT_CONTEXT_TOO_LARGE',
    ]);
  });

  it('exposes a non-empty prompt version', () => {
    expect(typeof REPLY_DRAFT_PROMPT_VERSION).toBe('string');
    expect(REPLY_DRAFT_PROMPT_VERSION.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Positive behavior
// ===========================================================================

describe('Prompt Builder — builds a REPLY_DRAFT provider request', () => {
  it('builds a provider request with operation REPLY_DRAFT and the context businessId', () => {
    const data = buildOk(context());
    expect(data.providerRequest.operation).toBe('REPLY_DRAFT');
    expect(data.providerRequest.businessId).toBe(BIZ_A);
    expect(typeof data.providerRequest.prompt).toBe('string');
    expect(data.providerRequest.prompt.length).toBeGreaterThan(0);
  });

  it('records promptVersion in the result and provider metadata', () => {
    const data = buildOk(context());
    expect(data.promptVersion).toBe(REPLY_DRAFT_PROMPT_VERSION);
    expect(data.providerRequest.metadata?.promptVersion).toBe(
      REPLY_DRAFT_PROMPT_VERSION,
    );
    expect(data.providerRequest.metadata?.contextItemCount).toBe('1');
  });

  it('records a contextHash on the result and the provider request', () => {
    const data = buildOk(context());
    expect(data.contextHash).toMatch(/^[0-9a-f]{16}$/);
    expect(data.providerRequest.contextHash).toBe(data.contextHash);
  });

  it('injects verified context values into the prompt', () => {
    const data = buildOk(
      context({
        businessContextItems: [
          item({ id: 'a', category: 'pricing', key: 'studio', value: 'EUR 1200/mo' }),
        ],
      }),
    );
    expect(data.providerRequest.prompt).toContain('EUR 1200/mo');
    expect(data.providerRequest.prompt).toContain('pricing');
    expect(data.includedContextItemIds).toEqual(['a']);
    expect(data.omittedContextItemIds).toEqual([]);
  });

  it('emits the provenance-aware refusal / hedging rules', () => {
    const prompt = buildOk(context()).providerRequest.prompt;
    expect(prompt.toLowerCase()).toContain('verified business context');
    expect(prompt.toLowerCase()).toContain('hedge');
    expect(prompt.toLowerCase()).toContain('defer');
    expect(prompt.toLowerCase()).toContain('confirm');
    expect(prompt.toLowerCase()).toContain('not fabricate');
  });

  it('covers the PRD §5.1 vertical-sensitive categories in the rules', () => {
    const prompt = buildOk(context()).providerRequest.prompt.toLowerCase();
    for (const category of [
      'property availability',
      'price',
      'roi',
      'investment guarantees',
      'legal requirements',
      'regulatory requirements',
      'mortgage / financing',
      'commissions',
      'contracts',
    ]) {
      expect(prompt).toContain(category);
    }
  });

  it('emits the human-review / no-auto-send rules', () => {
    const prompt = buildOk(context()).providerRequest.prompt.toLowerCase();
    expect(prompt).toContain('human operator');
    expect(prompt).toContain('review');
    expect(prompt).toContain('draft only');
    expect(prompt).toContain('never be sent');
  });

  it('supports an optional safe operator instruction without leaking PII fields', () => {
    const data = buildOk(context(), 'Keep it short and apologetic.');
    expect(data.providerRequest.prompt).toContain('Keep it short and apologetic.');
    expect(data.providerRequest.prompt).toContain('[OPERATOR INSTRUCTION]');
    // The instruction is steering only — flagged as NOT verified context.
    expect(data.providerRequest.prompt.toLowerCase()).toContain(
      'not verified business context',
    );
  });

  it('builds without an operator instruction section when none is given', () => {
    const prompt = buildOk(context()).providerRequest.prompt;
    expect(prompt).not.toContain('[OPERATOR INSTRUCTION]');
  });
});

// ===========================================================================
// Determinism
// ===========================================================================

describe('Prompt Builder — determinism', () => {
  it('produces identical output for the same input', () => {
    const a = buildOk(context());
    const b = buildOk(context());
    expect(a).toEqual(b);
  });

  it('sorts items deterministically regardless of input order', () => {
    const items = [
      item({ id: 'c', category: 'pricing', key: 'studio', value: 'EUR 1200' }),
      item({ id: 'a', category: 'hours', key: 'monday', value: 'Open 9-5' }),
      item({ id: 'b', category: 'hours', key: 'tuesday', value: 'Open 9-5' }),
    ];
    const forward = buildOk(context({ businessContextItems: items }));
    const reversed = buildOk(
      context({ businessContextItems: [...items].reverse() }),
    );
    expect(forward).toEqual(reversed);
    // Sorted by category, then key, then id.
    expect(forward.includedContextItemIds).toEqual(['a', 'b', 'c']);
  });

  it('produces a stable contextHash for the same context', () => {
    expect(buildOk(context()).contextHash).toBe(buildOk(context()).contextHash);
  });

  it('produces a contextHash independent of input item order', () => {
    const items = [
      item({ id: 'x', category: 'a', key: 'k1', value: 'v1' }),
      item({ id: 'y', category: 'b', key: 'k2', value: 'v2' }),
    ];
    const a = buildOk(context({ businessContextItems: items }));
    const b = buildOk(context({ businessContextItems: [...items].reverse() }));
    expect(a.contextHash).toBe(b.contextHash);
  });

  it('produces a different contextHash when verified context changes', () => {
    const base = buildOk(context()).contextHash;
    const changedValue = buildOk(
      context({ businessContextItems: [item({ value: 'Open 10:00–18:00' })] }),
    ).contextHash;
    const changedSet = buildOk(
      context({
        businessContextItems: [item(), item({ id: 'item-2', key: 'tuesday' })],
      }),
    ).contextHash;
    expect(changedValue).not.toBe(base);
    expect(changedSet).not.toBe(base);
  });

  it('does not change the contextHash when only the operator instruction changes', () => {
    // contextHash fingerprints the verified CONTEXT, not the instruction.
    const a = buildOk(context(), 'instruction one').contextHash;
    const b = buildOk(context(), 'a totally different instruction').contextHash;
    expect(a).toBe(b);
  });

  it('uses explicit separators so ambiguous field concatenation never collides', () => {
    // Without delimiters, {category:'ab', key:'c'} and {category:'a', key:'bc'}
    // would concatenate to the same key. Explicit separators must keep them
    // distinct. Hold id/value/source fields equal so ONLY the category/key
    // boundary differs.
    const shared = {
      id: 'same-id',
      value: 'same-value',
      sourceType: 'OWNER_APPROVED' as const,
      sourceLabel: null,
      verifiedAt: null,
    };
    const a = buildOk(
      context({ businessContextItems: [item({ ...shared, category: 'ab', key: 'c' })] }),
    ).contextHash;
    const b = buildOk(
      context({ businessContextItems: [item({ ...shared, category: 'a', key: 'bc' })] }),
    ).contextHash;
    expect(a).not.toBe(b);
  });

  it('does not let a record boundary collide with item content', () => {
    // Two items {category:'a'} + {category:'b'} must not hash the same as a
    // single item whose category spans the would-be boundary.
    const two = buildOk(
      context({
        businessContextItems: [
          item({ id: 'i1', category: 'a', key: 'k', value: 'v' }),
          item({ id: 'i2', category: 'b', key: 'k', value: 'v' }),
        ],
      }),
    ).contextHash;
    const one = buildOk(
      context({
        businessContextItems: [item({ id: 'i1', category: 'ab', key: 'k', value: 'v' })],
      }),
    ).contextHash;
    expect(two).not.toBe(one);
  });
});

// ===========================================================================
// Zero verified context
// ===========================================================================

describe('Prompt Builder — zero verified context', () => {
  it('still builds, with a warning and strict missing-context rules', () => {
    const data = buildOk(context({ businessContextItems: [] }));
    expect(data.includedContextItemIds).toEqual([]);
    expect(data.warnings.length).toBeGreaterThan(0);
    expect(data.warnings.join(' ').toLowerCase()).toContain(
      'no verified business context',
    );
    const prompt = data.providerRequest.prompt.toLowerCase();
    expect(prompt).toContain('no verified business context');
    expect(prompt).toContain('must not make any business-specific definitive');
    expect(data.providerRequest.metadata?.contextItemCount).toBe('0');
  });

  it('drops malformed items, reporting them as omitted with a warning', () => {
    const data = buildOk(
      context({
        businessContextItems: [
          item({ id: 'good', value: 'Open 9-5' }),
          item({ id: 'blank', value: '   ' }),
        ],
      }),
    );
    expect(data.includedContextItemIds).toEqual(['good']);
    expect(data.omittedContextItemIds).toEqual(['blank']);
    expect(data.warnings.join(' ').toLowerCase()).toContain('omitted');
  });
});

// ===========================================================================
// Unknown-safe item handling (items typed as unknown at runtime)
// ===========================================================================

describe('Prompt Builder — unknown-safe item handling', () => {
  // The schema only checks businessContextItems is an array, so entries may be
  // anything at runtime. The builder must never throw on malformed entries.
  function buildWithItems(items: unknown[]) {
    return makeBuilder().buildReplyDraftPrompt({
      context: context({
        businessContextItems: items as never,
      }),
    });
  }

  /** The single warning string emitted for malformed entries. */
  function malformedWarning(warnings: readonly string[]): string | undefined {
    return warnings.find((w) => w.toLowerCase().includes('malformed'));
  }

  it('does not throw on a null entry, dropping it (no id to record)', () => {
    const res = buildWithItems([null, item({ id: 'good' })]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.includedContextItemIds).toEqual(['good']);
      expect(res.data.omittedContextItemIds).toEqual([]);
    }
  });

  it('produces a warning for a null malformed entry (no usable id)', () => {
    const res = buildWithItems([null, item({ id: 'good' })]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.omittedContextItemIds).toEqual([]);
      // Warning is emitted even though nothing landed in omittedContextItemIds.
      expect(malformedWarning(res.data.warnings)).toBeDefined();
    }
  });

  it('does not throw on string / number entries, dropping them with a warning', () => {
    const res = buildWithItems(['nope', 42, item({ id: 'good' })]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.includedContextItemIds).toEqual(['good']);
      // Primitives carry no usable id, so nothing is added to omitted...
      expect(res.data.omittedContextItemIds).toEqual([]);
      // ...but both malformed entries are still warned about.
      expect(malformedWarning(res.data.warnings)).toContain('2');
    }
  });

  it('produces a warning for a malformed object without an id', () => {
    const res = buildWithItems([
      { category: 'hours', key: 'monday', value: '' },
      item({ id: 'good' }),
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.includedContextItemIds).toEqual(['good']);
      // No usable id → not recorded in omitted...
      expect(res.data.omittedContextItemIds).toEqual([]);
      // ...but it is counted as malformed and warned about.
      expect(malformedWarning(res.data.warnings)).toBeDefined();
    }
  });

  it('omits an object with an id but missing value, recording the id', () => {
    const res = buildWithItems([
      { id: 'no-value', category: 'hours', key: 'monday', sourceType: 'OWNER_APPROVED' },
      item({ id: 'good' }),
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.includedContextItemIds).toEqual(['good']);
      expect(res.data.omittedContextItemIds).toEqual(['no-value']);
      expect(malformedWarning(res.data.warnings)).toBeDefined();
    }
  });

  it('treats a non-string id as no usable id (warned, not in omitted)', () => {
    const res = buildWithItems([
      { id: 42, category: 'hours', key: 'monday', value: '' },
      item({ id: 'good' }),
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.includedContextItemIds).toEqual(['good']);
      expect(res.data.omittedContextItemIds).toEqual([]);
      expect(malformedWarning(res.data.warnings)).toBeDefined();
    }
  });

  it('only records safely-extractable ids in omittedContextItemIds', () => {
    const res = buildWithItems([
      null,
      'junk',
      99,
      { category: 'hours', key: 'monday', value: '' }, // no id
      { id: 'has-id', category: 'hours', key: 'tuesday' }, // id, missing value
      item({ id: 'good' }),
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Of five malformed entries, only one carries a usable id.
      expect(res.data.omittedContextItemIds).toEqual(['has-id']);
    }
  });

  it('warning count reflects ALL malformed entries, not only those with ids', () => {
    const res = buildWithItems([
      null, // malformed, no id
      'junk', // malformed, no id
      { category: 'hours', key: 'monday', value: '' }, // malformed, no id
      { id: 'has-id', category: 'hours', key: 'tuesday' }, // malformed, with id
      item({ id: 'good' }), // valid
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.includedContextItemIds).toEqual(['good']);
      expect(res.data.omittedContextItemIds).toEqual(['has-id']);
      // 4 malformed entries total, only 1 of which had a usable id.
      expect(malformedWarning(res.data.warnings)).toContain('4');
    }
  });

  it('emits no malformed warning when all items are valid', () => {
    const res = buildWithItems([item({ id: 'a', value: 'Open 9-5' })]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(malformedWarning(res.data.warnings)).toBeUndefined();
    }
  });

  it('still includes valid items alongside malformed ones', () => {
    const res = buildWithItems([
      null,
      'junk',
      item({ id: 'a', category: 'hours', key: 'monday', value: 'Open 9-5' }),
      { id: 'bad', category: 'hours', key: 'tuesday' },
      item({ id: 'b', category: 'pricing', key: 'studio', value: 'EUR 1200' }),
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.includedContextItemIds).toEqual(['a', 'b']);
      expect(res.data.omittedContextItemIds).toEqual(['bad']);
      expect(res.data.providerRequest.prompt).toContain('EUR 1200');
    }
  });
});

// ===========================================================================
// Security / scope — no internal or PII leakage into the prompt
// ===========================================================================

describe('Prompt Builder — no internal/PII leakage in prompt text', () => {
  it('never includes verifiedByUserId in the prompt', () => {
    const prompt = buildOk(
      context({ businessContextItems: [item({ verifiedByUserId: VERIFIER })] }),
    ).providerRequest.prompt;
    expect(prompt).not.toContain(VERIFIER);
  });

  it('never includes raw sourceMetadata in the prompt', () => {
    const SECRET = 'ZZZ_SOURCE_METADATA_SECRET_123';
    const prompt = buildOk(
      context({
        businessContextItems: [
          item({ sourceMetadata: { note: SECRET, internal: true } }),
        ],
      }),
    ).providerRequest.prompt;
    expect(prompt).not.toContain(SECRET);
    expect(prompt).not.toContain('sourceMetadata');
  });

  it('never exposes internal item ids in the prompt text', () => {
    const data = buildOk(
      context({
        businessContextItems: [
          item({ id: 'INTERNAL_ITEM_ID_SECRET', value: 'Open 9-5' }),
        ],
      }),
    );
    // The id is tracked internally for audit...
    expect(data.includedContextItemIds).toContain('INTERNAL_ITEM_ID_SECRET');
    // ...but never leaks into the customer-facing prompt text.
    expect(data.providerRequest.prompt).not.toContain('INTERNAL_ITEM_ID_SECRET');
  });

  it('does not render internal field names or a status field for items', () => {
    const prompt = buildOk(context()).providerRequest.prompt;
    // Internal field NAMES are never rendered as item data...
    expect(prompt).not.toContain('createdByUserId');
    expect(prompt).not.toContain('verifiedByUserId');
    expect(prompt).not.toContain('sourceUrl');
    expect(prompt).not.toContain('sourceMetadata');
    // ...and no per-item lifecycle status field is emitted (items render only
    // category/key/value/sourceType/sourceLabel/verifiedAt).
    expect(prompt).not.toContain('status:');
    expect(prompt).not.toMatch(/^\s*id:/m);
  });
});

// ===========================================================================
// Validation — fail closed
// ===========================================================================

describe('Prompt Builder — fails closed on invalid input', () => {
  it('rejects a missing context', () => {
    const res = makeBuilder().buildReplyDraftPrompt(
      undefined as never,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROMPT_INVALID_CONTEXT');
  });

  it('rejects a non-UUID businessId', () => {
    const res = makeBuilder().buildReplyDraftPrompt({
      context: context({ businessId: 'not-a-uuid' }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROMPT_INVALID_CONTEXT');
  });

  it('rejects aiMode other than AI_ASSISTED', () => {
    const res = makeBuilder().buildReplyDraftPrompt({
      context: context({ aiMode: 'MANUAL' as never }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROMPT_INVALID_CONTEXT');
  });

  it('rejects aiGenerationEnabled !== true', () => {
    const res = makeBuilder().buildReplyDraftPrompt({
      context: context({ aiGenerationEnabled: false as never }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROMPT_INVALID_CONTEXT');
  });

  it('rejects an empty / whitespace-only operator instruction', () => {
    for (const blank of ['', '   ', '\n\t ']) {
      const res = makeBuilder().buildReplyDraftPrompt({
        context: context(),
        instruction: blank,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('AI_PROMPT_INVALID_INSTRUCTION');
    }
  });

  it('rejects a non-string operator instruction', () => {
    const res = makeBuilder().buildReplyDraftPrompt({
      context: context(),
      instruction: 42 as never,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROMPT_INVALID_INSTRUCTION');
  });

  it('rejects an oversized operator instruction', () => {
    const res = makeBuilder().buildReplyDraftPrompt({
      context: context(),
      instruction: 'a'.repeat(MAX_OPERATOR_INSTRUCTION_CHARS + 1),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROMPT_INVALID_INSTRUCTION');
  });

  it('rejects a context whose items overflow the prompt size budget', () => {
    // Many large verified values push the built prompt past the budget.
    const big = 'v'.repeat(2000);
    const items: AssembledBusinessContextItem[] = [];
    for (let i = 0; i < 50; i++) {
      items.push(item({ id: `i${i}`, key: `k${i}`, value: big }));
    }
    const res = makeBuilder().buildReplyDraftPrompt({
      context: context({ businessContextItems: items }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROMPT_CONTEXT_TOO_LARGE');
  });

  it('accepts an instruction exactly at the maximum length', () => {
    const res = makeBuilder().buildReplyDraftPrompt({
      context: context(),
      instruction: 'a'.repeat(MAX_OPERATOR_INSTRUCTION_CHARS),
    });
    expect(res.ok).toBe(true);
  });

  it('keeps the built prompt within the size budget for normal input', () => {
    const data = buildOk(context());
    expect(data.providerRequest.prompt.length).toBeLessThanOrEqual(
      MAX_REPLY_DRAFT_PROMPT_CHARS,
    );
  });
});

// ===========================================================================
// No provider call / no network
// ===========================================================================

describe('Prompt Builder — no provider call, no network', () => {
  it('does not invoke global fetch while building', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = makeBuilder().buildReplyDraftPrompt({ context: context() });
    expect(res.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a request payload but never a generation result', () => {
    const data = buildOk(context());
    // Output is a REQUEST, not a provider RESULT — no generated text/usage.
    expect(data.providerRequest).toBeDefined();
    expect((data as unknown as { text?: string }).text).toBeUndefined();
    expect((data as unknown as { usage?: unknown }).usage).toBeUndefined();
  });
});

// ===========================================================================
// Static scope guards (meta tests over the new B-R5 source file)
// ===========================================================================

describe('Prompt Builder — static scope guards', () => {
  const FILE = 'src/domains/ai-runtime/prompt-builder.ts';

  function read(rel: string): string {
    return fs.readFileSync(path.resolve(rel), 'utf8');
  }

  function importPaths(src: string): string[] {
    return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  }

  /** Allowlisted imports for the builder — nothing else. */
  const ALLOWED_IMPORTS = new Set(['zod', '@/lib/result', './types']);

  it('imports no real provider / LLM SDK', () => {
    const src = read(FILE);
    expect(src).not.toMatch(
      /openai|anthropic|@anthropic-ai|@google|googleapis|gemini|vertex|cohere|mistral|llama|bedrock/i,
    );
  });

  it('uses only allowlisted imports (no new deps, no fake provider)', () => {
    for (const imp of importPaths(read(FILE))) {
      expect(ALLOWED_IMPORTS.has(imp)).toBe(true);
    }
  });

  it('does not import the fake provider or provider implementations', () => {
    for (const imp of importPaths(read(FILE))) {
      expect(imp).not.toMatch(/fake-provider|provider$/);
    }
  });

  it('makes no network request', () => {
    const src = read(FILE);
    expect(src).not.toMatch(
      /\bfetch\b|XMLHttpRequest|node:http\b|node:https\b|http\.request|https\.request|axios|undici/i,
    );
  });

  it('reads no environment / API-key path', () => {
    const src = read(FILE);
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/api[_-]?key/i);
  });

  it('uses no randomness or wall-clock', () => {
    const src = read(FILE);
    expect(src).not.toMatch(/Math\.random/);
    expect(src).not.toMatch(/Date\.now|new Date\(/);
  });

  it('has no customer/conversation/message/reply-draft read path', () => {
    const src = read(FILE);
    expect(src).not.toMatch(
      /\b(db|prisma)\.(customer|conversation|message|replyDraft)\b/,
    );
    for (const imp of importPaths(src)) {
      expect(imp).not.toMatch(/domains\/(crm|conversations|reply-drafts)/);
    }
    // No customer-PII field names are read.
    expect(src).not.toMatch(
      /customerMessage|conversationMessages|customerEmail|customerPhone/,
    );
  });

  it('has no auto-send / dispatch / deliver path', () => {
    expect(read(FILE)).not.toMatch(
      /\b(sendMessage|autoSend|dispatch|deliver|sendDraft)\s*\(/,
    );
  });

  it('the only third-party import is zod', () => {
    const thirdParty = importPaths(read(FILE)).filter(
      (imp) => !imp.startsWith('.') && !imp.startsWith('@/'),
    );
    expect([...new Set(thirdParty)]).toEqual(['zod']);
  });
});
