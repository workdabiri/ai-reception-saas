// ===========================================================================
// Integration Tests — AI Runtime Cross-Tenant Isolation (B-R7 real DB)
//
// Real-DB parity for the in-memory B-R7 cross-tenant AI-context isolation suite
// (__tests__/domains/ai-runtime-cross-tenant-isolation.test.ts). Where B-R7
// proves isolation over an in-memory multi-tenant store, THIS suite proves the
// same invariants against a real local PostgreSQL database, exercising the
// PRODUCTION composition (`createApiDependencies`) — the same context assembler
// (B-R3) over the same Knowledge service+repository (B-R2) and AI Config
// resolver (B-R1) the API wires — plus the real AI generation audit repository
// (B-R6). It is the AI-runtime analogue of the Area A tenant-isolation CI gate.
//
// Runs against a real local PostgreSQL database. Gated by
// RUN_INTEGRATION_TESTS=true and requires a LOCAL DATABASE_URL. Normal
// `pnpm test` skips these tests cleanly.
//
// SCOPE GUARDS (enforced by construction):
//  - Seeds ONLY identity / tenancy / knowledge / ai-generation-audit rows.
//  - Reads/seeds NO customer / conversation / message / reply-draft content —
//    this file never touches those tables or their services.
//  - Calls NO AI provider and builds NO prompt: only the structured assembler
//    output is exercised. It introduces NO send path.
//  - The audit block is business-scoped and METADATA-ONLY (item ids + counts) —
//    it persists no raw prompt, no generated text, and no customer content.
// ===========================================================================

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
} from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';

import { createApiDependencies } from '../../src/app/api/_shared/composition';
import type { PrismaCompatibleClient } from '../../src/app/api/_shared/composition.types';
import {
  createAiGenerationAuditRepository,
  type AiGenerationAuditRepositoryDb,
} from '../../src/domains/ai-runtime/audit-log';

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

const describeIntegration = integrationEnabled ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Local-only safety guard (mirrors the Area A integration suite)
// ---------------------------------------------------------------------------

function assertLocalDatabase(url: string): void {
  const lower = url.toLowerCase();
  if (!lower.includes('localhost') && !lower.includes('127.0.0.1')) {
    throw new Error(
      'Integration tests require a local DATABASE_URL (localhost or 127.0.0.1). ' +
        'Refusing to run destructive cleanup against a remote database.',
    );
  }
}

// ---------------------------------------------------------------------------
// Cleanup helper — deletes in dependency-safe order
//
// This suite seeds ONLY users, businesses, memberships, business-context items,
// and AI-generation audit logs. They form a closed FK graph (audit-log and
// context-item -> business; membership -> business + user; business -> user),
// so deleting child rows before businesses before users fully cleans the
// suite's footprint without ever touching the customer/conversation/message
// tables — consistent with the "no PII surface" invariant for AI-runtime work.
// ---------------------------------------------------------------------------

async function cleanDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.aiGenerationAuditLog.deleteMany();
  await prisma.businessContextItem.deleteMany();
  await prisma.businessMembership.deleteMany();
  await prisma.business.deleteMany();
  await prisma.user.deleteMany();
}

// ---------------------------------------------------------------------------
// Seeded world — all ids + unique sentinels + cross-tenant marker sets
// ---------------------------------------------------------------------------

