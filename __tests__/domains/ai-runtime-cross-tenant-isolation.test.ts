// ===========================================================================
// Tests — AI Runtime: Cross-Tenant AI-Context Isolation Suite (B-R7)
//
// This is the PRD-v1.1 §9 AI gate proof. It proves the AI runtime cannot mix
// tenant/business data across businesses, and that AI-off fails closed.
//
// DESIGN — prove isolation through the REAL composition, not mocks:
//   The whole stack is wired exactly as production would compose it — the REAL
//   context assembler (B-R3) over the REAL Knowledge service+repository (B-R2)
//   and the REAL AI Config resolver+repository (B-R1), the REAL prompt builder
//   (B-R5), the REAL deterministic fake provider (B-R4), and the REAL audit
//   repository/service (B-R6). Only the lowest layer — the Prisma delegates —
//   is replaced by an in-memory, MULTI-TENANT store that faithfully reproduces
//   Prisma's `where` semantics (filter by businessId + status + optional
//   category). Business A AND Business B rows live in the SAME store.
//
//   Because the only tenant filter is the one the real repository constructs
//   from the server-resolved businessId the real assembler threads down, a
//   regression that widened scope, trusted a client businessId, or dropped the
//   VERIFIED status pin would let Business B rows leak into Business A's
//   assembled context — and these tests would fail. That is a structural
//   isolation proof at the available domain boundary.
//
// COVERAGE (matches the B-R7 spec):
//   1. Assembler tenant isolation (A sees only A; B sees only B; no cross-leak
//      of ids / keys / values / source labels / provenance / metadata).
//   2. Verified-only behavior intact (DRAFT/ARCHIVED excluded; other tenant's
//      VERIFIED excluded).
//   3. AI-off / MANUAL fails closed — no knowledge read, no prompt, no provider
//      call, no audit row, no draft metadata.
//   4. Prompt builder isolation when fed the ACTUAL assembler output.
//   5. Audit tenant isolation (cross-tenant complete rejected; terminal-state
//      immutability) tied to the real prompt output.
//   6. No auto-send / human-review boundary preserved on structured outputs.
//   7. Static scope guards over the production AI-runtime source and this test
//      target (no provider SDK / network / env / API-key / customer reads /
//      send path).
//
// NOTE: `runReplyDraftPipeline` below is a TEST-ONLY composition that mirrors
// the intended Level-2 generate order to prove fail-closed ordering. It invents
// NO production route wiring and NO real generation service.
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  createKnowledgeService,
  createKnowledgeRepository,
  type KnowledgeRepositoryDb,
  type BusinessContextItemRecord,
  type BusinessContextItemStatusValue,
} from '@/domains/knowledge';
import {
  createAiConfigService,
  createAiConfigRepository,
  type AiConfigRepositoryDb,
  type BusinessAiModeValue,
} from '@/domains/ai-config';
import {
  createAiRuntimeService,
  createAiPromptBuilder,
  createFakeAiProvider,
  createAiGenerationAuditRepository,
  createAiGenerationAuditService,
  buildStartAiGenerationAuditInput,
  buildSuccessAiGenerationAuditInput,
  buildDraftAiMetadata,
  type AiGenerationAuditRepositoryDb,
  type AiGenerationAuditLogRecord,
  type AiProviderGenerateTextRequest,
} from '@/domains/ai-runtime';

// ---------------------------------------------------------------------------
// Constants — valid UUIDs (server-resolved tenant ids) + unique sentinels
// ---------------------------------------------------------------------------

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';
const BIZ_MANUAL = '33333333-3333-4333-8333-333333333333';
const BIZ_ABSENT = '99999999-9999-4999-8999-999999999999'; // not in the store
const VERIFIER_A = '4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERIFIER_B = '4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONV_A = '55555555-5555-4555-8555-555555555555';

const FIXED_NOW = new Date('2026-06-15T12:00:00.000Z');

// Deliberately unique sentinels embedded in each tenant's data. Cross-presence
// of ANY of these across a tenant boundary is a cross-tenant leak.
const A_VALUE = 'TENANT_A_ONLY_SECRET_CONTEXT';
const B_VALUE = 'TENANT_B_ONLY_SECRET_CONTEXT';
const A_SOURCE_LABEL = 'TENANT_A_ONLY_SOURCE_LABEL';
const B_SOURCE_LABEL = 'TENANT_B_ONLY_SOURCE_LABEL';
const A_META_SECRET = 'TENANT_A_ONLY_SOURCE_METADATA';
const B_META_SECRET = 'TENANT_B_ONLY_SOURCE_METADATA';
const A_DRAFT_VALUE = 'TENANT_A_DRAFT_UNVERIFIED_SECRET';
const A_ARCHIVED_VALUE = 'TENANT_A_ARCHIVED_SECRET';
const MANUAL_VALUE = 'TENANT_MANUAL_VERIFIED_SECRET';

// A customer-PII sentinel deliberately smuggled INTO the assembler input as
// client-shaped customer/conversation/message fields (see §1). Proving it never
// appears in the assembled context or prompt — even after it was actually
// introduced — is the strong form of "no customer/conversation/message content
// is introduced into AI context": the assembler reads only the server-resolved
// businessId and drops every other field by construction.
const CUSTOMER_PII_SENTINEL = 'CUSTOMER_PII_MUST_NEVER_APPEAR';

