import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createGetAiDraftsDashboardHandler,
  type AiDraftsDashboardHandlerDeps,
  type AiDraftsDashboardResponse,
} from '@/app/api/businesses/[businessId]/dashboard/ai-drafts/handler';
import {
  createTenantRequestContext,
  type TenantRequestContext,
  type ContextResult,
} from '@/app/api/_shared/request-context';
import { apiError } from '@/app/api/_shared/responses';
import { ok, err } from '@/lib/result';
import { API_HANDLERS_FEATURE_FLAG } from '@/app/api/_shared/feature-gate';
import {
  DEV_AUTH_CONTEXT_FEATURE_FLAG,
  DEV_AUTH_HEADERS,
} from '@/app/api/_shared/auth-context-adapter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BIZ_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_BIZ = '55555555-5555-4555-8555-555555555555';
const MEM_ID = '66666666-6666-4666-8666-666666666666';
const CONV_ID_1 = '77777777-7777-4777-8777-777777777777';
const CONV_ID_2 = '88888888-8888-4888-8888-888888888888';
const DRAFT_ID_1 = 'aaaa1111-1111-4111-8111-111111111111';
const DRAFT_ID_2 = 'aaaa2222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------------------
// Mock composition (for route integration tests)
// ---------------------------------------------------------------------------

