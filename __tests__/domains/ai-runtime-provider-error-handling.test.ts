// ===========================================================================
// Tests — AI Runtime: Provider Operational Error Handling (Area B §6 gate)
//
// Closes the Area B §6 "provider error handling" gate FOR THE CURRENT
// FAKE-PROVIDER SCOPE ONLY. It proves that an OPERATIONAL provider failure
// (timeout / rate-limit / unavailable / content-filtered / unknown) — the class
// of failure a real provider could raise after accepting an otherwise
// well-formed request — is handled fail-closed, surfaced through the existing
// `ActionResult` error contract, recorded as a metadata-only B-R6 audit FAILED
// row, and NEVER produces a draft or any send/message path.
//
// It uses a TEST-ONLY fault-injecting provider (`createFaultAiProvider`); the
// production `createFakeAiProvider` cannot model an operational failure (it only
// ever succeeds or returns a request-validation error). No production source is
// touched: there is no new production error taxonomy, no real provider, no
// network/SDK/env path, no route wiring, and no auto-send.
//
// Real-provider production AI-assisted go-live remains NOT YET APPROVED.
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  createAiGenerationAuditRepository,
  createAiGenerationAuditService,
  buildStartAiGenerationAuditInput,
  buildDraftAiMetadata,
  AI_PROVIDER_ERROR_CODES,
  AI_GENERATION_AUDIT_ERROR_CODES,
  createFakeAiProvider,
  type AiProvider,
  type AiGenerationAuditService,
  type AiGenerationAuditLog,
  type AiGenerationAuditRepositoryDb,
  type AiGenerationAuditLogRecord,
  type BuildReplyDraftPromptResult,
  type DraftAiMetadata,
} from '@/domains/ai-runtime';

import {
  createFaultAiProvider,
  FAULT_SCENARIOS,
  FAULT_SCENARIO_SPECS,
  FAULT_PROVIDER_ERROR_CODES,
  type FaultScenario,
} from '../_helpers/ai-runtime-fault-provider';

// ---------------------------------------------------------------------------
// Constants (valid UUIDs) + synthetic secrets that must NEVER be persisted
// ---------------------------------------------------------------------------

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';
const CONV_1 = '55555555-5555-4555-8555-555555555555';

const PROMPT_SECRET = 'ZZZ_RAW_PROMPT_SECRET_DO_NOT_PERSIST';
const RESULT_SECRET = 'ZZZ_GENERATED_TEXT_SECRET_DO_NOT_PERSIST';
const PII_EMAIL = 'jane.doe@example.com';
const PII_PHONE = '+1 (555) 123-4567';
const PII_PHONE_DIGITS = '5551234567';

const HELPER_REL = '__tests__/_helpers/ai-runtime-fault-provider.ts';

// ---------------------------------------------------------------------------
// Fixtures (typed as the real B-R5 output)
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
    omittedContextItemIds: [],
    warnings: [],
    ...overrides,
  };
}

/** A prompt carrying PII-shaped content, to prove it never reaches the row. */
function piiPromptResult(): BuildReplyDraftPromptResult {
  return promptResult({
    providerRequest: {
      operation: 'REPLY_DRAFT',
      businessId: BIZ_A,
      prompt: `RULES ${PROMPT_SECRET} contact ${PII_EMAIL} or ${PII_PHONE}`,
      contextHash: 'abcdef0123456789',
      metadata: { promptVersion: 'reply-draft-v1' },
    },
  });
}

function validRequest() {
  return promptResult().providerRequest;
}

// ---------------------------------------------------------------------------
// In-memory fake DB delegate (mimics the Prisma aiGenerationAuditLog delegate).
// It exposes ONLY the audit delegate — there is NO customer / conversation /
// message / reply-draft delegate reachable from the failure path.
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

function makeAuditService(db: FakeDb): AiGenerationAuditService {
  return createAiGenerationAuditService({
    repository: createAiGenerationAuditRepository(db),
  });
}

