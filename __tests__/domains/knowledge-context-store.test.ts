// ===========================================================================
// Tests — Knowledge Domain: Verified Business-Context Store (B-R2)
//
// Proves the tenant-scoped, verified business-context store:
//  - items are created as DRAFT (unverified) and carry provenance
//  - verified-context reads are ALWAYS scoped by businessId AND status:VERIFIED
//  - DRAFT / ARCHIVED / cross-business items are never returned as verified
//  - verify/archive are scoped by businessId
//  - repository errors surface as ActionResult errors
//  - the domain introduces NO AI provider / ai-runtime / prompt builder /
//    customer-conversation-message read path / auto-send path / new dependency
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  createKnowledgeRepository,
  createKnowledgeService,
  mapBusinessContextItemRecord,
  isBusinessContextItemStatus,
  isBusinessContextItemSourceType,
  BUSINESS_CONTEXT_ITEM_STATUS_VALUES,
  BUSINESS_CONTEXT_ITEM_SOURCE_TYPE_VALUES,
  DEFAULT_BUSINESS_CONTEXT_ITEM_STATUS,
  AI_ELIGIBLE_BUSINESS_CONTEXT_ITEM_STATUS,
  type KnowledgeRepository,
  type KnowledgeRepositoryDb,
  type BusinessContextItemRecord,
} from '@/domains/knowledge';

// ---------------------------------------------------------------------------
// Constants (valid UUIDs)
// ---------------------------------------------------------------------------

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';
const USER_1 = '33333333-3333-4333-8333-333333333333';
const VERIFIER = '44444444-4444-4444-8444-444444444444';

// ---------------------------------------------------------------------------
// Deterministic UUID generator for the in-memory fake
// ---------------------------------------------------------------------------

