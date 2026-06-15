// ===========================================================================
// Tests — AI Config Resolver (B-R1)
//
// Proves the per-business AI policy resolver:
//  - defaults to MANUAL / disabled
//  - enables generation ONLY for explicit AI_ASSISTED
//  - fails closed for missing business, invalid mode, repo error, no context
//  - reads the businessId from the server-side context and never elsewhere
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ok, err } from '@/lib/result';
import {
  createAiConfigService,
  createAiConfigRepository,
  isBusinessAiMode,
  BUSINESS_AI_MODE_VALUES,
  DEFAULT_BUSINESS_AI_MODE,
  type AiConfigRepository,
} from '@/domains/ai-config';

const BIZ_A = '44444444-4444-4444-8444-444444444444';
const BIZ_B = '55555555-5555-4555-8555-555555555555';

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------

function mockRepo(
  impl: AiConfigRepository['findBusinessAiMode'],
): AiConfigRepository & { findBusinessAiMode: ReturnType<typeof vi.fn> } {
  return { findBusinessAiMode: vi.fn(impl) };
}

// ===========================================================================
// Types / guards
// ===========================================================================

describe('AI Config — types', () => {
  it('BUSINESS_AI_MODE_VALUES is exactly [MANUAL, AI_ASSISTED]', () => {
    expect([...BUSINESS_AI_MODE_VALUES]).toEqual(['MANUAL', 'AI_ASSISTED']);
  });

  it('default mode is MANUAL (Level 1, AI disabled)', () => {
    expect(DEFAULT_BUSINESS_AI_MODE).toBe('MANUAL');
  });

  it('isBusinessAiMode accepts valid and rejects invalid', () => {
    expect(isBusinessAiMode('MANUAL')).toBe(true);
    expect(isBusinessAiMode('AI_ASSISTED')).toBe(true);
    expect(isBusinessAiMode('AUTO_PILOT')).toBe(false);
    expect(isBusinessAiMode('')).toBe(false);
    expect(isBusinessAiMode(null)).toBe(false);
    expect(isBusinessAiMode(undefined)).toBe(false);
  });
});

// ===========================================================================
// Resolver behavior
// ===========================================================================

describe('AI Config — resolveAiPolicy', () => {
  it('MANUAL resolves to AI disabled', async () => {
    const repo = mockRepo(async () => ok('MANUAL'));
    const svc = createAiConfigService({ repository: repo });
    const res = await svc.resolveAiPolicy({ businessId: BIZ_A });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.aiMode).toBe('MANUAL');
      expect(res.data.aiGenerationEnabled).toBe(false);
    }
  });

  it('AI_ASSISTED resolves to AI enabled', async () => {
    const repo = mockRepo(async () => ok('AI_ASSISTED'));
    const svc = createAiConfigService({ repository: repo });
    const res = await svc.resolveAiPolicy({ businessId: BIZ_A });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.aiMode).toBe('AI_ASSISTED');
      expect(res.data.aiGenerationEnabled).toBe(true);
    }
  });

  it('missing business (null) fails closed to MANUAL/disabled', async () => {
    const repo = mockRepo(async () => ok(null));
    const svc = createAiConfigService({ repository: repo });
    const res = await svc.resolveAiPolicy({ businessId: BIZ_A });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.aiMode).toBe('MANUAL');
      expect(res.data.aiGenerationEnabled).toBe(false);
    }
  });

  it('unknown/invalid stored mode fails closed to MANUAL/disabled', async () => {
    // Simulate a corrupted/forward-incompatible value sneaking out of the DB.
    const repo = mockRepo(async () => ok('AUTO_PILOT' as never));
    const svc = createAiConfigService({ repository: repo });
    const res = await svc.resolveAiPolicy({ businessId: BIZ_A });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.aiMode).toBe('MANUAL');
      expect(res.data.aiGenerationEnabled).toBe(false);
    }
  });

  it('repository error fails closed to disabled', async () => {
    const repo = mockRepo(async () => err('AI_CONFIG_REPOSITORY_ERROR', 'boom'));
    const svc = createAiConfigService({ repository: repo });
    const res = await svc.resolveAiPolicy({ businessId: BIZ_A });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.aiGenerationEnabled).toBe(false);
  });

  it('empty businessId fails closed and never calls the repository', async () => {
    const repo = mockRepo(async () => ok('AI_ASSISTED'));
    const svc = createAiConfigService({ repository: repo });
    const res = await svc.resolveAiPolicy({ businessId: '' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.aiGenerationEnabled).toBe(false);
    expect(repo.findBusinessAiMode).not.toHaveBeenCalled();
  });

  it('uses the server-side context businessId (does not trust other input)', async () => {
    const repo = mockRepo(async () => ok('AI_ASSISTED'));
    const svc = createAiConfigService({ repository: repo });
    // Even if extra client-shaped fields are present, only context.businessId
    // is ever read and forwarded to the repository.
    await svc.resolveAiPolicy({
      businessId: BIZ_A,
      ...({ clientBusinessId: BIZ_B } as object),
    });
    expect(repo.findBusinessAiMode).toHaveBeenCalledWith(BIZ_A);
    expect(repo.findBusinessAiMode).not.toHaveBeenCalledWith(BIZ_B);
  });
});

// ===========================================================================
// Repository
// ===========================================================================

describe('AI Config — repository', () => {
  it('selects only ai_mode scoped by business id', async () => {
    const findUnique = vi.fn().mockResolvedValue({ aiMode: 'AI_ASSISTED' });
    const repo = createAiConfigRepository({ business: { findUnique } });
    const res = await repo.findBusinessAiMode(BIZ_A);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBe('AI_ASSISTED');
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: BIZ_A },
      select: { aiMode: true },
    });
  });

  it('returns null when the business does not exist', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const repo = createAiConfigRepository({ business: { findUnique } });
    const res = await repo.findBusinessAiMode(BIZ_A);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBeNull();
  });

  it('returns an error result on DB failure', async () => {
    const findUnique = vi.fn().mockRejectedValue(new Error('db down'));
    const repo = createAiConfigRepository({ business: { findUnique } });
    const res = await repo.findBusinessAiMode(BIZ_A);
    expect(res.ok).toBe(false);
  });
});

// ===========================================================================
// Scope guard — no AI provider / LLM dependency introduced
// ===========================================================================

describe('AI Config — no provider dependency', () => {
  const files = [
    'src/domains/ai-config/types.ts',
    'src/domains/ai-config/service.ts',
    'src/domains/ai-config/repository.ts',
    'src/domains/ai-config/implementation.ts',
  ];

  it.each(files)('%s imports no LLM/provider SDK', (rel) => {
    const src = fs.readFileSync(path.resolve(rel), 'utf8');
    expect(src).not.toMatch(/openai|anthropic|@anthropic-ai|@google|gemini|cohere|mistral/i);
    expect(src).not.toMatch(/require\(['"](?:openai|anthropic|@google-ai)/);
  });
});
