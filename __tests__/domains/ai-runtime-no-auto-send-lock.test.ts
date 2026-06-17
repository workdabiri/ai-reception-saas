// ===========================================================================
// Tests — AI Runtime: Dedicated No-Auto-Send / Human-Approval Lock (B-R8)
//
// PURPOSE
//   The no-auto-send / human-review property currently holds structurally and
//   is pinned only as a SIDE-property of the B-R6 (audit/metadata) and B-R7
//   (cross-tenant isolation) suites. B-R8 makes it a DEDICATED, first-class lock
//   so a future AI-runtime change cannot silently regress it before Level 2 is
//   enabled for any real user (remediation plan §4 B-R8; closure checkpoint §6).
//
//   The goal is to make it STRUCTURALLY HARD for future AI runtime work to
//   accidentally send messages, approve drafts, transition drafts to SENT, or
//   otherwise bypass human review.
//
// WHAT THIS LOCKS (each maps to a required B-R8 property):
//   §1  Static AI-runtime no-send guards — the 8 production AI-runtime files
//       contain no send/dispatch/deliver/message-creation call-site, no
//       sent*/SENT/APPROVED delivery token, and no import of the
//       conversations / channels / actions / reply-drafts (send/delivery)
//       domains.  ⇒ AI runtime has no send path and no message-delivery path.
//   §2  AI draft metadata is review-only — the B-R6 builders
//       (buildDraftAiMetadata / buildStart… / buildSuccess…) never carry a
//       status, a sent/approved/dispatched/delivered field, a message id, an
//       autoSend flag, the raw draft text, or the raw prompt text.
//   §3  Audit lifecycle is NOT a draft-delivery lifecycle — audit status is only
//       STARTED / SUCCEEDED / FAILED; a SUCCEEDED attempt implies no approval,
//       no message creation, no send/deliver status, and no customer delivery.
//   §4  Fake provider cannot send — it returns generated text only, exposes no
//       send/approve method, and imports no message/channel/action/reply-draft
//       surface.
//   §5  Reply-drafts boundary — AI metadata attaches as metadata only (it never
//       changes a draft's status to APPROVED/SENT); approve/discard/edit remain
//       human/workflow actions in the reply-drafts domain; AI runtime imports no
//       reply-drafts repository/service; the human SENT/APPROVED capability is
//       preserved (not removed).
//   §6  Future route guard — no production route combines AI-runtime generation
//       (provider / prompt / audit) with send / dispatch / deliver / message
//       creation. The deterministic SYSTEM stub and normal human message
//       workflow are NOT blocked.
//   §7  No real provider / no real generation work — B-R8 introduces no real
//       provider SDK, no network/fetch, no env/API-key, no route-level
//       generation, and no new AI-runtime production module.
//   §8  Human approval remains the only boundary — send/approve permissions are
//       held only by human membership roles; there is no autonomous AI actor.
//
// SCOPE: TEST-ONLY. B-R8 changes NO production code. (A production constant
// enumerating the forbidden delivery field names would itself plant those
// tokens inside an AI-runtime source file and defeat the §1 static guard, so the
// forbidden-field contract is owned here, in the lock, as its single source of
// truth.) This suite invents NO route wiring and NO real generation service.
// ===========================================================================

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  // B-R6 pure builders (the only metadata path an AI-generated draft has)
  buildDraftAiMetadata,
  buildStartAiGenerationAuditInput,
  buildSuccessAiGenerationAuditInput,
  // B-R5 / B-R4 real composition (deterministic, no network/provider SDK)
  createAiPromptBuilder,
  createFakeAiProvider,
  // B-R6 audit persistence boundary
  createAiGenerationAuditRepository,
  AI_GENERATION_AUDIT_STATUS_VALUES,
  type AssembledAiContext,
  type BuildReplyDraftPromptResult,
  type AiProviderGenerateTextResult,
  type AiGenerationAuditLogRecord,
  type AiGenerationAuditRepositoryDb,
} from '@/domains/ai-runtime';

import {
  REPLY_DRAFT_STATUS_VALUES,
  REPLY_DRAFT_SOURCE_VALUES,
  createReplyDraftRepository,
  type ReplyDraftRepositoryDb,
  type ReplyDraftRecord,
} from '@/domains/reply-drafts';

import { ROLE_PERMISSIONS } from '@/domains/authz/permissions';
import { AUTHZ_PERMISSION_VALUES } from '@/domains/authz/types';

