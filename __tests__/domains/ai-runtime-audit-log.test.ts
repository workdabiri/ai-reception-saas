// ===========================================================================
// Tests — AI Runtime: AI Generation Audit Log + Draft Metadata (B-R6)
//
// Proves the audit/metadata persistence boundary:
//  - pure builders convert B-R5 prompt results / B-R4 provider results into
//    METADATA-ONLY audit inputs and a draft-metadata patch (counts + ids only,
//    never the raw prompt or generated text)
//  - the repository represents a started / succeeded / failed attempt with the
//    correct completedAt behaviour and is tenant-scoped by businessId
//  - the service validates required fields (businessId/operation) and
//    bounds/sanitizes free text (warnings, errorMessage)
//  - PRIVACY: no raw prompt / generated text / sourceMetadata / verifier id is
//    ever carried into the audit input, the persisted record, or draft metadata
//  - draft metadata is review-only: it references the audit log, carries no
//    draft text, and introduces no send / status transition
//
// And STATIC SCOPE GUARDS proving the new B-R6 source imports no provider SDK,
// no fake provider, no network/env/API-key path, no customer/conversation/
// message/reply-draft read path, no auto-send, and persists no raw prompt.
// ===========================================================================

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  createAiGenerationAuditRepository,
  createAiGenerationAuditService,
  buildStartAiGenerationAuditInput,
  buildSuccessAiGenerationAuditInput,
  buildDraftAiMetadata,
  mapAiGenerationAuditLogRecord,
  isAiGenerationAuditStatus,
  AI_GENERATION_AUDIT_STATUS_VALUES,
  AI_GENERATION_AUDIT_ERROR_CODES,
  createAiPromptBuilder,
  createFakeAiProvider,
  type AiGenerationAuditRepositoryDb,
  type AiGenerationAuditLogRecord,
  type AssembledAiContext,
  type BuildReplyDraftPromptResult,
  type AiProviderGenerateTextResult,
} from '@/domains/ai-runtime';

// ---------------------------------------------------------------------------
// Constants (valid UUIDs)
// ---------------------------------------------------------------------------

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';
const DRAFT_1 = '33333333-3333-4333-8333-333333333333';
const VERIFIER = '44444444-4444-4444-8444-444444444444';
const CONV_1 = '55555555-5555-4555-8555-555555555555';

const PROMPT_SECRET = 'ZZZ_RAW_PROMPT_SECRET_DO_NOT_PERSIST';
const RESULT_SECRET = 'ZZZ_GENERATED_TEXT_SECRET_DO_NOT_PERSIST';
const SOURCE_META_SECRET = 'ZZZ_SOURCE_METADATA_SECRET';

// ---------------------------------------------------------------------------
// Fixtures (typed as the real B-R5 / B-R4 outputs)
// ---------------------------------------------------------------------------

function promptResult(
  overrides: Partial<BuildReplyDraftPromptResult> = {},
): BuildReplyDraftPromptResult {
  return {
    promptVersion: 'reply-draft-v1',
    providerRequest: {
      operation: 'REPLY_DRAFT',
      businessId: BIZ_A,
      prompt: `SYSTEM RULES ... verified context ... ${PROMPT_SECRET}`,
      contextHash: 'abcdef0123456789',
      metadata: { promptVersion: 'reply-draft-v1', contextItemCount: '2' },
    },
    contextHash: 'abcdef0123456789',
    includedContextItemIds: ['item-a', 'item-b'],
    omittedContextItemIds: ['item-bad'],
    warnings: ['Omitted 1 malformed verified context item(s).'],
    ...overrides,
  };
}

