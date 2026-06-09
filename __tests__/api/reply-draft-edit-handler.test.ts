import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createEditDraftHandler,
  type EditDraftHandlerDeps,
} from '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/edit/handler';
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

const DRAFT_TEXT = 'Hello, this is my edited draft text';
const ORIGINAL_TEXT = 'Original generated draft text';
const NEW_TEXT = 'Updated draft text by operator';

// ---------------------------------------------------------------------------
// Mock composition (for route integration tests)
// ---------------------------------------------------------------------------

vi.mock('@/app/api/_shared/composition', () => ({
  getApiDependencies: () => ({
    repositories: {
      replyDrafts: {
        editDraft: vi.fn().mockResolvedValue(ok({
          previousStatus: 'PENDING_REVIEW',
          previousTextLength: ORIGINAL_TEXT.length,
          newTextLength: NEW_TEXT.length,
          draft: {
            id: DRAFT_ID,
            conversationId: CONV_ID,
            status: 'EDITED',
            source: 'SYSTEM',
            draftText: NEW_TEXT,
            draftTextPreview: NEW_TEXT,
            originalText: ORIGINAL_TEXT,
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

function mockDeps(): EditDraftHandlerDeps & {
  replyDraftRepository: {
    editDraft: ReturnType<typeof vi.fn>;
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
      editDraft: vi.fn().mockResolvedValue(ok({
        previousStatus: 'PENDING_REVIEW',
        previousTextLength: ORIGINAL_TEXT.length,
        newTextLength: NEW_TEXT.length,
        draft: {
          id: DRAFT_ID,
          conversationId: CONV_ID,
          status: 'EDITED',
          source: 'SYSTEM',
          draftText: NEW_TEXT,
          draftTextPreview: NEW_TEXT,
          originalText: ORIGINAL_TEXT,
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

function editRequest(body?: unknown): Request {
  if (body === undefined) {
    return new Request('http://x', { method: 'POST' });
  }
  return new Request('http://x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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

describe('Edit Draft Handler', () => {

  // -------------------------------------------------------------------------
  // Auth / params / body validation
  // -------------------------------------------------------------------------

  it('returns 501 when context fails', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: failCtx() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(501);
  });

  it('rejects invalid businessId', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), { ...P, businessId: 'not-uuid' });
    expect(r.status).toBe(400);
  });

  it('rejects invalid conversationId', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), { ...P, conversationId: 'bad' });
    expect(r.status).toBe(400);
  });

  it('rejects invalid draftId', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), { ...P, draftId: 'bad' });
    expect(r.status).toBe(400);
  });

  it('rejects missing request body', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x', { method: 'POST' }), P);
    expect(r.status).toBe(400);
  });

  it('rejects missing draftText', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({}), P);
    expect(r.status).toBe(400);
  });

  it('rejects empty draftText', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: '' }), P);
    expect(r.status).toBe(400);
  });

  it('rejects whitespace-only draftText', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: '   \n\t  ' }), P);
    expect(r.status).toBe(400);
  });

  it('rejects draftText exceeding 5000 characters', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: 'a'.repeat(5001) }), P);
    expect(r.status).toBe(400);
  });

  it('accepts draftText at exactly 5000 characters', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: 'a'.repeat(5000) }), P);
    expect(r.status).toBe(200);
  });

  it('rejects businessId mismatch (cross-tenant)', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), { ...P, businessId: OTHER_BIZ });
    expect(r.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // RBAC
  // -------------------------------------------------------------------------

  it('returns ACCESS_DENIED when authz denies', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(ok({ allowed: false }));
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(403);
  });

  it('passes authz error through', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(err('AUTHZ_ERROR', 'Authz error'));
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('uses ai_drafts.approve permission (not read or generate)', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(d.authzService.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'ai_drafts.approve' }),
    );
  });

  it('OWNER gets 200', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant({ role: 'OWNER' }) });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(200);
  });

  it('ADMIN gets 200', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant({ role: 'ADMIN' }) });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(200);
  });

  it('OPERATOR gets 200', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant({ role: 'OPERATOR' }) });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Conversation / draft validation
  // -------------------------------------------------------------------------

  it('returns 404 when conversation not found', async () => {
    const d = mockDeps();
    d.conversationRepository.findConversationById.mockResolvedValue(ok(null));
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('returns error when conversation lookup fails', async () => {
    const d = mockDeps();
    d.conversationRepository.findConversationById.mockResolvedValue(err('DB_ERROR', 'DB error'));
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('returns 404 when draft not found', async () => {
    const d = mockDeps();
    d.replyDraftRepository.editDraft.mockResolvedValue(err('DRAFT_NOT_FOUND', 'Draft not found'));
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(404);
  });

  it('returns 409 when DISCARDED cannot be edited', async () => {
    const d = mockDeps();
    d.replyDraftRepository.editDraft.mockResolvedValue(err('DRAFT_NOT_EDITABLE', 'Cannot edit'));
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(409);
  });

  it('returns 409 when APPROVED cannot be edited', async () => {
    const d = mockDeps();
    d.replyDraftRepository.editDraft.mockResolvedValue(err('DRAFT_NOT_EDITABLE', 'Cannot edit'));
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(409);
  });

  it('returns 409 when SENT cannot be edited', async () => {
    const d = mockDeps();
    d.replyDraftRepository.editDraft.mockResolvedValue(err('DRAFT_NOT_EDITABLE', 'Cannot edit'));
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(409);
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  it('PENDING_REVIEW → EDITED returns edited=true with correct draft', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.edited).toBe(true);
    expect(body.data.draft.status).toBe('EDITED');
    expect(body.data.draft.draftText).toBe(NEW_TEXT);
    expect(body.data.draft.source).toBe('SYSTEM');
    expect(body.data.draft.originalText).toBe(ORIGINAL_TEXT);
    expect(body.data.businessId).toBe(BIZ_ID);
    expect(body.data.conversationId).toBe(CONV_ID);
  });

  it('EDITED → EDITED returns edited=true', async () => {
    const d = mockDeps();
    d.replyDraftRepository.editDraft.mockResolvedValue(ok({
      previousStatus: 'EDITED',
      previousTextLength: DRAFT_TEXT.length,
      newTextLength: NEW_TEXT.length,
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        status: 'EDITED',
        source: 'SYSTEM',
        draftText: NEW_TEXT,
        draftTextPreview: NEW_TEXT,
        originalText: ORIGINAL_TEXT,
        updatedAt: NOW.toISOString(),
      },
    }));
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.edited).toBe(true);
    expect(body.data.draft.status).toBe('EDITED');
  });

  it('passes correct input to editDraft', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(d.replyDraftRepository.editDraft).toHaveBeenCalledWith({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      draftText: NEW_TEXT,
    });
  });

  it('returns error when repository edit fails', async () => {
    const d = mockDeps();
    d.replyDraftRepository.editDraft.mockResolvedValue(err('REPLY_DRAFT_REPOSITORY_ERROR', 'Repository error'));
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  // -------------------------------------------------------------------------
  // aiDraftStatus reconciliation
  // -------------------------------------------------------------------------

  it('reconciles aiDraftStatus to READY after successful edit', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(d.conversationRepository.updateConversation).toHaveBeenCalledWith(
      CONV_ID,
      { aiDraftStatus: 'READY' },
    );
  });

  it('succeeds even if aiDraftStatus reconciliation fails', async () => {
    const d = mockDeps();
    d.conversationRepository.updateConversation.mockResolvedValue(err('DB_ERROR', 'Update failed'));
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  it('emits audit event on successful edit with accurate metadata', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(d.auditService.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BIZ_ID,
        actorType: 'USER',
        actorUserId: USER_ID,
        action: 'ai_draft.edited',
        targetType: 'reply_draft',
        targetId: DRAFT_ID,
        result: 'SUCCESS',
        metadata: expect.objectContaining({
          conversationId: CONV_ID,
          previousStatus: 'PENDING_REVIEW',
          newStatus: 'EDITED',
          previousTextLength: ORIGINAL_TEXT.length,
          newTextLength: NEW_TEXT.length,
        }),
      }),
    );
  });

  it('EDITED → EDITED audit records previousStatus as EDITED', async () => {
    const d = mockDeps();
    d.replyDraftRepository.editDraft.mockResolvedValue(ok({
      previousStatus: 'EDITED',
      previousTextLength: DRAFT_TEXT.length,
      newTextLength: NEW_TEXT.length,
      draft: {
        id: DRAFT_ID,
        conversationId: CONV_ID,
        status: 'EDITED',
        source: 'SYSTEM',
        draftText: NEW_TEXT,
        draftTextPreview: NEW_TEXT,
        originalText: ORIGINAL_TEXT,
        updatedAt: NOW.toISOString(),
      },
    }));
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(d.auditService.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          previousStatus: 'EDITED',
          newStatus: 'EDITED',
        }),
      }),
    );
  });

  it('audit metadata does NOT contain full draftText or originalText', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(editRequest({ draftText: NEW_TEXT }), P);
    const call = d.auditService.createAuditEvent.mock.calls[0]?.[0];
    expect(call?.metadata).not.toHaveProperty('draftText');
    expect(call?.metadata).not.toHaveProperty('originalText');
  });

  it('succeeds even if audit write fails', async () => {
    const d = mockDeps();
    d.auditService.createAuditEvent.mockRejectedValue(new Error('Audit failed'));
    const h = createEditDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(200);
  });

  it('works without audit service (optional dep)', async () => {
    const d = mockDeps();
    const h = createEditDraftHandler({ ...d, auditService: undefined, resolveTenantContext: okTenant() });
    const r = await h(editRequest({ draftText: NEW_TEXT }), P);
    expect(r.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Scope guards
  // -------------------------------------------------------------------------

  it('handler does not import Prisma directly', async () => {
    const src = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/edit/handler.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/from ['"]@prisma\/client['"]/);
    expect(src).not.toMatch(/PrismaClient/);
  });

  it('route does not import Prisma directly', async () => {
    const src = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/edit/route.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/from ['"]@prisma\/client['"]/);
    expect(src).not.toMatch(/PrismaClient/);
  });

  it('no LLM/provider imports in handler', async () => {
    const src = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/edit/handler.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/^import.*(?:openai|anthropic|gemini)/im);
    expect(src).not.toMatch(/require\(['"](?:openai|anthropic|@google-ai)/);
  });

  it('no outbound message creation in handler', async () => {
    const src = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/edit/handler.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/createMessage|message\.create|OUTBOUND|senderType/i);
  });

  it('handler uses ai_drafts.approve not ai_drafts.generate', async () => {
    const src = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/edit/handler.ts'),
      'utf8',
    );
    expect(src).toMatch(/ai_drafts\.approve/);
    expect(src).not.toMatch(/ai_drafts\.generate/);
  });

  it('handler follows DI pattern', async () => {
    const src = fs.readFileSync(
      path.resolve('src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/edit/handler.ts'),
      'utf8',
    );
    expect(src).toMatch(/createEditDraftHandler/);
    expect(src).toMatch(/EditDraftHandlerDeps/);
  });
});

// ===========================================================================
// Route integration tests
// ===========================================================================

describe('Edit Draft Route', () => {
  it('returns 501 when feature flag is not set', async () => {
    delete process.env[API_HANDLERS_FEATURE_FLAG];
    const { POST } = await import(
      '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/edit/route'
    );
    const r = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [DEV_AUTH_HEADERS.userId]: USER_ID,
          [DEV_AUTH_HEADERS.businessId]: BIZ_ID,
          [DEV_AUTH_HEADERS.membershipId]: MEM_ID,
          [DEV_AUTH_HEADERS.role]: 'OWNER',
        },
        body: JSON.stringify({ draftText: NEW_TEXT }),
      }),
      { params: Promise.resolve({ businessId: BIZ_ID, conversationId: CONV_ID, draftId: DRAFT_ID }) },
    );
    expect(r.status).toBe(501);
  });

  it('returns non-501 when feature flag is enabled', async () => {
    process.env[API_HANDLERS_FEATURE_FLAG] = 'true';
    process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG] = 'true';
    const { POST } = await import(
      '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/edit/route'
    );
    const r = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [DEV_AUTH_HEADERS.userId]: USER_ID,
          [DEV_AUTH_HEADERS.businessId]: BIZ_ID,
          [DEV_AUTH_HEADERS.membershipId]: MEM_ID,
          [DEV_AUTH_HEADERS.role]: 'OWNER',
        },
        body: JSON.stringify({ draftText: NEW_TEXT }),
      }),
      { params: Promise.resolve({ businessId: BIZ_ID, conversationId: CONV_ID, draftId: DRAFT_ID }) },
    );
    expect(r.status).not.toBe(501);
  });
});