// Stable item ids that embed their tenant so any cross-presence is obvious.
const A_HOURS = 'tenant-a-verified-hours';
const A_PRICING = 'tenant-a-verified-pricing';
const A_DRAFT = 'tenant-a-draft-unverified';
const A_ARCHIVED = 'tenant-a-archived';
const B_HOURS = 'tenant-b-verified-hours';
const B_PRICING = 'tenant-b-verified-pricing';

/** Every Business-B marker that must never appear in Business-A artifacts. */
const B_MARKERS = [
  B_VALUE,
  B_SOURCE_LABEL,
  B_META_SECRET,
  B_HOURS,
  B_PRICING,
  VERIFIER_B,
  BIZ_B,
];

/** Every Business-A marker that must never appear in Business-B artifacts. */
const A_MARKERS = [
  A_VALUE,
  A_SOURCE_LABEL,
  A_META_SECRET,
  A_HOURS,
  A_PRICING,
  VERIFIER_A,
];

// ---------------------------------------------------------------------------
// Fixtures — raw DB records (Prisma shape: Date fields, not ISO strings)
// ---------------------------------------------------------------------------

function record(
  overrides: Partial<BusinessContextItemRecord> &
    Pick<BusinessContextItemRecord, 'id' | 'businessId'>,
): BusinessContextItemRecord {
  return {
    category: 'hours',
    key: 'monday',
    value: 'Open 9-5',
    status: 'VERIFIED',
    sourceType: 'OWNER_APPROVED',
    sourceLabel: null,
    sourceUrl: null,
    sourceMetadata: null,
    verifiedByUserId: null,
    verifiedAt: new Date('2026-06-10T09:00:00.000Z'),
    createdByUserId: null,
    createdAt: new Date('2026-06-01T09:00:00.000Z'),
    updatedAt: new Date('2026-06-10T09:00:00.000Z'),
    ...overrides,
  };
}

/** The standard two-tenant seed: A and B each have distinct verified context,
 *  plus A has a DRAFT and an ARCHIVED item that must never be assembled. */
function twoTenantSeed(): BusinessContextItemRecord[] {
  return [
    // Business A — verified
    record({
      id: A_HOURS,
      businessId: BIZ_A,
      category: 'hours',
      key: 'monday',
      value: `Open 9:00-17:00 ${A_VALUE}`,
      sourceLabel: A_SOURCE_LABEL,
      sourceMetadata: { note: A_META_SECRET },
      verifiedByUserId: VERIFIER_A,
    }),
    record({
      id: A_PRICING,
      businessId: BIZ_A,
      category: 'pricing',
      key: 'studio',
      value: `EUR 1200/mo ${A_VALUE}`,
      verifiedByUserId: VERIFIER_A,
    }),
    // Business A — NOT verified (must be excluded)
    record({
      id: A_DRAFT,
      businessId: BIZ_A,
      status: 'DRAFT',
      category: 'pricing',
      key: 'penthouse',
      value: `EUR 9000/mo ${A_DRAFT_VALUE}`,
      verifiedByUserId: null,
      verifiedAt: null,
    }),
    record({
      id: A_ARCHIVED,
      businessId: BIZ_A,
      status: 'ARCHIVED',
      category: 'hours',
      key: 'sunday',
      value: `Closed ${A_ARCHIVED_VALUE}`,
      verifiedByUserId: VERIFIER_A,
    }),
    // Business B — verified (must never appear in A's context)
    record({
      id: B_HOURS,
      businessId: BIZ_B,
      category: 'hours',
      key: 'monday',
      value: `Open 10:00-18:00 ${B_VALUE}`,
      sourceLabel: B_SOURCE_LABEL,
      sourceMetadata: { note: B_META_SECRET },
      verifiedByUserId: VERIFIER_B,
    }),
    record({
      id: B_PRICING,
      businessId: BIZ_B,
      category: 'pricing',
      key: 'studio',
      value: `EUR 2000/mo ${B_VALUE}`,
      verifiedByUserId: VERIFIER_B,
    }),
  ];
}

// ---------------------------------------------------------------------------
// In-memory MULTI-TENANT Knowledge delegate (faithful Prisma `where` semantics)
// ---------------------------------------------------------------------------

type KnowledgeFindManyArgs = {
  where: {
    businessId: string;
    status: BusinessContextItemStatusValue;
    category?: string;
  };
  orderBy: { updatedAt: 'desc' };
  take: number;
};