function providerResult(
  overrides: Partial<AiProviderGenerateTextResult> = {},
): AiProviderGenerateTextResult {
  return {
    text: `Dear customer, ... ${RESULT_SECRET}`,
    providerId: 'fake',
    modelId: 'fake-deterministic-v1',
    finishReason: 'STOP',
    usage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
    createdAt: '2026-06-16T09:00:00.000Z',
    requestId: 'req-123',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// In-memory fake DB delegate (mimics the Prisma aiGenerationAuditLog delegate)
// ---------------------------------------------------------------------------

interface FakeDb extends AiGenerationAuditRepositoryDb {
  rows: AiGenerationAuditLogRecord[];
}

function fakeUuid(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function createFakeDb(): FakeDb {
  const rows: AiGenerationAuditLogRecord[] = [];
  let idCounter = 0;
  let clock = 0;
  const tick = () => new Date(1_700_000_000_000 + clock++ * 1000);

  return {
    rows,
    aiGenerationAuditLog: {
      async create({ data }) {
        const now = tick();
        const record: AiGenerationAuditLogRecord = {
          id: fakeUuid(++idCounter),
          businessId: data.businessId,
          conversationId: data.conversationId ?? null,
          replyDraftId: data.replyDraftId ?? null,
          operation: data.operation,
          status: data.status,
          promptVersion: data.promptVersion ?? null,
          contextHash: data.contextHash ?? null,
          includedContextItemIds: data.includedContextItemIds ?? null,
          omittedContextItemIds: data.omittedContextItemIds ?? null,
          warnings: data.warnings ?? null,
          providerId: data.providerId ?? null,
          modelId: data.modelId ?? null,
          providerRequestId: null,
          finishReason: null,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          promptCharCount: data.promptCharCount ?? null,
          resultCharCount: null,
          errorCode: null,
          errorMessage: null,
          startedAt: now,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        rows.push(record);
        return { ...record };
      },
      async findUnique({ where }) {
        const { id, businessId } = where.id_businessId;
        const found = rows.find(
          (r) => r.id === id && r.businessId === businessId,
        );
        return found ? { ...found } : null;
      },
      async update({ where, data }) {
        const { id, businessId } = where.id_businessId;
        const idx = rows.findIndex(
          (r) => r.id === id && r.businessId === businessId,
        );
        if (idx === -1) throw new Error('record not found');
        const now = tick();
        // Drop undefined keys (mimic Prisma: undefined = "leave unchanged").
        const patch: Partial<AiGenerationAuditLogRecord> = {};
        for (const [k, v] of Object.entries(data)) {
          if (v !== undefined) {
            (patch as Record<string, unknown>)[k] = v;
          }
        }
        const updated: AiGenerationAuditLogRecord = {
          ...rows[idx],
          ...patch,
          updatedAt: now,
        };
        rows[idx] = updated;
        return { ...updated };
      },
    },
  };
}

// ===========================================================================
// Code surface
// ===========================================================================

describe('AI audit — code surface', () => {
  it('exposes exactly the expected status values', () => {
    expect([...AI_GENERATION_AUDIT_STATUS_VALUES]).toEqual([
      'STARTED',
      'SUCCEEDED',
      'FAILED',
    ]);
  });

  it('exposes exactly the expected error codes', () => {
    expect([...AI_GENERATION_AUDIT_ERROR_CODES]).toEqual([
      'AI_AUDIT_INVALID_INPUT',
      'AI_AUDIT_NOT_FOUND',
      'AI_AUDIT_INVALID_TRANSITION',
      'AI_AUDIT_REPOSITORY_ERROR',
    ]);
  });

  it('has a working status type guard', () => {
    expect(isAiGenerationAuditStatus('STARTED')).toBe(true);
    expect(isAiGenerationAuditStatus('NOPE')).toBe(false);
    expect(isAiGenerationAuditStatus(42)).toBe(false);
  });
});

// ===========================================================================
// Pure builders — metadata extraction only
// ===========================================================================

describe('AI audit — buildStartAiGenerationAuditInput', () => {
  it('derives metadata from a B-R5 prompt result without the raw prompt', () => {
    const input = buildStartAiGenerationAuditInput({
      promptResult: promptResult(),
      providerId: 'fake',
      modelId: 'fake-deterministic-v1',
      replyDraftId: DRAFT_1,
    });
    expect(input.businessId).toBe(BIZ_A);
    expect(input.operation).toBe('REPLY_DRAFT');
    expect(input.replyDraftId).toBe(DRAFT_1);
    expect(input.promptVersion).toBe('reply-draft-v1');
    expect(input.contextHash).toBe('abcdef0123456789');
    expect(input.includedContextItemIds).toEqual(['item-a', 'item-b']);
    expect(input.omittedContextItemIds).toEqual(['item-bad']);
    expect(input.warnings?.length).toBe(1);
    expect(input.providerId).toBe('fake');
    expect(input.modelId).toBe('fake-deterministic-v1');
    // Character count only — never the prompt text.
    expect(input.promptCharCount).toBe(
      promptResult().providerRequest.prompt.length,
    );
  });

  it('never carries the raw prompt text into the start input', () => {
    const input = buildStartAiGenerationAuditInput({
      promptResult: promptResult(),
    });
    expect(JSON.stringify(input)).not.toContain(PROMPT_SECRET);
    expect(input).not.toHaveProperty('prompt');
    expect(input).not.toHaveProperty('providerRequest');
  });

  it('defaults operation from the prompt result and replyDraftId to null', () => {
    const input = buildStartAiGenerationAuditInput({
      promptResult: promptResult(),
    });
    expect(input.operation).toBe('REPLY_DRAFT');
    expect(input.replyDraftId).toBeNull();
  });

  it('copies an optional conversationId into the start input, defaulting null', () => {
    const withConv = buildStartAiGenerationAuditInput({
      promptResult: promptResult(),
      conversationId: CONV_1,
    });
    expect(withConv.conversationId).toBe(CONV_1);
    const without = buildStartAiGenerationAuditInput({
      promptResult: promptResult(),
    });
    expect(without.conversationId).toBeNull();
  });

  it('derives businessId + operation from the providerRequest (not a separate arg)', () => {
    // The helper takes NO businessId argument: the audited tenant + operation
    // are derived from the already-built B-R5 provider request payload, so the
    // audit metadata can never disagree with what was actually prompted.
    const pr = promptResult();
    const input = buildStartAiGenerationAuditInput({ promptResult: pr });
    expect(input.businessId).toBe(pr.providerRequest.businessId);
    expect(input.operation).toBe(pr.providerRequest.operation);
  });

  it('uses the providerRequest tenant even for a different business (BIZ_B)', () => {
    const pr = promptResult({
      providerRequest: {
        operation: 'REPLY_DRAFT',
        businessId: BIZ_B,
        prompt: 'prompt for B',
        contextHash: 'abcdef0123456789',
        metadata: { promptVersion: 'reply-draft-v1', contextItemCount: '0' },
      },
    });
    const input = buildStartAiGenerationAuditInput({ promptResult: pr });
    expect(input.businessId).toBe(BIZ_B);
    expect(input.promptCharCount).toBe('prompt for B'.length);
  });
});

// ===========================================================================
// Conversation trace metadata (Patch 1)
// ===========================================================================

describe('AI audit — conversationId trace metadata', () => {
  it('repository persists conversationId and the mapper returns it', async () => {
    const { db, repo } = makeRepo();
    const res = await repo.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
        conversationId: CONV_1,
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.conversationId).toBe(CONV_1);
    // It is persisted as a plain trace id on the row.
    expect(db.rows[0].conversationId).toBe(CONV_1);
  });

  it('can start an attempt without a conversationId (null)', async () => {
    const { repo } = makeRepo();
    const res = await repo.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
      }),
    );
    expect(res.ok && res.data.conversationId).toBeNull();
  });

  it('service rejects an invalid (non-UUID) conversationId', async () => {
    const { service } = makeService();
    const res = await service.start({
      businessId: BIZ_A,
      operation: 'REPLY_DRAFT',
      conversationId: 'not-a-uuid',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_AUDIT_INVALID_INPUT');
  });

  it('service accepts a valid conversationId on start', async () => {
    const { service } = makeService();
    const res = await service.start({
      businessId: BIZ_A,
      operation: 'REPLY_DRAFT',
      conversationId: CONV_1,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.conversationId).toBe(CONV_1);
  });
});

describe('AI audit — buildSuccessAiGenerationAuditInput', () => {
  it('derives metadata from a B-R4 provider result without the generated text', () => {
    const input = buildSuccessAiGenerationAuditInput({
      auditLogId: fakeUuid(1),
      businessId: BIZ_A,
      result: providerResult(),
      replyDraftId: DRAFT_1,
    });
    expect(input.providerId).toBe('fake');
    expect(input.modelId).toBe('fake-deterministic-v1');
    expect(input.providerRequestId).toBe('req-123');
    expect(input.finishReason).toBe('STOP');
    expect(input.promptTokens).toBe(120);
    expect(input.completionTokens).toBe(80);
    expect(input.totalTokens).toBe(200);
    expect(input.replyDraftId).toBe(DRAFT_1);
    // Character count only — never the generated text.
    expect(input.resultCharCount).toBe(providerResult().text.length);
  });

  it('never carries the generated text into the success input', () => {
    const input = buildSuccessAiGenerationAuditInput({
      auditLogId: fakeUuid(1),
      businessId: BIZ_A,
      result: providerResult(),
    });
    expect(JSON.stringify(input)).not.toContain(RESULT_SECRET);
    expect(input).not.toHaveProperty('text');
  });
});

describe('AI audit — buildDraftAiMetadata', () => {
  it('produces a review-only, metadata-only draft patch', () => {
    const meta = buildDraftAiMetadata({
      promptResult: promptResult(),
      result: providerResult(),
      auditLogId: fakeUuid(7),
    });
    expect(meta.source).toBe('AI');
    expect(meta.modelProvider).toBe('fake');
    expect(meta.modelName).toBe('fake-deterministic-v1');
    expect(meta.promptVersion).toBe('reply-draft-v1');
    expect(meta.aiContextHash).toBe('abcdef0123456789');
    expect(meta.aiFinishReason).toBe('STOP');
    expect(meta.aiGeneratedAt).toBe('2026-06-16T09:00:00.000Z');
    expect(meta.aiGenerationAuditLogId).toBe(fakeUuid(7));
  });

  it('carries no draft text, no prompt, and no send / status transition', () => {
    const meta = buildDraftAiMetadata({
      promptResult: promptResult(),
      result: providerResult(),
    });
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain(PROMPT_SECRET);
    expect(serialized).not.toContain(RESULT_SECRET);
    expect(meta).not.toHaveProperty('draftText');
    expect(meta).not.toHaveProperty('prompt');
    // Review-only: no status field, no send/sent fields.
    expect(meta).not.toHaveProperty('status');
    expect(meta).not.toHaveProperty('sentAt');
    expect(meta).not.toHaveProperty('sentMessageId');
    expect(meta.aiGenerationAuditLogId).toBeNull();
  });
});

// ===========================================================================
// Repository — lifecycle (started / succeeded / failed)
// ===========================================================================

function makeRepo() {
  const db = createFakeDb();
  return { db, repo: createAiGenerationAuditRepository(db) };
}

describe('AI audit — repository lifecycle', () => {
  it('start() opens a STARTED record with completedAt null', async () => {
    const { repo } = makeRepo();
    const res = await repo.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.status).toBe('STARTED');
    expect(res.data.businessId).toBe(BIZ_A);
    expect(res.data.operation).toBe('REPLY_DRAFT');
    expect(res.data.promptVersion).toBe('reply-draft-v1');
    expect(res.data.contextHash).toBe('abcdef0123456789');
    expect(res.data.includedContextItemIds).toEqual(['item-a', 'item-b']);
    expect(res.data.omittedContextItemIds).toEqual(['item-bad']);
    expect(res.data.completedAt).toBeNull();
    expect(typeof res.data.startedAt).toBe('string');
  });

  it('completeSuccess() transitions STARTED → SUCCEEDED and stamps completedAt', async () => {
    const { repo } = makeRepo();
    const started = await repo.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
      }),
    );
    if (!started.ok) throw new Error('start failed');
    const done = await repo.completeSuccess(
      buildSuccessAiGenerationAuditInput({
        auditLogId: started.data.id,
        businessId: BIZ_A,
        result: providerResult(),
        replyDraftId: DRAFT_1,
      }),
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.data.status).toBe('SUCCEEDED');
    expect(done.data.completedAt).not.toBeNull();
    expect(done.data.providerId).toBe('fake');
    expect(done.data.modelId).toBe('fake-deterministic-v1');
    expect(done.data.providerRequestId).toBe('req-123');
    expect(done.data.finishReason).toBe('STOP');
    expect(done.data.promptTokens).toBe(120);
    expect(done.data.completionTokens).toBe(80);
    expect(done.data.totalTokens).toBe(200);
    expect(done.data.resultCharCount).toBe(providerResult().text.length);
    expect(done.data.replyDraftId).toBe(DRAFT_1);
  });

  it('completeFailure() transitions STARTED → FAILED with code + message', async () => {
    const { repo } = makeRepo();
    const started = await repo.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
      }),
    );
    if (!started.ok) throw new Error('start failed');
    const done = await repo.completeFailure({
      auditLogId: started.data.id,
      businessId: BIZ_A,
      errorCode: 'AI_PROVIDER_INVALID_REQUEST',
      errorMessage: 'request was rejected',
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.data.status).toBe('FAILED');
    expect(done.data.completedAt).not.toBeNull();
    expect(done.data.errorCode).toBe('AI_PROVIDER_INVALID_REQUEST');
    expect(done.data.errorMessage).toBe('request was rejected');
  });

  it('findByBusinessAndId() returns the record or null', async () => {
    const { repo } = makeRepo();
    const started = await repo.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
      }),
    );
    if (!started.ok) throw new Error('start failed');
    const found = await repo.findByBusinessAndId(BIZ_A, started.data.id);
    expect(found.ok && found.data?.id).toBe(started.data.id);
    const missing = await repo.findByBusinessAndId(BIZ_A, fakeUuid(999));
    expect(missing.ok && missing.data).toBeNull();
  });
});

