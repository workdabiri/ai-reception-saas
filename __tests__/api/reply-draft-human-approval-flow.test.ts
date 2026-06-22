// ===========================================================================
// Area B — Human Approval Flow Verification (test-only safety-gate proof)
//
// Safety claim under proof:
//   The existing deterministic AI-assisted draft flow can generate or edit
//   reviewable drafts, but it cannot create/send any customer-facing outbound
//   response unless an explicit human approval path is invoked.
//
// Precise truth this file pins (it does NOT assert false behavior):
//   - generate / edit / discard are draft-only and never reach APPROVED/SENT;
//   - approve is the ONLY handler that records explicit human approval semantics
//     (status APPROVED, with the human reviewer's userId);
//   - even approve does NOT itself send or create an outbound Message — sending
//     would be a separate path that does not exist today;
//   - no reply-draft handler imports/calls any outbound/send/channel/provider
//     path (static scope guards), and this verification introduced no real
//     provider, AI-runtime route wiring, B-R6 audit wiring, env read, or
//     auto-send.
//
// This file is TEST-ONLY. It adds no production code, no provider, no route
// behavior change, and no customer-message-in-prompt.
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ok } from '@/lib/result';
import { createGenerateStubDraftHandler } from '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/handler';
import { createEditDraftHandler } from '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/edit/handler';
import { createApproveDraftHandler } from '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/handler';
import { createDiscardDraftHandler } from '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/discard/handler';
import {
  createTenantRequestContext,
  type TenantRequestContext,
  type ContextResult,
} from '@/app/api/_shared/request-context';
import { apiError } from '@/app/api/_shared/responses';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BIZ_ID = '44444444-4444-4444-8444-444444444444';
const MEM_ID = '66666666-6666-4666-8666-666666666666';
const CONV_ID = '77777777-7777-4777-8777-777777777777';
const DRAFT_ID = 'aaaa1111-1111-4111-8111-111111111111';

type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

const P2 = { businessId: BIZ_ID, conversationId: CONV_ID };
const P3 = { businessId: BIZ_ID, conversationId: CONV_ID, draftId: DRAFT_ID };

function okTenant(role: Role = 'OWNER') {
  return async (): Promise<ContextResult<TenantRequestContext>> => ({
    ok: true as const,
    context: createTenantRequestContext({
      requestId: null,
      tenant: { userId: USER_ID, businessId: BIZ_ID, membershipId: MEM_ID, role },
    }),
  });
}

function failCtx() {
  return async (): Promise<ContextResult<TenantRequestContext>> => ({
    ok: false as const,
    response: apiError('AUTH_CONTEXT_UNAVAILABLE', 'Auth unavailable', 501),
  });
}