vi.mock('@/app/api/_shared/composition', () => ({
  getApiDependencies: () => ({
    repositories: {
      replyDrafts: {
        getDashboardDrafts: vi.fn().mockResolvedValue(ok({ pendingCount: 0, drafts: [] })),
      },
    },
    services: {
      authz: { requirePermission: vi.fn().mockResolvedValue(ok({ allowed: true })) },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

function mockDeps(): AiDraftsDashboardHandlerDeps & {
  replyDraftRepository: {
    getDashboardDrafts: ReturnType<typeof vi.fn>;
  };
  authzService: {
    requirePermission: ReturnType<typeof vi.fn>;
  };
} {
  return {
    replyDraftRepository: {
      getDashboardDrafts: vi.fn().mockResolvedValue(ok({ pendingCount: 0, drafts: [] })),
    },
    authzService: {
      requirePermission: vi.fn().mockResolvedValue(ok({ allowed: true })),
    },
  };
}

function okTenant(opts: { userId?: string; businessId?: string; membershipId?: string; role?: Role } = {}): (r: Request) => Promise<ContextResult<TenantRequestContext>> {
  return async () => ({ ok: true as const, context: createTenantRequestContext({ requestId: null, tenant: { userId: opts.userId ?? USER_ID, businessId: opts.businessId ?? BIZ_ID, membershipId: opts.membershipId ?? MEM_ID, role: opts.role ?? 'OWNER' } }) });
}

function failCtx<T>(): (r: Request) => Promise<ContextResult<T>> {
  return async () => ({ ok: false as const, response: apiError('AUTH_CONTEXT_UNAVAILABLE', 'Auth unavailable', 501) });
}

// ---------------------------------------------------------------------------
// Feature flag save/restore
// ---------------------------------------------------------------------------

let pA: string | undefined, pD: string | undefined;
beforeEach(() => { pA = process.env[API_HANDLERS_FEATURE_FLAG]; pD = process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG]; delete process.env[API_HANDLERS_FEATURE_FLAG]; delete process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG]; });
afterEach(() => { if (pA !== undefined) process.env[API_HANDLERS_FEATURE_FLAG] = pA; else delete process.env[API_HANDLERS_FEATURE_FLAG]; if (pD !== undefined) process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG] = pD; else delete process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG]; });

const P = { businessId: BIZ_ID };

// ===========================================================================
// Handler tests
// ===========================================================================

describe('AI Drafts Dashboard Handler', () => {
  // -------------------------------------------------------------------------
  // Authentication & Authorization
  // -------------------------------------------------------------------------

  it('returns 501 when context fails', async () => {
    const d = mockDeps();
    const h = createGetAiDraftsDashboardHandler({ ...d, resolveTenantContext: failCtx() });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(501);
    expect(d.replyDraftRepository.getDashboardDrafts).not.toHaveBeenCalled();
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
  });

  it('rejects invalid businessId', async () => {
    const d = mockDeps();
    const h = createGetAiDraftsDashboardHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), { businessId: 'bad' });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('INVALID_AI_DRAFTS_INPUT');
  });

  it('rejects businessId mismatch (cross-tenant)', async () => {
    const d = mockDeps();
    const h = createGetAiDraftsDashboardHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), { businessId: OTHER_BIZ });
    expect(r.status).toBe(403);
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
  });

  it('returns ACCESS_DENIED when authz denies', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(ok({ allowed: false }));
    const h = createGetAiDraftsDashboardHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(403);
    expect(d.replyDraftRepository.getDashboardDrafts).not.toHaveBeenCalled();
  });

  it('passes authz error through', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(err('INTERNAL_SERVER_ERROR', 'fail'));
    const h = createGetAiDraftsDashboardHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(500);
    expect(d.replyDraftRepository.getDashboardDrafts).not.toHaveBeenCalled();
  });

  it('uses ai_drafts.read permission (not conversations.read)', async () => {
    const d = mockDeps();
    const h = createGetAiDraftsDashboardHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x'), P);
    expect(d.authzService.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'ai_drafts.read' }),
    );
  });

  // -------------------------------------------------------------------------
  // RBAC: OWNER/ADMIN/OPERATOR should succeed, VIEWER should be denied
  // -------------------------------------------------------------------------

  it.each<Role>(['OWNER', 'ADMIN', 'OPERATOR'])(
    '%s gets 200 with empty drafts',
    async (role) => {
      const d = mockDeps();
      const h = createGetAiDraftsDashboardHandler({ ...d, resolveTenantContext: okTenant({ role }) });
      const r = await h(new Request('http://x'), P);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.ok).toBe(true);
      const data: AiDraftsDashboardResponse = body.data;
      expect(data.drafts).toEqual([]);
      expect(data.pendingCount).toBe(0);
      expect(data.businessId).toBe(BIZ_ID);
      expect(typeof data.generatedAt).toBe('string');
    },
  );

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  it('returns empty drafts list when none exist', async () => {
    const d = mockDeps();
    d.replyDraftRepository.getDashboardDrafts.mockResolvedValue(ok({ pendingCount: 0, drafts: [] }));
    const h = createGetAiDraftsDashboardHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(200);
    const data = (await r.json()).data as AiDraftsDashboardResponse;
    expect(data.pendingCount).toBe(0);
    expect(data.drafts).toEqual([]);
    expect(data.businessId).toBe(BIZ_ID);
  });

  // -------------------------------------------------------------------------
  // Data state
  // -------------------------------------------------------------------------

  it('returns pending/edited drafts from repository', async () => {
    const d = mockDeps();
    const mockDrafts = [
      {
        id: DRAFT_ID_1,
        conversationId: CONV_ID_1,
        customerName: 'Alice Customer',
        subject: 'Order inquiry',
        channel: 'WEBSITE_CHAT',
        draftTextPreview: 'Thank you for reaching out...',
        source: 'SYSTEM' as const,
        status: 'PENDING_REVIEW' as const,
        createdAt: '2026-06-08T10:00:00.000Z',
      },
      {
        id: DRAFT_ID_2,
        conversationId: CONV_ID_2,
        customerName: null,
        subject: null,
        channel: 'INTERNAL',
        draftTextPreview: 'We received your message...',
        source: 'OPERATOR' as const,
        status: 'EDITED' as const,
        createdAt: '2026-06-08T09:00:00.000Z',
      },
    ];
    d.replyDraftRepository.getDashboardDrafts.mockResolvedValue(
      ok({ pendingCount: 2, drafts: mockDrafts }),
    );
    const h = createGetAiDraftsDashboardHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(200);
    const data = (await r.json()).data as AiDraftsDashboardResponse;
    expect(data.pendingCount).toBe(2);
    expect(data.drafts).toHaveLength(2);
    expect(data.drafts[0].id).toBe(DRAFT_ID_1);
    expect(data.drafts[0].status).toBe('PENDING_REVIEW');
    expect(data.drafts[0].customerName).toBe('Alice Customer');
    expect(data.drafts[1].id).toBe(DRAFT_ID_2);
    expect(data.drafts[1].status).toBe('EDITED');
    expect(data.drafts[1].customerName).toBeNull();
  });

  it('passes businessId to repository', async () => {
    const d = mockDeps();
    const h = createGetAiDraftsDashboardHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x'), P);
    expect(d.replyDraftRepository.getDashboardDrafts).toHaveBeenCalledWith(
      BIZ_ID,
      expect.any(Number),
    );
  });

  it('passes a reasonable limit to repository', async () => {
    const d = mockDeps();
    const h = createGetAiDraftsDashboardHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x'), P);
    const limit = d.replyDraftRepository.getDashboardDrafts.mock.calls[0][1];
    expect(limit).toBeGreaterThanOrEqual(5);
    expect(limit).toBeLessThanOrEqual(20);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('returns error when repository fails', async () => {
    const d = mockDeps();
    d.replyDraftRepository.getDashboardDrafts.mockResolvedValue(
      err('REPLY_DRAFT_REPOSITORY_ERROR', 'Repository operation failed'),
    );
    const h = createGetAiDraftsDashboardHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error.code).toBe('REPLY_DRAFT_REPOSITORY_ERROR');
  });

  // -------------------------------------------------------------------------
  // Scope guards
  // -------------------------------------------------------------------------

  it('handler does not import Prisma directly', () => {
    const handlerPath = path.resolve(
      __dirname,
      '../../src/app/api/businesses/[businessId]/dashboard/ai-drafts/handler.ts',
    );
    const src = fs.readFileSync(handlerPath, 'utf-8');
    expect(src).not.toContain("from '@prisma/client'");
    expect(src).not.toContain('from "@prisma/client"');
    expect(src).not.toContain("from '@/lib/prisma'");
    expect(src).not.toContain('from "@/lib/prisma"');
  });

  it('route does not import Prisma directly', () => {
    const routePath = path.resolve(
      __dirname,
      '../../src/app/api/businesses/[businessId]/dashboard/ai-drafts/route.ts',
    );
    const src = fs.readFileSync(routePath, 'utf-8');
    expect(src).not.toContain("from '@prisma/client'");
    expect(src).not.toContain('from "@prisma/client"');
    expect(src).not.toContain("from '@/lib/prisma'");
    expect(src).not.toContain('from "@/lib/prisma"');
  });

  it('handler follows DI pattern (uses dependency injection)', () => {
    const handlerPath = path.resolve(
      __dirname,
      '../../src/app/api/businesses/[businessId]/dashboard/ai-drafts/handler.ts',
    );
    const src = fs.readFileSync(handlerPath, 'utf-8');
    // Must export a handler builder function
    expect(src).toContain('export function createGetAiDraftsDashboardHandler');
    // Must accept deps parameter
    expect(src).toContain('AiDraftsDashboardHandlerDeps');
  });
});

