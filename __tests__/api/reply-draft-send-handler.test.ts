// ===========================================================================
// Reply Draft Send — Handler + Repository + Route tests
//
// Covers the explicit, human-triggered "send approved draft" action, performed
// as ONE atomic DB transaction: claim APPROVED → SENT + insert OUTBOUND message
// + link sentMessageId, commit-all-or-nothing.
//
// Safety properties pinned here:
//   - ai_drafts.send required (VIEWER denied; OWNER/ADMIN/OPERATOR allowed);
//   - only an APPROVED draft is sendable (PENDING_REVIEW / EDITED / DISCARDED
//     and missing drafts are rejected with explicit error codes);
//   - the transaction creates exactly one message AND links it atomically —
//     there is no "SENT + sentMessageId = null" orphan, even on a mid-send crash
//     (a thrown message insert rolls the claim back to APPROVED, no message);
//   - a re-send is idempotent — no duplicate message;
//   - ai_draft.sent AND message.created audits are content-free;
//   - the send path introduces NO provider / network / LLM / external channel.
// ===========================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createSendDraftHandler,
  type SendDraftHandlerDeps,
} from '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/send/handler';
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
  type ReplyDraftSendTxClient,
} from '@/domains/reply-drafts/repository';
import type { SentDraftView, SentMessageMetadata } from '@/domains/reply-drafts/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BIZ_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_BIZ = '55555555-5555-4555-8555-555555555555';
const MEM_ID = '66666666-6666-4666-8666-666666666666';
const CONV_ID = '77777777-7777-4777-8777-777777777777';
const DRAFT_ID = 'aaaa1111-1111-4111-8111-111111111111';
const MSG_ID = 'bbbb2222-2222-4222-8222-222222222222';
const OTHER_CONV_ID = '88888888-8888-4888-8888-888888888888';
const NOW = new Date('2026-01-15T12:00:00.000Z');

const DRAFT_TEXT = 'Hello, this is the approved reply to be sent';
const ORIGINAL_TEXT = 'Original generated draft text';

const HANDLER_PATH =
  'src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/send/handler.ts';
const ROUTE_PATH =
  'src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/send/route.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function sentDraftView(sentMessageId: string | null = MSG_ID): SentDraftView {
  return {
    id: DRAFT_ID,
    conversationId: CONV_ID,
    status: 'SENT',
    source: 'SYSTEM',
    draftTextPreview: DRAFT_TEXT,
    reviewedAt: NOW.toISOString(),
    reviewedByUserId: USER_ID,
    sentMessageId,
    sentAt: NOW.toISOString(),
    sentByUserId: USER_ID,
    updatedAt: NOW.toISOString(),
  };
}

function messageMetadata(): SentMessageMetadata {
  return {
    id: MSG_ID,
    conversationId: CONV_ID,
    direction: 'OUTBOUND',
    senderType: 'OPERATOR',
    senderUserId: USER_ID,
    createdAt: NOW.toISOString(),
  };
}