interface SeededWorld {
  aBusinessId: string;
  bBusinessId: string;
  manualBusinessId: string;
  aUserId: string;
  bUserId: string;
  // VERIFIED items (assembled) + the excluded DRAFT/ARCHIVED items.
  aHoursId: string;
  aPricingId: string;
  aDraftId: string;
  aArchivedId: string;
  bHoursId: string;
  bPricingId: string;
  manualItemId: string;
  // Content sentinels embedded in seeded values (never expected to cross tenants).
  aValue: string;
  bValue: string;
  aDraftValue: string;
  aArchivedValue: string;
  manualValue: string;
  // Everything that belongs to A and must never appear in B's artifacts...
  aMarkers: readonly string[];
  // ...and vice versa.
  bMarkers: readonly string[];
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describeIntegration('AI Runtime cross-tenant isolation (B-R7 real DB)', () => {
  let prisma: PrismaClient;
  let deps: ReturnType<typeof createApiDependencies>;
  let auditRepo: ReturnType<typeof createAiGenerationAuditRepository>;
  let seed: SeededWorld;

  beforeAll(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL is required when RUN_INTEGRATION_TESTS=true. ' +
          'Set DATABASE_URL to a local PostgreSQL connection string.',
      );
    }
    assertLocalDatabase(databaseUrl);
    const adapter = new PrismaPg(databaseUrl);
    prisma = new PrismaClient({ adapter });
    deps = createApiDependencies({
      prisma: prisma as unknown as PrismaCompatibleClient,
    });
    // The AI generation audit repository (B-R6) is not exposed by the API
    // composition root, so it is wired here directly over the same Prisma
    // delegate — the existing repository factory, no test-only production code.
    auditRepo = createAiGenerationAuditRepository(
      prisma as unknown as AiGenerationAuditRepositoryDb,
    );
  });

  afterAll(async () => {
    if (prisma) {
      await cleanDatabase(prisma);
      await prisma.$disconnect();
    }
  });

  afterEach(async () => {
    await cleanDatabase(prisma);
  });

  beforeEach(async () => {
    seed = await seedWorld();
  });

  // -------------------------------------------------------------------------
  // Seeding — two AI-enabled tenants (A, B) + one MANUAL tenant, each with
  // distinct VERIFIED context; A also owns a DRAFT and an ARCHIVED item that
  // must never be assembled. All sentinels carry a per-run suffix.
  // -------------------------------------------------------------------------

  async function seedWorld(): Promise<SeededWorld> {
    const { identity, tenancy, knowledge } = deps.repositories;
    const suffix = randomUUID();

    const aValue = `TENANT_A_ONLY_VALUE_${suffix}`;
    const bValue = `TENANT_B_ONLY_VALUE_${suffix}`;
    const aKey = `tenant_a_key_${suffix}`;
    const bKey = `tenant_b_key_${suffix}`;
    const aLabel = `TENANT_A_ONLY_LABEL_${suffix}`;
    const bLabel = `TENANT_B_ONLY_LABEL_${suffix}`;
    const aMeta = `TENANT_A_ONLY_META_${suffix}`;
    const bMeta = `TENANT_B_ONLY_META_${suffix}`;
    const aDraftValue = `TENANT_A_DRAFT_SECRET_${suffix}`;
    const aArchivedValue = `TENANT_A_ARCHIVED_SECRET_${suffix}`;
    const manualValue = `TENANT_MANUAL_SECRET_${suffix}`;

    // -- tenant setup ------------------------------------------------------

    async function seedTenant(
      label: string,
      mode: 'AI_ASSISTED' | 'MANUAL',
    ): Promise<{ userId: string; businessId: string }> {
      const userRes = await identity.createUser({
        email: `ai-iso-${label}-${suffix}@example.com`,
        name: `AI Iso ${label}`,
        locale: 'en',
      });
      if (!userRes.ok) throw new Error(`seed ${label} user: ${userRes.error.code}`);
      const bizRes = await tenancy.createBusiness({
        name: `AI Iso Business ${label}`,
        slug: `ai-iso-${label}-${suffix}`.slice(0, 64),
        createdByUserId: userRes.data.id,
      });
      if (!bizRes.ok) throw new Error(`seed ${label} business: ${bizRes.error.code}`);
      const memRes = await tenancy.createMembership({
        businessId: bizRes.data.id,
        userId: userRes.data.id,
        role: 'OWNER',
        status: 'ACTIVE',
      });
      if (!memRes.ok) throw new Error(`seed ${label} membership: ${memRes.error.code}`);
      // Flip the AI mode for AI-enabled tenants. The ai-config domain only
      // RESOLVES policy (there is no aiMode setter on the tenancy/ai-config
      // service), so the test writes the existing `ai_mode` column directly on
      // the existing business row. This adds no production code and no
      // schema/migration; MANUAL tenants are left at the schema default.
      if (mode === 'AI_ASSISTED') {
        await prisma.business.update({
          where: { id: bizRes.data.id },
          data: { aiMode: 'AI_ASSISTED' },
        });
      }
      return { userId: userRes.data.id, businessId: bizRes.data.id };
    }

    // -- context-item helpers (DRAFT -> VERIFIED / DRAFT -> ARCHIVED) -------

    async function createVerified(
      businessId: string,
      verifierId: string,
      args: {
        category: string;
        key: string;
        value: string;
        sourceLabel?: string | null;
        sourceMetadata?: unknown;
      },
    ): Promise<string> {
      const created = await knowledge.createItem({
        businessId,
        category: args.category,
        key: args.key,
        value: args.value,
        sourceType: 'OWNER_APPROVED',
        sourceLabel: args.sourceLabel ?? null,
        sourceMetadata: args.sourceMetadata ?? null,
        createdByUserId: verifierId,
      });
      if (!created.ok) throw new Error(`createItem: ${created.error.code}`);
      const verified = await knowledge.verifyItem({
        businessId,
        itemId: created.data.id,
        verifiedByUserId: verifierId,
      });
      if (!verified.ok) throw new Error(`verifyItem: ${verified.error.code}`);
      return verified.data.id;
    }

    async function createDraft(
      businessId: string,
      args: { category: string; key: string; value: string },
    ): Promise<string> {
      const created = await knowledge.createItem({
        businessId,
        category: args.category,
        key: args.key,
        value: args.value,
        sourceType: 'OWNER_APPROVED',
      });
      if (!created.ok) throw new Error(`createItem(draft): ${created.error.code}`);
      return created.data.id; // left in DRAFT — never AI-eligible
    }

    async function createArchived(
      businessId: string,
      args: { category: string; key: string; value: string },
    ): Promise<string> {
      const id = await createDraft(businessId, args);
      const archived = await knowledge.archiveItem({ businessId, itemId: id });
      if (!archived.ok) throw new Error(`archiveItem: ${archived.error.code}`);
      return archived.data.id;
    }

    // -- seed --------------------------------------------------------------

    const a = await seedTenant('a', 'AI_ASSISTED');
    const b = await seedTenant('b', 'AI_ASSISTED');
    const manual = await seedTenant('manual', 'MANUAL');

    const aHoursId = await createVerified(a.businessId, a.userId, {
      category: 'hours',
      key: `${aKey}_monday`,
      value: `Open 09:00-17:00 ${aValue}`,
      sourceLabel: aLabel,
      sourceMetadata: { note: aMeta },
    });
    const aPricingId = await createVerified(a.businessId, a.userId, {
      category: 'pricing',
      key: `${aKey}_studio`,
      value: `EUR 1200/mo ${aValue}`,
    });
    const aDraftId = await createDraft(a.businessId, {
      category: 'pricing',
      key: `${aKey}_penthouse`,
      value: `EUR 9000/mo ${aDraftValue}`,
    });
    const aArchivedId = await createArchived(a.businessId, {
      category: 'hours',
      key: `${aKey}_sunday`,
      value: `Closed ${aArchivedValue}`,
    });

    const bHoursId = await createVerified(b.businessId, b.userId, {
      category: 'hours',
      key: `${bKey}_monday`,
      value: `Open 10:00-18:00 ${bValue}`,
      sourceLabel: bLabel,
      sourceMetadata: { note: bMeta },
    });
    const bPricingId = await createVerified(b.businessId, b.userId, {
      category: 'pricing',
      key: `${bKey}_studio`,
      value: `EUR 2000/mo ${bValue}`,
    });

    // MANUAL tenant DOES own a VERIFIED item — proving the policy gate (not an
    // empty store) is what stops assembly.
    const manualItemId = await createVerified(manual.businessId, manual.userId, {
      category: 'hours',
      key: `${suffix}_manual_monday`,
      value: `Open 09:00-17:00 ${manualValue}`,
    });

    // verifiedByUserId (provenance) is the tenant's own user id; a cross-tenant
    // leak of A's verifier into B (or vice versa) must never happen.
    const aMarkers = [
      aValue,
      aKey,
      aLabel,
      aMeta,
      aHoursId,
      aPricingId,
      a.userId,
      a.businessId,
    ];
    const bMarkers = [
      bValue,
      bKey,
      bLabel,
      bMeta,
      bHoursId,
      bPricingId,
      b.userId,
      b.businessId,
    ];

    return {
      aBusinessId: a.businessId,
      bBusinessId: b.businessId,
      manualBusinessId: manual.businessId,
      aUserId: a.userId,
      bUserId: b.userId,
      aHoursId,
      aPricingId,
      aDraftId,
      aArchivedId,
      bHoursId,
      bPricingId,
      manualItemId,
      aValue,
      bValue,
      aDraftValue,
      aArchivedValue,
      manualValue,
      aMarkers,
      bMarkers,
    };
  }

  // -- assembler helpers ---------------------------------------------------

  function assembleContext(
    businessId: string,
    options?: { category?: string; limit?: number },
  ) {
    return deps.services.aiRuntime.assembleAiContext({ businessId }, options);
  }

  async function assembleOk(
    businessId: string,
    options?: { category?: string; limit?: number },
  ) {
    const res = await assembleContext(businessId, options);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(`expected ok context, got ${res.error.code}`);
    return res.data;
  }

  // =========================================================================
  // 1. Assembler tenant isolation
  // =========================================================================

  describe('Assembler tenant isolation', () => {
    it('Business A assembled context includes ONLY Business A VERIFIED items', async () => {
      const a = await assembleOk(seed.aBusinessId);
      expect(a.businessId).toBe(seed.aBusinessId);
      expect(a.aiMode).toBe('AI_ASSISTED');
      expect(a.aiGenerationEnabled).toBe(true);
      expect(a.businessContextItems.map((i) => i.id).sort()).toEqual(
        [seed.aHoursId, seed.aPricingId].sort(),
      );
      for (const item of a.businessContextItems) {
        expect(item.value).toContain(seed.aValue);
        expect(item.value).not.toContain(seed.bValue);
      }
    });

    it('Business B assembled context includes ONLY Business B VERIFIED items', async () => {
      const b = await assembleOk(seed.bBusinessId);
      expect(b.businessId).toBe(seed.bBusinessId);
      expect(b.businessContextItems.map((i) => i.id).sort()).toEqual(
        [seed.bHoursId, seed.bPricingId].sort(),
      );
      for (const item of b.businessContextItems) {
        expect(item.value).toContain(seed.bValue);
        expect(item.value).not.toContain(seed.aValue);
      }
    });

    it('Business A context contains NO Business-B id / key / value / label / provenance', async () => {
      const a = await assembleOk(seed.aBusinessId);
      const serialized = JSON.stringify(a);
      for (const marker of seed.bMarkers) {
        expect(serialized).not.toContain(marker);
      }
    });

    it('Business B context contains NO Business-A id / key / value / label / provenance', async () => {
      const b = await assembleOk(seed.bBusinessId);
      const serialized = JSON.stringify(b);
      for (const marker of seed.aMarkers) {
        expect(serialized).not.toContain(marker);
      }
    });

    it('a category filter narrows within the tenant and never crosses it', async () => {
      // Only A's VERIFIED pricing item — A's DRAFT pricing item is excluded and
      // B's pricing item (same category/key shape) never appears.
      const a = await assembleOk(seed.aBusinessId, { category: 'pricing' });
      expect(a.businessContextItems.map((i) => i.id)).toEqual([seed.aPricingId]);
      expect(JSON.stringify(a)).not.toContain(seed.bValue);
    });

    it('the assembled context exposes only the safe projection — no prompt / provider / send / per-item businessId fields', async () => {
      const a = await assembleOk(seed.aBusinessId);
      // Top-level shape is a structured context, never a prompt/provider/send
      // envelope: no prompt string, no providerRequest, no sent*/status fields.
      expect(Object.keys(a).sort()).toEqual(
        [
          'aiGenerationEnabled',
          'aiMode',
          'assembledAt',
          'businessContextItems',
          'businessId',
        ].sort(),
      );
      // The per-item projection drops businessId/status and carries no PII field.
      const itemKeys = new Set(
        a.businessContextItems.flatMap((i) => Object.keys(i)),
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
    });
  });

  // =========================================================================
  // 2. Verified-only behavior remains intact
  // =========================================================================

  describe('Verified-only behavior', () => {
    it('excludes DRAFT (unverified) items', async () => {
      const a = await assembleOk(seed.aBusinessId);
      expect(a.businessContextItems.map((i) => i.id)).not.toContain(seed.aDraftId);
      expect(JSON.stringify(a)).not.toContain(seed.aDraftValue);
    });

    it('excludes ARCHIVED items', async () => {
      const a = await assembleOk(seed.aBusinessId);
      expect(a.businessContextItems.map((i) => i.id)).not.toContain(
        seed.aArchivedId,
      );
      expect(JSON.stringify(a)).not.toContain(seed.aArchivedValue);
    });

    it('does not include the other tenant VERIFIED items when assembling A', async () => {
      const a = await assembleOk(seed.aBusinessId);
      const ids = a.businessContextItems.map((i) => i.id);
      expect(ids).not.toContain(seed.bHoursId);
      expect(ids).not.toContain(seed.bPricingId);
    });
  });

  // =========================================================================
  // 3. AI-off / MANUAL fails closed
  // =========================================================================

  describe('AI-off / MANUAL fails closed', () => {
    it('the resolver reports AI_ASSISTED tenants enabled and the MANUAL tenant disabled', async () => {
      const aPolicy = await deps.services.aiConfig.resolveAiPolicy({
        businessId: seed.aBusinessId,
      });
      expect(aPolicy.ok).toBe(true);
      if (aPolicy.ok) {
        expect(aPolicy.data.aiMode).toBe('AI_ASSISTED');
        expect(aPolicy.data.aiGenerationEnabled).toBe(true);
      }
      const mPolicy = await deps.services.aiConfig.resolveAiPolicy({
        businessId: seed.manualBusinessId,
      });
      expect(mPolicy.ok).toBe(true);
      if (mPolicy.ok) {
        expect(mPolicy.data.aiMode).toBe('MANUAL');
        expect(mPolicy.data.aiGenerationEnabled).toBe(false);
      }
    });

    it('the MANUAL tenant returns AI_CONTEXT_DISABLED even though it owns a VERIFIED item', async () => {
      const res = await assembleContext(seed.manualBusinessId);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_DISABLED');
      // Fail-closed: the MANUAL tenant's verified value never leaves the store.
      expect(JSON.stringify(res)).not.toContain(seed.manualValue);
    });

    it('an absent business (no row) also fails closed', async () => {
      const res = await assembleContext(randomUUID());
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('AI_CONTEXT_DISABLED');
    });
  });

  // =========================================================================
  // 4. Audit isolation (real DB, metadata-only)
  // =========================================================================

  describe('Audit isolation (metadata-only)', () => {
    it('AI-generation audit rows are tenant-scoped and persist metadata only', async () => {
      // Open one STARTED attempt per tenant. The inputs are METADATA ONLY: the
      // operation, the real VERIFIED context item ids, and a prompt CHAR COUNT.
      // No prompt text, generated text, or customer content is passed or stored.
      const aStart = await auditRepo.start({
        businessId: seed.aBusinessId,
        operation: 'REPLY_DRAFT',
        includedContextItemIds: [seed.aHoursId, seed.aPricingId],
        promptCharCount: 128,
      });
      expect(aStart.ok).toBe(true);
      if (!aStart.ok) return;
      const bStart = await auditRepo.start({
        businessId: seed.bBusinessId,
        operation: 'REPLY_DRAFT',
        includedContextItemIds: [seed.bHoursId, seed.bPricingId],
        promptCharCount: 128,
      });
      expect(bStart.ok).toBe(true);
      if (!bStart.ok) return;

      // Cross-tenant READ is denied by the composite (id, businessId) scope:
      // B cannot read A's row, but A can read its own.
      const crossRead = await auditRepo.findByBusinessAndId(
        seed.bBusinessId,
        aStart.data.id,
      );
      expect(crossRead.ok).toBe(true);
      if (crossRead.ok) expect(crossRead.data).toBeNull();
      const ownRead = await auditRepo.findByBusinessAndId(
        seed.aBusinessId,
        aStart.data.id,
      );
      expect(ownRead.ok).toBe(true);
      if (ownRead.ok) {
        expect(ownRead.data).not.toBeNull();
        expect(ownRead.data?.businessId).toBe(seed.aBusinessId);
        expect(ownRead.data?.status).toBe('STARTED');
      }

      // Cross-tenant COMPLETION is rejected (AI_AUDIT_NOT_FOUND) and mutates
      // nothing — A's row is still STARTED afterward.
      const crossComplete = await auditRepo.completeSuccess({
        auditLogId: aStart.data.id,
        businessId: seed.bBusinessId,
      });
      expect(crossComplete.ok).toBe(false);
      if (!crossComplete.ok) {
        expect(crossComplete.error.code).toBe('AI_AUDIT_NOT_FOUND');
      }
      const afterCross = await auditRepo.findByBusinessAndId(
        seed.aBusinessId,
        aStart.data.id,
      );
      expect(afterCross.ok).toBe(true);
      if (afterCross.ok) expect(afterCross.data?.status).toBe('STARTED');

      // The owner can complete its own attempt.
      const ownComplete = await auditRepo.completeSuccess({
        auditLogId: aStart.data.id,
        businessId: seed.aBusinessId,
      });
      expect(ownComplete.ok).toBe(true);
      if (ownComplete.ok) expect(ownComplete.data.status).toBe('SUCCEEDED');

      // A's persisted audit row carries item-id + count METADATA but NO content,
      // and nothing belonging to Business B.
      const persisted = await auditRepo.findByBusinessAndId(
        seed.aBusinessId,
        aStart.data.id,
      );
      expect(persisted.ok).toBe(true);
      if (!persisted.ok || !persisted.data) return;
      const dump = JSON.stringify(persisted.data);
      // Metadata (the verified context item ids) is present...
      expect(dump).toContain(seed.aHoursId);
      expect(dump).toContain(seed.aPricingId);
      // ...but the raw content sentinel is never stored...
      expect(dump).not.toContain(seed.aValue);
      // ...and no Business-B marker appears anywhere in A's audit row.
      for (const marker of seed.bMarkers) {
        expect(dump).not.toContain(marker);
      }
      // The record exposes no content-bearing column.
      const keys = Object.keys(persisted.data);
      for (const forbidden of [
        'prompt',
        'promptText',
        'generatedText',
        'text',
        'transcript',
        'draftText',
        'messageBody',
        'customerEmail',
        'customerPhone',
      ]) {
        expect(keys).not.toContain(forbidden);
      }
    });
  });
});