// ===========================================================================
// Route feature gate tests
// ===========================================================================

describe('AI Drafts Dashboard Route', () => {
  it('returns 501 when feature flag is not set', async () => {
    delete process.env[API_HANDLERS_FEATURE_FLAG];
    // Re-import to get fresh route
    const routeModule = await import(
      '@/app/api/businesses/[businessId]/dashboard/ai-drafts/route'
    );
    const context = { params: Promise.resolve({ businessId: BIZ_ID }) };
    const r = await routeModule.GET(new Request('http://x'), context);
    expect(r.status).toBe(501);
  });

  it('returns non-501 when feature flag is enabled', async () => {
    process.env[API_HANDLERS_FEATURE_FLAG] = 'true';
    process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG] = 'true';
    const routeModule = await import(
      '@/app/api/businesses/[businessId]/dashboard/ai-drafts/route'
    );
    const devH = {
      [DEV_AUTH_HEADERS.userId]: USER_ID,
      [DEV_AUTH_HEADERS.businessId]: BIZ_ID,
      [DEV_AUTH_HEADERS.membershipId]: MEM_ID,
      [DEV_AUTH_HEADERS.role]: 'OWNER',
    };
    const context = { params: Promise.resolve({ businessId: BIZ_ID }) };
    const r = await routeModule.GET(
      new Request('http://x', { headers: devH }),
      context,
    );
    expect(r.status).not.toBe(501);
  });
});