function fakeUuid(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

// ---------------------------------------------------------------------------
// In-memory fake DB delegate (mimics the Prisma businessContextItem delegate)
// ---------------------------------------------------------------------------

interface FakeDb extends KnowledgeRepositoryDb {
  rows: BusinessContextItemRecord[];
}

function createFakeDb(): FakeDb {
  const rows: BusinessContextItemRecord[] = [];
  let idCounter = 0;
  let clock = 0;
  const tick = () => new Date(1_700_000_000_000 + clock++ * 1000);

  return {
    rows,
    businessContextItem: {
      async create({ data }) {
        const now = tick();
        const record: BusinessContextItemRecord = {
          id: fakeUuid(++idCounter),
          businessId: data.businessId,
          category: data.category,
          key: data.key,
          value: data.value,
          status: data.status,
          sourceType: data.sourceType,
          sourceLabel: data.sourceLabel ?? null,
          sourceUrl: data.sourceUrl ?? null,
          sourceMetadata: data.sourceMetadata ?? null,
          verifiedByUserId: null,
          verifiedAt: null,
          createdByUserId: data.createdByUserId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        rows.push(record);
        return { ...record };
      },
      async findMany({ where, take }) {
        const filtered = rows
          .filter(
            (r) =>
              r.businessId === where.businessId &&
              r.status === where.status &&
              (where.category === undefined || r.category === where.category),
          )
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        return filtered.slice(0, take).map((r) => ({ ...r }));
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
        const updated: BusinessContextItemRecord = {
          ...rows[idx],
          ...data,
          updatedAt: now,
        };
        rows[idx] = updated;
        return { ...updated };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    businessId: BIZ_A,
    category: 'hours',
    key: 'monday',
    value: 'Open 9:00–17:00',
    sourceType: 'OWNER_APPROVED' as const,
    sourceLabel: 'Owner dashboard',
    createdByUserId: USER_1,
    ...overrides,
  };
}

// ===========================================================================
// Types & guards
// ===========================================================================

describe('Knowledge — types & guards', () => {
  it('status values are exactly [DRAFT, VERIFIED, ARCHIVED]', () => {
    expect([...BUSINESS_CONTEXT_ITEM_STATUS_VALUES]).toEqual([
      'DRAFT',
      'VERIFIED',
      'ARCHIVED',
    ]);
  });

  it('source type values include the expected provenance kinds', () => {
    expect([...BUSINESS_CONTEXT_ITEM_SOURCE_TYPE_VALUES]).toEqual([
      'OWNER_APPROVED',
      'OPERATOR_APPROVED',
      'SYSTEM_SEEDED',
      'IMPORT',
      'OTHER',
    ]);
  });

  it('default status is DRAFT (unverified) and AI-eligible status is VERIFIED', () => {
    expect(DEFAULT_BUSINESS_CONTEXT_ITEM_STATUS).toBe('DRAFT');
    expect(AI_ELIGIBLE_BUSINESS_CONTEXT_ITEM_STATUS).toBe('VERIFIED');
  });

  it('status guard accepts valid and rejects invalid values', () => {
    expect(isBusinessContextItemStatus('VERIFIED')).toBe(true);
    expect(isBusinessContextItemStatus('DRAFT')).toBe(true);
    expect(isBusinessContextItemStatus('PUBLISHED')).toBe(false);
    expect(isBusinessContextItemStatus(null)).toBe(false);
  });

  it('source-type guard accepts valid and rejects invalid values', () => {
    expect(isBusinessContextItemSourceType('OWNER_APPROVED')).toBe(true);
    expect(isBusinessContextItemSourceType('SCRAPED')).toBe(false);
    expect(isBusinessContextItemSourceType(undefined)).toBe(false);
  });

  it('maps a record to a domain item with ISO date strings', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    const item = mapBusinessContextItemRecord({
      id: 'x',
      businessId: BIZ_A,
      category: 'policy',
      key: 'refunds',
      value: 'No refunds after 30 days',
      status: 'VERIFIED',
      sourceType: 'OWNER_APPROVED',
      sourceLabel: null,
      sourceUrl: null,
      sourceMetadata: null,
      verifiedByUserId: VERIFIER,
      verifiedAt: now,
      createdByUserId: USER_1,
      createdAt: now,
      updatedAt: now,
    });
    expect(item.verifiedAt).toBe(now.toISOString());
    expect(item.createdAt).toBe(now.toISOString());
    expect(item.value).toBe('No refunds after 30 days');
  });
});

// ===========================================================================
// Repository — create + provenance
// ===========================================================================

describe('Knowledge repository — createItem', () => {
  it('stores businessId and provenance, defaulting to DRAFT (unverified)', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);

    const res = await repo.createItem(validCreateInput());

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.businessId).toBe(BIZ_A);
      expect(res.data.status).toBe('DRAFT');
      expect(res.data.sourceType).toBe('OWNER_APPROVED');
      expect(res.data.sourceLabel).toBe('Owner dashboard');
      expect(res.data.createdByUserId).toBe(USER_1);
      // Unverified on creation: no verification provenance yet.
      expect(res.data.verifiedByUserId).toBeNull();
      expect(res.data.verifiedAt).toBeNull();
    }
  });

  it('preserves long text values (business-owned knowledge)', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);
    const longValue = 'A'.repeat(8000);

    const res = await repo.createItem(validCreateInput({ value: longValue }));

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.value).toBe(longValue);
  });

  it('returns an ActionResult error when the DB create throws', async () => {
    const db = createFakeDb();
    vi.spyOn(db.businessContextItem, 'create').mockRejectedValueOnce(
      new Error('db down'),
    );
    const repo = createKnowledgeRepository(db);

    const res = await repo.createItem(validCreateInput());

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('KNOWLEDGE_REPOSITORY_ERROR');
  });
});

// ===========================================================================
// Repository — listVerifiedByBusiness (the core security read)
// ===========================================================================