// ---------------------------------------------------------------------------
// Test-only orchestration mirroring the INTENDED caller contract:
//   start audit -> call provider -> on failure: record FAILED, build NO draft.
// This invents no route and no production service; it only sequences existing
// exported pieces to prove the failure contract end-to-end.
// ---------------------------------------------------------------------------

type AttemptResult =
  | {
      outcome: 'SUCCEEDED';
      auditLog: AiGenerationAuditLog;
      draft: DraftAiMetadata;
    }
  | {
      outcome: 'FAILED';
      auditLog: AiGenerationAuditLog;
      draft: null;
      error: { code: string; message: string };
    }
  | { outcome: 'ABORTED'; reason: string };

async function runGenerationAttempt(deps: {
  auditService: AiGenerationAuditService;
  provider: AiProvider;
  pr: BuildReplyDraftPromptResult;
}): Promise<AttemptResult> {
  const { auditService, provider, pr } = deps;

  const started = await auditService.start(
    buildStartAiGenerationAuditInput({
      promptResult: pr,
      conversationId: CONV_1,
      providerId: provider.providerId,
      modelId: provider.modelId,
    }),
  );
  if (!started.ok) {
    return { outcome: 'ABORTED', reason: started.error.code };
  }

  const generated = await provider.generateText(pr.providerRequest);

  if (!generated.ok) {
    // Fail closed: record FAILED with the provider's bounded error code/message
    // (never the prompt). Build NO draft and touch NO send/message path.
    const failed = await auditService.completeFailure({
      auditLogId: started.data.id,
      businessId: started.data.businessId,
      errorCode: generated.error.code,
      errorMessage: generated.error.message,
      providerId: provider.providerId,
      modelId: provider.modelId,
    });
    return {
      outcome: 'FAILED',
      auditLog: failed.ok ? failed.data : started.data,
      draft: null,
      error: generated.error,
    };
  }

  // Success path (not exercised by the fault provider) — present only so the
  // failure branch is proven to be the ONLY branch that omits a draft.
  const completed = await auditService.completeSuccess({
    auditLogId: started.data.id,
    businessId: started.data.businessId,
    providerId: generated.data.providerId,
    modelId: generated.data.modelId,
    finishReason: generated.data.finishReason,
    promptTokens: generated.data.usage.promptTokens,
    completionTokens: generated.data.usage.completionTokens,
    totalTokens: generated.data.usage.totalTokens,
    resultCharCount: generated.data.text.length,
  });
  const draft = buildDraftAiMetadata({
    promptResult: pr,
    result: generated.data,
    auditLogId: started.data.id,
  });
  return {
    outcome: 'SUCCEEDED',
    auditLog: completed.ok ? completed.data : started.data,
    draft,
  };
}

// ===========================================================================
// Fault taxonomy surface
// ===========================================================================

describe('Provider error handling — fault taxonomy surface', () => {
  it('exposes exactly the five operational scenarios', () => {
    expect([...FAULT_SCENARIOS]).toEqual([
      'timeout',
      'rate_limited',
      'unavailable',
      'content_filtered',
      'unknown',
    ]);
  });

  it('maps every scenario to a unique, bounded, audit-safe error code', () => {
    const codes = FAULT_SCENARIOS.map((s) => FAULT_SCENARIO_SPECS[s].code);
    expect(new Set(codes).size).toBe(codes.length); // unique
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9_]+$/); // no PII, no content, no spaces
      expect(code.length).toBeLessThanOrEqual(200);
    }
    expect([...FAULT_PROVIDER_ERROR_CODES]).toEqual(codes);
  });

  it('keeps operational codes DISJOINT from production validation codes', () => {
    const validation = new Set<string>([...AI_PROVIDER_ERROR_CODES]);
    for (const code of FAULT_PROVIDER_ERROR_CODES) {
      expect(validation.has(code)).toBe(false);
    }
  });

  it('classifies retry posture: transient retryable, policy/unknown not', () => {
    expect(FAULT_SCENARIO_SPECS.timeout.retryable).toBe(true);
    expect(FAULT_SCENARIO_SPECS.rate_limited.retryable).toBe(true);
    expect(FAULT_SCENARIO_SPECS.unavailable.retryable).toBe(true);
    expect(FAULT_SCENARIO_SPECS.content_filtered.retryable).toBe(false);
    expect(FAULT_SCENARIO_SPECS.unknown.retryable).toBe(false);
  });

  it('uses fixed, generic, PII-free messages that never echo request content', () => {
    for (const scenario of FAULT_SCENARIOS) {
      const { message } = FAULT_SCENARIO_SPECS[scenario];
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(PROMPT_SECRET);
      expect(message).not.toContain(PII_EMAIL);
      expect(message).not.toContain(PII_PHONE_DIGITS);
    }
  });
});

