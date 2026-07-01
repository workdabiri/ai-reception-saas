// ===========================================================================
// Tests — Channels Repository (Area C, P12-B)
//
// Prisma-`where`-faithful in-memory fake. Proves:
//  - every query is businessId-scoped (composite unique for single-row ops);
//  - create persists the keyed hash (no plaintext column exists);
//  - resolveActiveByKeyHash returns ACTIVE matches and FAILS CLOSED for
//    REVOKED/missing, returning only { id, businessId };
//  - cross-tenant findBindingById returns nothing;
//  - rotation is IMMEDIATE (the rotated-away hash no longer resolves);
//  - revoke is terminal; the read DTO never exposes widgetKeyHash.
// ===========================================================================

import { describe, it, expect } from 'vitest';

import {
  createChannelsRepository,
  type ChannelsRepositoryDb,
  type WebChatChannelBindingRecord,
} from '@/domains/channels';

const BIZ_A = '11111111-1111-4111-8111-111111111111';
const BIZ_B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

// ---------------------------------------------------------------------------
// Prisma-where-faithful in-memory fake (honors id_businessId + widgetKeyHash)
// ---------------------------------------------------------------------------

interface Fake extends ChannelsRepositoryDb {
  rows: WebChatChannelBindingRecord[];
  calls: { findManyWhere: unknown[] };
}

function createFakeDb(seed: WebChatChannelBindingRecord[] = []): Fake {
  const rows = seed.map((r) => ({ ...r }));
  const calls = { findManyWhere: [] as unknown[] };
  let clock = 1_700_000_000_000;
  const tick = () => new Date((clock += 1000));
  let idn = 0;
  const nextId = () => `aaaaaaaa-aaaa-4aaa-8aaa-${(++idn).toString().padStart(12, '0')}`;

  return {
    rows,
    calls,
    webChatChannelBinding: {
      async create({ data }) {
        const now = tick();
        const rec: WebChatChannelBindingRecord = {
          id: nextId(),
          businessId: data.businessId,
          label: data.label,
          status: data.status,
          widgetKeyHash: data.widgetKeyHash,
          widgetKeyLast4: data.widgetKeyLast4,
          keyRotatedAt: null,
          allowedOrigins: data.allowedOrigins,
          revokedAt: null,
          revokedByUserId: null,
          createdByUserId: data.createdByUserId ?? null,
          createdAt: now,
          updatedAt: now,
        };
        rows.push(rec);
        return { ...rec };
      },
      async findUnique({ where }) {
        if ('widgetKeyHash' in where) {
          const found = rows.find((r) => r.widgetKeyHash === where.widgetKeyHash);
          return found ? { ...found } : null;
        }
        const { id, businessId } = where.id_businessId;
        const found = rows.find((r) => r.id === id && r.businessId === businessId);
        return found ? { ...found } : null;
      },
      async findMany({ where, take }) {
        calls.findManyWhere.push(where);
        return rows
          .filter((r) => r.businessId === where.businessId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take)
          .map((r) => ({ ...r }));
      },
      async update({ where, data }) {
        const { id, businessId } = where.id_businessId;
        const idx = rows.findIndex(
          (r) => r.id === id && r.businessId === businessId,
        );
        if (idx === -1) throw new Error('record not found');
        rows[idx] = { ...rows[idx], ...data, updatedAt: tick() } as WebChatChannelBindingRecord;
        return { ...rows[idx] };
      },
    },
  };
}

