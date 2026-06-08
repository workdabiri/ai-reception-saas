import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createGenerateStubDraftHandler,
  STUB_DRAFT_TEXT,
  type GenerateStubDraftHandlerDeps,
} from '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/handler';
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
import {
  createReplyDraftRepository,
  type ReplyDraftRepositoryDb,
} from '@/domains/reply-drafts/repository';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BIZ_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_BIZ = '55555555-5555-4555-8555-555555555555';
const MEM_ID = '66666666-6666-4666-8666-666666666666';
const CONV_ID = '77777777-7777-4777-8777-777777777777';
const DRAFT_ID = 'aaaa1111-1111-4111-8111-111111111111';
const OTHER_CONV_ID = '88888888-8888-4888-8888-888888888888';

// ---------------------------------------------------------------------------
// Mock composition (for route integration tests)
// ---------------------------------------------------------------------------

vi.mock('@/app/api/_shared/composition', () => ({
  getApiDependencies: () => ({
    repositories: {
      replyDrafts: {
        generateOrReuseStubDraft: vi.fn().mockResolvedValue(ok({
          created: true,
          draft: {
            id: DRAFT_ID,
            conversationId: CONV_ID,
            source: 'SYSTEM',
            status: 'PENDING_REVIEW',
            draftTextPreview: 'Thanks for your message…',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        })),
      },
      conversations: {
        findConversationById: vi.fn().mockResolvedValue(ok({
          id: CONV_ID,
          businessId: BIZ_ID,
        })),
        updateConversation: vi.fn().mockResolvedValue(ok({ id: CONV_ID })),
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

function mockDeps(): GenerateStubDraftHandlerDeps & {
  replyDraftRepository: {
    generateOrReuseStubDraft: ReturnType<typeof vi.fn>;
  };
  conversationRepository: {
    findConversationById: ReturnType<typeof vi.fn>;
    updateConversation: ReturnType<typeof vi.fn>;
  };
  authzService: {
    requirePermission: ReturnType<typeof vi.fn>;
  };
} {
  return {
    replyDraftRepository: {
      generateOrReuseStubDraft: vi.fn().mockResolvedValue(ok({
        created: true,
        draft: {
          id: DRAFT_ID,
          conversationId: CONV_ID,
          source: 'SYSTEM',
          status: 'PENDING_REVIEW',
          draftTextPreview: STUB_DRAFT_TEXT,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      })),
    },
    conversationRepository: {
      findConversationById: vi.fn().mockResolvedValue(ok({
        id: CONV_ID,
        businessId: BIZ_ID,
        status: 'OPEN',
        channel: 'WEB_CHAT',
      })),
      updateConversation: vi.fn().mockResolvedValue(ok({ id: CONV_ID })),
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

const P = { businessId: BIZ_ID, conversationId: CONV_ID };

// ===========================================================================
// Handler tests
// ===========================================================================

describe('Generate Stub Draft Handler', () => {
  // -------------------------------------------------------------------------
  // Authentication & Authorization
  // -------------------------------------------------------------------------

  it('returns 501 when context fails', async () => {
    const d = mockDeps();
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: failCtx() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(501);
    expect(d.replyDraftRepository.generateOrReuseStubDraft).not.toHaveBeenCalled();
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
  });

  it('rejects invalid businessId', async () => {
    const d = mockDeps();
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), { businessId: 'bad', conversationId: CONV_ID });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('INVALID_DRAFT_INPUT');
  });

  it('rejects invalid conversationId', async () => {
    const d = mockDeps();
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), { businessId: BIZ_ID, conversationId: 'bad' });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('INVALID_DRAFT_INPUT');
  });

  it('rejects businessId mismatch (cross-tenant)', async () => {
    const d = mockDeps();
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), { businessId: OTHER_BIZ, conversationId: CONV_ID });
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('TENANT_ACCESS_DENIED');
  });

  it('returns ACCESS_DENIED when authz denies', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(ok({ allowed: false }));
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('ACCESS_DENIED');
  });

  it('passes authz error through', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(err('AUTHZ_ERROR', 'Authz error'));
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).not.toBe(200);
  });

  it('uses ai_drafts.generate permission (not ai_drafts.read)', async () => {
    const d = mockDeps();
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x', { method: 'POST' }), P);
    expect(d.authzService.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'ai_drafts.generate' }),
    );
  });

  it('OWNER gets 200', async () => {
    const d = mockDeps();
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant({ role: 'OWNER' }) });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
  });

  it('ADMIN gets 200', async () => {
    const d = mockDeps();
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant({ role: 'ADMIN' }) });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
  });

  it('OPERATOR gets 200', async () => {
    const d = mockDeps();
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant({ role: 'OPERATOR' }) });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Conversation validation
  // -------------------------------------------------------------------------

  it('returns 404 when conversation not found', async () => {
    const d = mockDeps();
    d.conversationRepository.findConversationById.mockResolvedValue(ok(null));
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe('CONVERSATION_NOT_FOUND');
    expect(d.replyDraftRepository.generateOrReuseStubDraft).not.toHaveBeenCalled();
  });

  it('returns error when conversation lookup fails', async () => {
    const d = mockDeps();
    d.conversationRepository.findConversationById.mockResolvedValue(err('DB_ERROR', 'DB error'));
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).not.toBe(200);
    expect(d.replyDraftRepository.generateOrReuseStubDraft).not.toHaveBeenCalled();
  });

  it('passes businessId to conversation lookup', async () => {
    const d = mockDeps();
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x', { method: 'POST' }), P);
    expect(d.conversationRepository.findConversationById).toHaveBeenCalledWith(CONV_ID, BIZ_ID);
  });

  // -------------------------------------------------------------------------
  // Draft generation
  // -------------------------------------------------------------------------

  it('creates a new draft when none exists', async () => {
    const d = mockDeps();
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.created).toBe(true);
    expect(body.data.draft).toBeDefined();
    expect(body.data.draft.source).toBe('SYSTEM');
    expect(body.data.draft.status).toBe('PENDING_REVIEW');
    expect(body.data.businessId).toBe(BIZ_ID);
    expect(body.data.conversationId).toBe(CONV_ID);
    expect(body.data.generatedAt).toBeDefined();
  });

  it('reuses existing draft when one exists', async () => {
    const d = mockDeps();
    d.replyDraftRepository.generateOrReuseStubDraft.mockResolvedValue(ok({
      created: false,
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        source: 'SYSTEM',
        status: 'EDITED',
        draftTextPreview: 'Modified text…',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    }));
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.created).toBe(false);
    expect(body.data.draft.status).toBe('EDITED');
  });

  it('passes deterministic STUB_DRAFT_TEXT to repository', async () => {
    const d = mockDeps();
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x', { method: 'POST' }), P);
    expect(d.replyDraftRepository.generateOrReuseStubDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draftText: STUB_DRAFT_TEXT,
        businessId: BIZ_ID,
        conversationId: CONV_ID,
        createdByUserId: USER_ID,
      }),
    );
  });

  it('generated text is deterministic', () => {
    expect(STUB_DRAFT_TEXT).toBe(
      'Thanks for your message. We received your request and an operator will review it before replying.',
    );
  });

  // -------------------------------------------------------------------------
  // Conversation.aiDraftStatus update
  // -------------------------------------------------------------------------

  it('updates aiDraftStatus to READY when draft is newly created', async () => {
    const d = mockDeps();
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x', { method: 'POST' }), P);
    expect(d.conversationRepository.updateConversation).toHaveBeenCalledWith(
      CONV_ID,
      { aiDraftStatus: 'READY' },
    );
  });

  it('reconciles aiDraftStatus to READY when existing reviewable draft is reused', async () => {
    const d = mockDeps();
    d.replyDraftRepository.generateOrReuseStubDraft.mockResolvedValue(ok({
      created: false,
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        source: 'SYSTEM',
        status: 'PENDING_REVIEW',
        draftTextPreview: STUB_DRAFT_TEXT,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    }));
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x', { method: 'POST' }), P);
    expect(d.conversationRepository.updateConversation).toHaveBeenCalledWith(
      CONV_ID,
      { aiDraftStatus: 'READY' },
    );
  });

  it('succeeds even if aiDraftStatus reconciliation fails (new draft)', async () => {
    const d = mockDeps();
    d.conversationRepository.updateConversation.mockResolvedValue(err('DB_ERROR', 'DB error'));
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.created).toBe(true);
  });

  it('succeeds even if aiDraftStatus reconciliation fails (reused draft)', async () => {
    const d = mockDeps();
    d.replyDraftRepository.generateOrReuseStubDraft.mockResolvedValue(ok({
      created: false,
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        source: 'SYSTEM',
        status: 'EDITED',
        draftTextPreview: 'Edited text…',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    }));
    d.conversationRepository.updateConversation.mockResolvedValue(err('DB_ERROR', 'DB error'));
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.created).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('returns error when repository fails', async () => {
    const d = mockDeps();
    d.replyDraftRepository.generateOrReuseStubDraft.mockResolvedValue(err('REPO_ERROR', 'Repository error'));
    const h = createGenerateStubDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).not.toBe(200);
  });

  // -------------------------------------------------------------------------
  // Scope guards
  // -------------------------------------------------------------------------

  it('handler does not import Prisma directly', async () => {
    const handlerSrc = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/handler.ts'),
      'utf8',
    );
    expect(handlerSrc).not.toMatch(/from ['"]@prisma\/client['"]/);
    expect(handlerSrc).not.toMatch(/from ['"]@\/lib\/prisma['"]/);
    expect(handlerSrc).not.toMatch(/import.*PrismaClient/);
  });

  it('route does not import Prisma directly', async () => {
    const routeSrc = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/route.ts'),
      'utf8',
    );
    expect(routeSrc).not.toMatch(/from ['"]@prisma\/client['"]/);
    expect(routeSrc).not.toMatch(/from ['"]@\/lib\/prisma['"]/);
    expect(routeSrc).not.toMatch(/import.*PrismaClient/);
  });

  it('no LLM/provider imports in handler', async () => {
    const handlerSrc = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/handler.ts'),
      'utf8',
    );
    expect(handlerSrc).not.toMatch(/^import.*(?:openai|anthropic|gemini)/im);
    // Verify no require() calls to LLM providers
    expect(handlerSrc).not.toMatch(/require\(['"](?:openai|anthropic|@google-ai)/);
  });

  it('handler follows DI pattern (uses dependency injection)', async () => {
    const handlerSrc = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/handler.ts'),
      'utf8',
    );
    expect(handlerSrc).toContain('GenerateStubDraftHandlerDeps');
    expect(handlerSrc).toContain('createGenerateStubDraftHandler');
  });

  it('no outbound message creation in handler', async () => {
    const handlerSrc = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/handler.ts'),
      'utf8',
    );
    expect(handlerSrc).not.toMatch(/createMessage/);
    expect(handlerSrc).not.toMatch(/message\.create/);
    expect(handlerSrc).not.toMatch(/OUTBOUND/);
  });
});

// ===========================================================================
// Route integration tests
// ===========================================================================

describe('Generate Stub Draft Route', () => {
  it('returns 501 when feature flag is not set', async () => {
    delete process.env[API_HANDLERS_FEATURE_FLAG];
    const { POST } = await import(
      '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/route'
    );
    const r = await POST(
      new Request('http://x', { method: 'POST' }),
      { params: Promise.resolve({ businessId: BIZ_ID, conversationId: CONV_ID }) },
    );
    expect(r.status).toBe(501);
  });

  it('returns non-501 when feature flag is enabled', async () => {
    process.env[API_HANDLERS_FEATURE_FLAG] = 'true';
    process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG] = 'true';
    const { POST } = await import(
      '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/route'
    );
    const r = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: {
          [DEV_AUTH_HEADERS.userId]: USER_ID,
          [DEV_AUTH_HEADERS.businessId]: BIZ_ID,
          [DEV_AUTH_HEADERS.membershipId]: MEM_ID,
          [DEV_AUTH_HEADERS.role]: 'OWNER',
        },
      }),
      { params: Promise.resolve({ businessId: BIZ_ID, conversationId: CONV_ID }) },
    );
    expect(r.status).not.toBe(501);
  });
});

