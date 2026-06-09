import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createDiscardDraftHandler,
  type DiscardDraftHandlerDeps,
} from '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/discard/handler';
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
  type ReplyDraftRecord,
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
const OTHER_DRAFT_ID = 'bbbb2222-2222-4222-8222-222222222222';
const NOW = new Date('2026-01-15T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Mock composition (for route integration tests)
// ---------------------------------------------------------------------------

vi.mock('@/app/api/_shared/composition', () => ({
  getApiDependencies: () => ({
    repositories: {
      replyDrafts: {
        discardDraft: vi.fn().mockResolvedValue(ok({
          discarded: true,
          previousStatus: 'PENDING_REVIEW',
          draft: {
            id: DRAFT_ID,
            conversationId: CONV_ID,
            status: 'DISCARDED',
            source: 'SYSTEM',
            reviewedAt: NOW.toISOString(),
            reviewedByUserId: USER_ID,
            updatedAt: NOW.toISOString(),
          },
        })),
        countReviewableByConversation: vi.fn().mockResolvedValue(ok(0)),
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
      audit: { createAuditEvent: vi.fn().mockResolvedValue(ok({ id: 'audit-1' })) },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

function mockDeps(): DiscardDraftHandlerDeps & {
  replyDraftRepository: {
    discardDraft: ReturnType<typeof vi.fn>;
    countReviewableByConversation: ReturnType<typeof vi.fn>;
  };
  conversationRepository: {
    findConversationById: ReturnType<typeof vi.fn>;
    updateConversation: ReturnType<typeof vi.fn>;
  };
  authzService: {
    requirePermission: ReturnType<typeof vi.fn>;
  };
  auditService: {
    createAuditEvent: ReturnType<typeof vi.fn>;
  };
} {
  return {
    replyDraftRepository: {
      discardDraft: vi.fn().mockResolvedValue(ok({
        discarded: true,
        previousStatus: 'PENDING_REVIEW',
        draft: {
          id: DRAFT_ID,
          conversationId: CONV_ID,
          status: 'DISCARDED',
          source: 'SYSTEM',
          reviewedAt: NOW.toISOString(),
          reviewedByUserId: USER_ID,
          updatedAt: NOW.toISOString(),
        },
      })),
      countReviewableByConversation: vi.fn().mockResolvedValue(ok(0)),
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
    auditService: {
      createAuditEvent: vi.fn().mockResolvedValue(ok({ id: 'audit-1' })),
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

const P = { businessId: BIZ_ID, conversationId: CONV_ID, draftId: DRAFT_ID };

// ===========================================================================
// Handler tests
// ===========================================================================

describe('Discard Draft Handler', () => {
  // -------------------------------------------------------------------------
  // Authentication & Authorization
  // -------------------------------------------------------------------------

  it('returns 501 when context fails', async () => {
    const d = mockDeps();
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: failCtx() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(501);
    expect(d.replyDraftRepository.discardDraft).not.toHaveBeenCalled();
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
  });

  it('rejects invalid businessId', async () => {
    const d = mockDeps();
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), { businessId: 'bad', conversationId: CONV_ID, draftId: DRAFT_ID });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('INVALID_DISCARD_INPUT');
  });

  it('rejects invalid conversationId', async () => {
    const d = mockDeps();
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), { businessId: BIZ_ID, conversationId: 'bad', draftId: DRAFT_ID });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('INVALID_DISCARD_INPUT');
  });

  it('rejects invalid draftId', async () => {
    const d = mockDeps();
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), { businessId: BIZ_ID, conversationId: CONV_ID, draftId: 'bad' });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('INVALID_DISCARD_INPUT');
  });

  it('rejects businessId mismatch (cross-tenant)', async () => {
    const d = mockDeps();
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), { businessId: OTHER_BIZ, conversationId: CONV_ID, draftId: DRAFT_ID });
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('TENANT_ACCESS_DENIED');
  });

  it('returns ACCESS_DENIED when authz denies', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(ok({ allowed: false }));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('ACCESS_DENIED');
  });

  it('passes authz error through', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(err('AUTHZ_ERROR', 'Authz error'));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).not.toBe(200);
  });

  it('uses ai_drafts.approve permission (not read or generate)', async () => {
    const d = mockDeps();
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x', { method: 'POST' }), P);
    expect(d.authzService.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'ai_drafts.approve' }),
    );
  });

  it('OWNER gets 200', async () => {
    const d = mockDeps();
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant({ role: 'OWNER' }) });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
  });

  it('ADMIN gets 200', async () => {
    const d = mockDeps();
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant({ role: 'ADMIN' }) });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
  });

  it('OPERATOR gets 200', async () => {
    const d = mockDeps();
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant({ role: 'OPERATOR' }) });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Conversation validation
  // -------------------------------------------------------------------------

  it('returns 404 when conversation not found', async () => {
    const d = mockDeps();
    d.conversationRepository.findConversationById.mockResolvedValue(ok(null));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe('CONVERSATION_NOT_FOUND');
    expect(d.replyDraftRepository.discardDraft).not.toHaveBeenCalled();
  });

  it('returns error when conversation lookup fails', async () => {
    const d = mockDeps();
    d.conversationRepository.findConversationById.mockResolvedValue(err('DB_ERROR', 'DB error'));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).not.toBe(200);
    expect(d.replyDraftRepository.discardDraft).not.toHaveBeenCalled();
  });

  it('passes businessId to conversation lookup', async () => {
    const d = mockDeps();
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x', { method: 'POST' }), P);
    expect(d.conversationRepository.findConversationById).toHaveBeenCalledWith(CONV_ID, BIZ_ID);
  });

  // -------------------------------------------------------------------------
  // Draft lifecycle: discard transitions
  // -------------------------------------------------------------------------

  it('PENDING_REVIEW → DISCARDED returns discarded=true', async () => {
    const d = mockDeps();
    d.replyDraftRepository.discardDraft.mockResolvedValue(ok({
      discarded: true,
      previousStatus: 'PENDING_REVIEW',
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        status: 'DISCARDED',
        source: 'SYSTEM',
        reviewedAt: NOW.toISOString(),
        reviewedByUserId: USER_ID,
        updatedAt: NOW.toISOString(),
      },
    }));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.discarded).toBe(true);
    expect(body.data.draft.status).toBe('DISCARDED');
    expect(body.data.draft.reviewedByUserId).toBe(USER_ID);
    expect(body.data.businessId).toBe(BIZ_ID);
    expect(body.data.conversationId).toBe(CONV_ID);
  });

  it('already DISCARDED returns discarded=false and 200', async () => {
    const d = mockDeps();
    d.replyDraftRepository.discardDraft.mockResolvedValue(ok({
      discarded: false,
      previousStatus: null,
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        status: 'DISCARDED',
        source: 'SYSTEM',
        reviewedAt: '2026-01-14T00:00:00.000Z',
        reviewedByUserId: USER_ID,
        updatedAt: '2026-01-14T00:00:00.000Z',
      },
    }));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.discarded).toBe(false);
  });

  it('returns 404 when draft not found', async () => {
    const d = mockDeps();
    d.replyDraftRepository.discardDraft.mockResolvedValue(err('DRAFT_NOT_FOUND', 'Draft not found'));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe('DRAFT_NOT_FOUND');
  });

  it('returns 409 when APPROVED cannot be discarded', async () => {
    const d = mockDeps();
    d.replyDraftRepository.discardDraft.mockResolvedValue(err('DRAFT_NOT_DISCARDABLE', 'Cannot discard an approved or sent draft'));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('DRAFT_NOT_DISCARDABLE');
  });

  it('returns 409 when SENT cannot be discarded', async () => {
    const d = mockDeps();
    d.replyDraftRepository.discardDraft.mockResolvedValue(err('DRAFT_NOT_DISCARDABLE', 'Cannot discard'));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(409);
  });

  it('passes correct input to discardDraft', async () => {
    const d = mockDeps();
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x', { method: 'POST' }), P);
    expect(d.replyDraftRepository.discardDraft).toHaveBeenCalledWith({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
  });

  // -------------------------------------------------------------------------
  // Conversation.aiDraftStatus reconciliation
  // -------------------------------------------------------------------------

  it('reconciles aiDraftStatus to REJECTED when no reviewable drafts remain', async () => {
    const d = mockDeps();
    d.replyDraftRepository.countReviewableByConversation.mockResolvedValue(ok(0));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x', { method: 'POST' }), P);
    expect(d.conversationRepository.updateConversation).toHaveBeenCalledWith(
      CONV_ID,
      { aiDraftStatus: 'REJECTED' },
    );
  });

  it('does not reconcile aiDraftStatus when reviewable drafts remain', async () => {
    const d = mockDeps();
    d.replyDraftRepository.countReviewableByConversation.mockResolvedValue(ok(2));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x', { method: 'POST' }), P);
    expect(d.conversationRepository.updateConversation).not.toHaveBeenCalled();
  });

  it('succeeds even if aiDraftStatus reconciliation fails', async () => {
    const d = mockDeps();
    d.replyDraftRepository.countReviewableByConversation.mockResolvedValue(ok(0));
    d.conversationRepository.updateConversation.mockResolvedValue(err('DB_ERROR', 'DB error'));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.discarded).toBe(true);
  });

  it('succeeds even if reviewable count lookup fails', async () => {
    const d = mockDeps();
    d.replyDraftRepository.countReviewableByConversation.mockResolvedValue(err('DB_ERROR', 'Count failed'));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  it('PENDING_REVIEW discard records accurate previousStatus in audit metadata', async () => {
    const d = mockDeps();
    // Default mock returns previousStatus: 'PENDING_REVIEW'
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x', { method: 'POST' }), P);
    expect(d.auditService.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BIZ_ID,
        actorType: 'USER',
        actorUserId: USER_ID,
        action: 'ai_draft.discarded',
        targetType: 'reply_draft',
        targetId: DRAFT_ID,
        result: 'SUCCESS',
        metadata: expect.objectContaining({
          conversationId: CONV_ID,
          previousStatus: 'PENDING_REVIEW',
          newStatus: 'DISCARDED',
          discarded: true,
        }),
      }),
    );
  });

  it('EDITED discard records accurate previousStatus in audit metadata', async () => {
    const d = mockDeps();
    d.replyDraftRepository.discardDraft.mockResolvedValue(ok({
      discarded: true,
      previousStatus: 'EDITED',
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        status: 'DISCARDED',
        source: 'SYSTEM',
        reviewedAt: NOW.toISOString(),
        reviewedByUserId: USER_ID,
        updatedAt: NOW.toISOString(),
      },
    }));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x', { method: 'POST' }), P);
    expect(d.auditService.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          conversationId: CONV_ID,
          previousStatus: 'EDITED',
          newStatus: 'DISCARDED',
          discarded: true,
        }),
      }),
    );
  });

  it('does not emit audit event on idempotent discard (already discarded)', async () => {
    const d = mockDeps();
    d.replyDraftRepository.discardDraft.mockResolvedValue(ok({
      discarded: false,
      previousStatus: null,
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        status: 'DISCARDED',
        source: 'SYSTEM',
        reviewedAt: NOW.toISOString(),
        reviewedByUserId: USER_ID,
        updatedAt: NOW.toISOString(),
      },
    }));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x', { method: 'POST' }), P);
    expect(d.auditService.createAuditEvent).not.toHaveBeenCalled();
  });

  it('succeeds even if audit write fails', async () => {
    const d = mockDeps();
    d.auditService.createAuditEvent.mockRejectedValue(new Error('Audit DB down'));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
  });

  it('works without audit service (optional dep)', async () => {
    const d = mockDeps();
    const { auditService: _, ...depsWithoutAudit } = d;
    const h = createDiscardDraftHandler({ ...depsWithoutAudit, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Repository error handling
  // -------------------------------------------------------------------------

  it('returns error when repository discard fails', async () => {
    const d = mockDeps();
    d.replyDraftRepository.discardDraft.mockResolvedValue(err('REPO_ERROR', 'Repository error'));
    const h = createDiscardDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).not.toBe(200);
  });

  // -------------------------------------------------------------------------
  // Scope guards
  // -------------------------------------------------------------------------

  it('handler does not import Prisma directly', () => {
    const handlerSrc = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/discard/handler.ts'),
      'utf8',
    );
    expect(handlerSrc).not.toMatch(/from ['"]@prisma\/client['"]/);
    expect(handlerSrc).not.toMatch(/from ['"]@\/lib\/prisma['"]/);
    expect(handlerSrc).not.toMatch(/import.*PrismaClient/);
  });

  it('route does not import Prisma directly', () => {
    const routeSrc = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/discard/route.ts'),
      'utf8',
    );
    expect(routeSrc).not.toMatch(/from ['"]@prisma\/client['"]/);
    expect(routeSrc).not.toMatch(/from ['"]@\/lib\/prisma['"]/);
    expect(routeSrc).not.toMatch(/import.*PrismaClient/);
  });

  it('no LLM/provider imports in handler', () => {
    const handlerSrc = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/discard/handler.ts'),
      'utf8',
    );
    expect(handlerSrc).not.toMatch(/^import.*(?:openai|anthropic|gemini)/im);
    expect(handlerSrc).not.toMatch(/require\(['"](?:openai|anthropic|@google-ai)/);
  });

  it('no outbound message creation in handler', () => {
    const handlerSrc = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/discard/handler.ts'),
      'utf8',
    );
    expect(handlerSrc).not.toMatch(/createMessage/);
    expect(handlerSrc).not.toMatch(/message\.create/);
    expect(handlerSrc).not.toMatch(/OUTBOUND/);
  });

  it('handler uses ai_drafts.approve not ai_drafts.generate', () => {
    const handlerSrc = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/discard/handler.ts'),
      'utf8',
    );
    expect(handlerSrc).toContain("'ai_drafts.approve'");
    expect(handlerSrc).not.toContain("'ai_drafts.generate'");
    expect(handlerSrc).not.toContain("'ai_drafts.read'");
  });

  it('handler follows DI pattern', () => {
    const handlerSrc = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/discard/handler.ts'),
      'utf8',
    );
    expect(handlerSrc).toContain('DiscardDraftHandlerDeps');
    expect(handlerSrc).toContain('createDiscardDraftHandler');
  });
});

// ===========================================================================
// Route integration tests
// ===========================================================================

describe('Discard Draft Route', () => {
  it('returns 501 when feature flag is not set', async () => {
    delete process.env[API_HANDLERS_FEATURE_FLAG];
    const { POST } = await import(
      '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/discard/route'
    );
    const r = await POST(
      new Request('http://x', { method: 'POST' }),
      { params: Promise.resolve({ businessId: BIZ_ID, conversationId: CONV_ID, draftId: DRAFT_ID }) },
    );
    expect(r.status).toBe(501);
  });

  it('returns non-501 when feature flag is enabled', async () => {
    process.env[API_HANDLERS_FEATURE_FLAG] = 'true';
    process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG] = 'true';
    const { POST } = await import(
      '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/discard/route'
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
      { params: Promise.resolve({ businessId: BIZ_ID, conversationId: CONV_ID, draftId: DRAFT_ID }) },
    );
    expect(r.status).not.toBe(501);
  });
});

// ===========================================================================
// Repository unit tests — Discard
// ===========================================================================

describe('ReplyDraft Repository — Discard', () => {
  function mockDb(): ReplyDraftRepositoryDb & {
    replyDraft: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  } {
    return {
      replyDraft: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({
          id: DRAFT_ID,
          businessId: BIZ_ID,
          conversationId: CONV_ID,
          source: 'SYSTEM',
          status: 'PENDING_REVIEW',
          draftText: 'test',
          originalText: 'test',
          reviewedByUserId: null,
          reviewedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        }),
        update: vi.fn().mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
          id: args.where.id,
          businessId: BIZ_ID,
          conversationId: CONV_ID,
          source: 'SYSTEM',
          status: args.data.status ?? 'DISCARDED',
          draftText: (args.data as Record<string, unknown>).draftText as string ?? 'test',
          originalText: 'test',
          reviewedByUserId: args.data.reviewedByUserId ?? USER_ID,
          reviewedAt: args.data.reviewedAt ?? NOW,
          createdAt: NOW,
          updatedAt: NOW,
        })),
      },
    };
  }

  const pendingDraft: ReplyDraftRecord = {
    id: DRAFT_ID,
    businessId: BIZ_ID,
    conversationId: CONV_ID,
    source: 'SYSTEM',
    status: 'PENDING_REVIEW',
    draftText: 'Draft text',
    originalText: 'Draft text',
    reviewedByUserId: null,
    reviewedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const editedDraft: ReplyDraftRecord = { ...pendingDraft, status: 'EDITED' };
  const discardedDraft: ReplyDraftRecord = {
    ...pendingDraft,
    status: 'DISCARDED',
    reviewedByUserId: USER_ID,
    reviewedAt: NOW,
  };
  const approvedDraft: ReplyDraftRecord = {
    ...pendingDraft,
    status: 'APPROVED',
    reviewedByUserId: USER_ID,
    reviewedAt: NOW,
  };
  const sentDraft: ReplyDraftRecord = {
    ...pendingDraft,
    status: 'SENT',
    reviewedByUserId: USER_ID,
    reviewedAt: NOW,
  };

  // findByBusinessConversationAndId

  it('findByBusinessConversationAndId returns draft when scope matches', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(pendingDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.findByBusinessConversationAndId(BIZ_ID, CONV_ID, DRAFT_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toBeNull();
      expect(result.data!.id).toBe(DRAFT_ID);
    }
  });

  it('findByBusinessConversationAndId returns null when business mismatch', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(pendingDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.findByBusinessConversationAndId(OTHER_BIZ, CONV_ID, DRAFT_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
  });

  it('findByBusinessConversationAndId returns null when conversation mismatch', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(pendingDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.findByBusinessConversationAndId(BIZ_ID, OTHER_CONV_ID, DRAFT_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
  });

  it('findByBusinessConversationAndId returns null when not found', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(null);
    const repo = createReplyDraftRepository(db);
    const result = await repo.findByBusinessConversationAndId(BIZ_ID, CONV_ID, OTHER_DRAFT_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
  });

  it('findByBusinessConversationAndId returns error on DB failure', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockRejectedValue(new Error('DB error'));
    const repo = createReplyDraftRepository(db);
    const result = await repo.findByBusinessConversationAndId(BIZ_ID, CONV_ID, DRAFT_ID);
    expect(result.ok).toBe(false);
  });

  // discardDraft

  it('discardDraft transitions PENDING_REVIEW → DISCARDED', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(pendingDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.discardDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.discarded).toBe(true);
      expect(result.data.previousStatus).toBe('PENDING_REVIEW');
      expect(result.data.draft.status).toBe('DISCARDED');
      expect(result.data.draft.reviewedByUserId).toBe(USER_ID);
    }
    expect(db.replyDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DRAFT_ID },
        data: expect.objectContaining({
          status: 'DISCARDED',
          reviewedByUserId: USER_ID,
        }),
      }),
    );
  });

  it('discardDraft transitions EDITED → DISCARDED', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(editedDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.discardDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.discarded).toBe(true);
      expect(result.data.previousStatus).toBe('EDITED');
    }
  });

  it('discardDraft returns idempotent success for already DISCARDED', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(discardedDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.discardDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.discarded).toBe(false);
      expect(result.data.previousStatus).toBeNull();
      expect(result.data.draft.status).toBe('DISCARDED');
    }
    expect(db.replyDraft.update).not.toHaveBeenCalled();
  });

  it('discardDraft rejects APPROVED draft', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(approvedDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.discardDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_DISCARDABLE');
  });

  it('discardDraft rejects SENT draft', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(sentDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.discardDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_DISCARDABLE');
  });

  it('discardDraft returns DRAFT_NOT_FOUND when not found', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(null);
    const repo = createReplyDraftRepository(db);
    const result = await repo.discardDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_FOUND');
  });

  it('discardDraft returns error on DB update failure', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(pendingDraft);
    db.replyDraft.update.mockRejectedValue(new Error('Update failed'));
    const repo = createReplyDraftRepository(db);
    const result = await repo.discardDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(false);
  });

  // countReviewableByConversation

  it('countReviewableByConversation counts PENDING_REVIEW + EDITED', async () => {
    const db = mockDb();
    db.replyDraft.count.mockResolvedValue(3);
    const repo = createReplyDraftRepository(db);
    const result = await repo.countReviewableByConversation(BIZ_ID, CONV_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(3);
    expect(db.replyDraft.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: BIZ_ID,
          conversationId: CONV_ID,
          status: { in: ['PENDING_REVIEW', 'EDITED'] },
        }),
      }),
    );
  });

  it('countReviewableByConversation returns 0 when none exist', async () => {
    const db = mockDb();
    db.replyDraft.count.mockResolvedValue(0);
    const repo = createReplyDraftRepository(db);
    const result = await repo.countReviewableByConversation(BIZ_ID, CONV_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(0);
  });

  it('countReviewableByConversation returns error on DB failure', async () => {
    const db = mockDb();
    db.replyDraft.count.mockRejectedValue(new Error('DB error'));
    const repo = createReplyDraftRepository(db);
    const result = await repo.countReviewableByConversation(BIZ_ID, CONV_ID);
    expect(result.ok).toBe(false);
  });
});