// ===========================================================================
// Operational failures return err(...), never throw, are fail-closed
// ===========================================================================

describe('Provider error handling — fail-closed result contract', () => {
  it.each([...FAULT_SCENARIOS])(
    '%s returns err(...) and never throws',
    async (scenario) => {
      const provider = createFaultAiProvider({ scenario });
      // .resolves proves it settled (did not reject / throw).
      await expect(
        provider.generateText(validRequest()),
      ).resolves.toMatchObject({ ok: false });
    },
  );

  it.each([...FAULT_SCENARIOS])(
    '%s yields the mapped error code and produces NO draft text',
    async (scenario) => {
      const provider = createFaultAiProvider({ scenario });
      const res = await provider.generateText(validRequest());

      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('unreachable: expected failure');
      expect(res.error.code).toBe(FAULT_SCENARIO_SPECS[scenario].code);
      // Fail-closed: no success payload, hence no generated text.
      expect(
        (res as { data?: unknown }).data,
      ).toBeUndefined();
      expect(JSON.stringify(res)).not.toContain(RESULT_SECRET);
    },
  );

  it('is deterministic: same scenario -> identical (code,message) across instances and calls', async () => {
    const a = createFaultAiProvider({ scenario: 'timeout' });
    const b = createFaultAiProvider({ scenario: 'timeout' });
    const r1 = await a.generateText(validRequest());
    const r2 = await a.generateText(validRequest());
    const r3 = await b.generateText(validRequest());
    expect(r1).toEqual(r2);
    expect(r1).toEqual(r3);
  });

  it('does not invoke global fetch during a failing generation', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const provider = createFaultAiProvider({ scenario: 'unavailable' });
      const res = await provider.generateText(validRequest());
      expect(res.ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ===========================================================================
// Failure flow -> exactly one metadata-only audit FAILED row, no draft/send
// ===========================================================================

describe('Provider error handling — audit FAILED path (metadata-only)', () => {
  it.each([...FAULT_SCENARIOS])(
    '%s records exactly one FAILED row and builds no draft',
    async (scenario: FaultScenario) => {
      const db = createFakeDb();
      const auditService = makeAuditService(db);
      const provider = createFaultAiProvider({ scenario });

      const result = await runGenerationAttempt({
        auditService,
        provider,
        pr: promptResult(),
      });

      expect(result.outcome).toBe('FAILED');
      if (result.outcome !== 'FAILED') throw new Error('unreachable');

      // Exactly one row, terminal FAILED, no draft produced.
      expect(db.rows).toHaveLength(1);
      expect(db.rows[0].status).toBe('FAILED');
      expect(result.draft).toBeNull();
      expect(result.auditLog.status).toBe('FAILED');
      expect(result.auditLog.completedAt).not.toBeNull();
    },
  );

  it('records a bounded, safe error code on the FAILED row', async () => {
    const db = createFakeDb();
    const auditService = makeAuditService(db);
    const provider = createFaultAiProvider({ scenario: 'rate_limited' });

    await runGenerationAttempt({ auditService, provider, pr: promptResult() });

    const row = db.rows[0];
    expect(row.errorCode).toBe('AI_PROVIDER_RATE_LIMITED');
    expect(row.errorCode).toMatch(/^[A-Z0-9_]+$/);
    expect((row.errorCode ?? '').length).toBeLessThanOrEqual(200);
    expect(FAULT_PROVIDER_ERROR_CODES).toContain(row.errorCode);
  });

  it('persists a METADATA-ONLY row — no content/prompt/text columns', async () => {
    const db = createFakeDb();
    const auditService = makeAuditService(db);
    const provider = createFaultAiProvider({ scenario: 'unknown' });

    await runGenerationAttempt({ auditService, provider, pr: promptResult() });

    const row = db.rows[0];
    const keys = Object.keys(row);
    for (const forbidden of [
      'prompt',
      'promptText',
      'text',
      'generatedText',
      'draftText',
      'originalText',
      'content',
      'transcript',
      'customer',
      'email',
      'phone',
      'message',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    // Positive: it DOES carry the expected metadata.
    expect(row).toMatchObject({
      businessId: BIZ_A,
      operation: 'REPLY_DRAFT',
      status: 'FAILED',
    });
    expect(typeof row.promptCharCount).toBe('number'); // length only, not text
  });

  it('never lets the raw prompt or PII reach the FAILED row', async () => {
    const db = createFakeDb();
    const auditService = makeAuditService(db);
    const provider = createFaultAiProvider({ scenario: 'timeout' });

    await runGenerationAttempt({
      auditService,
      provider,
      pr: piiPromptResult(),
    });

    const serialized = JSON.stringify(db.rows[0]);
    expect(serialized).not.toContain(PROMPT_SECRET);
    expect(serialized).not.toContain(PII_EMAIL);
    expect(serialized).not.toContain('jane.doe');
    expect(serialized).not.toContain(PII_PHONE_DIGITS);
    expect(serialized).not.toContain('123-4567');
    expect(serialized).not.toContain(RESULT_SECRET);
  });

  it('touches no customer/conversation/message/reply-draft delegate', () => {
    const db = createFakeDb();
    // The only delegate the failure path can reach is the audit log.
    expect(Object.keys(db).sort()).toEqual(['aiGenerationAuditLog', 'rows']);
    for (const forbidden of [
      'customer',
      'conversation',
      'message',
      'replyDraft',
    ]) {
      expect(db).not.toHaveProperty(forbidden);
    }
  });
});

// ===========================================================================
// Terminal immutability + tenant scoping on the failure path
// ===========================================================================

describe('Provider error handling — terminal immutability & tenancy', () => {
  it('keeps a FAILED row immutable (no re-complete as FAILED or SUCCEEDED)', async () => {
    const db = createFakeDb();
    const auditService = makeAuditService(db);
    const provider = createFaultAiProvider({ scenario: 'unavailable' });

    const result = await runGenerationAttempt({
      auditService,
      provider,
      pr: promptResult(),
    });
    if (result.outcome !== 'FAILED') throw new Error('unreachable');

    const id = result.auditLog.id;
    const snapshot = JSON.stringify(db.rows[0]);

    const reFail = await auditService.completeFailure({
      auditLogId: id,
      businessId: BIZ_A,
      errorCode: 'AI_PROVIDER_TIMEOUT',
    });
    expect(reFail.ok).toBe(false);
    if (!reFail.ok) {
      expect(reFail.error.code).toBe('AI_AUDIT_INVALID_TRANSITION');
    }

    const reSucceed = await auditService.completeSuccess({
      auditLogId: id,
      businessId: BIZ_A,
    });
    expect(reSucceed.ok).toBe(false);
    if (!reSucceed.ok) {
      expect(reSucceed.error.code).toBe('AI_AUDIT_INVALID_TRANSITION');
    }

    // Row unchanged after rejected transitions.
    expect(JSON.stringify(db.rows[0])).toBe(snapshot);
    expect(db.rows).toHaveLength(1);
  });

  it('scopes completion by businessId — a cross-tenant failure cannot mutate the row', async () => {
    const db = createFakeDb();
    const auditService = makeAuditService(db);
    const provider = createFaultAiProvider({ scenario: 'timeout' });

    // Open a STARTED attempt for BIZ_A.
    const started = await auditService.start(
      buildStartAiGenerationAuditInput({
        promptResult: promptResult(),
        conversationId: CONV_1,
        providerId: provider.providerId,
        modelId: provider.modelId,
      }),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error('unreachable');

    // A different tenant cannot complete BIZ_A's attempt as FAILED.
    const crossTenant = await auditService.completeFailure({
      auditLogId: started.data.id,
      businessId: BIZ_B,
      errorCode: 'AI_PROVIDER_TIMEOUT',
    });
    expect(crossTenant.ok).toBe(false);
    if (!crossTenant.ok) {
      expect(crossTenant.error.code).toBe('AI_AUDIT_NOT_FOUND');
    }
    // The BIZ_A row is untouched and still STARTED.
    expect(db.rows[0].businessId).toBe(BIZ_A);
    expect(db.rows[0].status).toBe('STARTED');

    // The correct tenant can complete it.
    const ownTenant = await auditService.completeFailure({
      auditLogId: started.data.id,
      businessId: BIZ_A,
      errorCode: 'AI_PROVIDER_TIMEOUT',
    });
    expect(ownTenant.ok).toBe(true);
    expect(db.rows[0].status).toBe('FAILED');
  });

  it('exposes the expected audit error codes (transition/not-found)', () => {
    expect([...AI_GENERATION_AUDIT_ERROR_CODES]).toContain(
      'AI_AUDIT_INVALID_TRANSITION',
    );
    expect([...AI_GENERATION_AUDIT_ERROR_CODES]).toContain('AI_AUDIT_NOT_FOUND');
  });
});

// ===========================================================================
// Static scope guards over the fault-provider helper surface
// ===========================================================================

describe('Provider error handling — static scope guards (helper surface)', () => {
  function read(rel: string): string {
    return fs.readFileSync(path.resolve(rel), 'utf8');
  }

  function importPaths(src: string): string[] {
    return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  }

  it('imports no real provider / LLM SDK', () => {
    const src = read(HELPER_REL);
    expect(src).not.toMatch(
      /openai|anthropic|@anthropic-ai|@google|googleapis|gemini|vertex|cohere|mistral|llama|bedrock/i,
    );
    expect(src).not.toMatch(
      /require\(['"](?:openai|anthropic|@google|cohere|mistral)/,
    );
  });

  it('uses only allowlisted imports (no new deps)', () => {
    const allowed = new Set(['@/lib/result', '@/domains/ai-runtime']);
    for (const imp of importPaths(read(HELPER_REL))) {
      expect(allowed.has(imp)).toBe(true);
    }
  });

  it('makes no network request', () => {
    expect(read(HELPER_REL)).not.toMatch(
      /\bfetch\b|XMLHttpRequest|node:http\b|node:https\b|http\.request|https\.request|axios|undici/i,
    );
  });

  it('reads no environment / API-key path', () => {
    const src = read(HELPER_REL);
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/api[_-]?key/i);
  });

  it('uses no randomness (deterministic)', () => {
    expect(read(HELPER_REL)).not.toMatch(/Math\.random/);
  });

  it('has no auto-send / dispatch / deliver / message-create path', () => {
    expect(read(HELPER_REL)).not.toMatch(
      /\b(sendMessage|autoSend|dispatch|deliver|sendDraft|createMessage)\s*\(/,
    );
  });

  it('has no customer/conversation/message/reply-draft read path', () => {
    const src = read(HELPER_REL);
    expect(src).not.toMatch(
      /\b(db|prisma)\.(customer|conversation|message|replyDraft)\b/,
    );
  });

  it('confirms the production fake provider cannot model an operational failure', async () => {
    // The fake provider only ever SUCCEEDS on a valid request — proving the
    // fault provider fills a genuine gap rather than duplicating it.
    const fake = createFakeAiProvider();
    const res = await fake.generateText(validRequest());
    expect(res.ok).toBe(true);
  });
});