// ===========================================================================
// Repository unit tests
// ===========================================================================

describe('ReplyDraft Repository — Generate', () => {
  function mockDb(): ReplyDraftRepositoryDb & {
    replyDraft: {
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  } {
    return {
      replyDraft: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({
          id: DRAFT_ID,
          businessId: BIZ_ID,
          conversationId: CONV_ID,
          source: 'SYSTEM',
          status: 'PENDING_REVIEW',
          draftText: STUB_DRAFT_TEXT,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      },
    };
  }

  it('findLatestReviewableByConversation filters PENDING_REVIEW/EDITED only', async () => {
    const db = mockDb();
    const repo = createReplyDraftRepository(db);
    await repo.findLatestReviewableByConversation(BIZ_ID, CONV_ID);
    expect(db.replyDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: BIZ_ID,
          conversationId: CONV_ID,
          status: { in: ['PENDING_REVIEW', 'EDITED'] },
        }),
        orderBy: { createdAt: 'desc' },
        take: 1,
      }),
    );
  });

  it('findLatestReviewableByConversation returns null when no drafts exist', async () => {
    const db = mockDb();
    const repo = createReplyDraftRepository(db);
    const result = await repo.findLatestReviewableByConversation(BIZ_ID, CONV_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
  });

  it('findLatestReviewableByConversation returns the record when found', async () => {
    const db = mockDb();
    db.replyDraft.findMany.mockResolvedValue([{
      id: DRAFT_ID,
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      source: 'SYSTEM',
      status: 'PENDING_REVIEW',
      draftText: STUB_DRAFT_TEXT,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }]);
    const repo = createReplyDraftRepository(db);
    const result = await repo.findLatestReviewableByConversation(BIZ_ID, CONV_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toBeNull();
      expect(result.data!.id).toBe(DRAFT_ID);
    }
  });

  it('findLatestReviewableByConversation returns error on DB failure', async () => {
    const db = mockDb();
    db.replyDraft.findMany.mockRejectedValue(new Error('DB error'));
    const repo = createReplyDraftRepository(db);
    const result = await repo.findLatestReviewableByConversation(BIZ_ID, CONV_ID);
    expect(result.ok).toBe(false);
  });

  it('createSystemDraft sets SYSTEM source and PENDING_REVIEW status', async () => {
    const db = mockDb();
    const repo = createReplyDraftRepository(db);
    const result = await repo.createSystemDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      createdByUserId: USER_ID,
      draftText: STUB_DRAFT_TEXT,
    });
    expect(result.ok).toBe(true);
    expect(db.replyDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: BIZ_ID,
          conversationId: CONV_ID,
          createdByUserId: USER_ID,
          source: 'SYSTEM',
          status: 'PENDING_REVIEW',
          draftText: STUB_DRAFT_TEXT,
          originalText: STUB_DRAFT_TEXT,
        }),
      }),
    );
  });

  it('createSystemDraft returns error on DB failure', async () => {
    const db = mockDb();
    db.replyDraft.create.mockRejectedValue(new Error('DB error'));
    const repo = createReplyDraftRepository(db);
    const result = await repo.createSystemDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      createdByUserId: USER_ID,
      draftText: STUB_DRAFT_TEXT,
    });
    expect(result.ok).toBe(false);
  });

  it('generateOrReuseStubDraft returns created=false if reviewable draft exists', async () => {
    const db = mockDb();
    db.replyDraft.findMany.mockResolvedValue([{
      id: DRAFT_ID,
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      source: 'SYSTEM',
      status: 'EDITED',
      draftText: 'Edited text',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }]);
    const repo = createReplyDraftRepository(db);
    const result = await repo.generateOrReuseStubDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      createdByUserId: USER_ID,
      draftText: STUB_DRAFT_TEXT,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.created).toBe(false);
      expect(result.data.draft.id).toBe(DRAFT_ID);
      expect(result.data.draft.status).toBe('EDITED');
    }
    // Should not create a new draft
    expect(db.replyDraft.create).not.toHaveBeenCalled();
  });

  it('generateOrReuseStubDraft creates new draft if none exists', async () => {
    const db = mockDb();
    const repo = createReplyDraftRepository(db);
    const result = await repo.generateOrReuseStubDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      createdByUserId: USER_ID,
      draftText: STUB_DRAFT_TEXT,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.created).toBe(true);
      expect(result.data.draft.source).toBe('SYSTEM');
      expect(result.data.draft.status).toBe('PENDING_REVIEW');
    }
    expect(db.replyDraft.create).toHaveBeenCalled();
  });

  it('generateOrReuseStubDraft returns draftTextPreview not full text', async () => {
    const db = mockDb();
    const longText = 'A'.repeat(200);
    db.replyDraft.create.mockResolvedValue({
      id: DRAFT_ID,
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      source: 'SYSTEM',
      status: 'PENDING_REVIEW',
      draftText: longText,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const repo = createReplyDraftRepository(db);
    const result = await repo.generateOrReuseStubDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      createdByUserId: USER_ID,
      draftText: longText,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.draft.draftTextPreview.length).toBeLessThanOrEqual(121); // 120 + '…'
      expect(result.data.draft.draftTextPreview.endsWith('…')).toBe(true);
    }
  });

  it('generateOrReuseStubDraft returns error on DB failure', async () => {
    const db = mockDb();
    db.replyDraft.findMany.mockRejectedValue(new Error('DB error'));
    const repo = createReplyDraftRepository(db);
    const result = await repo.generateOrReuseStubDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      createdByUserId: USER_ID,
      draftText: STUB_DRAFT_TEXT,
    });
    expect(result.ok).toBe(false);
  });

  it('generateOrReuseStubDraft scopes findMany by businessId', async () => {
    const db = mockDb();
    const repo = createReplyDraftRepository(db);
    await repo.generateOrReuseStubDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      createdByUserId: USER_ID,
      draftText: STUB_DRAFT_TEXT,
    });
    expect(db.replyDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: BIZ_ID,
        }),
      }),
    );
  });
});