// ===========================================================================
// Repository unit tests
// ===========================================================================

describe('ReplyDraft Repository', () => {
  it('getDashboardDrafts returns empty result when no drafts', async () => {
    const { createReplyDraftRepository } = await import('@/domains/reply-drafts/repository');
    const db = {
      replyDraft: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const repo = createReplyDraftRepository(db);
    const result = await repo.getDashboardDrafts(BIZ_ID, 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.pendingCount).toBe(0);
      expect(result.data.drafts).toEqual([]);
    }
  });

  it('getDashboardDrafts filters by PENDING_REVIEW and EDITED statuses', async () => {
    const { createReplyDraftRepository } = await import('@/domains/reply-drafts/repository');
    const db = {
      replyDraft: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const repo = createReplyDraftRepository(db);
    await repo.getDashboardDrafts(BIZ_ID, 10);
    expect(db.replyDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId: BIZ_ID,
          status: { in: ['PENDING_REVIEW', 'EDITED'] },
        },
      }),
    );
  });

  it('getDashboardDrafts passes limit and orders by createdAt desc', async () => {
    const { createReplyDraftRepository } = await import('@/domains/reply-drafts/repository');
    const db = {
      replyDraft: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const repo = createReplyDraftRepository(db);
    await repo.getDashboardDrafts(BIZ_ID, 5);
    expect(db.replyDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    );
  });

  it('getDashboardDrafts maps records to dashboard items', async () => {
    const { createReplyDraftRepository } = await import('@/domains/reply-drafts/repository');
    const mockRecord = {
      id: DRAFT_ID_1,
      conversationId: CONV_ID_1,
      source: 'SYSTEM' as const,
      status: 'PENDING_REVIEW' as const,
      draftText: 'Thank you for reaching out to us.',
      createdAt: new Date('2026-06-08T10:00:00.000Z'),
      conversation: {
        subject: 'Order inquiry',
        channel: 'WEBSITE_CHAT',
        customer: { displayName: 'Alice Customer' },
      },
    };
    const db = {
      replyDraft: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([mockRecord]),
      },
    };
    const repo = createReplyDraftRepository(db);
    const result = await repo.getDashboardDrafts(BIZ_ID, 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.pendingCount).toBe(1);
      expect(result.data.drafts).toHaveLength(1);
      const draft = result.data.drafts[0];
      expect(draft.id).toBe(DRAFT_ID_1);
      expect(draft.conversationId).toBe(CONV_ID_1);
      expect(draft.customerName).toBe('Alice Customer');
      expect(draft.subject).toBe('Order inquiry');
      expect(draft.channel).toBe('WEBSITE_CHAT');
      expect(draft.source).toBe('SYSTEM');
      expect(draft.status).toBe('PENDING_REVIEW');
      expect(draft.createdAt).toBe('2026-06-08T10:00:00.000Z');
    }
  });

  it('getDashboardDrafts handles null customer gracefully', async () => {
    const { createReplyDraftRepository } = await import('@/domains/reply-drafts/repository');
    const mockRecord = {
      id: DRAFT_ID_1,
      conversationId: CONV_ID_1,
      source: 'SYSTEM' as const,
      status: 'EDITED' as const,
      draftText: 'Short text',
      createdAt: new Date('2026-06-08T10:00:00.000Z'),
      conversation: {
        subject: null,
        channel: 'INTERNAL',
        customer: null,
      },
    };
    const db = {
      replyDraft: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([mockRecord]),
      },
    };
    const repo = createReplyDraftRepository(db);
    const result = await repo.getDashboardDrafts(BIZ_ID, 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.drafts[0].customerName).toBeNull();
      expect(result.data.drafts[0].subject).toBeNull();
    }
  });

  it('getDashboardDrafts truncates long preview text', async () => {
    const { createReplyDraftRepository } = await import('@/domains/reply-drafts/repository');
    const longText = 'A'.repeat(200);
    const mockRecord = {
      id: DRAFT_ID_1,
      conversationId: CONV_ID_1,
      source: 'AI' as const,
      status: 'PENDING_REVIEW' as const,
      draftText: longText,
      createdAt: new Date('2026-06-08T10:00:00.000Z'),
      conversation: {
        subject: null,
        channel: 'INTERNAL',
        customer: null,
      },
    };
    const db = {
      replyDraft: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([mockRecord]),
      },
    };
    const repo = createReplyDraftRepository(db);
    const result = await repo.getDashboardDrafts(BIZ_ID, 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const preview = result.data.drafts[0].draftTextPreview;
      expect(preview.length).toBeLessThanOrEqual(121); // 120 + ellipsis
      expect(preview).toContain('…');
    }
  });

  it('getDashboardDrafts does not truncate short text', async () => {
    const { createReplyDraftRepository } = await import('@/domains/reply-drafts/repository');
    const shortText = 'Hello, thanks for reaching out!';
    const mockRecord = {
      id: DRAFT_ID_1,
      conversationId: CONV_ID_1,
      source: 'SYSTEM' as const,
      status: 'PENDING_REVIEW' as const,
      draftText: shortText,
      createdAt: new Date('2026-06-08T10:00:00.000Z'),
      conversation: {
        subject: null,
        channel: 'INTERNAL',
        customer: null,
      },
    };
    const db = {
      replyDraft: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([mockRecord]),
      },
    };
    const repo = createReplyDraftRepository(db);
    const result = await repo.getDashboardDrafts(BIZ_ID, 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.drafts[0].draftTextPreview).toBe(shortText);
    }
  });

  it('getDashboardDrafts returns repository error on DB failure', async () => {
    const { createReplyDraftRepository } = await import('@/domains/reply-drafts/repository');
    const db = {
      replyDraft: {
        count: vi.fn().mockRejectedValue(new Error('db fail')),
        findMany: vi.fn().mockRejectedValue(new Error('db fail')),
      },
    };
    const repo = createReplyDraftRepository(db);
    const result = await repo.getDashboardDrafts(BIZ_ID, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('REPLY_DRAFT_REPOSITORY_ERROR');
    }
  });

  it('getDashboardDrafts includes conversation join', async () => {
    const { createReplyDraftRepository } = await import('@/domains/reply-drafts/repository');
    const db = {
      replyDraft: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const repo = createReplyDraftRepository(db);
    await repo.getDashboardDrafts(BIZ_ID, 10);
    const callArgs = db.replyDraft.findMany.mock.calls[0][0];
    expect(callArgs.include).toBeDefined();
    expect(callArgs.include.conversation).toBeDefined();
    expect(callArgs.include.conversation.select.subject).toBe(true);
    expect(callArgs.include.conversation.select.channel).toBe(true);
    expect(callArgs.include.conversation.select.customer).toBeDefined();
  });
});