// ---------------------------------------------------------------------------
// Constants — valid UUIDs + content sentinels
// ---------------------------------------------------------------------------

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const CONV_1 = '55555555-5555-4555-8555-555555555555';
const DRAFT_1 = '33333333-3333-4333-8333-333333333333';
const USER_HUMAN = '44444444-4444-4444-8444-444444444444';
const VERIFIER = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const FIXED_NOW = new Date('2026-06-16T12:00:00.000Z');

// Secrets deliberately embedded in raw prompt / generated text / draft text.
// Their appearance in any persisted/attached metadata is a leak (and, for the
// draft text, a sign the AI path is carrying customer-facing content).
const PROMPT_SECRET = 'B_R8_RAW_PROMPT_SECRET_DO_NOT_PERSIST';
const RESULT_SECRET = 'B_R8_GENERATED_TEXT_SECRET_DO_NOT_PERSIST';
const DRAFT_TEXT_SECRET = 'B_R8_DRAFT_TEXT_SECRET_DO_NOT_ATTACH';

// ---------------------------------------------------------------------------
// The production AI-runtime source surface under lock (B-R3..B-R6)
// ---------------------------------------------------------------------------

const AI_RUNTIME_DIR = 'src/domains/ai-runtime';

const PROD_FILES = [
  'src/domains/ai-runtime/types.ts',
  'src/domains/ai-runtime/service.ts',
  'src/domains/ai-runtime/context-assembler.ts',
  'src/domains/ai-runtime/provider.ts',
  'src/domains/ai-runtime/fake-provider.ts',
  'src/domains/ai-runtime/prompt-builder.ts',
  'src/domains/ai-runtime/audit-log.ts',
  'src/domains/ai-runtime/index.ts',
];

/** The B-R8 lock target itself (used by its own no-real-work self-guard, §7). */
const TEST_FILE = '__tests__/domains/ai-runtime-no-auto-send-lock.test.ts';

// ---------------------------------------------------------------------------
// Forbidden-field contract (single source of truth for the lock)
// ---------------------------------------------------------------------------

/**
 * Field names that must NEVER appear on an AI-runtime structured output
 * (draft-metadata patch or audit input). Their presence would mean the AI path
 * is carrying a draft delivery state, an approval, a message reference, or an
 * auto-send flag — the exact failure B-R8 locks out.
 */
const FORBIDDEN_DELIVERY_FIELDS = [
  'status',
  'sentAt',
  'sentMessageId',
  'messageId',
  'autoSend',
  'approvedByUserId',
  'approvedAt',
  'dispatchedAt',
  'deliveredAt',
] as const;

/** Raw-content fields that must never ride along on AI-runtime metadata. */
const FORBIDDEN_CONTENT_FIELDS = [
  'draftText',
  'draftTextPreview',
  'prompt',
  'promptText',
  'rawPrompt',
  'text',
  'responseText',
] as const;

/**
 * Send / dispatch / deliver / message-creation CALL-SITE matcher. Matches the
 * function-call form `name(` only, so prose like "delivery / service areas" or
 * "must never be sent" is not a false positive. Case-sensitive on purpose.
 */
const SEND_CALL_RE =
  /\b(sendMessage|sendDraft|autoSend|dispatch|deliver|createMessage)\s*\(/;

/** A transition to the SENT draft state, in either quote style. */
const SENT_TRANSITION_RE = /status:\s*['"]SENT['"]/;

/**
 * AI-runtime GENERATION signal: the provider / prompt / audit symbols (or a
 * direct `@/domains/ai-runtime` import) that, combined with a send call-site in
 * the same route file, would constitute AI auto-send. NOTE: this deliberately
 * does NOT include the B-R3 context assembler (`assembleAiContext` /
 * `createAiRuntimeService`) on its own — assembly is not generation, and the
 * assembler is legitimately wired in the DI composition root.
 */
const AI_GENERATION_SYMBOL_RE =
  /\b(buildReplyDraftPrompt|createAiPromptBuilder|createFakeAiProvider|createAiGenerationAudit(?:Service|Repository)|buildDraftAiMetadata|buildStartAiGenerationAuditInput|buildSuccessAiGenerationAuditInput)\b|\.generateText\s*\(/;

/** Import-path patterns forbidden inside AI-runtime source (send/delivery/PII). */
const FORBIDDEN_IMPORT_DOMAIN_RE =
  /domains\/(conversations|channels|actions|reply-drafts|crm)/;
const FORBIDDEN_IMPORT_SEND_MODULE_RE =
  /\b(send|sender|deliver|delivery|dispatch|messaging|mailer|outbox|sms|smtp|email)\b/i;

/** Real model-provider SDK names — must never appear as a dependency or import. */
const REAL_PROVIDER_SDK_RE =
  /openai|anthropic|@anthropic-ai|@google\/genai|googleapis|gemini|vertex|cohere|mistral|llama|bedrock|huggingface|replicate|groq|together-ai/i;

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), 'utf8');
}