describe('Knowledge repository — listVerifiedByBusiness', () => {
  it('ALWAYS scopes the query by businessId AND status:VERIFIED', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repo = createKnowledgeRepository({
      businessContextItem: { findMany } as never,
    } as unknown as KnowledgeRepositoryDb);

    await repo.listVerifiedByBusiness({ businessId: BIZ_A });

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.businessId).toBe(BIZ_A);
    expect(arg.where.status).toBe('VERIFIED');
  });

  it('keeps businessId + VERIFIED pinned even when a category filter is added', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repo = createKnowledgeRepository({
      businessContextItem: { findMany } as never,
    } as unknown as KnowledgeRepositoryDb);

    await repo.listVerifiedByBusiness({ businessId: BIZ_A, category: 'hours' });

    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      businessId: BIZ_A,
      status: 'VERIFIED',
      category: 'hours',
    });
  });

  it('returns only VERIFIED items for the business; excludes DRAFT and ARCHIVED', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);

    // One verified, one draft, one archived — all for BIZ_A.
    const verified = await repo.createItem(validCreateInput({ key: 'verified' }));
    const draft = await repo.createItem(validCreateInput({ key: 'draft' }));
    const archived = await repo.createItem(validCreateInput({ key: 'archived' }));
    if (!verified.ok || !draft.ok || !archived.ok) throw new Error('setup');

    await repo.verifyItem({
      businessId: BIZ_A,
      itemId: verified.data.id,
      verifiedByUserId: VERIFIER,
    });
    await repo.archiveItem({ businessId: BIZ_A, itemId: archived.data.id });

    const res = await repo.listVerifiedByBusiness({ businessId: BIZ_A });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(1);
      expect(res.data[0].key).toBe('verified');
      expect(res.data[0].status).toBe('VERIFIED');
    }
  });

  it('never returns another business\'s verified items (cross-tenant isolation)', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);

    // BIZ_B has a verified item.
    const bItem = await repo.createItem(
      validCreateInput({ businessId: BIZ_B, key: 'b-secret' }),
    );
    if (!bItem.ok) throw new Error('setup');
    await repo.verifyItem({
      businessId: BIZ_B,
      itemId: bItem.data.id,
      verifiedByUserId: VERIFIER,
    });

    // BIZ_A asks for its verified items — must see none of BIZ_B's.
    const res = await repo.listVerifiedByBusiness({ businessId: BIZ_A });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([]);
  });

  it('returns an ActionResult error when the DB query throws', async () => {
    const db = createFakeDb();
    vi.spyOn(db.businessContextItem, 'findMany').mockRejectedValueOnce(
      new Error('db down'),
    );
    const repo = createKnowledgeRepository(db);

    const res = await repo.listVerifiedByBusiness({ businessId: BIZ_A });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('KNOWLEDGE_REPOSITORY_ERROR');
  });
});

// ===========================================================================
// Repository — listByBusiness (status-filtered visibility)
// ===========================================================================

describe('Knowledge repository — listByBusiness', () => {
  it('defaults to VERIFIED when no status is given (fail-safe)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repo = createKnowledgeRepository({
      businessContextItem: { findMany } as never,
    } as unknown as KnowledgeRepositoryDb);

    await repo.listByBusiness({ businessId: BIZ_A });

    const arg = findMany.mock.calls[0][0];
    expect(arg.where.businessId).toBe(BIZ_A);
    expect(arg.where.status).toBe('VERIFIED');
  });

  it('filters by the requested status, always pinned to businessId', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repo = createKnowledgeRepository({
      businessContextItem: { findMany } as never,
    } as unknown as KnowledgeRepositoryDb);

    await repo.listByBusiness({ businessId: BIZ_A, status: 'DRAFT' });

    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ businessId: BIZ_A, status: 'DRAFT' });
  });

  it('returns only DRAFT items for the business when status:DRAFT', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);

    const verified = await repo.createItem(validCreateInput({ key: 'verified' }));
    await repo.createItem(validCreateInput({ key: 'draft' }));
    if (!verified.ok) throw new Error('setup');
    await repo.verifyItem({
      businessId: BIZ_A,
      itemId: verified.data.id,
      verifiedByUserId: VERIFIER,
    });

    const res = await repo.listByBusiness({ businessId: BIZ_A, status: 'DRAFT' });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(1);
      expect(res.data[0].key).toBe('draft');
      expect(res.data[0].status).toBe('DRAFT');
    }
  });

  it('never returns another business\'s items when filtering by status', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);

    await repo.createItem(validCreateInput({ businessId: BIZ_B, key: 'b-draft' }));

    const res = await repo.listByBusiness({ businessId: BIZ_A, status: 'DRAFT' });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([]);
  });

  it('returns an ActionResult error when the DB query throws', async () => {
    const db = createFakeDb();
    vi.spyOn(db.businessContextItem, 'findMany').mockRejectedValueOnce(
      new Error('db down'),
    );
    const repo = createKnowledgeRepository(db);

    const res = await repo.listByBusiness({ businessId: BIZ_A, status: 'DRAFT' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('KNOWLEDGE_REPOSITORY_ERROR');
  });
});

