// ===========================================================================
// Tests — AI Runtime: Tenant-Scoped AI Context Assembler (B-R3)
//
// Proves the assembler:
//  - fails closed (AI_CONTEXT_DISABLED) when aiMode is MANUAL / disabled
//  - returns a structured context ONLY when AI generation is enabled
//  - reads the businessId from the SERVER-RESOLVED context and nowhere else
//  - calls knowledge.listVerifiedItems with the context businessId
//  - never widens scope from client-supplied/options data
//  - includes only verified business-context items (provenance preserved)
//  - returns an empty list when there are no verified items
//  - fails closed when the knowledge service fails
//  - fails closed when tenant context is missing/invalid
//  - validates optional category/limit filters
//
// And static scope guards proving the domain introduces NO provider SDK, NO
// prompt builder/template, NO customer/conversation/message PII path, and NO
// auto-send path.
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ok, err } from '@/lib/result';
import {
  createAiRuntimeService,
  AI_RUNTIME_ERROR_CODES,
  type AiRuntimeService,
} from '@/domains/ai-runtime';
import type { AiConfigService } from '@/domains/ai-config';
import type { KnowledgeService } from '@/domains/knowledge';
import type { BusinessContextItem } from '@/domains/knowledge';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';
const VERIFIER = '44444444-4444-4444-8444-444444444444';
const FIXED_NOW = new Date('2026-06-15T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function verifiedItem(
  overrides: Partial<BusinessContextItem> = {},
): BusinessContextItem {
  return {
    id: 'item-1',
    businessId: BIZ_A,
    category: 'hours',
    key: 'monday',
    value: 'Open 9:00–17:00',
    status: 'VERIFIED',
    sourceType: 'OWNER_APPROVED',
    sourceLabel: 'Owner dashboard',
    sourceUrl: null,
    sourceMetadata: { note: 'seasonal' },
    verifiedByUserId: VERIFIER,
    verifiedAt: '2026-06-10T09:00:00.000Z',
    createdByUserId: VERIFIER,
    createdAt: '2026-06-01T09:00:00.000Z',
    updatedAt: '2026-06-10T09:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

type MockedAiConfig = AiConfigService & {
  resolveAiPolicy: ReturnType<typeof vi.fn>;
};

type MockedKnowledge = KnowledgeService & {
  listVerifiedItems: ReturnType<typeof vi.fn>;
  createItem: ReturnType<typeof vi.fn>;
  verifyItem: ReturnType<typeof vi.fn>;
  archiveItem: ReturnType<typeof vi.fn>;
};

function mockAiConfig(enabled: boolean, mode?: 'MANUAL' | 'AI_ASSISTED') {
  const aiMode = mode ?? (enabled ? 'AI_ASSISTED' : 'MANUAL');
  return {
    resolveAiPolicy: vi.fn(async (ctx: { businessId: string }) =>
      ok({ businessId: ctx.businessId, aiMode, aiGenerationEnabled: enabled }),
    ),
  } as MockedAiConfig;
}

function mockKnowledge(
  impl: KnowledgeService['listVerifiedItems'] = async () => ok([]),
) {
  return {
    listVerifiedItems: vi.fn(impl),
    createItem: vi.fn(async () => ok({} as never)),
    verifyItem: vi.fn(async () => ok({} as never)),
    archiveItem: vi.fn(async () => ok({} as never)),
  } as MockedKnowledge;
}

function makeService(
  aiConfig: MockedAiConfig,
  knowledge: MockedKnowledge,
): AiRuntimeService {
  return createAiRuntimeService({
    aiConfig,
    knowledge,
    now: () => FIXED_NOW,
  });
}

// ===========================================================================
// Error code surface
// ===========================================================================

describe('AI Runtime — error codes', () => {
  it('exposes exactly the expected fail-closed error codes', () => {
    expect([...AI_RUNTIME_ERROR_CODES]).toEqual([
      'AI_CONTEXT_INVALID_TENANT_CONTEXT',
      'AI_CONTEXT_INVALID_OPTIONS',
      'AI_CONTEXT_DISABLED',
      'AI_CONTEXT_KNOWLEDGE_UNAVAILABLE',
    ]);
  });
});

// ===========================================================================
// Fail-closed: disabled / invalid context
// ===========================================================================

describe('AI Runtime — fail closed', () => {
  it('returns AI_CONTEXT_DISABLED when aiMode is MANUAL (disabled)', async () => {
    const aiConfig = mockAiConfig(false, 'MANUAL');
    const knowledge = mockKnowledge();
    const svc = makeService(aiConfig, knowledge);

    const res = await svc.assembleAiContext({ businessId: BIZ_A });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_DISABLED');
    // Disabled must NOT read knowledge.
    expect(knowledge.listVerifiedItems).not.toHaveBeenCalled();
  });

  it('returns AI_CONTEXT_DISABLED when the policy resolves to an error', async () => {
    const aiConfig = {
      resolveAiPolicy: vi.fn(async () => err('AI_CONFIG_REPOSITORY_ERROR', 'x')),
    } as unknown as MockedAiConfig;
    const knowledge = mockKnowledge();
    const svc = makeService(aiConfig, knowledge);

    const res = await svc.assembleAiContext({ businessId: BIZ_A });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_DISABLED');
    expect(knowledge.listVerifiedItems).not.toHaveBeenCalled();
  });

  it('returns AI_CONTEXT_DISABLED for an inconsistent policy (MANUAL but enabled)', async () => {
    // Defense-in-depth: even if a policy reports generation enabled while the
    // mode is not AI_ASSISTED, the assembler must fail closed and not read
    // knowledge.
    const aiConfig = mockAiConfig(true, 'MANUAL');
    const knowledge = mockKnowledge();
    const svc = makeService(aiConfig, knowledge);

    const res = await svc.assembleAiContext({ businessId: BIZ_A });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_DISABLED');
    expect(knowledge.listVerifiedItems).not.toHaveBeenCalled();
  });

  it('returns AI_CONTEXT_INVALID_TENANT_CONTEXT when businessId is empty', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge();
    const svc = makeService(aiConfig, knowledge);

    const res = await svc.assembleAiContext({ businessId: '' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_INVALID_TENANT_CONTEXT');
    // Never consult policy/knowledge without a valid tenant scope.
    expect(aiConfig.resolveAiPolicy).not.toHaveBeenCalled();
    expect(knowledge.listVerifiedItems).not.toHaveBeenCalled();
  });

  it('returns AI_CONTEXT_INVALID_TENANT_CONTEXT when businessId is not a UUID', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge();
    const svc = makeService(aiConfig, knowledge);

    const res = await svc.assembleAiContext({ businessId: 'not-a-uuid' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_INVALID_TENANT_CONTEXT');
    // A non-UUID is an invalid tenant context — never a policy/knowledge call.
    expect(aiConfig.resolveAiPolicy).not.toHaveBeenCalled();
    expect(knowledge.listVerifiedItems).not.toHaveBeenCalled();
  });

  it('returns AI_CONTEXT_INVALID_TENANT_CONTEXT when context is missing', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge();
    const svc = makeService(aiConfig, knowledge);

    // Simulate a caller that fails to pass a server-resolved context.
    const res = await svc.assembleAiContext(undefined as never);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_INVALID_TENANT_CONTEXT');
    expect(aiConfig.resolveAiPolicy).not.toHaveBeenCalled();
  });

  it('fails closed (AI_CONTEXT_KNOWLEDGE_UNAVAILABLE) when knowledge errors', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge(async () =>
      err('KNOWLEDGE_REPOSITORY_ERROR', 'db down'),
    );
    const svc = makeService(aiConfig, knowledge);

    const res = await svc.assembleAiContext({ businessId: BIZ_A });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_KNOWLEDGE_UNAVAILABLE');
  });
});

// ===========================================================================
// Enabled: structured assembly
// ===========================================================================

describe('AI Runtime — enabled assembly', () => {
  it('returns a structured context only when AI generation is enabled', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge(async () => ok([verifiedItem()]));
    const svc = makeService(aiConfig, knowledge);

    const res = await svc.assembleAiContext({ businessId: BIZ_A });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.businessId).toBe(BIZ_A);
      expect(res.data.aiMode).toBe('AI_ASSISTED');
      expect(res.data.aiGenerationEnabled).toBe(true);
      expect(res.data.assembledAt).toBe(FIXED_NOW.toISOString());
      expect(res.data.businessContextItems).toHaveLength(1);
    }
  });

  it('sets the success aiMode from the resolved policy (not a hardcoded string)', async () => {
    const aiConfig = mockAiConfig(true, 'AI_ASSISTED');
    const knowledge = mockKnowledge(async () => ok([]));
    const svc = makeService(aiConfig, knowledge);

    const res = await svc.assembleAiContext({ businessId: BIZ_A });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const policy = await aiConfig.resolveAiPolicy.mock.results[0].value;
      expect(res.data.aiMode).toBe(policy.data.aiMode);
      expect(res.data.aiMode).toBe('AI_ASSISTED');
    }
  });

  it('uses the server-resolved context businessId for BOTH policy and knowledge', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge(async () => ok([]));
    const svc = makeService(aiConfig, knowledge);

    await svc.assembleAiContext({ businessId: BIZ_A });

    expect(aiConfig.resolveAiPolicy).toHaveBeenCalledWith({ businessId: BIZ_A });
    expect(knowledge.listVerifiedItems).toHaveBeenCalledWith({
      businessId: BIZ_A,
      category: undefined,
      limit: undefined,
    });
  });

  it('never widens scope from extra client-shaped fields on the context', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge(async () => ok([]));
    const svc = makeService(aiConfig, knowledge);

    // A malicious/extra businessId field must be ignored — only the
    // server-resolved context.businessId is ever read.
    await svc.assembleAiContext({
      businessId: BIZ_A,
      ...({ clientBusinessId: BIZ_B } as object),
    });

    expect(knowledge.listVerifiedItems).toHaveBeenCalledTimes(1);
    const arg = knowledge.listVerifiedItems.mock.calls[0][0];
    expect(arg.businessId).toBe(BIZ_A);
    expect(arg.businessId).not.toBe(BIZ_B);
    expect(aiConfig.resolveAiPolicy).not.toHaveBeenCalledWith({
      businessId: BIZ_B,
    });
  });

  it('preserves provenance fields and excludes lifecycle/status noise', async () => {
    const aiConfig = mockAiConfig(true);
    const item = verifiedItem();
    const knowledge = mockKnowledge(async () => ok([item]));
    const svc = makeService(aiConfig, knowledge);

    const res = await svc.assembleAiContext({ businessId: BIZ_A });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const assembled = res.data.businessContextItems[0];
      expect(assembled).toEqual({
        id: item.id,
        category: item.category,
        key: item.key,
        value: item.value,
        sourceType: item.sourceType,
        sourceLabel: item.sourceLabel,
        sourceUrl: item.sourceUrl,
        sourceMetadata: item.sourceMetadata,
        verifiedByUserId: item.verifiedByUserId,
        verifiedAt: item.verifiedAt,
      });
      // No raw status / business / created-by metadata leaks into AI context.
      expect(assembled).not.toHaveProperty('status');
      expect(assembled).not.toHaveProperty('businessId');
      expect(assembled).not.toHaveProperty('createdByUserId');
    }
  });

  it('returns empty businessContextItems when there are no verified items', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge(async () => ok([]));
    const svc = makeService(aiConfig, knowledge);

    const res = await svc.assembleAiContext({ businessId: BIZ_A });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.businessContextItems).toEqual([]);
      // Empty is acceptable ONLY because policy is enabled — never invented.
      expect(res.data.aiGenerationEnabled).toBe(true);
    }
  });

  it('only includes items supplied by the (verified-only) knowledge service', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge(async () =>
      ok([
        verifiedItem({ id: 'a', key: 'monday' }),
        verifiedItem({ id: 'b', key: 'tuesday' }),
      ]),
    );
    const svc = makeService(aiConfig, knowledge);

    const res = await svc.assembleAiContext({ businessId: BIZ_A });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.businessContextItems.map((i) => i.id)).toEqual(['a', 'b']);
    }
  });
});