// ===========================================================================
// Repository unit tests — Edit
// ===========================================================================

describe('ReplyDraft Repository — Edit', () => {
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
          draftText: ORIGINAL_TEXT,
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
          status: args.data.status ?? 'EDITED',
          draftText: args.data.draftText ?? ORIGINAL_TEXT,
          originalText: ORIGINAL_TEXT,
          reviewedByUserId: args.data.reviewedByUserId ?? null,
          reviewedAt: args.data.reviewedAt ?? null,
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
    draftText: ORIGINAL_TEXT,
    originalText: ORIGINAL_TEXT,
    reviewedByUserId: null,
    reviewedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const editedDraft: ReplyDraftRecord = { ...pendingDraft, status: 'EDITED', draftText: DRAFT_TEXT };
  const discardedDraft: ReplyDraftRecord = { ...pendingDraft, status: 'DISCARDED', reviewedByUserId: USER_ID, reviewedAt: NOW };
  const approvedDraft: ReplyDraftRecord = { ...pendingDraft, status: 'APPROVED', reviewedByUserId: USER_ID, reviewedAt: NOW };
  const sentDraft: ReplyDraftRecord = { ...pendingDraft, status: 'SENT', reviewedByUserId: USER_ID, reviewedAt: NOW };

  it('editDraft transitions PENDING_REVIEW → EDITED', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(pendingDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.editDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      draftText: NEW_TEXT,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.previousStatus).toBe('PENDING_REVIEW');
      expect(result.data.draft.status).toBe('EDITED');
      expect(result.data.draft.draftText).toBe(NEW_TEXT);
      expect(result.data.draft.originalText).toBe(ORIGINAL_TEXT);
      expect(result.data.draft.source).toBe('SYSTEM');
      expect(result.data.previousTextLength).toBe(ORIGINAL_TEXT.length);
      expect(result.data.newTextLength).toBe(NEW_TEXT.length);
    }
    expect(db.replyDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DRAFT_ID },
        data: expect.objectContaining({
          status: 'EDITED',
          draftText: NEW_TEXT,
        }),
      }),
    );
  });

  it('editDraft transitions EDITED → EDITED', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(editedDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.editDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      draftText: NEW_TEXT,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.previousStatus).toBe('EDITED');
      expect(result.data.draft.status).toBe('EDITED');
    }
  });

  it('editDraft rejects DISCARDED draft', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(discardedDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.editDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      draftText: NEW_TEXT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_EDITABLE');
  });

  it('editDraft rejects APPROVED draft', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(approvedDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.editDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      draftText: NEW_TEXT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_EDITABLE');
  });

  it('editDraft rejects SENT draft', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(sentDraft);
    const repo = createReplyDraftRepository(db);
    const result = await repo.editDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      draftText: NEW_TEXT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_EDITABLE');
  });

  it('editDraft returns DRAFT_NOT_FOUND when not found', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(null);
    const repo = createReplyDraftRepository(db);
    const result = await repo.editDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      draftText: NEW_TEXT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_FOUND');
  });

  it('editDraft rejects when business mismatch', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue({ ...pendingDraft, businessId: OTHER_BIZ });
    const repo = createReplyDraftRepository(db);
    const result = await repo.editDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      draftText: NEW_TEXT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_FOUND');
  });

  it('editDraft rejects when conversation mismatch', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue({ ...pendingDraft, conversationId: OTHER_CONV_ID });
    const repo = createReplyDraftRepository(db);
    const result = await repo.editDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      draftText: NEW_TEXT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_FOUND');
  });

  it('editDraft preserves originalText and source', async () => {
    const db = mockDb();
    const operatorDraft: ReplyDraftRecord = { ...pendingDraft, source: 'OPERATOR', originalText: 'Operator original' };
    db.replyDraft.findUnique.mockResolvedValue(operatorDraft);
    db.replyDraft.update.mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
      ...operatorDraft,
      status: args.data.status ?? 'EDITED',
      draftText: args.data.draftText ?? operatorDraft.draftText,
      updatedAt: NOW,
    }));
    const repo = createReplyDraftRepository(db);
    const result = await repo.editDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      draftText: NEW_TEXT,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.draft.source).toBe('OPERATOR');
      expect(result.data.draft.originalText).toBe('Operator original');
    }
    // Update should NOT include source or originalText
    const updateCall = db.replyDraft.update.mock.calls[0]?.[0];
    expect(updateCall?.data).not.toHaveProperty('source');
    expect(updateCall?.data).not.toHaveProperty('originalText');
    expect(updateCall?.data).not.toHaveProperty('reviewedByUserId');
    expect(updateCall?.data).not.toHaveProperty('reviewedAt');
  });

  it('editDraft returns error on DB update failure', async () => {
    const db = mockDb();
    db.replyDraft.findUnique.mockResolvedValue(pendingDraft);
    db.replyDraft.update.mockRejectedValue(new Error('Update failed'));
    const repo = createReplyDraftRepository(db);
    const result = await repo.editDraft({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      draftText: NEW_TEXT,
    });
    expect(result.ok).toBe(false);
  });
});