// ===========================================================================
// Repository — findByBusinessAndId (scope guard)
// ===========================================================================

describe('Knowledge repository — findByBusinessAndId', () => {
  it('queries by the compound (id, businessId) unique key — not by id alone', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const repo = createKnowledgeRepository({
      businessContextItem: { findUnique } as never,
    } as unknown as KnowledgeRepositoryDb);
    const itemId = fakeUuid(42);

    await repo.findByBusinessAndId(BIZ_A, itemId);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id_businessId: { id: itemId, businessId: BIZ_A } },
    });
  });

  it('returns the item for the owning business', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);
    const created = await repo.createItem(validCreateInput());
    if (!created.ok) throw new Error('setup');

    const res = await repo.findByBusinessAndId(BIZ_A, created.data.id);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data?.id).toBe(created.data.id);
  });

  it('returns null for a foreign business (cross-tenant)', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);
    const created = await repo.createItem(validCreateInput());
    if (!created.ok) throw new Error('setup');

    const res = await repo.findByBusinessAndId(BIZ_B, created.data.id);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBeNull();
  });
});

// ===========================================================================
// Repository — verifyItem
// ===========================================================================

describe('Knowledge repository — verifyItem', () => {
  it('transitions DRAFT → VERIFIED and records verification provenance', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);
    const created = await repo.createItem(validCreateInput());
    if (!created.ok) throw new Error('setup');

    const res = await repo.verifyItem({
      businessId: BIZ_A,
      itemId: created.data.id,
      verifiedByUserId: VERIFIER,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.status).toBe('VERIFIED');
      expect(res.data.verifiedByUserId).toBe(VERIFIER);
      expect(res.data.verifiedAt).not.toBeNull();
    }
  });

  it('refuses to verify an item owned by another business', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);
    const created = await repo.createItem(validCreateInput());
    if (!created.ok) throw new Error('setup');

    const res = await repo.verifyItem({
      businessId: BIZ_B,
      itemId: created.data.id,
      verifiedByUserId: VERIFIER,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('BUSINESS_CONTEXT_ITEM_NOT_FOUND');
    // The foreign item must remain DRAFT.
    expect(db.rows[0].status).toBe('DRAFT');
  });

  it('refuses to verify an archived item', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);
    const created = await repo.createItem(validCreateInput());
    if (!created.ok) throw new Error('setup');
    await repo.archiveItem({ businessId: BIZ_A, itemId: created.data.id });

    const res = await repo.verifyItem({
      businessId: BIZ_A,
      itemId: created.data.id,
      verifiedByUserId: VERIFIER,
    });

    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error.code).toBe('BUSINESS_CONTEXT_ITEM_NOT_VERIFIABLE');
  });

  it('scopes the verify UPDATE by the compound (id, businessId) key', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);
    const created = await repo.createItem(validCreateInput());
    if (!created.ok) throw new Error('setup');
    const updateSpy = vi.spyOn(db.businessContextItem, 'update');

    await repo.verifyItem({
      businessId: BIZ_A,
      itemId: created.data.id,
      verifiedByUserId: VERIFIER,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0].where).toEqual({
      id_businessId: { id: created.data.id, businessId: BIZ_A },
    });
  });

  it('rejects an already-VERIFIED item with NOT_VERIFIABLE and does not update it', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);
    const created = await repo.createItem(validCreateInput());
    if (!created.ok) throw new Error('setup');

    // First verify succeeds (DRAFT → VERIFIED).
    const first = await repo.verifyItem({
      businessId: BIZ_A,
      itemId: created.data.id,
      verifiedByUserId: VERIFIER,
    });
    expect(first.ok).toBe(true);

    // A repeated verify must be rejected and must NOT touch the row.
    const updateSpy = vi.spyOn(db.businessContextItem, 'update');
    const second = await repo.verifyItem({
      businessId: BIZ_A,
      itemId: created.data.id,
      verifiedByUserId: USER_1, // a different verifier
    });

    expect(second.ok).toBe(false);
    if (!second.ok)
      expect(second.error.code).toBe('BUSINESS_CONTEXT_ITEM_NOT_VERIFIABLE');
    expect(updateSpy).not.toHaveBeenCalled();
    // Original verification provenance is preserved (not overwritten).
    expect(db.rows[0].verifiedByUserId).toBe(VERIFIER);
  });
});