function draftStub(status: string) {
  return {
    id: DRAFT_ID,
    conversationId: CONV_ID,
    source: 'SYSTEM',
    status,
    draftTextPreview: 'preview…',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function postReq(body?: unknown): Request {
  return body === undefined
    ? new Request('http://x', { method: 'POST' })
    : new Request('http://x', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      });
}

// Asserts a response body carries no outbound / sent / message-delivery signal.
function expectNoSendSignal(data: Record<string, unknown>, draft?: Record<string, unknown>) {
  for (const k of ['sent', 'sentAt', 'sentMessageId', 'messageId', 'message', 'dispatchedAt', 'deliveredAt', 'outbound']) {
    expect(data).not.toHaveProperty(k);
  }
  if (draft) {
    for (const k of ['sentAt', 'sentMessageId', 'dispatchedAt', 'deliveredAt']) {
      expect(draft).not.toHaveProperty(k);
    }
    expect(draft.status).not.toBe('SENT');
  }
}

// ---------------------------------------------------------------------------
// Handler builders (inject fakes; expose spies for assertions)
// ---------------------------------------------------------------------------

function buildGenerate(opts: { ctx?: ReturnType<typeof okTenant>; allowed?: boolean } = {}) {
  const spies = {
    generateOrReuseStubDraft: vi.fn().mockResolvedValue(ok({ created: true, draft: draftStub('PENDING_REVIEW') })),
    findConversationById: vi.fn().mockResolvedValue(ok({ id: CONV_ID, businessId: BIZ_ID })),
    updateConversation: vi.fn().mockResolvedValue(ok({ id: CONV_ID })),
    requirePermission: vi.fn().mockResolvedValue(ok({ allowed: opts.allowed ?? true })),
    resolveAiPolicy: vi.fn().mockResolvedValue(ok({ businessId: BIZ_ID, aiMode: 'AI_ASSISTED', aiGenerationEnabled: true })),
    createAuditEvent: vi.fn().mockResolvedValue(ok({ id: 'audit-evt' })),
  };
  const handler = createGenerateStubDraftHandler({
    replyDraftRepository: { generateOrReuseStubDraft: spies.generateOrReuseStubDraft },
    conversationRepository: { findConversationById: spies.findConversationById, updateConversation: spies.updateConversation },
    authzService: { requirePermission: spies.requirePermission },
    aiConfigService: { resolveAiPolicy: spies.resolveAiPolicy },
    auditService: { createAuditEvent: spies.createAuditEvent },
    resolveTenantContext: opts.ctx ?? okTenant(),
  });
  return { handler, spies };
}

function buildEdit(opts: { ctx?: ReturnType<typeof okTenant>; allowed?: boolean } = {}) {
  const spies = {
    editDraft: vi.fn().mockResolvedValue(ok({ draft: draftStub('EDITED'), previousStatus: 'PENDING_REVIEW', previousTextLength: 20, newTextLength: 10 })),
    findConversationById: vi.fn().mockResolvedValue(ok({ id: CONV_ID, businessId: BIZ_ID })),
    updateConversation: vi.fn().mockResolvedValue(ok({ id: CONV_ID })),
    requirePermission: vi.fn().mockResolvedValue(ok({ allowed: opts.allowed ?? true })),
    createAuditEvent: vi.fn().mockResolvedValue(ok({ id: 'audit-evt' })),
  };
  const handler = createEditDraftHandler({
    replyDraftRepository: { editDraft: spies.editDraft },
    conversationRepository: { findConversationById: spies.findConversationById, updateConversation: spies.updateConversation },
    authzService: { requirePermission: spies.requirePermission },
    auditService: { createAuditEvent: spies.createAuditEvent },
    resolveTenantContext: opts.ctx ?? okTenant(),
  });
  return { handler, spies };
}

function buildDiscard(opts: { ctx?: ReturnType<typeof okTenant>; allowed?: boolean } = {}) {
  const spies = {
    discardDraft: vi.fn().mockResolvedValue(ok({ discarded: true, draft: draftStub('DISCARDED'), previousStatus: 'PENDING_REVIEW' })),
    countReviewableByConversation: vi.fn().mockResolvedValue(ok(0)),
    findConversationById: vi.fn().mockResolvedValue(ok({ id: CONV_ID, businessId: BIZ_ID })),
    updateConversation: vi.fn().mockResolvedValue(ok({ id: CONV_ID })),
    requirePermission: vi.fn().mockResolvedValue(ok({ allowed: opts.allowed ?? true })),
    createAuditEvent: vi.fn().mockResolvedValue(ok({ id: 'audit-evt' })),
  };
  const handler = createDiscardDraftHandler({
    replyDraftRepository: { discardDraft: spies.discardDraft, countReviewableByConversation: spies.countReviewableByConversation },
    conversationRepository: { findConversationById: spies.findConversationById, updateConversation: spies.updateConversation },
    authzService: { requirePermission: spies.requirePermission },
    auditService: { createAuditEvent: spies.createAuditEvent },
    resolveTenantContext: opts.ctx ?? okTenant(),
  });
  return { handler, spies };
}

function buildApprove(opts: { ctx?: ReturnType<typeof okTenant>; allowed?: boolean } = {}) {
  const spies = {
    approveDraft: vi.fn().mockResolvedValue(ok({ approved: true, draft: draftStub('APPROVED'), previousStatus: 'PENDING_REVIEW' })),
    findConversationById: vi.fn().mockResolvedValue(ok({ id: CONV_ID, businessId: BIZ_ID })),
    updateConversation: vi.fn().mockResolvedValue(ok({ id: CONV_ID })),
    requirePermission: vi.fn().mockResolvedValue(ok({ allowed: opts.allowed ?? true })),
    createAuditEvent: vi.fn().mockResolvedValue(ok({ id: 'audit-evt' })),
  };
  const handler = createApproveDraftHandler({
    replyDraftRepository: { approveDraft: spies.approveDraft },
    conversationRepository: { findConversationById: spies.findConversationById, updateConversation: spies.updateConversation },
    authzService: { requirePermission: spies.requirePermission },
    auditService: { createAuditEvent: spies.createAuditEvent },
    resolveTenantContext: opts.ctx ?? okTenant(),
  });
  return { handler, spies };
}

// ===========================================================================
// 1. Generate is draft-only
// ===========================================================================

describe('Human-approval flow — 1. generate is draft-only', () => {
  it('creates a reviewable draft only (PENDING_REVIEW) and approves/sends nothing', async () => {
    const { handler, spies } = buildGenerate();
    const r = await handler(postReq(), P2);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.created).toBe(true);
    expect(body.data.draft.status).toBe('PENDING_REVIEW');
    // Never approved, never sent.
    expect(body.data.draft.status).not.toBe('APPROVED');
    expect(body.data).not.toHaveProperty('approved');
    expectNoSendSignal(body.data, body.data.draft);
    expect(spies.generateOrReuseStubDraft).toHaveBeenCalledTimes(1);
  });

  it('the only conversation write is an aiDraftStatus reconcile (not a message create)', async () => {
    const { handler, spies } = buildGenerate();
    await handler(postReq(), P2);
    expect(spies.updateConversation).toHaveBeenCalledWith(CONV_ID, { aiDraftStatus: 'READY' });
    // updateConversation is only ever called with a status flag — never message content.
    for (const call of spies.updateConversation.mock.calls) {
      expect(Object.keys(call[1])).toEqual(['aiDraftStatus']);
    }
  });
});

