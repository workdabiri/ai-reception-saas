import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createApproveDraftHandler,
  type ApproveDraftHandlerDeps,
} from '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/handler';
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
const NOW = new Date('2026-01-15T12:00:00.000Z');

const DRAFT_TEXT = 'Hello, this is draft text for approval';
const ORIGINAL_TEXT = 'Original generated draft text';

// ---------------------------------------------------------------------------
// Mock composition (for route integration tests)
// ---------------------------------------------------------------------------

vi.mock('@/app/api/_shared/composition', () => ({
  getApiDependencies: () => ({
    repositories: {
      replyDrafts: {
        approveDraft: vi.fn().mockResolvedValue(ok({
          approved: true,
          previousStatus: 'PENDING_REVIEW',
          draft: {
            id: DRAFT_ID,
            conversationId: CONV_ID,
            status: 'APPROVED',
            source: 'SYSTEM',
            draftTextPreview: DRAFT_TEXT,
            reviewedAt: NOW.toISOString(),
            reviewedByUserId: USER_ID,
            updatedAt: NOW.toISOString(),
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
      audit: { createAuditEvent: vi.fn().mockResolvedValue(ok({ id: 'audit-1' })) },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

function mockDeps(): ApproveDraftHandlerDeps & {
  replyDraftRepository: {
    approveDraft: ReturnType<typeof vi.fn>;
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
      approveDraft: vi.fn().mockResolvedValue(ok({
        approved: true,
        previousStatus: 'PENDING_REVIEW',
        draft: {
          id: DRAFT_ID,
          conversationId: CONV_ID,
          status: 'APPROVED',
          source: 'SYSTEM',
          draftTextPreview: DRAFT_TEXT,
          reviewedAt: NOW.toISOString(),
          reviewedByUserId: USER_ID,
          updatedAt: NOW.toISOString(),
        },
      })),
    },
    conversationRepository: {
      findConversationById: vi.fn().mockResolvedValue(ok({
        id: CONV_ID,
        businessId: BIZ_ID,
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

function approveRequest(): Request {
  return new Request('http://x', { method: 'POST' });
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

describe('Approve Draft Handler', () => {

  // -------------------------------------------------------------------------
  // Auth / params validation
  // -------------------------------------------------------------------------

  it('returns 501 when context fails', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: failCtx() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(501);
  });

  it('rejects invalid businessId', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), { ...P, businessId: 'not-uuid' });
    expect(r.status).toBe(400);
  });

  it('rejects invalid conversationId', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), { ...P, conversationId: 'bad' });
    expect(r.status).toBe(400);
  });

  it('rejects invalid draftId', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), { ...P, draftId: 'bad' });
    expect(r.status).toBe(400);
  });

  it('rejects businessId mismatch (cross-tenant)', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), { ...P, businessId: OTHER_BIZ });
    expect(r.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // RBAC
  // -------------------------------------------------------------------------

  it('returns ACCESS_DENIED when authz denies', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(ok({ allowed: false }));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(403);
  });

  it('passes authz error through', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(err('AUTHZ_ERROR', 'Authz error'));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('uses ai_drafts.approve permission (not read or generate)', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(approveRequest(), P);
    expect(d.authzService.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'ai_drafts.approve' }),
    );
  });

  it('OWNER gets 200', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant({ role: 'OWNER' }) });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(200);
  });

  it('ADMIN gets 200', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant({ role: 'ADMIN' }) });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(200);
  });

  it('OPERATOR gets 200', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant({ role: 'OPERATOR' }) });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Conversation / draft validation
  // -------------------------------------------------------------------------

  it('returns 404 when conversation not found', async () => {
    const d = mockDeps();
    d.conversationRepository.findConversationById.mockResolvedValue(ok(null));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('returns error when conversation lookup fails', async () => {
    const d = mockDeps();
    d.conversationRepository.findConversationById.mockResolvedValue(err('DB_ERROR', 'DB error'));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('returns 404 when draft not found', async () => {
    const d = mockDeps();
    d.replyDraftRepository.approveDraft.mockResolvedValue(err('DRAFT_NOT_FOUND', 'Draft not found'));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(404);
  });

  it('returns 409 when DISCARDED cannot be approved', async () => {
    const d = mockDeps();
    d.replyDraftRepository.approveDraft.mockResolvedValue(err('DRAFT_NOT_APPROVABLE', 'Cannot approve'));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(409);
  });

  it('returns 409 when SENT cannot be approved', async () => {
    const d = mockDeps();
    d.replyDraftRepository.approveDraft.mockResolvedValue(err('DRAFT_NOT_APPROVABLE', 'Cannot approve'));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(409);
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  it('PENDING_REVIEW → APPROVED returns approved=true with correct draft', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.approved).toBe(true);
    expect(body.data.draft.status).toBe('APPROVED');
    expect(body.data.draft.source).toBe('SYSTEM');
    expect(body.data.draft.reviewedAt).toBeTruthy();
    expect(body.data.draft.reviewedByUserId).toBe(USER_ID);
    expect(body.data.businessId).toBe(BIZ_ID);
    expect(body.data.conversationId).toBe(CONV_ID);
  });

  it('EDITED → APPROVED returns approved=true', async () => {
    const d = mockDeps();
    d.replyDraftRepository.approveDraft.mockResolvedValue(ok({
      approved: true,
      previousStatus: 'EDITED',
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        status: 'APPROVED',
        source: 'SYSTEM',
        draftTextPreview: DRAFT_TEXT,
        reviewedAt: NOW.toISOString(),
        reviewedByUserId: USER_ID,
        updatedAt: NOW.toISOString(),
      },
    }));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.approved).toBe(true);
    expect(body.data.draft.status).toBe('APPROVED');
  });

  it('already APPROVED returns approved=false and 200 (idempotent)', async () => {
    const d = mockDeps();
    d.replyDraftRepository.approveDraft.mockResolvedValue(ok({
      approved: false,
      previousStatus: null,
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        status: 'APPROVED',
        source: 'SYSTEM',
        draftTextPreview: DRAFT_TEXT,
        reviewedAt: NOW.toISOString(),
        reviewedByUserId: USER_ID,
        updatedAt: NOW.toISOString(),
      },
    }));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.approved).toBe(false);
    expect(body.data.draft.status).toBe('APPROVED');
  });

  it('passes correct input to approveDraft', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(approveRequest(), P);
    expect(d.replyDraftRepository.approveDraft).toHaveBeenCalledWith({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
  });

  it('returns error when repository approve fails', async () => {
    const d = mockDeps();
    d.replyDraftRepository.approveDraft.mockResolvedValue(err('REPLY_DRAFT_REPOSITORY_ERROR', 'Repository error'));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  // -------------------------------------------------------------------------
  // aiDraftStatus reconciliation
  // -------------------------------------------------------------------------

  it('reconciles aiDraftStatus to APPROVED after successful approve', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(approveRequest(), P);
    expect(d.conversationRepository.updateConversation).toHaveBeenCalledWith(
      CONV_ID,
      { aiDraftStatus: 'APPROVED' },
    );
  });

  it('reconciles aiDraftStatus to APPROVED on idempotent already-APPROVED', async () => {
    const d = mockDeps();
    d.replyDraftRepository.approveDraft.mockResolvedValue(ok({
      approved: false,
      previousStatus: null,
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        status: 'APPROVED',
        source: 'SYSTEM',
        draftTextPreview: DRAFT_TEXT,
        reviewedAt: NOW.toISOString(),
        reviewedByUserId: USER_ID,
        updatedAt: NOW.toISOString(),
      },
    }));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(approveRequest(), P);
    expect(d.conversationRepository.updateConversation).toHaveBeenCalledWith(
      CONV_ID,
      { aiDraftStatus: 'APPROVED' },
    );
  });

  it('succeeds even if aiDraftStatus reconciliation fails', async () => {
    const d = mockDeps();
    d.conversationRepository.updateConversation.mockResolvedValue(err('DB_ERROR', 'Update failed'));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  it('emits audit event on successful approve with accurate metadata', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(approveRequest(), P);
    expect(d.auditService.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BIZ_ID,
        actorType: 'USER',
        actorUserId: USER_ID,
        action: 'ai_draft.approved',
        targetType: 'reply_draft',
        targetId: DRAFT_ID,
        result: 'SUCCESS',
        metadata: expect.objectContaining({
          conversationId: CONV_ID,
          previousStatus: 'PENDING_REVIEW',
          newStatus: 'APPROVED',
          approved: true,
        }),
      }),
    );
  });

  it('EDITED → APPROVED audit records previousStatus as EDITED', async () => {
    const d = mockDeps();
    d.replyDraftRepository.approveDraft.mockResolvedValue(ok({
      approved: true,
      previousStatus: 'EDITED',
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        status: 'APPROVED',
        source: 'SYSTEM',
        draftTextPreview: DRAFT_TEXT,
        reviewedAt: NOW.toISOString(),
        reviewedByUserId: USER_ID,
        updatedAt: NOW.toISOString(),
      },
    }));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(approveRequest(), P);
    expect(d.auditService.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          previousStatus: 'EDITED',
          newStatus: 'APPROVED',
        }),
      }),
    );
  });

  it('audit metadata does NOT contain full draftText or originalText', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(approveRequest(), P);
    const call = d.auditService.createAuditEvent.mock.calls[0]?.[0];
    expect(call?.metadata).not.toHaveProperty('draftText');
    expect(call?.metadata).not.toHaveProperty('originalText');
  });

  it('does NOT emit audit event on idempotent already-APPROVED', async () => {
    const d = mockDeps();
    d.replyDraftRepository.approveDraft.mockResolvedValue(ok({
      approved: false,
      previousStatus: null,
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        status: 'APPROVED',
        source: 'SYSTEM',
        draftTextPreview: DRAFT_TEXT,
        reviewedAt: NOW.toISOString(),
        reviewedByUserId: USER_ID,
        updatedAt: NOW.toISOString(),
      },
    }));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(approveRequest(), P);
    expect(d.auditService.createAuditEvent).not.toHaveBeenCalled();
  });

  it('succeeds even if audit write fails', async () => {
    const d = mockDeps();
    d.auditService.createAuditEvent.mockRejectedValue(new Error('Audit failed'));
    const h = createApproveDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(200);
  });

  it('works without audit service (optional dep)', async () => {
    const d = mockDeps();
    const h = createApproveDraftHandler({ ...d, auditService: undefined, resolveTenantContext: okTenant() });
    const r = await h(approveRequest(), P);
    expect(r.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Scope guards
  // -------------------------------------------------------------------------

  it('handler does not import Prisma directly', async () => {
    const src = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/handler.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/from ['"]@prisma\/client['"]/);
    expect(src).not.toMatch(/PrismaClient/);
  });

  it('route does not import Prisma directly', async () => {
    const src = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/route.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/from ['"]@prisma\/client['"]/);
    expect(src).not.toMatch(/PrismaClient/);
  });

  it('no LLM/provider imports in handler', async () => {
    const src = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/handler.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/^import.*(?:openai|anthropic|gemini)/im);
    expect(src).not.toMatch(/require\(['"](?:openai|anthropic|@google-ai)/);
  });

  it('no outbound message creation in handler', async () => {
    const src = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/handler.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/createMessage|message\.create|OUTBOUND|senderType/i);
  });

  it('handler uses ai_drafts.approve not ai_drafts.generate', async () => {
    const src = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/handler.ts'),
      'utf8',
    );
    expect(src).toMatch(/ai_drafts\.approve/);
    expect(src).not.toMatch(/ai_drafts\.generate/);
  });

  it('handler follows DI pattern', async () => {
    const src = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/handler.ts'),
      'utf8',
    );
    expect(src).toMatch(/createApproveDraftHandler/);
    expect(src).toMatch(/ApproveDraftHandlerDeps/);
  });
});

// ===========================================================================
// Route integration tests
// ===========================================================================

describe('Approve Draft Route', () => {
  it('returns 501 when feature flag is not set', async () => {
    delete process.env[API_HANDLERS_FEATURE_FLAG];
    const { POST } = await import(
      '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/route'
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
    expect(r.status).toBe(501);
  });

  it('returns non-501 when feature flag is enabled', async () => {
    process.env[API_HANDLERS_FEATURE_FLAG] = 'true';
    process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG] = 'true';
    const { POST } = await import(
      '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/route'
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
// Repository unit tests — Approve
// ===========================================================================

describe('ReplyDraft Repository — Approve', () => {
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
          draftText: DRAFT_TEXT,
          originalText: ORIGINAL_TEXT,
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
          status: args.data.status ?? 'APPROVED',
          draftText: (args.data as Record<string, unknown>).draftText ?? DRAFT_TEXT,
          originalText: ORIGINAL_TEXT,
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
    draftText: DRAFT_TEXT,
    originalText: ORIGINAL_TEXT,
    reviewedByUserId: null,
    reviewedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const editedDraft: ReplyDraftRecord = { ...pendingDraft, status: 'EDITED', draftText: 'Edited version' };
  const approvedDraft: ReplyDraftRecord = { ...pendingDraft, status: 'APPROVED', reviewedByUserId: USER_ID, reviewedAt: NOW };
  const discardedDraft: ReplyDraftRecord = { ...pendingDraft, status: 'DISCARDED', reviewedByUserId: USER_ID, reviewedAt: NOW };
  const sentDraft: ReplyDraftRecord = { ...pendingDraft, status: 'SENT', reviewedByUserId: USER_ID, reviewedAt: NOW };

  it('approveDraft transitions PENDING_REVIEW → APPROVED', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(pendingDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.approveDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.approved).toBe(true);
      expect(result.data.previousStatus).toBe('PENDING_REVIEW');
      expect(result.data.draft.status).toBe('APPROVED');
      expect(result.data.draft.source).toBe('SYSTEM');
      expect(result.data.draft.reviewedByUserId).toBe(USER_ID);
      expect(result.data.draft.reviewedAt).toBeTruthy();
      expect(result.data.draft.draftTextPreview).toBeTruthy();
    }
    expect(db.replyDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DRAFT_ID },
        data: expect.objectContaining({
          status: 'APPROVED',
          reviewedByUserId: USER_ID,
        }),
      }),
    );
  });

  it('approveDraft transitions EDITED → APPROVED', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(editedDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.approveDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.approved).toBe(true);
      expect(result.data.previousStatus).toBe('EDITED');
      expect(result.data.draft.status).toBe('APPROVED');
    }
  });

  it('approveDraft returns idempotent success for already APPROVED', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(approvedDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.approveDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.approved).toBe(false);
      expect(result.data.previousStatus).toBeNull();
      expect(result.data.draft.status).toBe('APPROVED');
    }
    // Should NOT call update on idempotent path
    expect(db.replyDraft.update).not.toHaveBeenCalled();
  });

  it('approveDraft rejects DISCARDED draft', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(discardedDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.approveDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_APPROVABLE');
  });

  it('approveDraft rejects SENT draft', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(sentDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.approveDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_APPROVABLE');
  });

  it('approveDraft returns DRAFT_NOT_FOUND when not found', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(null);
    const repo = createReplyDraftRepository(db);
    const result = await repo.approveDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_FOUND');
  });

  it('approveDraft rejects when business mismatch', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue({ ...pendingDraft, businessId: OTHER_BIZ });
    const repo = createReplyDraftRepository(db);
    const result = await repo.approveDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_FOUND');
  });

  it('approveDraft rejects when conversation mismatch', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue({ ...pendingDraft, conversationId: OTHER_CONV_ID });
    const repo = createReplyDraftRepository(db);
    const result = await repo.approveDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_FOUND');
  });

  it('approveDraft preserves draftText, originalText, and source', async () => {
    const db = mockDb();
    const operatorDraft: ReplyDraftRecord = { ...pendingDraft, source: 'OPERATOR', draftText: 'Operator text', originalText: 'Operator original' };
    db.replyDraft.findUnique.mockResolvedValue(operatorDraft);
    // Prisma preserves unmodified fields — mock the update response accordingly
    db.replyDraft.update.mockResolvedValue({
      ...operatorDraft,
      status: 'APPROVED',
      reviewedByUserId: USER_ID,
      reviewedAt: NOW,
    });
    const repo = createReplyDraftRepository(db);
    const result = await repo.approveDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.draft.source).toBe('OPERATOR');
    }
    // Update should NOT include draftText, originalText, or source
    const updateCall = db.replyDraft.update.mock.calls[0]?.[0];
    expect(updateCall?.data).not.toHaveProperty('draftText');
    expect(updateCall?.data).not.toHaveProperty('originalText');
    expect(updateCall?.data).not.toHaveProperty('source');
  });

  it('approveDraft returns error on DB update failure', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(pendingDraft);
    db.replyDraft.update.mockRejectedValue(new Error('Update failed'));
    const repo = createReplyDraftRepository(db);
    const result = await repo.approveDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      reviewedByUserId: USER_ID,
    });
    expect(result.ok).toBe(false);
  });
});