// ===========================================================================
// Repository — archiveItem
// ===========================================================================

describe('Knowledge repository — archiveItem', () => {
  it('archives an item scoped by businessId, removing it from verified reads', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);
    const created = await repo.createItem(validCreateInput());
    if (!created.ok) throw new Error('setup');
    await repo.verifyItem({
      businessId: BIZ_A,
      itemId: created.data.id,
      verifiedByUserId: VERIFIER,
    });

    const archived = await repo.archiveItem({
      businessId: BIZ_A,
      itemId: created.data.id,
    });
    expect(archived.ok).toBe(true);
    if (archived.ok) expect(archived.data.status).toBe('ARCHIVED');

    const list = await repo.listVerifiedByBusiness({ businessId: BIZ_A });
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.data).toEqual([]);
  });

  it('scopes the archive UPDATE by the compound (id, businessId) key', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);
    const created = await repo.createItem(validCreateInput());
    if (!created.ok) throw new Error('setup');
    const updateSpy = vi.spyOn(db.businessContextItem, 'update');

    await repo.archiveItem({ businessId: BIZ_A, itemId: created.data.id });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0].where).toEqual({
      id_businessId: { id: created.data.id, businessId: BIZ_A },
    });
  });

  it('refuses to archive an item owned by another business', async () => {
    const db = createFakeDb();
    const repo = createKnowledgeRepository(db);
    const created = await repo.createItem(validCreateInput());
    if (!created.ok) throw new Error('setup');

    const res = await repo.archiveItem({
      businessId: BIZ_B,
      itemId: created.data.id,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('BUSINESS_CONTEXT_ITEM_NOT_FOUND');
    expect(db.rows[0].status).toBe('DRAFT');
  });
});

// ===========================================================================
// Service — validation + scoping + delegation
// ===========================================================================

/** Mock repository whose methods are vi.fn spies (capture forwarded args). */
type MockedKnowledgeRepository = KnowledgeRepository & {
  createItem: ReturnType<typeof vi.fn>;
  listVerifiedByBusiness: ReturnType<typeof vi.fn>;
  listByBusiness: ReturnType<typeof vi.fn>;
  findByBusinessAndId: ReturnType<typeof vi.fn>;
  verifyItem: ReturnType<typeof vi.fn>;
  archiveItem: ReturnType<typeof vi.fn>;
};

function mockRepo(): MockedKnowledgeRepository {
  return {
    createItem: vi.fn(async (input) => ({ ok: true, data: { ...input } })),
    listVerifiedByBusiness: vi.fn(async () => ({ ok: true, data: [] })),
    listByBusiness: vi.fn(async () => ({ ok: true, data: [] })),
    findByBusinessAndId: vi.fn(async () => ({ ok: true, data: null })),
    verifyItem: vi.fn(async () => ({ ok: true, data: {} })),
    archiveItem: vi.fn(async () => ({ ok: true, data: {} })),
  } as MockedKnowledgeRepository;
}

describe('Knowledge service — createItem', () => {
  it('rejects an invalid (non-UUID) businessId and does not call the repo', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.createItem(
      validCreateInput({ businessId: 'not-a-uuid' }),
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_KNOWLEDGE_INPUT');
    expect(repo.createItem).not.toHaveBeenCalled();
  });

  it('rejects an empty value', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.createItem(validCreateInput({ value: '' }));

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_KNOWLEDGE_INPUT');
  });

  it('rejects an invalid sourceType (provenance must be a known kind)', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.createItem(
      validCreateInput({ sourceType: 'SCRAPED' }),
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_KNOWLEDGE_INPUT');
  });

  it('rejects a missing sourceType (provenance must be explicit, never defaulted)', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });

    // sourceType omitted entirely — there is no DB/default that would invent it.
    const res = await svc.createItem({
      businessId: BIZ_A,
      category: 'hours',
      key: 'monday',
      value: 'Open 9:00–17:00',
    } as never);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_KNOWLEDGE_INPUT');
    expect(repo.createItem).not.toHaveBeenCalled();
  });

  it('forwards a valid create to the repository', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.createItem(validCreateInput());

    expect(res.ok).toBe(true);
    expect(repo.createItem).toHaveBeenCalledTimes(1);
    expect(repo.createItem.mock.calls[0][0].businessId).toBe(BIZ_A);
  });
});

