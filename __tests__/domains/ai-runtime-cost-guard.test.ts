// ===========================================================================
// Tests — AI Runtime: Token / Usage Cost Guard (Area B §6 gate)
//
// Test-proves the Area B §6 "token / usage cost guard" gate FOR THE CURRENT
// FAKE-PROVIDER SCOPE ONLY. It proves a vendor-neutral, PURE cost-guard decision
// contract over the existing `AiProviderUsage` token metadata: usage within a
// per-business limit is ALLOWED; usage over the limit, a missing/invalid limit,
// and a missing/invalid usage are all DENIED fail-closed through the existing
// `ActionResult` error contract.
//
// It uses a TEST-ONLY pure helper (`evaluateAiRuntimeCostPolicy`); no production
// source is touched. There is no production cost taxonomy, no real provider, no
// metering, no persistent counter, no schema/migration, no network/SDK/env path,
// no route wiring, and no auto-send. Accumulating per-business usage and
// persisting it are OWNER-GATED / DEFERRED and live outside this contract.
//
// Real-provider production AI-assisted go-live remains NOT YET APPROVED.
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  AI_PROVIDER_ERROR_CODES,
  createFakeAiProvider,
  type AiProviderUsage,
} from '@/domains/ai-runtime';

import {
  evaluateAiRuntimeCostPolicy,
  AI_RUNTIME_COST_POLICY_ERROR_CODES,
  type AiRuntimeCostLimit,
  type AiRuntimeCostAllowance,
} from '../_helpers/ai-runtime-cost-policy';

// ---------------------------------------------------------------------------
// Constants + a synthetic PII-shaped marker that must NEVER reach a decision
// ---------------------------------------------------------------------------

const HELPER_REL = '__tests__/_helpers/ai-runtime-cost-policy.ts';

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const PII_EMAIL = 'jane.doe@example.com';

// ---------------------------------------------------------------------------
// Fixtures (synthetic numeric data only)
// ---------------------------------------------------------------------------

function limit(overrides: Partial<AiRuntimeCostLimit> = {}): AiRuntimeCostLimit {
  return { maxTotalTokens: 1000, ...overrides };
}

/** A well-formed usage figure (totalTokens === prompt + completion). */
function usage(
  promptTokens: number,
  completionTokens: number,
  totalOverride?: number,
): AiProviderUsage {
  return {
    promptTokens,
    completionTokens,
    totalTokens: totalOverride ?? promptTokens + completionTokens,
  };
}