// ===========================================================================
// Options: validated, scope-narrowing only
// ===========================================================================

describe('AI Runtime — options', () => {
  it('forwards a valid category + limit as narrowing filters', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge(async () => ok([]));
    const svc = makeService(aiConfig, knowledge);

    await svc.assembleAiContext(
      { businessId: BIZ_A },
      { category: 'hours', limit: 10 },
    );

    expect(knowledge.listVerifiedItems).toHaveBeenCalledWith({
      businessId: BIZ_A,
      category: 'hours',
      limit: 10,
    });
  });

  it('rejects an invalid limit (zero/negative/non-integer)', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge();
    const svc = makeService(aiConfig, knowledge);

    for (const bad of [0, -1, 1.5]) {
      const res = await svc.assembleAiContext(
        { businessId: BIZ_A },
        { limit: bad },
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_INVALID_OPTIONS');
    }
    expect(knowledge.listVerifiedItems).not.toHaveBeenCalled();
  });

  it('rejects an empty category filter', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge();
    const svc = makeService(aiConfig, knowledge);

    const res = await svc.assembleAiContext(
      { businessId: BIZ_A },
      { category: '   ' },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_INVALID_OPTIONS');
    expect(knowledge.listVerifiedItems).not.toHaveBeenCalled();
  });

  it('rejects a businessId smuggled into options (strict, never stripped)', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge();
    const svc = makeService(aiConfig, knowledge);

    // A businessId in options must be REJECTED, not silently dropped — it could
    // otherwise be mistaken for a scope-widening lever.
    const res = await svc.assembleAiContext(
      { businessId: BIZ_A },
      { category: 'hours', ...({ businessId: BIZ_B } as object) },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_INVALID_OPTIONS');
    expect(knowledge.listVerifiedItems).not.toHaveBeenCalled();
  });

  it('rejects unknown option keys (strict)', async () => {
    const aiConfig = mockAiConfig(true);
    const knowledge = mockKnowledge();
    const svc = makeService(aiConfig, knowledge);

    const res = await svc.assembleAiContext(
      { businessId: BIZ_A },
      { category: 'hours', ...({ unexpected: true } as object) },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_INVALID_OPTIONS');
    expect(knowledge.listVerifiedItems).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Security / scope guards (static meta tests)
// ===========================================================================

describe('AI Runtime — scope guards (no provider / prompt / PII / send)', () => {
  const domainFiles = [
    'src/domains/ai-runtime/types.ts',
    'src/domains/ai-runtime/service.ts',
    'src/domains/ai-runtime/context-assembler.ts',
    'src/domains/ai-runtime/index.ts',
  ];

  /** Import specifiers (the path in `from '...'`) for a source file. */
  function importPaths(src: string): string[] {
    return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  }

  /** Allowlisted import paths — anything else is a scope violation. */
  const ALLOWED_IMPORTS = new Set([
    'zod',
    '@/lib/result',
    '@/domains/ai-config/service',
    '@/domains/ai-config/types',
    '@/domains/knowledge/service',
    '@/domains/knowledge/types',
    './types',
    './service',
    './context-assembler',
    // B-R4: provider boundary + deterministic fake provider re-exported by index.
    './provider',
    './fake-provider',
    // B-R5: provenance-aware prompt builder re-exported by index.
    './prompt-builder',
  ]);

  it.each(domainFiles)('%s imports no LLM/provider SDK', (rel) => {
    const src = fs.readFileSync(path.resolve(rel), 'utf8');
    expect(src).not.toMatch(
      /openai|anthropic|@anthropic-ai|@google|gemini|cohere|mistral|llama/i,
    );
    expect(src).not.toMatch(/require\(['"](?:openai|anthropic|@google-ai)/);
  });

  it.each(domainFiles)('%s only uses allowlisted imports (no new deps)', (rel) => {
    const src = fs.readFileSync(path.resolve(rel), 'utf8');
    for (const imp of importPaths(src)) {
      expect(ALLOWED_IMPORTS.has(imp)).toBe(true);
    }
  });

  it.each(domainFiles)(
    '%s has no prompt builder / prompt template construction',
    (rel) => {
      const src = fs.readFileSync(path.resolve(rel), 'utf8');
      // No prompt-construction identifiers anywhere in the assembler.
      expect(src).not.toMatch(
        /\b(buildPrompt|promptBuilder|systemPrompt|promptTemplate|renderPrompt)\b/,
      );
    },
  );

  it.each(domainFiles)(
    '%s has no customer/conversation/message/reply-draft read path',
    (rel) => {
      const src = fs.readFileSync(path.resolve(rel), 'utf8');
      // No delegate-style access to customer/conversation/message tables.
      expect(src).not.toMatch(
        /\b(db|prisma)\.(customer|conversation|message|replyDraft)\b/,
      );
      // No imports of customer/conversation/message/reply-draft domains.
      for (const imp of importPaths(src)) {
        expect(imp).not.toMatch(
          /domains\/(crm|conversations|reply-drafts)/,
        );
      }
    },
  );

  it.each(domainFiles)('%s has no auto-send / dispatch / deliver path', (rel) => {
    const src = fs.readFileSync(path.resolve(rel), 'utf8');
    expect(src).not.toMatch(
      /\b(sendMessage|autoSend|dispatch|deliver|sendDraft)\s*\(/,
    );
  });

  it('the only third-party import across the domain is zod', () => {
    const allImports = domainFiles.flatMap((rel) =>
      importPaths(fs.readFileSync(path.resolve(rel), 'utf8')),
    );
    const thirdParty = allImports.filter(
      (imp) => !imp.startsWith('.') && !imp.startsWith('@/'),
    );
    expect([...new Set(thirdParty)]).toEqual(['zod']);
  });
});