describe('Knowledge service — listVerifiedItems', () => {
  it('validates and forwards only the server-resolved scope to the repo', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.listVerifiedItems({ businessId: BIZ_A });

    expect(res.ok).toBe(true);
    expect(repo.listVerifiedByBusiness).toHaveBeenCalledWith({
      businessId: BIZ_A,
    });
  });

  it('rejects a non-UUID businessId', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.listVerifiedItems({ businessId: 'nope' });

    expect(res.ok).toBe(false);
    expect(repo.listVerifiedByBusiness).not.toHaveBeenCalled();
  });
});

describe('Knowledge service — listItems', () => {
  it('forwards the validated status-filtered scope to repository.listByBusiness', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.listItems({ businessId: BIZ_A, status: 'DRAFT' });

    expect(res.ok).toBe(true);
    expect(repo.listByBusiness).toHaveBeenCalledWith({
      businessId: BIZ_A,
      status: 'DRAFT',
    });
    // Does NOT route through the verified-only method.
    expect(repo.listVerifiedByBusiness).not.toHaveBeenCalled();
  });

  it('allows an omitted status (repo applies the fail-safe VERIFIED default)', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.listItems({ businessId: BIZ_A });

    expect(res.ok).toBe(true);
    expect(repo.listByBusiness).toHaveBeenCalledWith({ businessId: BIZ_A });
  });

  it('rejects an unknown status value', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.listItems({
      businessId: BIZ_A,
      status: 'PUBLISHED' as never,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_KNOWLEDGE_INPUT');
    expect(repo.listByBusiness).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID businessId', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.listItems({ businessId: 'nope', status: 'DRAFT' });

    expect(res.ok).toBe(false);
    expect(repo.listByBusiness).not.toHaveBeenCalled();
  });
});

describe('Knowledge service — findItem', () => {
  it('returns the item when found for the owning business', async () => {
    const repo = mockRepo();
    const itemId = fakeUuid(11);
    repo.findByBusinessAndId.mockResolvedValueOnce({
      ok: true,
      data: { id: itemId, businessId: BIZ_A, status: 'DRAFT' },
    });
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.findItem({ businessId: BIZ_A, itemId });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.id).toBe(itemId);
    expect(repo.findByBusinessAndId).toHaveBeenCalledWith(BIZ_A, itemId);
  });

  it('maps a not-found (null) lookup to BUSINESS_CONTEXT_ITEM_NOT_FOUND', async () => {
    const repo = mockRepo(); // findByBusinessAndId defaults to ok(null)
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.findItem({ businessId: BIZ_A, itemId: fakeUuid(12) });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('BUSINESS_CONTEXT_ITEM_NOT_FOUND');
  });

  it('rejects an invalid itemId without calling the repo', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.findItem({ businessId: BIZ_A, itemId: 'bad' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_KNOWLEDGE_INPUT');
    expect(repo.findByBusinessAndId).not.toHaveBeenCalled();
  });

  it('propagates a repository error result', async () => {
    const repo = mockRepo();
    repo.findByBusinessAndId.mockResolvedValueOnce({
      ok: false,
      error: { code: 'KNOWLEDGE_REPOSITORY_ERROR', message: 'boom' },
    });
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.findItem({ businessId: BIZ_A, itemId: fakeUuid(13) });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('KNOWLEDGE_REPOSITORY_ERROR');
  });
});