/** Extracts every module specifier from `import …`/`export … from` statements. */
function importPaths(src: string): string[] {
  return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** Recursively lists `.ts`/`.tsx` files under a directory (absolute paths). */
function walkTs(absDir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTs(full));
    } else if (
      entry.isFile() &&
      (full.endsWith('.ts') || full.endsWith('.tsx'))
    ) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures (typed as the real B-R5 / B-R4 outputs)
// ---------------------------------------------------------------------------

/** A minimal AI-enabled assembled context (BIZ_A) for the real pipeline. */
function assembledContext(): AssembledAiContext {
  return {
    businessId: BIZ_A,
    aiMode: 'AI_ASSISTED',
    aiGenerationEnabled: true,
    businessContextItems: [
      {
        id: 'item-hours',
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
}

/** A B-R5 prompt-build result whose raw prompt carries a secret. */
function promptResultFixture(
  overrides: Partial<BuildReplyDraftPromptResult> = {},
): BuildReplyDraftPromptResult {
  return {
    promptVersion: 'reply-draft-v1',
    providerRequest: {
      operation: 'REPLY_DRAFT',
      businessId: BIZ_A,
      prompt: `SYSTEM RULES ... verified context ... ${PROMPT_SECRET}`,
      contextHash: 'abcdef0123456789',
      metadata: { promptVersion: 'reply-draft-v1', contextItemCount: '1' },
    },
    contextHash: 'abcdef0123456789',
    includedContextItemIds: ['item-hours'],
    omittedContextItemIds: [],
    warnings: [],
    ...overrides,
  };
}

/** A B-R4 provider result whose generated text carries a secret. */
function providerResultFixture(
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
// In-memory audit delegate (mirrors the B-R6 Prisma aiGenerationAuditLog seam)
// ---------------------------------------------------------------------------

interface AuditFakeDb extends AiGenerationAuditRepositoryDb {
  rows: AiGenerationAuditLogRecord[];
}

function fakeUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function createAuditFakeDb(): AuditFakeDb {
  const rows: AiGenerationAuditLogRecord[] = [];
  let idCounter = 0;
  let clock = 0;
  const tick = () => new Date(1_700_000_000_000 + clock++ * 1000);

  return {
    rows,
    aiGenerationAuditLog: {
      async create({ data }) {
        const now = tick();
        const rec: AiGenerationAuditLogRecord = {
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
        rows.push(rec);
        return { ...rec };
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
        rows[idx] = { ...rows[idx], ...patch, updatedAt: now };
        return { ...rows[idx] };
      },
    },
  };
}

/**
 * Runs the intended Level-2 generate ORDER over the REAL B-R5 builder + B-R4
 * fake provider + B-R6 audit repository: assemble (provided) → prompt → audit
 * start → generate → audit complete-success. There is NO send/approve/deliver
 * step because none exists. Returns the persisted artifacts for inspection.
 */
async function runRealSuccessPipeline() {
  const built = createAiPromptBuilder().buildReplyDraftPrompt({
    context: assembledContext(),
  });
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error('prompt build failed');

  const provider = createFakeAiProvider({ now: () => FIXED_NOW });
  const gen = await provider.generateText(built.data.providerRequest);
  expect(gen.ok).toBe(true);
  if (!gen.ok) throw new Error('generation failed');

  const auditDb = createAuditFakeDb();
  const repo = createAiGenerationAuditRepository(auditDb);

  const started = await repo.start(
    buildStartAiGenerationAuditInput({
      promptResult: built.data,
      providerId: provider.providerId,
      modelId: provider.modelId,
      conversationId: CONV_1,
    }),
  );
  expect(started.ok).toBe(true);
  if (!started.ok) throw new Error('audit start failed');

  const done = await repo.completeSuccess(
    buildSuccessAiGenerationAuditInput({
      auditLogId: started.data.id,
      businessId: BIZ_A,
      result: gen.data,
      replyDraftId: DRAFT_1,
    }),
  );
  expect(done.ok).toBe(true);
  if (!done.ok) throw new Error('audit complete failed');

  const meta = buildDraftAiMetadata({
    promptResult: built.data,
    result: gen.data,
    auditLogId: done.data.id,
  });

  return { auditDb, started: started.data, done: done.data, meta, gen: gen.data };
}

// ---------------------------------------------------------------------------
// In-memory reply-draft delegate (the ONLY persistence reply-drafts touches)
// ---------------------------------------------------------------------------

function createReplyDraftDb(seed: ReplyDraftRecord[]): {
  db: ReplyDraftRepositoryDb;
  rows: ReplyDraftRecord[];
} {
  const rows: ReplyDraftRecord[] = seed.map((r) => ({ ...r }));
  const db: ReplyDraftRepositoryDb = {
    replyDraft: {
      async findMany() {
        return [];
      },
      async findUnique({ where }) {
        const found = rows.find((r) => r.id === where.id);
        return found ? { ...found } : null;
      },
      async count() {
        return 0;
      },
      async create() {
        throw new Error('create is not exercised by the B-R8 lock');
      },
      async update({ where, data }) {
        const idx = rows.findIndex((r) => r.id === where.id);
        if (idx === -1) throw new Error('record not found');
        rows[idx] = {
          ...rows[idx],
          ...data,
          updatedAt: new Date('2026-06-16T10:00:00.000Z'),
        } as ReplyDraftRecord;
        return { ...rows[idx] };
      },
    },
  };
  return { db, rows };
}

function aiSourcedPendingDraft(): ReplyDraftRecord {
  return {
    id: DRAFT_1,
    businessId: BIZ_A,
    conversationId: CONV_1,
    source: 'AI',
    status: 'PENDING_REVIEW',
    draftText: `Draft awaiting review. ${DRAFT_TEXT_SECRET}`,
    originalText: `Draft awaiting review. ${DRAFT_TEXT_SECRET}`,
    reviewedByUserId: null,
    reviewedAt: null,
    createdAt: new Date('2026-06-16T09:30:00.000Z'),
    updatedAt: new Date('2026-06-16T09:30:00.000Z'),
  };
}

// ===========================================================================
// §1 — Static AI-runtime no-send guards
// ===========================================================================

describe('B-R8 §1 — AI runtime has no send / delivery path (static guards)', () => {
  it('the guard patterns are not vacuous (they catch a synthetic violation)', () => {
    // NOTE: the violation sample deliberately avoids embedding a literal import
    // statement so it is not itself picked up by importPaths() when the §7
    // allowlist self-check scans this file's source. The import regexes are
    // exercised directly against representative module-path strings instead.
    const violation = [
      'sendMessage(payload);',
      'createMessage(payload);',
      'autoSend(draft);',
      'dispatch(msg);',
      'deliver(msg);',
      'sendDraft(draft);',
      "status: 'SENT'",
      'const s: ReplyDraftStatus = SENT;',
      'const x = APPROVED;',
      'const y = { sentMessageId: id, sentAt: now };',
    ].join('\n');

    expect(violation).toMatch(SEND_CALL_RE);
    expect(violation).toMatch(SENT_TRANSITION_RE);
    expect(violation).toMatch(/\bSENT\b/);
    expect(violation).toMatch(/\bAPPROVED\b/);
    expect(violation).toMatch(/sentMessageId/);
    expect(violation).toMatch(/sentAt/);
    // The import guards catch a forbidden send/delivery domain or module path.
    expect(FORBIDDEN_IMPORT_DOMAIN_RE.test('@/domains/conversations')).toBe(true);
    expect(FORBIDDEN_IMPORT_DOMAIN_RE.test('@/domains/reply-drafts/repository')).toBe(true);
    expect(FORBIDDEN_IMPORT_SEND_MODULE_RE.test('@/domains/messaging/sender')).toBe(true);
  });

  it.each(PROD_FILES)(
    '%s has no send/dispatch/deliver/message-creation call-site',
    (rel) => {
      expect(read(rel)).not.toMatch(SEND_CALL_RE);
    },
  );

  it.each(PROD_FILES)(
    '%s contains no SENT / APPROVED draft-delivery token',
    (rel) => {
      const src = read(rel);
      // Bare uppercase tokens (case-sensitive, word-bounded) — lowercase prose
      // such as "must never be sent" is intentionally NOT matched.
      expect(src).not.toMatch(/\bSENT\b/);
      expect(src).not.toMatch(/\bAPPROVED\b/);
      expect(src).not.toMatch(SENT_TRANSITION_RE);
      expect(src).not.toContain("status: 'SENT'");
      expect(src).not.toContain('status: "SENT"');
    },
  );

  it.each(PROD_FILES)(
    '%s carries no sent*/dispatched*/delivered* delivery field',
    (rel) => {
      const src = read(rel);
      expect(src).not.toMatch(/\bsentMessageId\b/);
      expect(src).not.toMatch(/\bsentAt\b/);
      expect(src).not.toMatch(/\bdispatchedAt\b/);
      expect(src).not.toMatch(/\bdeliveredAt\b/);
    },
  );

  it.each(PROD_FILES)(
    '%s imports no conversations/channels/actions/reply-drafts (send/delivery) domain',
    (rel) => {
      for (const imp of importPaths(read(rel))) {
        expect(imp).not.toMatch(FORBIDDEN_IMPORT_DOMAIN_RE);
        expect(imp).not.toMatch(FORBIDDEN_IMPORT_SEND_MODULE_RE);
      }
    },
  );
});

// ===========================================================================
// §2 — AI draft metadata (and audit inputs) are review-only
// ===========================================================================

describe('B-R8 §2 — AI draft metadata is review-only', () => {
  it('buildDraftAiMetadata carries no delivery / status field', () => {
    const meta = buildDraftAiMetadata({
      promptResult: promptResultFixture(),
      result: providerResultFixture(),
      auditLogId: fakeUuid(7),
    });
    for (const forbidden of FORBIDDEN_DELIVERY_FIELDS) {
      expect(meta).not.toHaveProperty(forbidden);
    }
    // It is positively a review-only AI fingerprint.
    expect(meta.source).toBe('AI');
    expect(meta.aiGenerationAuditLogId).toBe(fakeUuid(7));
  });

  it('buildDraftAiMetadata carries no raw draft text and no raw prompt text', () => {
    const meta = buildDraftAiMetadata({
      promptResult: promptResultFixture(),
      result: providerResultFixture(),
    });
    for (const forbidden of FORBIDDEN_CONTENT_FIELDS) {
      expect(meta).not.toHaveProperty(forbidden);
    }
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain(PROMPT_SECRET);
    expect(serialized).not.toContain(RESULT_SECRET);
  });

  it('buildStartAiGenerationAuditInput carries no delivery field and no raw prompt', () => {
    const input = buildStartAiGenerationAuditInput({
      promptResult: promptResultFixture(),
      conversationId: CONV_1,
      replyDraftId: DRAFT_1,
    });
    for (const forbidden of FORBIDDEN_DELIVERY_FIELDS) {
      expect(input).not.toHaveProperty(forbidden);
    }
    for (const forbidden of FORBIDDEN_CONTENT_FIELDS) {
      expect(input).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(input)).not.toContain(PROMPT_SECRET);
    // Legitimate trace ids are allowed (they are not a delivery message id).
    expect(input.replyDraftId).toBe(DRAFT_1);
    expect(input.conversationId).toBe(CONV_1);
    expect(input).not.toHaveProperty('messageId');
  });

  it('buildSuccessAiGenerationAuditInput carries no delivery field and no generated text', () => {
    const input = buildSuccessAiGenerationAuditInput({
      auditLogId: fakeUuid(1),
      businessId: BIZ_A,
      result: providerResultFixture(),
      replyDraftId: DRAFT_1,
    });
    for (const forbidden of FORBIDDEN_DELIVERY_FIELDS) {
      expect(input).not.toHaveProperty(forbidden);
    }
    for (const forbidden of FORBIDDEN_CONTENT_FIELDS) {
      expect(input).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(input)).not.toContain(RESULT_SECRET);
  });
});

// ===========================================================================
// §3 — Audit lifecycle is NOT a draft-delivery lifecycle
// ===========================================================================

describe('B-R8 §3 — audit lifecycle is not a delivery lifecycle', () => {
  it('audit status values are exactly STARTED / SUCCEEDED / FAILED', () => {
    expect([...AI_GENERATION_AUDIT_STATUS_VALUES]).toEqual([
      'STARTED',
      'SUCCEEDED',
      'FAILED',
    ]);
  });

  it('the audit status union contains no approval / send / delivery state', () => {
    for (const delivery of [
      'APPROVED',
      'SENT',
      'DISCARDED',
      'DELIVERED',
      'DISPATCHED',
    ]) {
      expect(AI_GENERATION_AUDIT_STATUS_VALUES as readonly string[]).not.toContain(
        delivery,
      );
    }
  });

  it('a SUCCEEDED attempt is the terminal AI state — not an approval or a send', async () => {
    const { done, auditDb } = await runRealSuccessPipeline();

    // Success means "the model produced text", never "approved" or "sent".
    expect(done.status).toBe('SUCCEEDED');
    expect(done.status).not.toBe('APPROVED');
    expect(done.status).not.toBe('SENT');

    // The audit record models attempt lifecycle only — no delivery/approval/
    // message fields exist on it.
    for (const forbidden of [
      'sentMessageId',
      'sentAt',
      'approvedByUserId',
      'approvedAt',
      'dispatchedAt',
      'deliveredAt',
      'messageId',
      'draftText',
      'draftStatus',
    ]) {
      expect(done).not.toHaveProperty(forbidden);
    }

    // No persisted audit row carries a SENT/APPROVED marker or a message id.
    const dump = JSON.stringify(auditDb.rows);
    expect(dump).not.toMatch(/\bSENT\b/);
    expect(dump).not.toMatch(/\bAPPROVED\b/);
    expect(dump).not.toContain('sentMessageId');
    expect(dump).not.toContain('messageId');
  });

  it('audit success implies no message creation / customer delivery (no such delegate)', async () => {
    const { auditDb } = await runRealSuccessPipeline();
    // The audit repository can reach ONLY the aiGenerationAuditLog delegate —
    // there is structurally no message/conversation/reply-draft/send surface
    // through which "success" could create a Message or deliver to a customer.
    expect(Object.keys(auditDb)).toEqual(['rows', 'aiGenerationAuditLog']);
  });
});

// ===========================================================================
// §4 — The fake provider cannot send
// ===========================================================================

describe('B-R8 §4 — fake provider returns text only and cannot send', () => {
  it('exposes only providerId / modelId / generateText — no send or approve method', () => {
    const provider = createFakeAiProvider();
    expect(Object.keys(provider).sort()).toEqual(
      ['generateText', 'modelId', 'providerId'].sort(),
    );
    for (const forbidden of [
      'sendMessage',
      'sendDraft',
      'autoSend',
      'dispatch',
      'deliver',
      'approve',
      'approveDraft',
      'createMessage',
    ]) {
      expect(provider).not.toHaveProperty(forbidden);
    }
  });

  it('a successful result is generated text + metadata only (exact key set)', async () => {
    const provider = createFakeAiProvider({ now: () => FIXED_NOW });
    const built = createAiPromptBuilder().buildReplyDraftPrompt({
      context: assembledContext(),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const gen = await provider.generateText(built.data.providerRequest);
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;

    expect(Object.keys(gen.data).sort()).toEqual(
      [
        'createdAt',
        'finishReason',
        'modelId',
        'providerId',
        'requestId',
        'text',
        'usage',
      ].sort(),
    );
    // The result carries no send/approve/delivery/message field.
    for (const forbidden of [
      ...FORBIDDEN_DELIVERY_FIELDS,
      'draftId',
      'sent',
      'delivered',
    ]) {
      expect(gen.data).not.toHaveProperty(forbidden);
    }
  });

  it('fake-provider.ts imports no message/channel/action/reply-draft surface', () => {
    const src = read('src/domains/ai-runtime/fake-provider.ts');
    for (const imp of importPaths(src)) {
      expect(imp).not.toMatch(FORBIDDEN_IMPORT_DOMAIN_RE);
      expect(imp).not.toMatch(FORBIDDEN_IMPORT_SEND_MODULE_RE);
    }
    // No send call-site, no network, no env/key — it cannot reach a customer.
    expect(src).not.toMatch(SEND_CALL_RE);
    expect(src).not.toMatch(/\bfetch\b|XMLHttpRequest|axios|undici/i);
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/api[_-]?key/i);
  });
});

// ===========================================================================
// §5 — Reply-drafts boundary (attach-only; human-driven transitions)
// ===========================================================================

describe('B-R8 §5 — reply-drafts boundary', () => {
  it('attaching AI metadata does not change a draft to APPROVED or SENT', () => {
    const meta = buildDraftAiMetadata({
      promptResult: promptResultFixture(),
      result: providerResultFixture(),
      auditLogId: fakeUuid(9),
    });

    // A draft "row" as it would exist before review.
    const draftBefore = {
      id: DRAFT_1,
      conversationId: CONV_1,
      source: 'AI' as const,
      status: 'PENDING_REVIEW' as const,
      draftText: `Awaiting review. ${DRAFT_TEXT_SECRET}`,
      reviewedByUserId: null,
      reviewedAt: null,
    };

    // Attaching the AI metadata is a pure metadata merge — no status key rides
    // along, so the human-review status cannot be flipped by attachment.
    const merged = { ...draftBefore, ...meta };
    expect(merged.status).toBe('PENDING_REVIEW');
    expect(merged.status).not.toBe('APPROVED');
    expect(merged.status).not.toBe('SENT');
    expect(merged.reviewedByUserId).toBeNull();
    expect(merged.reviewedAt).toBeNull();
    // The merge added only AI fingerprint fields.
    expect(merged.modelProvider).toBe('fake');
    expect(merged.promptVersion).toBe('reply-draft-v1');
    expect(Object.keys(meta)).not.toContain('status');
  });

  it('the AI-runtime barrel exports no draft-mutation function', () => {
    // The reply-draft lifecycle verbs live ONLY in the reply-drafts domain. The
    // AI-runtime index must re-export none of them.
    const indexSrc = read('src/domains/ai-runtime/index.ts');
    for (const verb of [
      'approveDraft',
      'discardDraft',
      'editDraft',
      'createSystemDraft',
      'generateOrReuseStubDraft',
      'createReplyDraftRepository',
    ]) {
      expect(indexSrc).not.toContain(verb);
    }
    // It re-exports only the known AI-runtime modules.
    expect(importPaths(indexSrc).sort()).toEqual(
      [
        './types',
        './service',
        './context-assembler',
        './provider',
        './fake-provider',
        './prompt-builder',
        './audit-log',
      ].sort(),
    );
  });

  it.each(PROD_FILES)(
    '%s references no reply-draft mutation verb',
    (rel) => {
      const src = read(rel);
      expect(src).not.toMatch(/\b(approveDraft|discardDraft|editDraft)\b/);
      expect(src).not.toMatch(/\bcreateReplyDraftRepository\b/);
      expect(src).not.toMatch(/\breviewedByUserId\b/);
    },
  );

  it('approve/discard/edit are human/workflow actions in the reply-drafts domain', () => {
    const { db } = createReplyDraftDb([aiSourcedPendingDraft()]);
    const repo = createReplyDraftRepository(db);
    expect(typeof repo.approveDraft).toBe('function');
    expect(typeof repo.discardDraft).toBe('function');
    expect(typeof repo.editDraft).toBe('function');
    // The reply-drafts persistence surface is exactly the replyDraft delegate —
    // no message/send delegate, so approving creates no Message.
    expect(Object.keys(db)).toEqual(['replyDraft']);
  });

  it('approving an AI-sourced draft is driven by a HUMAN reviewer (not the AI runtime)', async () => {
    const { db, rows } = createReplyDraftDb([aiSourcedPendingDraft()]);
    const repo = createReplyDraftRepository(db);

    const res = await repo.approveDraft({
      businessId: BIZ_A,
      conversationId: CONV_1,
      draftId: DRAFT_1,
      reviewedByUserId: USER_HUMAN, // a human actor is REQUIRED by the input
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.approved).toBe(true);
    expect(res.data.draft.status).toBe('APPROVED');
    // The transition is stamped with the human reviewer; APPROVED is reachable
    // only via this human-driven repository action — never from AI runtime.
    expect(rows[0].status).toBe('APPROVED');
    expect(rows[0].reviewedByUserId).toBe(USER_HUMAN);
  });

  it('preserves the human SENT/APPROVED capability (B-R8 removes nothing)', () => {
    // The point is to stop AI from using these, NOT to remove human send.
    expect(REPLY_DRAFT_STATUS_VALUES as readonly string[]).toContain('APPROVED');
    expect(REPLY_DRAFT_STATUS_VALUES as readonly string[]).toContain('SENT');
    // 'AI' remains a valid draft SOURCE label (metadata), distinct from a send.
    expect(REPLY_DRAFT_SOURCE_VALUES as readonly string[]).toContain('AI');
  });
});

// ===========================================================================
// §6 — Future route guard (no AI generation wired to a send path)
// ===========================================================================

describe('B-R8 §6 — no route combines AI generation with send/dispatch/deliver', () => {
  const API_DIR = path.resolve('src/app/api');

  function hasAiGeneration(src: string): boolean {
    if (AI_GENERATION_SYMBOL_RE.test(src)) return true;
    return importPaths(src).some((p) => /@\/domains\/ai-runtime/.test(p));
  }

  function hasSend(src: string): boolean {
    return SEND_CALL_RE.test(src) || SENT_TRANSITION_RE.test(src);
  }

  it('the API route tree exists and is non-trivially scanned', () => {
    expect(fs.existsSync(API_DIR)).toBe(true);
    const files = walkTs(API_DIR);
    // Sanity: the sweep actually found the route surface (guard is not vacuous).
    expect(files.length).toBeGreaterThan(10);
  });

  it('no production API file combines AI-runtime generation with a send path', () => {
    const offenders: string[] = [];
    for (const abs of walkTs(API_DIR)) {
      const src = fs.readFileSync(abs, 'utf8');
      if (hasAiGeneration(src) && hasSend(src)) {
        offenders.push(path.relative(process.cwd(), abs));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does NOT block the deterministic SYSTEM stub (generate handler neither generates via AI nor sends)', () => {
    const src = read(
      'src/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/generate/handler.ts',
    );
    expect(hasAiGeneration(src)).toBe(false);
    expect(hasSend(src)).toBe(false);
  });

  it('does NOT block normal human message workflow (createMessage handler does not use AI generation)', () => {
    const src = read(
      'src/app/api/businesses/[businessId]/conversations/handler.ts',
    );
    expect(hasSend(src)).toBe(true); // it invokes the conversation create-message path
    expect(hasAiGeneration(src)).toBe(false); // ...but wires no AI generation
  });

  it('does NOT block the DI composition root (it wires the assembler but has no send call-site)', () => {
    const src = read('src/app/api/_shared/composition.ts');
    expect(hasAiGeneration(src)).toBe(true); // imports the B-R3 assembler
    expect(hasSend(src)).toBe(false); // ...but contains no send/createMessage call-site
  });
});

// ===========================================================================
// §7 — No real provider / no real generation work introduced by B-R8
// ===========================================================================

describe('B-R8 §7 — introduces no real provider / route-level generation', () => {
  it('the AI-runtime directory gained no new production module (only the known files)', () => {
    const allowed = new Set([
      'README.md',
      'types.ts',
      'service.ts',
      'context-assembler.ts',
      'provider.ts',
      'fake-provider.ts',
      'prompt-builder.ts',
      'audit-log.ts',
      'index.ts',
    ]);
    const present = fs
      .readdirSync(path.resolve(AI_RUNTIME_DIR), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
    for (const name of present) {
      expect(allowed.has(name)).toBe(true);
    }
    // And no send/generate/real-provider module sneaked in.
    for (const forbidden of [
      'generate.ts',
      'send.ts',
      'sender.ts',
      'dispatch.ts',
      'deliver.ts',
      'real-provider.ts',
      'openai.ts',
      'anthropic.ts',
      'b-r8.ts',
    ]) {
      expect(fs.existsSync(path.resolve(AI_RUNTIME_DIR, forbidden))).toBe(false);
    }
  });

  it('package.json declares no real model-provider SDK', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    for (const name of names) {
      expect(name).not.toMatch(REAL_PROVIDER_SDK_RE);
    }
  });

  it('no production API file wires route-level real generation', () => {
    // The assembler may be composed in the DI root, but the generation symbols
    // (prompt builder / fake provider / audit / generateText) must appear in NO
    // route file — there is no production generate-via-AI path yet.
    for (const abs of walkTs(path.resolve('src/app/api'))) {
      const src = fs.readFileSync(abs, 'utf8');
      expect(src).not.toMatch(AI_GENERATION_SYMBOL_RE);
    }
  });

  it('the B-R8 lock itself introduces no SDK / network / env / API-key usage', () => {
    const src = read(TEST_FILE);
    for (const imp of importPaths(src)) {
      expect(imp).not.toMatch(REAL_PROVIDER_SDK_RE);
    }
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/\bnew\s+XMLHttpRequest\b/);
    expect(src).not.toMatch(/process\.env\./);
    expect(src).not.toMatch(/require\(['"](?:openai|anthropic|@google)/);
    // The lock asserts on send/deliver tokens but never CALLS such a function.
    expect(src).not.toMatch(
      /\.(sendMessage|autoSend|dispatch|deliver|sendDraft|createMessage)\s*\(/,
    );
  });

  it('the B-R8 lock imports only allowlisted modules', () => {
    const ALLOWED = new Set([
      'vitest',
      'node:fs',
      'node:path',
      '@/domains/ai-runtime',
      '@/domains/reply-drafts',
      '@/domains/authz/permissions',
      '@/domains/authz/types',
    ]);
    for (const imp of importPaths(read(TEST_FILE))) {
      expect(ALLOWED.has(imp)).toBe(true);
    }
  });
});

// ===========================================================================
// §8 — Human approval remains the only boundary before customer delivery
// ===========================================================================

describe('B-R8 §8 — human approval is the only pre-delivery boundary', () => {
  it('send & approve are real, human-gated permissions', () => {
    expect(AUTHZ_PERMISSION_VALUES as readonly string[]).toContain('ai_drafts.send');
    expect(AUTHZ_PERMISSION_VALUES as readonly string[]).toContain('ai_drafts.approve');
  });

  it('the only actors in the permission map are HUMAN membership roles', () => {
    // No autonomous / AI / system / bot actor exists that could hold approve/send.
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(
      ['ADMIN', 'OPERATOR', 'OWNER', 'VIEWER'].sort(),
    );
  });

  it('ai_drafts.send / ai_drafts.approve are granted ONLY to human roles', () => {
    const HUMAN_PRIVILEGED = ['OWNER', 'ADMIN', 'OPERATOR'];
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const granted = perms as readonly string[];
      if (granted.includes('ai_drafts.send')) {
        expect(HUMAN_PRIVILEGED).toContain(role);
      }
      if (granted.includes('ai_drafts.approve')) {
        expect(HUMAN_PRIVILEGED).toContain(role);
      }
    }
  });
});