function activeRecord(
  overrides: Partial<WebChatChannelBindingRecord> = {},
): WebChatChannelBindingRecord {
  const now = new Date('2026-06-30T10:00:00.000Z');
  return {
    id: 'fixed-id-0000-0000-000000000001',
    businessId: BIZ_A,
    label: 'Main',
    status: 'ACTIVE',
    widgetKeyHash: 'hash-A',
    widgetKeyLast4: 'wxyz',
    keyRotatedAt: null,
    allowedOrigins: ['https://example.com'],
    revokedAt: null,
    revokedByUserId: null,
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createBinding
// ---------------------------------------------------------------------------

describe('ChannelsRepository.createBinding', () => {
  it('persists the keyed hash + last4 and returns a DTO without the hash', async () => {
    const db = createFakeDb();
    const repo = createChannelsRepository(db);

    const res = await repo.createBinding({
      businessId: BIZ_A,
      label: 'Main',
      allowedOrigins: ['https://example.com'],
      widgetKeyHash: 'hash-A',
      widgetKeyLast4: 'wxyz',
      createdByUserId: USER,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The stored row carries the hash...
    expect(db.rows[0].widgetKeyHash).toBe('hash-A');
    // ...but the DTO never does.
    expect(res.data).not.toHaveProperty('widgetKeyHash');
    expect(res.data.widgetKeyLast4).toBe('wxyz');
    expect(res.data.status).toBe('ACTIVE');
    expect(JSON.stringify(res.data)).not.toContain('hash-A');
  });
});

// ---------------------------------------------------------------------------
// listBindings — businessId-scoped
// ---------------------------------------------------------------------------

describe('ChannelsRepository.listBindings', () => {
  it('filters strictly by businessId', async () => {
    const db = createFakeDb([
      activeRecord({ id: 'a1', businessId: BIZ_A, widgetKeyHash: 'h1' }),
      activeRecord({ id: 'b1', businessId: BIZ_B, widgetKeyHash: 'h2' }),
    ]);
    const repo = createChannelsRepository(db);

    const res = await repo.listBindings(BIZ_A);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toHaveLength(1);
    expect(res.data[0].businessId).toBe(BIZ_A);
    expect(db.calls.findManyWhere[0]).toEqual({ businessId: BIZ_A });
  });
});

// ---------------------------------------------------------------------------
// findBindingById — cross-tenant returns nothing
// ---------------------------------------------------------------------------

describe('ChannelsRepository.findBindingById', () => {
  it('returns the binding for the owning business', async () => {
    const db = createFakeDb([activeRecord({ id: 'a1' })]);
    const repo = createChannelsRepository(db);
    const res = await repo.findBindingById('a1', BIZ_A);
    expect(res.ok && res.data?.id).toBe('a1');
  });

  it('returns null for another tenant (composite-key scoped)', async () => {
    const db = createFakeDb([activeRecord({ id: 'a1', businessId: BIZ_A })]);
    const repo = createChannelsRepository(db);
    const res = await repo.findBindingById('a1', BIZ_B);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveActiveByKeyHash — ACTIVE-only, fail-closed, scope-only return
// ---------------------------------------------------------------------------

describe('ChannelsRepository.resolveActiveByKeyHash', () => {
  it('resolves an ACTIVE binding to ONLY { id, businessId }', async () => {
    const db = createFakeDb([
      activeRecord({ id: 'a1', businessId: BIZ_A, widgetKeyHash: 'hash-A' }),
    ]);
    const repo = createChannelsRepository(db);
    const res = await repo.resolveActiveByKeyHash('hash-A');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({ id: 'a1', businessId: BIZ_A });
    // No row fields leak (no hash, no label, no origins).
    expect(Object.keys(res.data ?? {}).sort()).toEqual(['businessId', 'id']);
  });

  it('fails closed for a REVOKED binding (returns null)', async () => {
    const db = createFakeDb([
      activeRecord({
        id: 'a1',
        status: 'REVOKED',
        widgetKeyHash: 'hash-revoked',
        revokedAt: new Date(),
      }),
    ]);
    const repo = createChannelsRepository(db);
    const res = await repo.resolveActiveByKeyHash('hash-revoked');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBeNull();
  });

  it('fails closed for a missing hash (returns null)', async () => {
    const repo = createChannelsRepository(createFakeDb());
    const res = await repo.resolveActiveByKeyHash('nope');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rotateKey — immediate (old hash no longer resolves)
// ---------------------------------------------------------------------------

describe('ChannelsRepository.rotateKey', () => {
  it('replaces the hash immediately — the old hash no longer resolves', async () => {
    const db = createFakeDb([
      activeRecord({ id: 'a1', businessId: BIZ_A, widgetKeyHash: 'old-hash' }),
    ]);
    const repo = createChannelsRepository(db);

    const rotated = await repo.rotateKey('a1', BIZ_A, 'new-hash', 'new4');
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.data.widgetKeyLast4).toBe('new4');
    expect(rotated.data.keyRotatedAt).not.toBeNull();

    // Old key is invalid at once; only the new hash resolves.
    expect((await repo.resolveActiveByKeyHash('old-hash')).ok).toBe(true);
    expect(
      ((await repo.resolveActiveByKeyHash('old-hash')) as { data: unknown }).data,
    ).toBeNull();
    const byNew = await repo.resolveActiveByKeyHash('new-hash');
    expect(byNew.ok && byNew.data?.id).toBe('a1');
  });

  it('rejects rotation of a missing binding', async () => {
    const repo = createChannelsRepository(createFakeDb());
    const res = await repo.rotateKey('missing', BIZ_A, 'h', '1234');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CHANNELS_BINDING_NOT_FOUND');
  });

  it('rejects rotation of a REVOKED binding (terminal)', async () => {
    const db = createFakeDb([
      activeRecord({ id: 'a1', status: 'REVOKED', widgetKeyHash: 'h' }),
    ]);
    const repo = createChannelsRepository(db);
    const res = await repo.rotateKey('a1', BIZ_A, 'h2', '1234');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CHANNELS_BINDING_REVOKED');
  });

  it('cannot rotate another tenant’s binding', async () => {
    const db = createFakeDb([activeRecord({ id: 'a1', businessId: BIZ_A })]);
    const repo = createChannelsRepository(db);
    const res = await repo.rotateKey('a1', BIZ_B, 'h2', '1234');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CHANNELS_BINDING_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// revokeBinding — terminal
// ---------------------------------------------------------------------------

describe('ChannelsRepository.revokeBinding', () => {
  it('revokes an ACTIVE binding and stamps provenance', async () => {
    const db = createFakeDb([
      activeRecord({ id: 'a1', businessId: BIZ_A, widgetKeyHash: 'h' }),
    ]);
    const repo = createChannelsRepository(db);
    const res = await repo.revokeBinding('a1', BIZ_A, USER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.status).toBe('REVOKED');
    expect(res.data.revokedByUserId).toBe(USER);
    expect(res.data.revokedAt).not.toBeNull();
    // Now it no longer resolves.
    const r = await repo.resolveActiveByKeyHash('h');
    expect(r.ok && r.data).toBeNull();
  });

  it('rejects re-revoking a REVOKED binding (terminal)', async () => {
    const db = createFakeDb([
      activeRecord({ id: 'a1', status: 'REVOKED', widgetKeyHash: 'h' }),
    ]);
    const repo = createChannelsRepository(db);
    const res = await repo.revokeBinding('a1', BIZ_A, USER);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CHANNELS_BINDING_REVOKED');
  });

  it('cannot revoke another tenant’s binding', async () => {
    const db = createFakeDb([activeRecord({ id: 'a1', businessId: BIZ_A })]);
    const repo = createChannelsRepository(db);
    const res = await repo.revokeBinding('a1', BIZ_B, USER);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CHANNELS_BINDING_NOT_FOUND');
  });
});