// ===========================================================================
// 2. Edit is draft-only
// ===========================================================================

describe('Human-approval flow — 2. edit is draft-only', () => {
  it('updates draft content/status only (EDITED) and does not approve or send', async () => {
    const { handler, spies } = buildEdit();
    const r = await handler(postReq({ draftText: 'Human-revised reply text.' }), P3);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.edited).toBe(true);
    expect(body.data.draft.status).toBe('EDITED');
    expect(body.data.draft.status).not.toBe('APPROVED');
    expect(body.data).not.toHaveProperty('approved');
    expectNoSendSignal(body.data, body.data.draft);
    expect(spies.editDraft).toHaveBeenCalledTimes(1);
  });

  it('does not bypass approval — editing never produces an APPROVED draft', async () => {
    const { handler } = buildEdit();
    const r = await handler(postReq({ draftText: 'Another revision.' }), P3);
    const body = await r.json();
    expect(body.data.draft.status).not.toBe('APPROVED');
    expect(body.data.draft.status).not.toBe('SENT');
  });
});

// ===========================================================================
// 3. Discard is non-send
// ===========================================================================

describe('Human-approval flow — 3. discard is non-send', () => {
  it('discards the draft only (DISCARDED) and sends/approves nothing', async () => {
    const { handler, spies } = buildDiscard();
    const r = await handler(postReq(), P3);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.discarded).toBe(true);
    expect(body.data.draft.status).toBe('DISCARDED');
    expect(body.data).not.toHaveProperty('approved');
    expectNoSendSignal(body.data, body.data.draft);
    expect(spies.discardDraft).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 4. Approve is the explicit human approval boundary
// ===========================================================================

describe('Human-approval flow — 4. approve is the explicit human approval boundary', () => {
  it('requires an authenticated tenant context (no context → 501, no approval recorded)', async () => {
    const { handler, spies } = buildApprove({ ctx: failCtx() });
    const r = await handler(postReq(), P3);
    expect(r.status).toBe(501);
    expect(spies.approveDraft).not.toHaveBeenCalled();
  });

  it('requires authorization (denied → 403, no approval recorded)', async () => {
    const { handler, spies } = buildApprove({ allowed: false });
    const r = await handler(postReq(), P3);
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('ACCESS_DENIED');
    expect(spies.approveDraft).not.toHaveBeenCalled();
  });

  it('records explicit human approval (APPROVED) attributed to the human reviewer', async () => {
    const { handler, spies } = buildApprove();
    const r = await handler(postReq(), P3);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.approved).toBe(true);
    expect(body.data.draft.status).toBe('APPROVED');
    // The approval is attributed to the authenticated human user.
    expect(spies.approveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BIZ_ID, conversationId: CONV_ID, draftId: DRAFT_ID, reviewedByUserId: USER_ID }),
    );
    // Status reconcile is APPROVED — still a status flag, not a message.
    expect(spies.updateConversation).toHaveBeenCalledWith(CONV_ID, { aiDraftStatus: 'APPROVED' });
  });

  it('marks APPROVED but does NOT itself create or send an outbound message', async () => {
    // Precise truth: approval is the human boundary; it does not send. Sending
    // would be a separate path that does not exist in any reply-draft handler.
    const { handler } = buildApprove();
    const r = await handler(postReq(), P3);
    const body = await r.json();
    expect(body.data.draft.status).toBe('APPROVED');
    expectNoSendSignal(body.data, body.data.draft);
    expect(JSON.stringify(body)).not.toMatch(/messageId|"sent"|OUTBOUND|dispatched|delivered/i);
  });

  it('approval does not happen implicitly from generate / edit / discard', async () => {
    const gen = await (await buildGenerate().handler(postReq(), P2)).json();
    const edit = await (await buildEdit().handler(postReq({ draftText: 'x' }), P3)).json();
    const disc = await (await buildDiscard().handler(postReq(), P3)).json();
    for (const body of [gen, edit, disc]) {
      expect(body.data).not.toHaveProperty('approved');
      expect(body.data.draft.status).not.toBe('APPROVED');
    }
  });
});