// ===========================================================================
// Repository — tenant scope
// ===========================================================================

describe('AI audit — tenant scope', () => {
  it('completeSuccess() for another business cannot touch the record (NOT_FOUND)', async () => {
    const { db, repo } = makeRepo();
    const started = await repo.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
      }),
    );
    if (!started.ok) throw new Error('start failed');
    const cross = await repo.completeSuccess({
      auditLogId: started.data.id,
      businessId: BIZ_B, // wrong tenant
    });
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.error.code).toBe('AI_AUDIT_NOT_FOUND');
    // The original row is untouched (still STARTED).
    expect(db.rows[0].status).toBe('STARTED');
  });

  it('completeFailure() on a missing record returns NOT_FOUND', async () => {
    const { repo } = makeRepo();
    const res = await repo.completeFailure({
      auditLogId: fakeUuid(123),
      businessId: BIZ_A,
      errorCode: 'X',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_AUDIT_NOT_FOUND');
  });

  it('findByBusinessAndId() does not return another business record', async () => {
    const { repo } = makeRepo();
    const started = await repo.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
      }),
    );
    if (!started.ok) throw new Error('start failed');
    const found = await repo.findByBusinessAndId(BIZ_B, started.data.id);
    expect(found.ok && found.data).toBeNull();
  });

  it('surfaces a repository error as an ActionResult error', async () => {
    const db = createFakeDb();
    db.aiGenerationAuditLog.create = () =>
      Promise.reject(new Error('db down'));
    const repo = createAiGenerationAuditRepository(db);
    const res = await repo.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_AUDIT_REPOSITORY_ERROR');
  });
});