/** Asserts an allow result and returns the allowance payload. */
function expectAllow(
  result: ReturnType<typeof evaluateAiRuntimeCostPolicy>,
): AiRuntimeCostAllowance {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected allow, got ${result.error.code}`);
  expect(result.data.allowed).toBe(true);
  return result.data;
}

/** Asserts a fail-closed denial with the expected code and returns it. */
function expectDeny(
  result: ReturnType<typeof evaluateAiRuntimeCostPolicy>,
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected deny, got allow');
  expect(result.error.code).toBe(code);
  // Denials carry no success payload (no `data`).
  expect((result as { data?: unknown }).data).toBeUndefined();
}

// ===========================================================================
// Allow path — usage within budget
// ===========================================================================

describe('Cost guard — allow path (within budget)', () => {
  it('allows usage below the total-token limit', () => {
    const out = expectAllow(
      evaluateAiRuntimeCostPolicy(limit({ maxTotalTokens: 1000 }), usage(100, 100)),
    );
    expect(out.evaluatedTotalTokens).toBe(200);
    expect(out.remainingTotalTokens).toBe(800);
    expect(out.evaluatedSpend).toBeNull();
    expect(out.remainingSpend).toBeNull();
  });

  it('allows usage exactly AT the total-token limit (deny is strict >)', () => {
    const out = expectAllow(
      evaluateAiRuntimeCostPolicy(limit({ maxTotalTokens: 200 }), usage(100, 100)),
    );
    expect(out.evaluatedTotalTokens).toBe(200);
    expect(out.remainingTotalTokens).toBe(0);
  });

  it('allows usage within optional prompt/completion sub-limits', () => {
    const out = expectAllow(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxPromptTokens: 500, maxCompletionTokens: 500 }),
        usage(100, 100),
      ),
    );
    expect(out.evaluatedPromptTokens).toBe(100);
    expect(out.evaluatedCompletionTokens).toBe(100);
  });

  it('allows usage within a configured spend limit (exact spend allowed)', () => {
    const out = expectAllow(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxSpend: 200, costPerToken: 1 }),
        usage(100, 100),
      ),
    );
    expect(out.evaluatedSpend).toBe(200);
    expect(out.remainingSpend).toBe(0);
  });

  it('reports remaining spend headroom under the spend limit', () => {
    const out = expectAllow(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxSpend: 1000, costPerToken: 2 }),
        usage(100, 100),
      ),
    );
    expect(out.evaluatedSpend).toBe(400);
    expect(out.remainingSpend).toBe(600);
  });
});

// ===========================================================================
// Deny path — over budget
// ===========================================================================

describe('Cost guard — deny path (over budget)', () => {
  it('denies usage over the total-token limit', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(limit({ maxTotalTokens: 100 }), usage(60, 60)),
      'AI_COST_BUDGET_EXCEEDED',
    );
  });

  it('denies usage over the prompt-token sub-limit', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxPromptTokens: 50 }),
        usage(60, 10),
      ),
      'AI_COST_BUDGET_EXCEEDED',
    );
  });

  it('denies usage over the completion-token sub-limit', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxCompletionTokens: 50 }),
        usage(10, 60),
      ),
      'AI_COST_BUDGET_EXCEEDED',
    );
  });

  it('denies usage over the configured spend limit', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxSpend: 100, costPerToken: 1 }),
        usage(100, 100),
      ),
      'AI_COST_BUDGET_EXCEEDED',
    );
  });
});

// ===========================================================================
// maxSpend = 0 edge — a valid budget that allows ONLY zero evaluated spend
// ===========================================================================

describe('Cost guard — maxSpend = 0 edge', () => {
  it('treats maxSpend = 0 (with a positive rate) as a VALID budget', () => {
    // The budget itself is well-formed; only the spend EVALUATION may deny.
    const out = evaluateAiRuntimeCostPolicy(
      limit({ maxTotalTokens: 1000, maxSpend: 0, costPerToken: 1 }),
      usage(0, 0),
    );
    expect(out.ok).toBe(true);
  });

  it('allows zero usage under maxSpend = 0 (evaluated spend is 0)', () => {
    const out = expectAllow(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxSpend: 0, costPerToken: 1 }),
        usage(0, 0),
      ),
    );
    expect(out.evaluatedSpend).toBe(0);
    expect(out.remainingSpend).toBe(0);
  });

  it('denies any positive usage under maxSpend = 0', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxSpend: 0, costPerToken: 1 }),
        usage(1, 0),
      ),
      'AI_COST_BUDGET_EXCEEDED',
    );
  });
});

// ===========================================================================
// Fail-closed — missing / invalid limit
// ===========================================================================

describe('Cost guard — fail-closed on missing / invalid limit', () => {
  it('denies when the limit is null (no budget => deny, never unlimited)', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(null, usage(1, 1)),
      'AI_COST_BUDGET_MISSING',
    );
  });

  it('denies when the limit is undefined', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(undefined, usage(1, 1)),
      'AI_COST_BUDGET_MISSING',
    );
  });

  it('denies when maxTotalTokens is negative', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(limit({ maxTotalTokens: -5 }), usage(1, 1)),
      'AI_COST_BUDGET_INVALID',
    );
  });

  it('denies when maxTotalTokens is NaN / non-finite', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(limit({ maxTotalTokens: Number.NaN }), usage(1, 1)),
      'AI_COST_BUDGET_INVALID',
    );
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: Number.POSITIVE_INFINITY }),
        usage(1, 1),
      ),
      'AI_COST_BUDGET_INVALID',
    );
  });

  it('denies when maxTotalTokens is not a number', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        { maxTotalTokens: 'lots' } as unknown as AiRuntimeCostLimit,
        usage(1, 1),
      ),
      'AI_COST_BUDGET_INVALID',
    );
  });

  it('denies when an optional sub-limit is negative', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxPromptTokens: -1 }),
        usage(1, 1),
      ),
      'AI_COST_BUDGET_INVALID',
    );
  });

  it('denies a half-configured spend dimension (ceiling without rate)', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxSpend: 100 }),
        usage(1, 1),
      ),
      'AI_COST_BUDGET_INVALID',
    );
  });

  it('denies a half-configured spend dimension (rate without ceiling)', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, costPerToken: 2 }),
        usage(1, 1),
      ),
      'AI_COST_BUDGET_INVALID',
    );
  });

  it('denies a decimal total-token ceiling (tokens are whole units)', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(limit({ maxTotalTokens: 100.5 }), usage(1, 1)),
      'AI_COST_BUDGET_INVALID',
    );
  });

  it('denies a decimal prompt/completion sub-ceiling', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxPromptTokens: 10.25 }),
        usage(1, 1),
      ),
      'AI_COST_BUDGET_INVALID',
    );
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxCompletionTokens: 7.5 }),
        usage(1, 1),
      ),
      'AI_COST_BUDGET_INVALID',
    );
  });

  it('denies costPerToken of 0 (a zero rate is over-permissive)', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxSpend: 100, costPerToken: 0 }),
        usage(1, 1),
      ),
      'AI_COST_BUDGET_INVALID',
    );
  });

  it('requires costPerToken to be strictly > 0 when spend is configured', () => {
    for (const badRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectDeny(
        evaluateAiRuntimeCostPolicy(
          limit({ maxTotalTokens: 1000, maxSpend: 100, costPerToken: badRate }),
          usage(1, 1),
        ),
        'AI_COST_BUDGET_INVALID',
      );
    }
  });

  it('accepts a decimal maxSpend (spend fields may be fractional)', () => {
    // A decimal SPEND ceiling is valid (only TOKEN fields must be integers).
    const out = evaluateAiRuntimeCostPolicy(
      limit({ maxTotalTokens: 1000, maxSpend: 0.5, costPerToken: 0.001 }),
      usage(100, 100),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.evaluatedSpend).toBeCloseTo(0.2, 10);
  });
});

// ===========================================================================
// Fail-closed — missing / invalid usage
// ===========================================================================

describe('Cost guard — fail-closed on missing / invalid usage', () => {
  it('denies when usage is null', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(limit(), null),
      'AI_COST_USAGE_MISSING',
    );
  });

  it('denies when usage is undefined', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(limit(), undefined),
      'AI_COST_USAGE_MISSING',
    );
  });

  it('denies when a usage count is NaN', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(limit(), usage(Number.NaN, 10, 10)),
      'AI_COST_USAGE_INVALID',
    );
  });

  it('denies when a usage count is non-finite (Infinity)', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        limit(),
        usage(10, Number.POSITIVE_INFINITY, 10),
      ),
      'AI_COST_USAGE_INVALID',
    );
  });

  it('denies when a usage count is negative', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(limit(), usage(-1, 10, 9)),
      'AI_COST_USAGE_INVALID',
    );
  });

  it('denies when a usage count is not a number', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(limit(), {
        promptTokens: 10,
        completionTokens: 10,
        totalTokens: '20',
      } as unknown as AiProviderUsage),
      'AI_COST_USAGE_INVALID',
    );
  });

  it('denies when totalTokens is inconsistent with prompt + completion', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(limit(), usage(10, 10, 999)),
      'AI_COST_USAGE_INVALID',
    );
  });

  it('denies a decimal promptTokens count', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(limit(), usage(4.5, 1)),
      'AI_COST_USAGE_INVALID',
    );
  });

  it('denies a decimal completionTokens count', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(limit(), usage(1, 1.2)),
      'AI_COST_USAGE_INVALID',
    );
  });

  it('denies a decimal totalTokens count', () => {
    expectDeny(
      evaluateAiRuntimeCostPolicy(limit(), usage(5, 5, 10.5)),
      'AI_COST_USAGE_INVALID',
    );
  });

  it('validates the limit BEFORE the usage (limit code wins when both bad)', () => {
    // Bad limit AND bad usage -> the limit error is reported first (fail-closed
    // order is most-fundamental-first).
    expectDeny(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: -1 }),
        usage(Number.NaN, 1, 1),
      ),
      'AI_COST_BUDGET_INVALID',
    );
  });
});

// ===========================================================================
// Error-code taxonomy surface
// ===========================================================================

describe('Cost guard — error-code taxonomy', () => {
  it('exposes the expected five fail-closed denial codes', () => {
    expect([...AI_RUNTIME_COST_POLICY_ERROR_CODES]).toEqual([
      'AI_COST_BUDGET_MISSING',
      'AI_COST_BUDGET_INVALID',
      'AI_COST_USAGE_MISSING',
      'AI_COST_USAGE_INVALID',
      'AI_COST_BUDGET_EXCEEDED',
    ]);
  });

  it('uses unique, bounded, audit-safe codes (no PII, no content)', () => {
    const codes = [...AI_RUNTIME_COST_POLICY_ERROR_CODES];
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9_]+$/);
      expect(code.length).toBeLessThanOrEqual(200);
    }
  });

  it('keeps cost codes DISJOINT from production provider validation codes', () => {
    const validation = new Set<string>([...AI_PROVIDER_ERROR_CODES]);
    for (const code of AI_RUNTIME_COST_POLICY_ERROR_CODES) {
      expect(validation.has(code)).toBe(false);
    }
  });

  it('only ever returns codes from the declared taxonomy', () => {
    const taxonomy = new Set<string>([...AI_RUNTIME_COST_POLICY_ERROR_CODES]);
    const denials = [
      evaluateAiRuntimeCostPolicy(null, usage(1, 1)),
      evaluateAiRuntimeCostPolicy(limit({ maxTotalTokens: -1 }), usage(1, 1)),
      evaluateAiRuntimeCostPolicy(limit(), null),
      evaluateAiRuntimeCostPolicy(limit(), usage(10, 10, 999)),
      evaluateAiRuntimeCostPolicy(limit({ maxTotalTokens: 10 }), usage(60, 60)),
    ];
    for (const d of denials) {
      expect(d.ok).toBe(false);
      if (!d.ok) expect(taxonomy.has(d.error.code)).toBe(true);
    }
  });
});

// ===========================================================================
// Purity & determinism
// ===========================================================================

describe('Cost guard — purity & determinism', () => {
  it('returns identical results for identical inputs', () => {
    const l = limit({ maxTotalTokens: 500, maxSpend: 1000, costPerToken: 1 });
    const u = usage(120, 80);
    expect(evaluateAiRuntimeCostPolicy(l, u)).toEqual(
      evaluateAiRuntimeCostPolicy(l, u),
    );
  });

  it('does not mutate its arguments (safe on frozen inputs)', () => {
    const l = Object.freeze(limit({ maxTotalTokens: 500 }));
    const u = Object.freeze(usage(100, 100));
    const before = JSON.stringify({ l, u });
    const out = evaluateAiRuntimeCostPolicy(l, u);
    expect(out.ok).toBe(true);
    expect(JSON.stringify({ l, u })).toBe(before);
  });

  it('invokes no global fetch during evaluation', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const out = evaluateAiRuntimeCostPolicy(limit(), usage(10, 10));
      expect(out.ok).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ===========================================================================
// Metadata-only — compatible with AiProviderUsage, no content/PII path
// ===========================================================================

describe('Cost guard — metadata-only & AiProviderUsage compatibility', () => {
  it('accepts the usage produced by the production fake provider', async () => {
    const provider = createFakeAiProvider();
    const generated = await provider.generateText({
      operation: 'REPLY_DRAFT',
      businessId: BIZ_A,
      prompt: 'SYSTEM RULES ... synthetic verified context ...',
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) throw new Error('unreachable: fake provider should succeed');

    const out = expectAllow(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 100_000 }),
        generated.data.usage,
      ),
    );
    expect(out.evaluatedTotalTokens).toBe(generated.data.usage.totalTokens);
  });

  it('reads ONLY token counts — extra PII-shaped fields never reach the decision', () => {
    // A usage object smuggling a PII-shaped field: the policy reads only the
    // three numeric token fields, so the field can never surface in the result.
    const smuggled = {
      promptTokens: 100,
      completionTokens: 100,
      totalTokens: 200,
      customerEmail: PII_EMAIL,
      note: 'ZZZ_SHOULD_NOT_APPEAR',
    } as unknown as AiProviderUsage;

    const out = expectAllow(
      evaluateAiRuntimeCostPolicy(limit({ maxTotalTokens: 1000 }), smuggled),
    );

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(PII_EMAIL);
    expect(serialized).not.toContain('jane.doe');
    expect(serialized).not.toContain('ZZZ_SHOULD_NOT_APPEAR');
  });

  it('surfaces only numeric metadata keys in the allowance', () => {
    const out = expectAllow(
      evaluateAiRuntimeCostPolicy(
        limit({ maxTotalTokens: 1000, maxSpend: 1000, costPerToken: 1 }),
        usage(100, 100),
      ),
    );
    expect(Object.keys(out).sort()).toEqual(
      [
        'allowed',
        'evaluatedCompletionTokens',
        'evaluatedPromptTokens',
        'evaluatedSpend',
        'evaluatedTotalTokens',
        'remainingSpend',
        'remainingTotalTokens',
      ].sort(),
    );
    // Every value (besides the `allowed` flag) is a finite number.
    for (const [k, v] of Object.entries(out)) {
      if (k === 'allowed') continue;
      expect(typeof v).toBe('number');
      expect(Number.isFinite(v as number)).toBe(true);
    }
  });
});

// ===========================================================================
// Static scope guards over the cost-policy helper surface
// ===========================================================================

describe('Cost guard — static scope guards (helper surface)', () => {
  function read(rel: string): string {
    return fs.readFileSync(path.resolve(rel), 'utf8');
  }

  function importPaths(src: string): string[] {
    return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  }

  it('imports no real provider / LLM SDK', () => {
    const src = read(HELPER_REL);
    expect(src).not.toMatch(
      /openai|anthropic|@anthropic-ai|@google|googleapis|gemini|vertex|cohere|mistral|llama|bedrock/i,
    );
    expect(src).not.toMatch(
      /require\(['"](?:openai|anthropic|@google|cohere|mistral)/,
    );
  });

  it('uses only allowlisted imports (no new deps)', () => {
    const allowed = new Set(['@/lib/result', '@/domains/ai-runtime']);
    for (const imp of importPaths(read(HELPER_REL))) {
      expect(allowed.has(imp)).toBe(true);
    }
  });

  it('makes no network request', () => {
    expect(read(HELPER_REL)).not.toMatch(
      /\bfetch\b|XMLHttpRequest|node:http\b|node:https\b|http\.request|https\.request|axios|undici/i,
    );
  });

  it('reads no environment / credential path', () => {
    const src = read(HELPER_REL);
    expect(src).not.toMatch(/process\.env/);
    // Also reject bracket access (process['env'] / process["env"]) and the
    // bundler-style import.meta.env, not just dot access.
    expect(src).not.toMatch(/process\s*\[\s*['"]env['"]\s*\]/);
    expect(src).not.toMatch(/import\s*\.\s*meta\s*\.\s*env/);
    expect(src).not.toMatch(/api[_-]?key/i);
  });

  it('uses no randomness (deterministic)', () => {
    expect(read(HELPER_REL)).not.toMatch(/Math\.random/);
  });

  it('reads no database / persistent counter', () => {
    const src = read(HELPER_REL);
    expect(src).not.toMatch(/PrismaClient|\.\$connect\b|prisma\./);
  });

  it('has no auto-send / dispatch / deliver / message-create path', () => {
    expect(read(HELPER_REL)).not.toMatch(
      /\b(sendMessage|autoSend|dispatch|deliver|sendDraft|createMessage)\s*\(/,
    );
  });

  it('has no customer/conversation/message/reply-draft read path', () => {
    const src = read(HELPER_REL);
    expect(src).not.toMatch(
      /\b(db|prisma)\.(customer|conversation|message|replyDraft)\b/,
    );
  });
});