// MessageIdentity shape returned by conversationService.findMessageById.
function messageIdentity() {
  return {
    id: MSG_ID,
    conversationId: CONV_ID,
    businessId: BIZ_ID,
    direction: 'OUTBOUND' as const,
    senderType: 'OPERATOR' as const,
    senderUserId: USER_ID,
    senderCustomerId: null,
    content: DRAFT_TEXT,
    contentType: 'text/plain',
    channelMetadata: null,
    metadata: null,
    createdAt: NOW.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mock composition (for route integration tests)
// ---------------------------------------------------------------------------

vi.mock('@/app/api/_shared/composition', () => ({
  getApiDependencies: () => ({
    repositories: {
      replyDrafts: {
        sendApprovedDraft: vi.fn().mockResolvedValue(
          ok({ outcome: 'SENT_NOW', draft: sentDraftView(MSG_ID), message: messageMetadata() }),
        ),
      },
    },
    services: {
      conversations: {
        findConversationById: vi.fn().mockResolvedValue(ok({ id: CONV_ID, businessId: BIZ_ID })),
        findMessageById: vi.fn().mockResolvedValue(ok(messageIdentity())),
      },
      authz: { requirePermission: vi.fn().mockResolvedValue(ok({ allowed: true })) },
      audit: { createAuditEvent: vi.fn().mockResolvedValue(ok({ id: 'audit-1' })) },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock deps factory
// ---------------------------------------------------------------------------

type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

function mockDeps(): SendDraftHandlerDeps & {
  replyDraftRepository: { sendApprovedDraft: ReturnType<typeof vi.fn> };
  conversationService: {
    findConversationById: ReturnType<typeof vi.fn>;
    findMessageById: ReturnType<typeof vi.fn>;
  };
  authzService: { requirePermission: ReturnType<typeof vi.fn> };
  auditService: { createAuditEvent: ReturnType<typeof vi.fn> };
} {
  return {
    replyDraftRepository: {
      sendApprovedDraft: vi.fn().mockResolvedValue(
        ok({ outcome: 'SENT_NOW', draft: sentDraftView(MSG_ID), message: messageMetadata() }),
      ),
    },
    conversationService: {
      findConversationById: vi.fn().mockResolvedValue(ok({ id: CONV_ID, businessId: BIZ_ID })),
      findMessageById: vi.fn().mockResolvedValue(ok(messageIdentity())),
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
  return async () => ({
    ok: true as const,
    context: createTenantRequestContext({
      requestId: null,
      tenant: {
        userId: opts.userId ?? USER_ID,
        businessId: opts.businessId ?? BIZ_ID,
        membershipId: opts.membershipId ?? MEM_ID,
        role: opts.role ?? 'OWNER',
      },
    }),
  });
}

function failCtx<T>(): (r: Request) => Promise<ContextResult<T>> {
  return async () => ({ ok: false as const, response: apiError('AUTH_CONTEXT_UNAVAILABLE', 'Auth unavailable', 501) });
}

function sendRequest(): Request {
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

describe('Send Draft Handler', () => {
  it('returns 501 when context fails', async () => {
    const d = mockDeps();
    const h = createSendDraftHandler({ ...d, resolveTenantContext: failCtx() });
    const r = await h(sendRequest(), P);
    expect(r.status).toBe(501);
    expect(d.replyDraftRepository.sendApprovedDraft).not.toHaveBeenCalled();
  });

  it.each(['businessId', 'conversationId', 'draftId'])('rejects invalid %s', async (field) => {
    const d = mockDeps();
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(sendRequest(), { ...P, [field]: 'not-uuid' });
    expect(r.status).toBe(400);
  });

  it('rejects businessId mismatch (cross-tenant) and never sends', async () => {
    const d = mockDeps();
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(sendRequest(), { ...P, businessId: OTHER_BIZ });
    expect(r.status).toBe(403);
    expect(d.replyDraftRepository.sendApprovedDraft).not.toHaveBeenCalled();
  });

  it('VIEWER (authz denied) → 403 ACCESS_DENIED, no send, no audit', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(ok({ allowed: false }));
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant({ role: 'VIEWER' }) });
    const r = await h(sendRequest(), P);
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('ACCESS_DENIED');
    expect(d.replyDraftRepository.sendApprovedDraft).not.toHaveBeenCalled();
    expect(d.auditService.createAuditEvent).not.toHaveBeenCalled();
  });

  it('passes authz error through', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(err('AUTHZ_ERROR', 'Authz error'));
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(sendRequest(), P);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('uses ai_drafts.send permission (not approve or generate)', async () => {
    const d = mockDeps();
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(sendRequest(), P);
    expect(d.authzService.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'ai_drafts.send' }),
    );
  });

  it.each(['OWNER', 'ADMIN', 'OPERATOR'] as const)('%s can send an APPROVED draft (200)', async (role) => {
    const d = mockDeps();
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant({ role }) });
    const r = await h(sendRequest(), P);
    expect(r.status).toBe(200);
  });

  it('returns 404 CONVERSATION_NOT_FOUND when conversation missing (no send)', async () => {
    const d = mockDeps();
    d.conversationService.findConversationById.mockResolvedValue(ok(null));
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(sendRequest(), P);
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe('CONVERSATION_NOT_FOUND');
    expect(d.replyDraftRepository.sendApprovedDraft).not.toHaveBeenCalled();
  });

  it('returns error when conversation lookup fails', async () => {
    const d = mockDeps();
    d.conversationService.findConversationById.mockResolvedValue(err('DB_ERROR', 'DB error'));
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(sendRequest(), P);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('returns 404 DRAFT_NOT_FOUND when draft missing', async () => {
    const d = mockDeps();
    d.replyDraftRepository.sendApprovedDraft.mockResolvedValue(err('DRAFT_NOT_FOUND', 'Draft not found'));
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(sendRequest(), P);
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe('DRAFT_NOT_FOUND');
  });

  it('returns 409 DRAFT_NOT_SENDABLE (non-APPROVED draft), no audit', async () => {
    const d = mockDeps();
    d.replyDraftRepository.sendApprovedDraft.mockResolvedValue(
      err('DRAFT_NOT_SENDABLE', 'Only an approved draft can be sent'),
    );
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(sendRequest(), P);
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('DRAFT_NOT_SENDABLE');
    expect(d.auditService.createAuditEvent).not.toHaveBeenCalled();
  });

  it('returns error when repository send fails (no orphan surfaced as success)', async () => {
    const d = mockDeps();
    d.replyDraftRepository.sendApprovedDraft.mockResolvedValue(err('REPLY_DRAFT_REPOSITORY_ERROR', 'tx failed'));
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(sendRequest(), P);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(d.auditService.createAuditEvent).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // SENT_NOW happy path
  // -------------------------------------------------------------------------

  it('SENT_NOW: returns the SENT draft (with sentMessageId) + message metadata', async () => {
    const d = mockDeps();
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(sendRequest(), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.sent).toBe(true);
    expect(body.data.idempotent).toBe(false);
    expect(body.data.draft.status).toBe('SENT');
    expect(body.data.draft.sentMessageId).toBe(MSG_ID);
    expect(body.data.draft.sentByUserId).toBe(USER_ID);
    expect(body.data.message.id).toBe(MSG_ID);
    expect(body.data.message.direction).toBe('OUTBOUND');
    expect(body.data.message.senderType).toBe('OPERATOR');
  });

  it('passes the authenticated operator as sentByUserId', async () => {
    const d = mockDeps();
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(sendRequest(), P);
    expect(d.replyDraftRepository.sendApprovedDraft).toHaveBeenCalledWith({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      draftId: DRAFT_ID,
      sentByUserId: USER_ID,
    });
  });

  it('SENT_NOW: emits message.created AND ai_draft.sent, both content-free', async () => {
    const d = mockDeps();
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    await h(sendRequest(), P);

    const calls = d.auditService.createAuditEvent.mock.calls.map((c) => c[0]);
    const actions = calls.map((c) => c.action);
    expect(actions).toContain('message.created');
    expect(actions).toContain('ai_draft.sent');

    const messageCreated = calls.find((c) => c.action === 'message.created');
    expect(messageCreated).toMatchObject({
      actorType: 'USER',
      actorUserId: USER_ID,
      targetType: 'message',
      targetId: MSG_ID,
      result: 'SUCCESS',
      metadata: { conversationId: CONV_ID, direction: 'OUTBOUND', senderType: 'OPERATOR' },
    });

    const aiSent = calls.find((c) => c.action === 'ai_draft.sent');
    expect(aiSent).toMatchObject({
      targetType: 'reply_draft',
      targetId: DRAFT_ID,
      result: 'SUCCESS',
      metadata: expect.objectContaining({
        conversationId: CONV_ID,
        previousStatus: 'APPROVED',
        newStatus: 'SENT',
        messageId: MSG_ID,
      }),
    });

    // No content anywhere in either audit.
    for (const c of calls) {
      expect(c.metadata).not.toHaveProperty('draftText');
      expect(c.metadata).not.toHaveProperty('content');
      expect(JSON.stringify(c.metadata)).not.toContain(DRAFT_TEXT);
    }
  });

  it('succeeds even if audit writes fail', async () => {
    const d = mockDeps();
    d.auditService.createAuditEvent.mockRejectedValue(new Error('audit down'));
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(sendRequest(), P);
    expect(r.status).toBe(200);
  });

  it('works without an audit service (optional dep)', async () => {
    const d = mockDeps();
    const h = createSendDraftHandler({ ...d, auditService: undefined, resolveTenantContext: okTenant() });
    const r = await h(sendRequest(), P);
    expect(r.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  it('ALREADY_SENT: idempotent success, no audit re-emitted, fetches linked message', async () => {
    const d = mockDeps();
    d.replyDraftRepository.sendApprovedDraft.mockResolvedValue(
      ok({ outcome: 'ALREADY_SENT', draft: sentDraftView(MSG_ID), message: null }),
    );
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(sendRequest(), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.idempotent).toBe(true);
    expect(body.data.sent).toBe(true);
    expect(body.data.message.id).toBe(MSG_ID);
    expect(d.conversationService.findMessageById).toHaveBeenCalledWith({ messageId: MSG_ID, businessId: BIZ_ID });
    // Idempotent: no new audit events for an already-sent draft.
    expect(d.auditService.createAuditEvent).not.toHaveBeenCalled();
  });

  it('ALREADY_SENT with null sentMessageId → message null, no message lookup', async () => {
    const d = mockDeps();
    d.replyDraftRepository.sendApprovedDraft.mockResolvedValue(
      ok({ outcome: 'ALREADY_SENT', draft: sentDraftView(null), message: null }),
    );
    const h = createSendDraftHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(sendRequest(), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.idempotent).toBe(true);
    expect(body.data.message).toBeNull();
    expect(d.conversationService.findMessageById).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Static scope guards — the send path is internal-only (req #11)
  // -------------------------------------------------------------------------

  function codeOf(relPath: string): string {
    const src = fs.readFileSync(path.resolve(relPath), 'utf8');
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  }

  it('handler/route do not import Prisma directly', () => {
    for (const p of [HANDLER_PATH, ROUTE_PATH]) {
      const src = fs.readFileSync(path.resolve(p), 'utf8');
      expect(src).not.toMatch(/from ['"]@prisma\/client['"]/);
      expect(src).not.toMatch(/PrismaClient/);
    }
  });

  it('handler imports no AI-runtime / provider SDK and no external channel/network surface', () => {
    const code = codeOf(HANDLER_PATH);
    expect(code).not.toMatch(/@\/domains\/ai-runtime/);
    expect(code).not.toMatch(/\bopenai\b|@anthropic-ai|@google\/(generative|genai)|\bcohere\b|\bmistral\b|\bbedrock\b/i);
    expect(code).not.toMatch(/\btwilio\b|\bwhatsapp\b|\bnodemailer\b|\bmailer\b|\bsmtp\b/i);
    expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|\baxios\b|\bundici\b/);
    expect(code).not.toMatch(/process\.env/);
    expect(code).not.toMatch(/api[_-]?key/i);
    expect(code).not.toMatch(/auto[_-]?send/i);
  });

  it('handler requires ai_drafts.send and not ai_drafts.generate', () => {
    const src = fs.readFileSync(path.resolve(HANDLER_PATH), 'utf8');
    expect(src).toMatch(/ai_drafts\.send/);
    expect(src).not.toMatch(/ai_drafts\.generate/);
  });
});

// ===========================================================================
// Repository unit tests — atomic send
//
// A transactional in-memory fake models commit/rollback: writes happen on a
// snapshot inside $transaction and are committed only if the callback resolves.
// A thrown message insert therefore discards the claim — exactly the crash the
// fix must survive.
// ===========================================================================

describe('ReplyDraft Repository — atomic send', () => {
  function approvedDraft(): ReplyDraftRecord {
    return {
      id: DRAFT_ID,
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      source: 'SYSTEM',
      status: 'APPROVED',
      draftText: DRAFT_TEXT,
      originalText: ORIGINAL_TEXT,
      reviewedByUserId: USER_ID,
      reviewedAt: NOW,
      sentMessageId: null,
      sentAt: null,
      sentByUserId: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
  }

  type StoreMessage = { id: string; conversationId: string; businessId: string; direction: string; senderType: string; senderUserId: string | null; senderCustomerId: string | null; content: string; contentType: string; createdAt: Date };

  function makeAtomicDb(seed: ReplyDraftRecord[]) {
    let drafts = seed.map((d) => ({ ...d }));
    let messages: StoreMessage[] = [];
    let failMessageCreate = false;
    let msgCounter = 0;

    const db: ReplyDraftRepositoryDb = {
      replyDraft: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      // Transactional fake: snapshot → run → commit only on success.
      $transaction: async <T>(fn: (tx: ReplyDraftSendTxClient) => Promise<T>): Promise<T> => {
        const draftsCopy = drafts.map((d) => ({ ...d }));
        const messagesCopy = messages.map((m) => ({ ...m }));
        const tx: ReplyDraftSendTxClient = {
          replyDraft: {
            findUnique: async ({ where }) => draftsCopy.find((d) => d.id === where.id) ?? null,
            updateMany: async ({ where, data }) => {
              let count = 0;
              for (const d of draftsCopy) {
                if (
                  d.id === where.id &&
                  d.businessId === where.businessId &&
                  d.conversationId === where.conversationId &&
                  d.status === where.status
                ) {
                  Object.assign(d, data);
                  count++;
                }
              }
              return { count };
            },
            update: async ({ where, data }) => {
              const d = draftsCopy.find((x) => x.id === where.id);
              if (!d) throw new Error('draft not found');
              Object.assign(d, data);
              return { ...d };
            },
          },
          message: {
            create: async ({ data }) => {
              if (failMessageCreate) throw new Error('message create failed (simulated crash)');
              const m: StoreMessage = { id: `${MSG_ID}-${msgCounter++}`, ...data, createdAt: NOW };
              messagesCopy.push(m);
              return { ...m };
            },
          },
        };
        const result = await fn(tx); // throws → next two lines (commit) are skipped
        drafts = draftsCopy;
        messages = messagesCopy;
        return result;
      },
    };

    return {
      db,
      getDraft: (id = DRAFT_ID) => drafts.find((d) => d.id === id),
      getMessages: () => messages,
      setFailMessageCreate: (v: boolean) => { failMessageCreate = v; },
    };
  }

  const input = { businessId: BIZ_ID, conversationId: CONV_ID, draftId: DRAFT_ID, sentByUserId: USER_ID };

  it('APPROVED → SENT_NOW: links the message and leaves NO SENT+null orphan', async () => {
    const store = makeAtomicDb([approvedDraft()]);
    const repo = createReplyDraftRepository(store.db);
    const result = await repo.sendApprovedDraft(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.outcome).toBe('SENT_NOW');
      expect(result.data.draft.status).toBe('SENT');
      expect(result.data.draft.sentMessageId).toBeTruthy();
      expect(result.data.message?.direction).toBe('OUTBOUND');
      expect(result.data.message?.senderType).toBe('OPERATOR');
    }
    // Committed state: exactly one message, draft SENT *with* a linked id.
    expect(store.getMessages()).toHaveLength(1);
    const draft = store.getDraft();
    expect(draft?.status).toBe('SENT');
    expect(draft?.sentMessageId).toBe(store.getMessages()[0].id);
    expect(draft?.sentByUserId).toBe(USER_ID);
  });

  it('ORPHAN GUARD: a crash during message insert rolls back the claim (draft stays APPROVED, no message)', async () => {
    const store = makeAtomicDb([approvedDraft()]);
    store.setFailMessageCreate(true); // simulate process/DB failure mid-send
    const repo = createReplyDraftRepository(store.db);

    const result = await repo.sendApprovedDraft(input);

    // The send fails cleanly...
    expect(result.ok).toBe(false);
    // ...and CRUCIALLY the draft is NOT left as a SENT orphan: it is still
    // APPROVED with no sentMessageId, and no message was persisted.
    const draft = store.getDraft();
    expect(draft?.status).toBe('APPROVED');
    expect(draft?.sentMessageId ?? null).toBeNull();
    expect(draft?.sentAt ?? null).toBeNull();
    expect(store.getMessages()).toHaveLength(0);

    // And it is retryable: a subsequent send (no failure) completes normally.
    store.setFailMessageCreate(false);
    const retry = await repo.sendApprovedDraft(input);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.data.outcome).toBe('SENT_NOW');
    expect(store.getMessages()).toHaveLength(1);
    expect(store.getDraft()?.status).toBe('SENT');
    expect(store.getDraft()?.sentMessageId).toBe(store.getMessages()[0].id);
  });

  it('double-send (double-click): second call is ALREADY_SENT, exactly ONE message total', async () => {
    const store = makeAtomicDb([approvedDraft()]);
    const repo = createReplyDraftRepository(store.db);

    const first = await repo.sendApprovedDraft(input);
    const second = await repo.sendApprovedDraft(input);

    expect(first.ok && first.data.outcome).toBe('SENT_NOW');
    expect(second.ok && second.data.outcome).toBe('ALREADY_SENT');
    expect(store.getMessages()).toHaveLength(1); // no duplicate
  });

  it('already SENT → ALREADY_SENT, creates no message', async () => {
    const sent = { ...approvedDraft(), status: 'SENT' as const, sentMessageId: MSG_ID, sentAt: NOW, sentByUserId: USER_ID };
    const store = makeAtomicDb([sent]);
    const repo = createReplyDraftRepository(store.db);
    const result = await repo.sendApprovedDraft(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.outcome).toBe('ALREADY_SENT');
      expect(result.data.message).toBeNull();
    }
    expect(store.getMessages()).toHaveLength(0);
  });

  it.each([
    ['PENDING_REVIEW'],
    ['EDITED'],
    ['DISCARDED'],
  ])('%s → DRAFT_NOT_SENDABLE, creates no message and leaves the draft unchanged', async (status) => {
    const store = makeAtomicDb([{ ...approvedDraft(), status: status as ReplyDraftRecord['status'] }]);
    const repo = createReplyDraftRepository(store.db);
    const result = await repo.sendApprovedDraft(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_SENDABLE');
    expect(store.getMessages()).toHaveLength(0);
    expect(store.getDraft()?.status).toBe(status);
  });

  it('empty draft text → DRAFT_NOT_SENDABLE (never sends an empty message)', async () => {
    const store = makeAtomicDb([{ ...approvedDraft(), draftText: '   ' }]);
    const repo = createReplyDraftRepository(store.db);
    const result = await repo.sendApprovedDraft(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_SENDABLE');
    expect(store.getMessages()).toHaveLength(0);
  });

  it('not found → DRAFT_NOT_FOUND', async () => {
    const store = makeAtomicDb([]);
    const repo = createReplyDraftRepository(store.db);
    const result = await repo.sendApprovedDraft(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_FOUND');
  });

  it.each([
    ['business', { businessId: OTHER_BIZ }],
    ['conversation', { conversationId: OTHER_CONV_ID }],
  ])('%s scope mismatch → DRAFT_NOT_FOUND, no message', async (_label, override) => {
    const store = makeAtomicDb([{ ...approvedDraft(), ...override }]);
    const repo = createReplyDraftRepository(store.db);
    const result = await repo.sendApprovedDraft(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DRAFT_NOT_FOUND');
    expect(store.getMessages()).toHaveLength(0);
  });

  it('fails closed when no $transaction is available (mock client lacks it)', async () => {
    const db: ReplyDraftRepositoryDb = {
      replyDraft: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(approvedDraft()),
        update: vi.fn(),
      },
      // $transaction intentionally omitted
    };
    const repo = createReplyDraftRepository(db);
    const result = await repo.sendApprovedDraft(input);
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// Route integration tests
// ===========================================================================

describe('Send Draft Route', () => {
  it('returns 501 when feature flag is not set', async () => {
    delete process.env[API_HANDLERS_FEATURE_FLAG];
    const { POST } = await import(
      '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/send/route'
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
      '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/send/route'
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