// ===========================================================================
// Terminal-state immutability (Patch 2)
// ===========================================================================

describe('AI audit — terminal-state immutability', () => {
  async function startedRecord() {
    const { db, repo } = makeRepo();
    const started = await repo.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
      }),
    );
    if (!started.ok) throw new Error('start failed');
    return { db, repo, id: started.data.id };
  }

  it('cannot completeSuccess twice', async () => {
    const { repo, id } = await startedRecord();
    const first = await repo.completeSuccess(
      buildSuccessAiGenerationAuditInput({
        auditLogId: id,
        businessId: BIZ_A,
        result: providerResult(),
      }),
    );
    expect(first.ok).toBe(true);
    const second = await repo.completeSuccess(
      buildSuccessAiGenerationAuditInput({
        auditLogId: id,
        businessId: BIZ_A,
        result: providerResult(),
      }),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('AI_AUDIT_INVALID_TRANSITION');
  });

  it('cannot completeFailure after success', async () => {
    const { repo, id } = await startedRecord();
    await repo.completeSuccess(
      buildSuccessAiGenerationAuditInput({
        auditLogId: id,
        businessId: BIZ_A,
        result: providerResult(),
      }),
    );
    const fail = await repo.completeFailure({
      auditLogId: id,
      businessId: BIZ_A,
      errorCode: 'AI_PROVIDER_INVALID_REQUEST',
    });
    expect(fail.ok).toBe(false);
    if (!fail.ok) expect(fail.error.code).toBe('AI_AUDIT_INVALID_TRANSITION');
  });

  it('cannot completeSuccess after failure', async () => {
    const { repo, id } = await startedRecord();
    await repo.completeFailure({
      auditLogId: id,
      businessId: BIZ_A,
      errorCode: 'AI_PROVIDER_INVALID_REQUEST',
    });
    const success = await repo.completeSuccess(
      buildSuccessAiGenerationAuditInput({
        auditLogId: id,
        businessId: BIZ_A,
        result: providerResult(),
      }),
    );
    expect(success.ok).toBe(false);
    if (!success.ok)
      expect(success.error.code).toBe('AI_AUDIT_INVALID_TRANSITION');
  });

  it('leaves the terminal row unchanged after a rejected transition', async () => {
    const { db, repo, id } = await startedRecord();
    await repo.completeSuccess(
      buildSuccessAiGenerationAuditInput({
        auditLogId: id,
        businessId: BIZ_A,
        result: providerResult(),
        replyDraftId: DRAFT_1,
      }),
    );
    const completedAtBefore = db.rows[0].completedAt;
    // A rejected failure transition must not mutate the SUCCEEDED record.
    await repo.completeFailure({
      auditLogId: id,
      businessId: BIZ_A,
      errorCode: 'SHOULD_NOT_APPLY',
      errorMessage: 'should not be written',
    });
    expect(db.rows[0].status).toBe('SUCCEEDED');
    expect(db.rows[0].errorCode).toBeNull();
    expect(db.rows[0].errorMessage).toBeNull();
    expect(db.rows[0].completedAt).toBe(completedAtBefore);
    expect(db.rows[0].replyDraftId).toBe(DRAFT_1);
  });
});