function createKnowledgeDb(seed: BusinessContextItemRecord[]) {
  const rows: BusinessContextItemRecord[] = seed.map((r) => ({ ...r }));

  // The ONLY tenant filter is the one the real repository constructs. It pins
  // businessId AND status (VERIFIED), and narrows by category when supplied —
  // exactly as Prisma would. Nothing here widens scope on its own.
  const findMany = vi.fn(async (args: KnowledgeFindManyArgs) => {
    const { where, take } = args;
    return rows
      .filter(
        (r) =>
          r.businessId === where.businessId &&
          r.status === where.status &&
          (where.category === undefined || r.category === where.category),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, take)
      .map((r) => ({ ...r }));
  });

  const businessContextItem = {
    findMany,
    // Unused by the assembler path under test; provided to satisfy the delegate
    // shape. They still honor the composite (id, businessId) tenant key.
    findUnique: async (args: {
      where: { id_businessId: { id: string; businessId: string } };
    }) => {
      const { id, businessId } = args.where.id_businessId;
      const found = rows.find((r) => r.id === id && r.businessId === businessId);
      return found ? { ...found } : null;
    },
    create: async () => {
      throw new Error('createKnowledgeDb.create is not exercised by B-R7');
    },
    update: async () => {
      throw new Error('createKnowledgeDb.update is not exercised by B-R7');
    },
  } satisfies KnowledgeRepositoryDb['businessContextItem'];

  return { db: { businessContextItem } as KnowledgeRepositoryDb, rows, findMany };
}

// ---------------------------------------------------------------------------
// In-memory MULTI-TENANT Business (aiMode) delegate
// ---------------------------------------------------------------------------

function createBusinessDb(modes: Record<string, BusinessAiModeValue>) {
  const findUnique = vi.fn(
    async (args: { where: { id: string }; select: { aiMode: true } }) => {
      const mode = modes[args.where.id];
      return mode === undefined ? null : { aiMode: mode };
    },
  );
  return { db: { business: { findUnique } } as AiConfigRepositoryDb, findUnique };
}

// ---------------------------------------------------------------------------
// In-memory AI generation audit delegate (mirrors the B-R6 fake)
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

// ---------------------------------------------------------------------------
// The full real stack (only the Prisma delegates are in-memory)
// ---------------------------------------------------------------------------

function createStack(opts: {
  modes: Record<string, BusinessAiModeValue>;
  items: BusinessContextItemRecord[];
}) {
  const business = createBusinessDb(opts.modes);
  const knowledgeDb = createKnowledgeDb(opts.items);

  const aiConfig = createAiConfigService({
    repository: createAiConfigRepository(business.db),
  });
  const knowledge = createKnowledgeService({
    repository: createKnowledgeRepository(knowledgeDb.db),
  });
  const assembler = createAiRuntimeService({
    aiConfig,
    knowledge,
    now: () => FIXED_NOW,
  });
  const promptBuilder = createAiPromptBuilder();

  // Real deterministic fake provider, wrapped in a spy so we can prove the
  // AI-off path NEVER reaches it.
  const baseProvider = createFakeAiProvider({ now: () => FIXED_NOW });
  const provider = {
    ...baseProvider,
    generateText: vi.fn(baseProvider.generateText),
  };

  const auditDb = createAuditFakeDb();
  const auditRepo = createAiGenerationAuditRepository(auditDb);
  const auditService = createAiGenerationAuditService({ repository: auditRepo });

  return {
    assembler,
    promptBuilder,
    provider,
    knowledge,
    aiConfig,
    auditRepo,
    auditService,
    auditDb,
    knowledgeDb,
    business,
  };
}

type Stack = ReturnType<typeof createStack>;

function defaultStack(): Stack {
  return createStack({
    modes: { [BIZ_A]: 'AI_ASSISTED', [BIZ_B]: 'AI_ASSISTED' },
    items: twoTenantSeed(),
  });
}