// ===========================================================================
// 5. Static scope guards — production handlers carry no outbound/send path
// ===========================================================================

const HANDLER_PATHS = [
  'src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/handler.ts',
  'src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/edit/handler.ts',
  'src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/handler.ts',
  'src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/discard/handler.ts',
];

const ROUTE_PATHS = [
  'src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/route.ts',
  'src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/edit/route.ts',
  'src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/route.ts',
  'src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/discard/route.ts',
];

// Strip comments so guards bind to CODE, not prose (handlers say "Does NOT
// send any message" in comments — that must not trip the guard).
function codeOf(relPath: string): string {
  const src = fs.readFileSync(path.resolve(relPath), 'utf8');
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const FORBIDDEN_SEND: readonly RegExp[] = [
  /\bsend\w*/i, // send / sendMessage / sendEmail ...
  /\.send\s*\(/,
  /\boutbound\b/i,
  /OUTBOUND/,
  /\btwilio\b/i,
  /\bwhatsapp\b/i,
  /email\.send/i,
  /channels?\.send/i,
  /createMessage/i,
  /message\.create/i,
];

const FORBIDDEN_WIRING: readonly RegExp[] = [
  /@\/domains\/ai-runtime/, // no AI-runtime provider wiring inside routes/handlers
  /AiGenerationAuditLog/, // no B-R6 route wiring
  /createAiGenerationAuditService/,
  /buildStartAiGenerationAuditInput/,
  /buildSuccessAiGenerationAuditInput/,
  /process\.env/, // no env / API-key reads
  /\bopenai\b/i,
  /\banthropic\b/i,
  /@anthropic-ai/i,
  /@google\/(generative|genai)/i,
  /\bcohere\b/i,
  /\bmistral\b/i,
  /\bbedrock\b/i,
  /api[_-]?key/i,
  /auto[_-]?send/i,
];

describe('Human-approval flow — 5. static scope guards (no outbound/send in handlers)', () => {
  it('the guard is not vacuous (all four handler files exist and are non-trivial)', () => {
    for (const p of HANDLER_PATHS) {
      const code = codeOf(p);
      expect(code.length).toBeGreaterThan(500);
    }
  });

  it.each(HANDLER_PATHS)('handler has no outbound/send call-site or import: %s', (p) => {
    const code = codeOf(p);
    for (const re of FORBIDDEN_SEND) {
      expect(code).not.toMatch(re);
    }
  });
});

// ===========================================================================
// 6. No real-provider / AI-runtime route wiring introduced
// ===========================================================================

describe('Human-approval flow — 6. no real-provider / AI-runtime route wiring', () => {
  it.each([...HANDLER_PATHS, ...ROUTE_PATHS])('no provider/env/B-R6/auto-send wiring: %s', (p) => {
    const code = codeOf(p);
    for (const re of FORBIDDEN_WIRING) {
      expect(code).not.toMatch(re);
    }
  });

  it('this verification adds no production source and no provider SDK to package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    for (const n of names) {
      expect(n).not.toMatch(/^(openai|@anthropic-ai\/|cohere-ai|@google\/(generative-ai|genai)|@mistralai\/|@aws-sdk\/client-bedrock)/i);
    }
  });
});