// ===========================================================================
// Service — validation + bounding + sanitization
// ===========================================================================

function makeService() {
  const db = createFakeDb();
  const repo = createAiGenerationAuditRepository(db);
  return { db, service: createAiGenerationAuditService({ repository: repo }) };
}

describe('AI audit — service validation', () => {
  it('requires a valid businessId on start', async () => {
    const { service } = makeService();
    const res = await service.start({
      businessId: 'not-a-uuid',
      operation: 'REPLY_DRAFT',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_AUDIT_INVALID_INPUT');
  });

  it('rejects an unknown operation', async () => {
    const { service } = makeService();
    const res = await service.start({
      businessId: BIZ_A,
      operation: 'SOMETHING_ELSE' as never,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_AUDIT_INVALID_INPUT');
  });

  it('records a valid started attempt via the service', async () => {
    const { service } = makeService();
    const res = await service.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.status).toBe('STARTED');
      expect(res.data.operation).toBe('REPLY_DRAFT');
    }
  });

  it('requires errorCode on failure completion', async () => {
    const { service } = makeService();
    const res = await service.completeFailure({
      auditLogId: fakeUuid(1),
      businessId: BIZ_A,
      errorCode: '',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_AUDIT_INVALID_INPUT');
  });

  it('truncates an over-long errorMessage rather than dropping the attempt', async () => {
    const { service, db } = makeService();
    const started = await service.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
      }),
    );
    if (!started.ok) throw new Error('start failed');
    const res = await service.completeFailure({
      auditLogId: started.data.id,
      businessId: BIZ_A,
      errorCode: 'AI_PROVIDER_INVALID_REQUEST',
      errorMessage: 'x'.repeat(5_000),
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.errorMessage?.length).toBe(500);
    }
    expect(db.rows[0].status).toBe('FAILED');
  });

  it('truncates over-long warnings on start', async () => {
    const { service } = makeService();
    const res = await service.start({
      businessId: BIZ_A,
      operation: 'REPLY_DRAFT',
      warnings: ['w'.repeat(5_000)],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.warnings?.[0].length).toBe(500);
    }
  });
});

// ===========================================================================
// Bounded + redacted text (Patch 3)
// ===========================================================================

const EMAIL = 'jane.doe@example.com';
const PHONE = '+1 (415) 555-2671';

describe('AI audit — bounded + redacted free text', () => {
  it('redacts an email in a warning on start', async () => {
    const { service } = makeService();
    const res = await service.start({
      businessId: BIZ_A,
      operation: 'REPLY_DRAFT',
      warnings: [`contact ${EMAIL} for details`],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.warnings?.[0]).toContain('[redacted-email]');
    expect(res.data.warnings?.[0]).not.toContain(EMAIL);
  });

  it('redacts a phone number in a warning on start', async () => {
    const { service } = makeService();
    const res = await service.start({
      businessId: BIZ_A,
      operation: 'REPLY_DRAFT',
      warnings: [`call ${PHONE} now`],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.warnings?.[0]).toContain('[redacted-phone]');
    expect(res.data.warnings?.[0]).not.toContain('555-2671');
  });

  it('redacts an email in an errorMessage on failure', async () => {
    const { service } = makeService();
    const started = await service.start({
      businessId: BIZ_A,
      operation: 'REPLY_DRAFT',
    });
    if (!started.ok) throw new Error('start failed');
    const res = await service.completeFailure({
      auditLogId: started.data.id,
      businessId: BIZ_A,
      errorCode: 'AI_PROVIDER_INVALID_REQUEST',
      errorMessage: `failed for ${EMAIL}`,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.errorMessage).toContain('[redacted-email]');
    expect(res.data.errorMessage).not.toContain(EMAIL);
  });

  it('redacts a phone number in an errorMessage on failure', async () => {
    const { service } = makeService();
    const started = await service.start({
      businessId: BIZ_A,
      operation: 'REPLY_DRAFT',
    });
    if (!started.ok) throw new Error('start failed');
    const res = await service.completeFailure({
      auditLogId: started.data.id,
      businessId: BIZ_A,
      errorCode: 'AI_PROVIDER_INVALID_REQUEST',
      errorMessage: `customer ${PHONE} could not be reached`,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.errorMessage).toContain('[redacted-phone]');
    expect(res.data.errorMessage).not.toContain('555-2671');
  });

  it('leaves no raw email/phone in the persisted record', async () => {
    const { db, service } = makeService();
    const started = await service.start({
      businessId: BIZ_A,
      operation: 'REPLY_DRAFT',
      warnings: [`warn ${EMAIL} ${PHONE}`],
    });
    if (!started.ok) throw new Error('start failed');
    await service.completeFailure({
      auditLogId: started.data.id,
      businessId: BIZ_A,
      errorCode: 'AI_PROVIDER_INVALID_REQUEST',
      errorMessage: `err ${EMAIL} ${PHONE}`,
    });
    const dump = JSON.stringify(db.rows);
    expect(dump).not.toContain(EMAIL);
    expect(dump).not.toContain('555-2671');
    expect(dump).toContain('[redacted-email]');
    expect(dump).toContain('[redacted-phone]');
  });

  it('collapses control characters and whitespace in warnings', async () => {
    const { service } = makeService();
    const res = await service.start({
      businessId: BIZ_A,
      operation: 'REPLY_DRAFT',
      warnings: ['a b\t\tc   d'],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.warnings?.[0]).toBe('a b c d');
  });

  it('truncates a redacted message to the max length', async () => {
    const { service } = makeService();
    const res = await service.start({
      businessId: BIZ_A,
      operation: 'REPLY_DRAFT',
      warnings: ['w'.repeat(5_000)],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.warnings?.[0].length).toBe(500);
  });
});

// ===========================================================================
// Privacy — no raw content ever persisted
// ===========================================================================

describe('AI audit — privacy (metadata only)', () => {
  it('never persists the raw prompt or generated text in the audit record', async () => {
    const { db, repo } = makeRepo();
    const started = await repo.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
      }),
    );
    if (!started.ok) throw new Error('start failed');
    await repo.completeSuccess(
      buildSuccessAiGenerationAuditInput({
        auditLogId: started.data.id,
        businessId: BIZ_A,
        result: providerResult(),
      }),
    );
    const dump = JSON.stringify(db.rows);
    expect(dump).not.toContain(PROMPT_SECRET);
    expect(dump).not.toContain(RESULT_SECRET);
  });

  it('the audit record shape has no raw content / PII fields', async () => {
    const { repo } = makeRepo();
    const started = await repo.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
      }),
    );
    if (!started.ok) throw new Error('start failed');
    const record = started.data;
    for (const forbidden of [
      'prompt',
      'promptText',
      'rawPrompt',
      'text',
      'responseText',
      'customerMessage',
      'conversationTranscript',
      'customerEmail',
      'customerPhone',
      'sourceMetadata',
      'verifiedByUserId',
    ]) {
      expect(record).not.toHaveProperty(forbidden);
    }
  });

  it('does not carry sourceMetadata even when present upstream', () => {
    // sourceMetadata lives on assembled context items, NOT on the prompt result
    // the builders consume — prove it never reaches the audit input by including
    // a secret on a context object and asserting the input never sees it.
    const ctxWithSecret = {
      businessId: BIZ_A,
      aiMode: 'AI_ASSISTED',
      aiGenerationEnabled: true,
      businessContextItems: [
        {
          id: 'item-a',
          category: 'hours',
          key: 'monday',
          value: 'Open 9-5',
          sourceType: 'OWNER_APPROVED',
          sourceLabel: 'Owner',
          sourceUrl: null,
          sourceMetadata: { secret: SOURCE_META_SECRET },
          verifiedByUserId: VERIFIER,
          verifiedAt: '2026-06-10T09:00:00.000Z',
        },
      ],
      assembledAt: '2026-06-16T08:30:00.000Z',
    } as AssembledAiContext;

    const built = createAiPromptBuilder().buildReplyDraftPrompt({
      context: ctxWithSecret,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const input = buildStartAiGenerationAuditInput({
      promptResult: built.data,
    });
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain(SOURCE_META_SECRET);
    expect(serialized).not.toContain(VERIFIER);
  });
});

// ===========================================================================
// Mapper
// ===========================================================================

describe('AI audit — mapper', () => {
  it('maps a raw record to a domain log (dates → ISO, JSON arrays coerced)', () => {
    const now = new Date('2026-06-16T09:00:00.000Z');
    const mapped = mapAiGenerationAuditLogRecord({
      id: fakeUuid(1),
      businessId: BIZ_A,
      conversationId: null,
      replyDraftId: null,
      operation: 'REPLY_DRAFT',
      status: 'SUCCEEDED',
      promptVersion: 'reply-draft-v1',
      contextHash: 'abc',
      includedContextItemIds: ['a', 'b', 42], // non-strings dropped
      omittedContextItemIds: null,
      warnings: ['w1'],
      providerId: 'fake',
      modelId: 'fake-deterministic-v1',
      providerRequestId: 'req-1',
      finishReason: 'STOP',
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      promptCharCount: 10,
      resultCharCount: 20,
      errorCode: null,
      errorMessage: null,
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    expect(mapped.includedContextItemIds).toEqual(['a', 'b']);
    expect(mapped.omittedContextItemIds).toBeNull();
    expect(mapped.startedAt).toBe('2026-06-16T09:00:00.000Z');
    expect(mapped.completedAt).toBe('2026-06-16T09:00:00.000Z');
    expect(mapped.finishReason).toBe('STOP');
  });

  it('coerces an unknown finish reason to null', () => {
    const now = new Date('2026-06-16T09:00:00.000Z');
    const mapped = mapAiGenerationAuditLogRecord({
      id: fakeUuid(1),
      businessId: BIZ_A,
      conversationId: null,
      replyDraftId: null,
      operation: 'REPLY_DRAFT',
      status: 'FAILED',
      promptVersion: null,
      contextHash: null,
      includedContextItemIds: null,
      omittedContextItemIds: null,
      warnings: null,
      providerId: null,
      modelId: null,
      providerRequestId: null,
      finishReason: 'WEIRD',
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      promptCharCount: null,
      resultCharCount: null,
      errorCode: 'X',
      errorMessage: 'y',
      startedAt: now,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(mapped.finishReason).toBeNull();
    expect(mapped.completedAt).toBeNull();
  });
});

// ===========================================================================
// Integration — real B-R5 builder + B-R4 fake provider → audit (no real provider)
// ===========================================================================

describe('AI audit — integrates with real B-R5 / B-R4 outputs', () => {
  it('records an end-to-end attempt from the real prompt builder + fake provider', async () => {
    const ctx: AssembledAiContext = {
      businessId: BIZ_A,
      aiMode: 'AI_ASSISTED',
      aiGenerationEnabled: true,
      businessContextItems: [
        {
          id: 'item-a',
          category: 'hours',
          key: 'monday',
          value: 'Open 9-5',
          sourceType: 'OWNER_APPROVED',
          sourceLabel: 'Owner',
          sourceUrl: null,
          sourceMetadata: null,
          verifiedByUserId: VERIFIER,
          verifiedAt: '2026-06-10T09:00:00.000Z',
        },
      ],
      assembledAt: '2026-06-16T08:30:00.000Z',
    };
    const built = createAiPromptBuilder().buildReplyDraftPrompt({ context: ctx });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const provider = createFakeAiProvider({
      now: () => new Date('2026-06-16T09:00:00.000Z'),
    });
    const gen = await provider.generateText(built.data.providerRequest);
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;

    const { repo } = makeRepo();
    const started = await repo.start(
      buildStartAiGenerationAuditInput({
        promptResult: built.data,
        providerId: provider.providerId,
        modelId: provider.modelId,
      }),
    );
    if (!started.ok) throw new Error('start failed');
    const done = await repo.completeSuccess(
      buildSuccessAiGenerationAuditInput({
        auditLogId: started.data.id,
        businessId: BIZ_A,
        result: gen.data,
        replyDraftId: DRAFT_1,
      }),
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.data.status).toBe('SUCCEEDED');
    expect(done.data.contextHash).toBe(built.data.contextHash);
    expect(done.data.providerId).toBe(provider.providerId);
    expect(done.data.modelId).toBe(provider.modelId);
    expect(done.data.totalTokens).toBe(gen.data.usage.totalTokens);

    // The draft metadata derived alongside is review-only and content-free.
    const meta = buildDraftAiMetadata({
      promptResult: built.data,
      result: gen.data,
      auditLogId: done.data.id,
    });
    expect(meta.source).toBe('AI');
    expect(meta.aiGenerationAuditLogId).toBe(done.data.id);
    expect(meta).not.toHaveProperty('draftText');
  });
});

// ===========================================================================
// Static scope guards (meta tests over the new B-R6 source file)
// ===========================================================================

describe('AI audit — static scope guards', () => {
  const FILE = 'src/domains/ai-runtime/audit-log.ts';

  function read(rel: string): string {
    return fs.readFileSync(path.resolve(rel), 'utf8');
  }

  function importPaths(src: string): string[] {
    return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  }

  /** Allowlisted imports for the audit module — nothing else. */
  const ALLOWED_IMPORTS = new Set(['zod', '@/lib/result', './types']);

  it('imports no real provider / LLM SDK', () => {
    expect(read(FILE)).not.toMatch(
      /openai|anthropic|@anthropic-ai|@google|googleapis|gemini|vertex|cohere|mistral|llama|bedrock/i,
    );
  });

  it('uses only allowlisted imports (no new deps, no fake provider, no provider)', () => {
    for (const imp of importPaths(read(FILE))) {
      expect(ALLOWED_IMPORTS.has(imp)).toBe(true);
    }
  });

  it('does not import the fake provider or provider implementations', () => {
    for (const imp of importPaths(read(FILE))) {
      expect(imp).not.toMatch(/fake-provider|provider$/);
    }
  });

  it('makes no network request', () => {
    expect(read(FILE)).not.toMatch(
      /\bfetch\b|XMLHttpRequest|node:http\b|node:https\b|http\.request|https\.request|axios|undici/i,
    );
  });

  it('reads no environment / API-key path', () => {
    const src = read(FILE);
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/api[_-]?key/i);
  });

  it('has no customer/conversation/message/reply-draft read path', () => {
    const src = read(FILE);
    expect(src).not.toMatch(
      /\b(db|prisma)\.(customer|conversation|message|replyDraft)\b/,
    );
    for (const imp of importPaths(src)) {
      expect(imp).not.toMatch(
        /domains\/(crm|conversations|reply-drafts|knowledge)/,
      );
    }
    expect(src).not.toMatch(
      /customerMessage|conversationMessages|customerEmail|customerPhone/,
    );
  });

  it('has no auto-send / dispatch / deliver path', () => {
    expect(read(FILE)).not.toMatch(
      /\b(sendMessage|autoSend|dispatch|deliver|sendDraft)\s*\(/,
    );
  });

  it('persists no raw prompt / response content field', () => {
    const src = read(FILE);
    // The only delegate write fields are metadata; no raw-content column names.
    expect(src).not.toMatch(/\brawPrompt\b|\bpromptText\b|\bresponseText\b/);
    // The builders read .length, never store the text/prompt themselves.
    expect(src).not.toMatch(/prompt:\s*[a-zA-Z]/);
  });

  it('the only third-party import is zod', () => {
    const thirdParty = importPaths(read(FILE)).filter(
      (imp) => !imp.startsWith('.') && !imp.startsWith('@/'),
    );
    expect([...new Set(thirdParty)]).toEqual(['zod']);
  });
});