/** Assembles for a tenant and unwraps, failing the test on a fail-closed error. */
async function assembleOk(stack: Stack, businessId: string) {
  const res = await stack.assembler.assembleAiContext({ businessId });
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}`);
  return res.data;
}

// ---------------------------------------------------------------------------
// TEST-ONLY pipeline — mirrors the intended Level-2 generate ORDER to prove
// fail-closed ordering. It introduces NO production generation/route wiring.
// ---------------------------------------------------------------------------

async function runReplyDraftPipeline(
  stack: Stack,
  ctx: { businessId: string },
  opts: { conversationId?: string | null } = {},
) {
  // 1. Assemble — the fail-closed gate. A disabled business stops HERE, before
  //    any prompt is built, any provider is called, or any audit row is opened.
  const assembled = await stack.assembler.assembleAiContext(ctx);
  if (!assembled.ok) {
    return { ok: false as const, stage: 'assemble' as const, error: assembled.error };
  }

  // 2. Build prompt from the ACTUAL assembled context.
  const built = stack.promptBuilder.buildReplyDraftPrompt({
    context: assembled.data,
  });
  if (!built.ok) {
    return { ok: false as const, stage: 'prompt' as const, error: built.error };
  }

  // 3. Open the audit attempt (tenant derived from the built provider request).
  const started = await stack.auditService.start(
    buildStartAiGenerationAuditInput({
      promptResult: built.data,
      providerId: stack.provider.providerId,
      modelId: stack.provider.modelId,
      conversationId: opts.conversationId ?? null,
    }),
  );
  if (!started.ok) {
    return { ok: false as const, stage: 'audit-start' as const, error: started.error };
  }

  // 4. Generate via the fake provider (still no send).
  const gen = await stack.provider.generateText(built.data.providerRequest);
  if (!gen.ok) {
    await stack.auditService.completeFailure({
      auditLogId: started.data.id,
      businessId: assembled.data.businessId,
      errorCode: gen.error.code,
    });
    return { ok: false as const, stage: 'provider' as const, error: gen.error };
  }

  // 5. Complete the audit + derive review-only draft metadata.
  const done = await stack.auditService.completeSuccess(
    buildSuccessAiGenerationAuditInput({
      auditLogId: started.data.id,
      businessId: assembled.data.businessId,
      result: gen.data,
    }),
  );
  const meta = buildDraftAiMetadata({
    promptResult: built.data,
    result: gen.data,
    auditLogId: started.data.id,
  });

  return {
    ok: true as const,
    stage: 'complete' as const,
    assembled: assembled.data,
    built: built.data,
    gen: gen.data,
    audit: done.ok ? done.data : null,
    meta,
  };
}

// ===========================================================================
// 1. Assembler tenant isolation
// ===========================================================================

describe('B-R7 §1 — assembler tenant isolation', () => {
  it('assembling for Business A includes ONLY A verified items', async () => {
    const stack = defaultStack();
    const a = await assembleOk(stack, BIZ_A);

    expect(a.businessId).toBe(BIZ_A);
    expect(a.businessContextItems.map((i) => i.id).sort()).toEqual(
      [A_HOURS, A_PRICING].sort(),
    );
    for (const item of a.businessContextItems) {
      expect(item.value).toContain(A_VALUE);
      expect(item.value).not.toContain(B_VALUE);
    }
  });

  it('assembling for Business B includes ONLY B verified items', async () => {
    const stack = defaultStack();
    const b = await assembleOk(stack, BIZ_B);

    expect(b.businessId).toBe(BIZ_B);
    expect(b.businessContextItems.map((i) => i.id).sort()).toEqual(
      [B_HOURS, B_PRICING].sort(),
    );
    for (const item of b.businessContextItems) {
      expect(item.value).toContain(B_VALUE);
      expect(item.value).not.toContain(A_VALUE);
    }
  });

  it('A context never contains ANY Business-B id / key / value / label / provenance', async () => {
    const stack = defaultStack();
    const a = await assembleOk(stack, BIZ_A);
    const serialized = JSON.stringify(a);
    for (const marker of B_MARKERS) {
      expect(serialized).not.toContain(marker);
    }
  });

  it('B context never contains ANY Business-A id / key / value / label / provenance', async () => {
    const stack = defaultStack();
    const b = await assembleOk(stack, BIZ_B);
    const serialized = JSON.stringify(b);
    for (const marker of A_MARKERS) {
      expect(serialized).not.toContain(marker);
    }
  });

  it('threads the SERVER-resolved businessId into the knowledge query (A only)', async () => {
    const stack = defaultStack();
    await assembleOk(stack, BIZ_A);

    expect(stack.knowledgeDb.findMany).toHaveBeenCalledTimes(1);
    const where = stack.knowledgeDb.findMany.mock.calls[0][0].where;
    expect(where.businessId).toBe(BIZ_A);
    expect(where.status).toBe('VERIFIED');
    // The other tenant is NEVER queried while assembling A.
    expect(where.businessId).not.toBe(BIZ_B);
  });

  it('ignores extra client-shaped businessId fields on the context (no widening)', async () => {
    const stack = defaultStack();
    // A smuggled second businessId must be ignored — only context.businessId is
    // ever read, so A's assembly can never be redirected to B.
    const res = await stack.assembler.assembleAiContext({
      businessId: BIZ_A,
      ...({ businessId2: BIZ_B, clientBusinessId: BIZ_B } as object),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.businessId).toBe(BIZ_A);
    expect(JSON.stringify(res.data)).not.toContain(B_VALUE);
    const where = stack.knowledgeDb.findMany.mock.calls[0][0].where;
    expect(where.businessId).toBe(BIZ_A);
  });

  it('ignores client-shaped customer/conversation/message fields on assembler input', async () => {
    const stack = defaultStack();

    // Actually INTRODUCE customer/conversation/message-shaped PII on the input
    // the way a malicious/confused caller might. The assembler must read only
    // the server-resolved businessId and drop everything else by construction.
    const res = await stack.assembler.assembleAiContext({
      businessId: BIZ_A,
      ...({
        customerName: CUSTOMER_PII_SENTINEL,
        customerEmail: CUSTOMER_PII_SENTINEL,
        customerPhone: CUSTOMER_PII_SENTINEL,
        conversationId: CUSTOMER_PII_SENTINEL,
        conversationTranscript: CUSTOMER_PII_SENTINEL,
        messageId: CUSTOMER_PII_SENTINEL,
        messageBody: CUSTOMER_PII_SENTINEL,
        latestCustomerMessage: CUSTOMER_PII_SENTINEL,
      } as object),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const built = stack.promptBuilder.buildReplyDraftPrompt({
      context: res.data,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // The smuggled PII never reaches the assembled context or the prompt...
    expect(JSON.stringify(res.data)).not.toContain(CUSTOMER_PII_SENTINEL);
    expect(built.data.providerRequest.prompt).not.toContain(
      CUSTOMER_PII_SENTINEL,
    );
    // ...and the knowledge query is still keyed solely on the server businessId.
    const where = stack.knowledgeDb.findMany.mock.calls[0][0].where;
    expect(where.businessId).toBe(BIZ_A);
    expect(where.status).toBe('VERIFIED');
  });

  it('a category filter narrows within the tenant and never crosses it', async () => {
    const stack = defaultStack();
    const res = await stack.assembler.assembleAiContext(
      { businessId: BIZ_A },
      { category: 'pricing' },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Only A's pricing item — B's pricing item (same category/key) never appears.
    expect(res.data.businessContextItems.map((i) => i.id)).toEqual([A_PRICING]);
    expect(JSON.stringify(res.data)).not.toContain(B_VALUE);
  });
});

// ===========================================================================
// 2. Verified-only behavior remains intact
// ===========================================================================

describe('B-R7 §2 — verified-only behavior remains intact', () => {
  it('excludes DRAFT (unverified) Business-A items', async () => {
    const stack = defaultStack();
    const a = await assembleOk(stack, BIZ_A);
    expect(a.businessContextItems.map((i) => i.id)).not.toContain(A_DRAFT);
    expect(JSON.stringify(a)).not.toContain(A_DRAFT_VALUE);
  });

  it('excludes ARCHIVED Business-A items', async () => {
    const stack = defaultStack();
    const a = await assembleOk(stack, BIZ_A);
    expect(a.businessContextItems.map((i) => i.id)).not.toContain(A_ARCHIVED);
    expect(JSON.stringify(a)).not.toContain(A_ARCHIVED_VALUE);
  });

  it('includes VERIFIED Business-A items', async () => {
    const stack = defaultStack();
    const a = await assembleOk(stack, BIZ_A);
    expect(a.businessContextItems.map((i) => i.id).sort()).toEqual(
      [A_HOURS, A_PRICING].sort(),
    );
  });

  it('does NOT include Business-B VERIFIED items when assembling A', async () => {
    const stack = defaultStack();
    const a = await assembleOk(stack, BIZ_A);
    const ids = a.businessContextItems.map((i) => i.id);
    expect(ids).not.toContain(B_HOURS);
    expect(ids).not.toContain(B_PRICING);
  });

  it('the knowledge query always pins status:VERIFIED (never DRAFT/ARCHIVED)', async () => {
    const stack = defaultStack();
    await assembleOk(stack, BIZ_A);
    for (const call of stack.knowledgeDb.findMany.mock.calls) {
      expect(call[0].where.status).toBe('VERIFIED');
    }
  });
});

// ===========================================================================
// 3. AI mode fail-closed (no provider / audit / draft when AI is off)
// ===========================================================================

describe('B-R7 §3 — AI-off / MANUAL fails closed', () => {
  function manualStack(): Stack {
    // MANUAL business that DOES have a verified item — proving it is the gate,
    // not an empty store, that stops generation.
    return createStack({
      modes: { [BIZ_MANUAL]: 'MANUAL' },
      items: [
        record({
          id: 'tenant-manual-verified',
          businessId: BIZ_MANUAL,
          value: `Open 9-5 ${MANUAL_VALUE}`,
          verifiedByUserId: VERIFIER_A,
        }),
      ],
    });
  }

  it('the resolver reports MANUAL as generation-disabled', async () => {
    const stack = manualStack();
    const policy = await stack.aiConfig.resolveAiPolicy({ businessId: BIZ_MANUAL });
    expect(policy.ok).toBe(true);
    if (policy.ok) {
      expect(policy.data.aiMode).toBe('MANUAL');
      expect(policy.data.aiGenerationEnabled).toBe(false);
    }
  });

  it('the assembler returns AI_CONTEXT_DISABLED and never reads knowledge', async () => {
    const stack = manualStack();
    const res = await stack.assembler.assembleAiContext({ businessId: BIZ_MANUAL });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_DISABLED');
    // Fail-closed: no verified-context read happens for a disabled business.
    expect(stack.knowledgeDb.findMany).not.toHaveBeenCalled();
  });

  it('an absent business (no aiMode row) also fails closed', async () => {
    const stack = manualStack();
    const res = await stack.assembler.assembleAiContext({ businessId: BIZ_ABSENT });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_DISABLED');
    expect(stack.knowledgeDb.findMany).not.toHaveBeenCalled();
  });

  it('the generate pipeline bails at the assembler — no prompt, provider, audit, or draft', async () => {
    const stack = manualStack();
    const result = await runReplyDraftPipeline(stack, { businessId: BIZ_MANUAL });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('pipeline must fail closed');
    expect(result.stage).toBe('assemble');
    expect(result.error.code).toBe('AI_CONTEXT_DISABLED');

    // No provider request was ever built or sent to the fake provider.
    expect(stack.provider.generateText).not.toHaveBeenCalled();
    // No audit row was opened.
    expect(stack.auditDb.rows).toHaveLength(0);
    // No verified-context read occurred.
    expect(stack.knowledgeDb.findMany).not.toHaveBeenCalled();
    // The MANUAL business's verified value never left the store.
    expect(JSON.stringify(result)).not.toContain(MANUAL_VALUE);
  });

  it('enabling (AI_ASSISTED) is what flips the gate open — same store, different mode', async () => {
    // Same verified item, but AI_ASSISTED: now the pipeline runs end to end.
    const stack = createStack({
      modes: { [BIZ_A]: 'AI_ASSISTED' },
      items: [
        record({
          id: A_HOURS,
          businessId: BIZ_A,
          value: `Open 9-5 ${A_VALUE}`,
          verifiedByUserId: VERIFIER_A,
        }),
      ],
    });
    const result = await runReplyDraftPipeline(stack, { businessId: BIZ_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stack.provider.generateText).toHaveBeenCalledTimes(1);
    expect(stack.auditDb.rows).toHaveLength(1);
  });
});

// ===========================================================================
// 4. Prompt builder isolation when fed the ACTUAL assembler output
// ===========================================================================

describe('B-R7 §4 — prompt builder isolation (fed real assembler output)', () => {
  function buildForA() {
    const stack = defaultStack();
    return assembleOk(stack, BIZ_A).then((a) => {
      const built = stack.promptBuilder.buildReplyDraftPrompt({ context: a });
      expect(built.ok).toBe(true);
      if (!built.ok) throw new Error('expected ok prompt');
      return { stack, assembled: a, built: built.data };
    });
  }

  it('the prompt contains Business-A verified context', async () => {
    const { built } = await buildForA();
    expect(built.providerRequest.prompt).toContain(A_VALUE);
  });

  it('the prompt contains NO Business-B context', async () => {
    const { built } = await buildForA();
    for (const marker of B_MARKERS) {
      expect(built.providerRequest.prompt).not.toContain(marker);
    }
  });

  it('the provider-request businessId equals Business A', async () => {
    const { built } = await buildForA();
    expect(built.providerRequest.businessId).toBe(BIZ_A);
  });

  it('included context item ids correspond ONLY to Business-A usable (verified) items', async () => {
    const { built } = await buildForA();
    expect([...built.includedContextItemIds].sort()).toEqual(
      [A_HOURS, A_PRICING].sort(),
    );
    // Never A's unverified items, never any B item.
    for (const forbidden of [A_DRAFT, A_ARCHIVED, B_HOURS, B_PRICING]) {
      expect(built.includedContextItemIds).not.toContain(forbidden);
    }
  });

  it('the context hash CHANGES when Business-A verified context changes', async () => {
    const stack = defaultStack();
    const a1 = await assembleOk(stack, BIZ_A);
    const built1 = stack.promptBuilder.buildReplyDraftPrompt({ context: a1 });
    expect(built1.ok).toBe(true);
    if (!built1.ok) return;

    // A new VERIFIED Business-A item enters the store -> A's context changed.
    stack.knowledgeDb.rows.push(
      record({
        id: 'tenant-a-verified-new',
        businessId: BIZ_A,
        category: 'policies',
        key: 'refunds',
        value: `14-day refunds ${A_VALUE}`,
        verifiedByUserId: VERIFIER_A,
        updatedAt: new Date('2026-06-11T09:00:00.000Z'),
      }),
    );
    const a2 = await assembleOk(stack, BIZ_A);
    const built2 = stack.promptBuilder.buildReplyDraftPrompt({ context: a2 });
    expect(built2.ok).toBe(true);
    if (!built2.ok) return;

    expect(built2.data.contextHash).not.toBe(built1.data.contextHash);
  });

  it("the context hash is UNAFFECTED by another tenant's context changing", async () => {
    const stack = defaultStack();
    const a1 = await assembleOk(stack, BIZ_A);
    const hashA1 = stack.promptBuilder.buildReplyDraftPrompt({ context: a1 });
    expect(hashA1.ok).toBe(true);
    if (!hashA1.ok) return;

    // Business B's verified context changes — A's fingerprint must not move.
    stack.knowledgeDb.rows.push(
      record({
        id: 'tenant-b-verified-new',
        businessId: BIZ_B,
        category: 'policies',
        key: 'refunds',
        value: `30-day refunds ${B_VALUE}`,
        verifiedByUserId: VERIFIER_B,
        updatedAt: new Date('2026-06-11T09:00:00.000Z'),
      }),
    );
    const a2 = await assembleOk(stack, BIZ_A);
    const hashA2 = stack.promptBuilder.buildReplyDraftPrompt({ context: a2 });
    expect(hashA2.ok).toBe(true);
    if (!hashA2.ok) return;

    expect(hashA2.data.contextHash).toBe(hashA1.data.contextHash);
  });

  it('no customer/conversation/message content appears in the assembled context or prompt', async () => {
    const { assembled, built } = await buildForA();
    // The structured context exposes ONLY the safe projection — no customer,
    // conversation, message, status, or per-item businessId fields.
    const itemKeys = new Set(
      assembled.businessContextItems.flatMap((i) => Object.keys(i)),
    );
    for (const forbidden of [
      'businessId',
      'status',
      'createdByUserId',
      'customerName',
      'customerEmail',
      'customerPhone',
      'conversationId',
      'messageId',
      'messageBody',
    ]) {
      expect(itemKeys.has(forbidden)).toBe(false);
    }
    // The never-seeded customer-PII sentinel appears nowhere.
    expect(JSON.stringify(assembled)).not.toContain(CUSTOMER_PII_SENTINEL);
    expect(built.providerRequest.prompt).not.toContain(CUSTOMER_PII_SENTINEL);
    // No verifier identity leaks into the customer-facing prompt text.
    expect(built.providerRequest.prompt).not.toContain(VERIFIER_A);
    expect(built.providerRequest.prompt).not.toContain(A_META_SECRET);
  });
});

// ===========================================================================
// 5. Audit tenant isolation (tied to the real assembler/prompt output)
// ===========================================================================

describe('B-R7 §5 — audit tenant isolation', () => {
  async function startAuditForA(stack: Stack) {
    const a = await assembleOk(stack, BIZ_A);
    const built = stack.promptBuilder.buildReplyDraftPrompt({ context: a });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error('expected ok prompt');
    // businessId is DERIVED from the built provider request (A) — a caller
    // cannot record a tenant that differs from what was actually prompted.
    const started = await stack.auditRepo.start(
      buildStartAiGenerationAuditInput({
        promptResult: built.data,
        conversationId: CONV_A,
      }),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error('start failed');
    return { built: built.data, started: started.data };
  }

  it('the audit row is scoped to Business A (derived from the prompt tenant)', async () => {
    const stack = defaultStack();
    const { built, started } = await startAuditForA(stack);
    expect(started.businessId).toBe(BIZ_A);
    expect(started.contextHash).toBe(built.contextHash);
    expect([...(started.includedContextItemIds ?? [])].sort()).toEqual(
      [A_HOURS, A_PRICING].sort(),
    );
    // No Business-B marker is anywhere in the persisted audit metadata.
    const dump = JSON.stringify(stack.auditDb.rows);
    for (const marker of B_MARKERS) {
      expect(dump).not.toContain(marker);
    }
  });

  it('completing an A audit with Business B is rejected (AI_AUDIT_NOT_FOUND)', async () => {
    const stack = defaultStack();
    const { started } = await startAuditForA(stack);

    const cross = await stack.auditRepo.completeSuccess({
      auditLogId: started.id,
      businessId: BIZ_B, // wrong tenant
    });
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.error.code).toBe('AI_AUDIT_NOT_FOUND');

    // The Business-A row is untouched (still STARTED, no provider metadata).
    expect(stack.auditDb.rows[0].status).toBe('STARTED');
    expect(stack.auditDb.rows[0].providerId).toBeNull();
    expect(stack.auditDb.rows[0].completedAt).toBeNull();
  });

  it('a cross-tenant failure-completion is also rejected and mutates nothing', async () => {
    const stack = defaultStack();
    const { started } = await startAuditForA(stack);

    const cross = await stack.auditRepo.completeFailure({
      auditLogId: started.id,
      businessId: BIZ_B,
      errorCode: 'SHOULD_NOT_APPLY',
      errorMessage: 'should never be written',
    });
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.error.code).toBe('AI_AUDIT_NOT_FOUND');
    expect(stack.auditDb.rows[0].status).toBe('STARTED');
    expect(stack.auditDb.rows[0].errorCode).toBeNull();
  });

  it('terminal-state immutability still holds for the A audit', async () => {
    const stack = defaultStack();
    const { started } = await startAuditForA(stack);

    const first = await stack.auditRepo.completeSuccess({
      auditLogId: started.id,
      businessId: BIZ_A,
    });
    expect(first.ok).toBe(true);

    // A second completion of any kind is rejected — the terminal row is frozen.
    const second = await stack.auditRepo.completeFailure({
      auditLogId: started.id,
      businessId: BIZ_A,
      errorCode: 'AI_PROVIDER_INVALID_REQUEST',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('AI_AUDIT_INVALID_TRANSITION');
    expect(stack.auditDb.rows[0].status).toBe('SUCCEEDED');
  });

  it('a full A pipeline persists exactly one A-scoped audit row, B-free', async () => {
    const stack = defaultStack();
    const result = await runReplyDraftPipeline(
      stack,
      { businessId: BIZ_A },
      { conversationId: CONV_A },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(stack.auditDb.rows).toHaveLength(1);
    expect(stack.auditDb.rows[0].businessId).toBe(BIZ_A);
    expect(result.audit?.businessId).toBe(BIZ_A);
    expect(result.audit?.status).toBe('SUCCEEDED');
    expect(result.audit?.conversationId).toBe(CONV_A);
    // The provider was called once, with A's tenant on the request.
    const reqs = stack.provider.generateText.mock.calls.map(
      (c) => c[0] as AiProviderGenerateTextRequest,
    );
    expect(reqs).toHaveLength(1);
    expect(reqs[0].businessId).toBe(BIZ_A);
    // Nothing B-shaped anywhere in the persisted audit metadata.
    const dump = JSON.stringify(stack.auditDb.rows);
    for (const marker of B_MARKERS) {
      expect(dump).not.toContain(marker);
    }
  });
});

// ===========================================================================
// 6. No auto-send / human-review boundary (structured outputs only)
// ===========================================================================

describe('B-R7 §6 — no auto-send / human-review boundary', () => {
  it('a completed pipeline produces review-only draft metadata (no send/status fields)', async () => {
    const stack = defaultStack();
    const result = await runReplyDraftPipeline(stack, { businessId: BIZ_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const meta = result.meta;
    expect(meta.source).toBe('AI');
    // Review-only: no send/dispatch/status/SENT fields are introduced.
    for (const forbidden of [
      'status',
      'sentAt',
      'sentMessageId',
      'messageId',
      'sent',
      'autoSend',
      'dispatchedAt',
      'deliveredAt',
    ]) {
      expect(meta).not.toHaveProperty(forbidden);
    }
    // No draft text / prompt rides along on the metadata patch.
    expect(meta).not.toHaveProperty('draftText');
    expect(meta).not.toHaveProperty('prompt');
  });

  it('no structured artifact carries a SENT status or message reference', async () => {
    const stack = defaultStack();
    const result = await runReplyDraftPipeline(stack, { businessId: BIZ_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The audit row models attempt lifecycle (STARTED/SUCCEEDED/FAILED) only —
    // never a message/send transition.
    expect(result.audit?.status).toBe('SUCCEEDED');
    const auditDump = JSON.stringify(stack.auditDb.rows);
    expect(auditDump).not.toContain('SENT');
    expect(auditDump).not.toContain('sentMessageId');
  });

  it('the in-memory stores expose no message/send delegate (no path to a Message)', () => {
    const stack = defaultStack();
    // The knowledge + audit delegates are the ONLY persistence reachable from
    // the runtime; neither exposes a customer/conversation/message/send surface.
    expect(Object.keys(stack.knowledgeDb.db)).toEqual(['businessContextItem']);
    expect(Object.keys(stack.auditDb)).toEqual(['rows', 'aiGenerationAuditLog']);
  });
});

// ===========================================================================
// 7. Static scope guards (production AI-runtime source + this test target)
// ===========================================================================

describe('B-R7 §7 — static scope guards', () => {
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

  const TEST_FILE =
    '__tests__/domains/ai-runtime-cross-tenant-isolation.test.ts';

  function read(rel: string): string {
    return fs.readFileSync(path.resolve(rel), 'utf8');
  }

  function importPaths(src: string): string[] {
    return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  }

  // --- Production AI-runtime domain: holistic re-affirmation ----------------

  it.each(PROD_FILES)('%s imports no real provider / LLM SDK', (rel) => {
    expect(read(rel)).not.toMatch(
      /openai|anthropic|@anthropic-ai|@google|googleapis|gemini|vertex|cohere|mistral|llama|bedrock/i,
    );
  });

  it.each(PROD_FILES)('%s makes no network request', (rel) => {
    expect(read(rel)).not.toMatch(
      /\bfetch\b|XMLHttpRequest|node:http\b|node:https\b|http\.request|https\.request|axios|undici/i,
    );
  });

  it.each(PROD_FILES)('%s reads no env / API-key path', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/api[_-]?key/i);
  });

  it.each(PROD_FILES)(
    '%s has no customer/conversation/message/reply-draft read path',
    (rel) => {
      const src = read(rel);
      expect(src).not.toMatch(
        /\b(db|prisma)\.(customer|conversation|message|replyDraft)\b/,
      );
      for (const imp of importPaths(src)) {
        expect(imp).not.toMatch(/domains\/(crm|conversations|reply-drafts)/);
      }
      expect(src).not.toMatch(
        /customerMessage|conversationMessages|customerEmail|customerPhone/,
      );
    },
  );

  it.each(PROD_FILES)('%s has no auto-send / dispatch / deliver call', (rel) => {
    expect(read(rel)).not.toMatch(
      /\b(sendMessage|autoSend|dispatch|deliver|sendDraft)\s*\(/,
    );
  });

  // --- This B-R7 test target: introduces no forbidden surface --------------

  it('B-R7 adds no production source file (test-only workstream)', () => {
    // The test lives under __tests__; assert there is no co-located production
    // module masquerading as B-R7 runtime wiring.
    expect(fs.existsSync(path.resolve('src/domains/ai-runtime/b-r7.ts'))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.resolve('src/domains/ai-runtime/generate.ts')),
    ).toBe(false);
  });

  it('the B-R7 test imports only allowlisted modules (no SDK / network / send / PII domain)', () => {
    const ALLOWED = new Set([
      'vitest',
      'node:fs',
      'node:path',
      '@/domains/ai-runtime',
      '@/domains/knowledge',
      '@/domains/ai-config',
    ]);
    for (const imp of importPaths(read(TEST_FILE))) {
      expect(ALLOWED.has(imp)).toBe(true);
    }
  });

  it('the B-R7 test imports no real provider SDK and no send/customer domain', () => {
    for (const imp of importPaths(read(TEST_FILE))) {
      expect(imp).not.toMatch(
        /openai|anthropic|@anthropic-ai|@google|gemini|cohere|mistral|llama|bedrock/i,
      );
      expect(imp).not.toMatch(/domains\/(crm|conversations|reply-drafts)/);
    }
  });

  it('the B-R7 test invokes no provider SDK, network, env, or send call-site', () => {
    const src = read(TEST_FILE);
    // No real network / env / SDK usage in the test itself. (Patterns are
    // chosen to match real USAGE forms, not the assertion strings above.)
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/\bnew\s+XMLHttpRequest\b/);
    expect(src).not.toMatch(/process\.env\./);
    expect(src).not.toMatch(/require\(['"](?:openai|anthropic|@google-ai)/);
    // No actual send/dispatch/deliver CALL-SITES (the only occurrences are in
    // the forbidden-property assertions above, never as `name(...)` calls).
    expect(src).not.toMatch(
      /\.(sendMessage|autoSend|dispatch|deliver|sendDraft)\s*\(/,
    );
  });
});