describe('Knowledge service — verifyItem / archiveItem', () => {
  it('verifyItem validates and scopes by businessId', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });
    const itemId = fakeUuid(7);

    const res = await svc.verifyItem({
      businessId: BIZ_A,
      itemId,
      verifiedByUserId: VERIFIER,
    });

    expect(res.ok).toBe(true);
    expect(repo.verifyItem).toHaveBeenCalledWith({
      businessId: BIZ_A,
      itemId,
      verifiedByUserId: VERIFIER,
    });
  });

  it('archiveItem validates and scopes by businessId', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });
    const itemId = fakeUuid(8);

    const res = await svc.archiveItem({ businessId: BIZ_A, itemId });

    expect(res.ok).toBe(true);
    expect(repo.archiveItem).toHaveBeenCalledWith({
      businessId: BIZ_A,
      itemId,
    });
  });

  it('archiveItem rejects an invalid itemId', async () => {
    const repo = mockRepo();
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.archiveItem({ businessId: BIZ_A, itemId: 'bad' });

    expect(res.ok).toBe(false);
    expect(repo.archiveItem).not.toHaveBeenCalled();
  });

  it('propagates a repository error result', async () => {
    const repo = mockRepo();
    repo.verifyItem.mockResolvedValueOnce({
      ok: false,
      error: { code: 'KNOWLEDGE_REPOSITORY_ERROR', message: 'boom' },
    });
    const svc = createKnowledgeService({ repository: repo });

    const res = await svc.verifyItem({
      businessId: BIZ_A,
      itemId: fakeUuid(9),
      verifiedByUserId: VERIFIER,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('KNOWLEDGE_REPOSITORY_ERROR');
  });
});

// ===========================================================================
// Security / scope guards (static meta tests)
//
// B-R2 stores data only: no AI provider, no ai-runtime, no prompt builder /
// context assembler, no customer/conversation/message read path, no auto-send,
// and no new dependency. These guards fail CI if a future change crosses those
// boundaries.
// ===========================================================================

describe('Knowledge — scope guards (no AI runtime / provider / PII / send)', () => {
  const domainFiles = [
    'src/domains/knowledge/types.ts',
    'src/domains/knowledge/service.ts',
    'src/domains/knowledge/repository.ts',
    'src/domains/knowledge/implementation.ts',
    'src/domains/knowledge/index.ts',
  ];

  /** Import specifiers (the path in `from '...'`) for a source file. */
  function importPaths(src: string): string[] {
    return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  }

  /** Allowlisted import paths — anything else is a scope violation. */
  const ALLOWED_IMPORTS = new Set([
    'zod',
    '@/lib/result',
    './types',
    './service',
    './repository',
    './implementation',
  ]);

  it.each(domainFiles)('%s imports no LLM/provider SDK', (rel) => {
    const src = fs.readFileSync(path.resolve(rel), 'utf8');
    expect(src).not.toMatch(
      /openai|anthropic|@anthropic-ai|@google|gemini|cohere|mistral|llama/i,
    );
    expect(src).not.toMatch(/require\(['"](?:openai|anthropic|@google-ai)/);
  });

  it.each(domainFiles)('%s does not import ai-runtime or other domains', (rel) => {
    const src = fs.readFileSync(path.resolve(rel), 'utf8');
    for (const imp of importPaths(src)) {
      expect(imp).not.toMatch(/ai-runtime/);
      expect(imp).not.toMatch(
        /domains\/(crm|conversations|reply-drafts|ai-config|cases|orders|reservations)/,
      );
    }
  });

  it.each(domainFiles)('%s only uses allowlisted imports (no new deps)', (rel) => {
    const src = fs.readFileSync(path.resolve(rel), 'utf8');
    for (const imp of importPaths(src)) {
      expect(ALLOWED_IMPORTS.has(imp)).toBe(true);
    }
  });

  it.each(domainFiles)('%s has no prompt builder / context assembler', (rel) => {
    const src = fs.readFileSync(path.resolve(rel), 'utf8');
    for (const imp of importPaths(src)) {
      expect(imp).not.toMatch(/prompt|assembler|provider|llm/i);
    }
  });

  it.each(domainFiles)(
    '%s has no customer/conversation/message read path or auto-send',
    (rel) => {
      const src = fs.readFileSync(path.resolve(rel), 'utf8');
      // Delegate-style access to other tenant data tables must not appear.
      expect(src).not.toMatch(/\b(db|prisma)\.(customer|conversation|message|replyDraft)\b/);
      // No send/dispatch path.
      expect(src).not.toMatch(/\b(sendMessage|autoSend|dispatch|deliver)\s*\(/);
    },
  );

  it('the only third-party import across the domain is zod', () => {
    const allImports = domainFiles.flatMap((rel) =>
      importPaths(fs.readFileSync(path.resolve(rel), 'utf8')),
    );
    const thirdParty = allImports.filter(
      (imp) => !imp.startsWith('.') && !imp.startsWith('@/'),
    );
    expect([...new Set(thirdParty)]).toEqual(['zod']);
  });
});
