// ===========================================================================
// Tests — Channels Service (Area C, P12-B)
//
// Proves:
//  - the raw widget key is returned EXACTLY ONCE (create/rotate) and never
//    persisted, re-returned (list/find), or carried by the read DTO/audit;
//  - hashing + key generation are INJECTED (not module-load); a fail-closed
//    hasher surfaces as CHANNELS_KEY_GENERATION_FAILED, never an unhandled throw;
//  - the persisted column is the hash only (no plaintext);
//  - content-free audit is emitted on create/rotate/revoke with no secret/hash/
//    raw-key/pepper in the metadata;
//  - error codes propagate.
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';

import {
  createChannelsService,
  createChannelsRepository,
  type ChannelsRepositoryDb,
  type WebChatChannelBindingRecord,
  type WidgetKeyGenerator,
  type WidgetKeyHasher,
} from '@/domains/channels';
import type { AuditService } from '@/domains/audit/service';

const BIZ = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';

const RAW_KEY = 'RAW-WIDGET-KEY-SECRET-do-not-leak';
const PEPPER = 'PEPPER-SECRET-do-not-leak';

// ---------------------------------------------------------------------------
// Injected fakes
// ---------------------------------------------------------------------------

function fakeKeyGen(raw = RAW_KEY): WidgetKeyGenerator {
  return { generate: () => ({ rawKey: raw, last4: raw.slice(-4) }) };
}

/** A deterministic peppered hasher — proves the hash is derived, not stored raw. */
function fakeHasher(): WidgetKeyHasher {
  return { hash: (raw: string) => `hashed(${raw})+${PEPPER}` };
}

/** A fail-closed hasher modeling an unconfigured pepper in production. */
function failClosedHasher(): WidgetKeyHasher {
  return {
    hash: () => {
      throw new Error('WIDGET_KEY_PEPPER not configured (fail closed)');
    },
  };
}

function createFakeDb(seed: WebChatChannelBindingRecord[] = []): ChannelsRepositoryDb & {
  rows: WebChatChannelBindingRecord[];
} {
  const rows = seed.map((r) => ({ ...r }));
  let clock = 1_700_000_000_000;
  const tick = () => new Date((clock += 1000));
  let idn = 0;
  // Valid UUIDs — the service validates bindingId with z.string().uuid().
  const nextId = () =>
    `aaaaaaaa-aaaa-4aaa-8aaa-${(++idn).toString().padStart(12, '0')}`;
  return {
    rows,
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
          const f = rows.find((r) => r.widgetKeyHash === where.widgetKeyHash);
          return f ? { ...f } : null;
        }
        const { id, businessId } = where.id_businessId;
        const f = rows.find((r) => r.id === id && r.businessId === businessId);
        return f ? { ...f } : null;
      },
      async findMany({ where, take }) {
        return rows
          .filter((r) => r.businessId === where.businessId)
          .slice(0, take)
          .map((r) => ({ ...r }));
      },
      async update({ where, data }) {
        const { id, businessId } = where.id_businessId;
        const idx = rows.findIndex(
          (r) => r.id === id && r.businessId === businessId,
        );
        if (idx === -1) throw new Error('not found');
        rows[idx] = { ...rows[idx], ...data, updatedAt: tick() } as WebChatChannelBindingRecord;
        return { ...rows[idx] };
      },
    },
  };
}

function auditSpy(): Pick<AuditService, 'createAuditEvent'> & {
  events: Array<Record<string, unknown>>;
} {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    createAuditEvent: vi.fn(async (input: Record<string, unknown>) => {
      events.push(input);
      return { ok: true as const, data: { id: 'audit-1' } };
    }) as unknown as AuditService['createAuditEvent'],
  };
}

function makeService(
  opts: {
    db?: ReturnType<typeof createFakeDb>;
    hasher?: WidgetKeyHasher;
    audit?: ReturnType<typeof auditSpy>;
  } = {},
) {
  const db = opts.db ?? createFakeDb();
  const audit = opts.audit ?? auditSpy();
  const service = createChannelsService({
    repository: createChannelsRepository(db),
    audit,
    keyGenerator: fakeKeyGen(),
    hasher: opts.hasher ?? fakeHasher(),
  });
  return { service, db, audit };
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('ChannelsService.createWebChatBinding', () => {
  it('returns the raw key ONCE, persists only the hash, leaks no secret in DTO/audit', async () => {
    const { service, db, audit } = makeService();

    const res = await service.createWebChatBinding({
      businessId: BIZ,
      label: 'Main',
      allowedOrigins: ['https://example.com'],
      createdByUserId: USER,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Raw key surfaced exactly once, here.
    expect(res.data.rawWidgetKey).toBe(RAW_KEY);
    // The DTO carries no hash / raw key / pepper.
    const dto = JSON.stringify(res.data.binding);
    expect(dto).not.toContain(RAW_KEY);
    expect(dto).not.toContain(PEPPER);
    expect(dto).not.toContain('hashed(');
    expect(res.data.binding).not.toHaveProperty('widgetKeyHash');
    expect(res.data.binding.widgetKeyLast4).toBe(RAW_KEY.slice(-4));

    // Persisted column is the derived hash, never the plaintext.
    expect(db.rows[0].widgetKeyHash).toBe(`hashed(${RAW_KEY})+${PEPPER}`);
    expect(db.rows[0]).not.toHaveProperty('rawKey');

    // Audit is content-free: no raw key / hash / pepper anywhere in metadata.
    expect(audit.createAuditEvent).toHaveBeenCalledTimes(1);
    const ev = JSON.stringify(audit.events[0]);
    expect(ev).not.toContain(RAW_KEY);
    expect(ev).not.toContain(PEPPER);
    expect(ev).not.toContain('hashed(');
    expect(audit.events[0].action).toBe('channel.web_chat_binding.created');
    expect(audit.events[0].actorUserId).toBe(USER);
  });

  it('fails closed (CHANNELS_KEY_GENERATION_FAILED) when the hasher throws — no row written', async () => {
    const { service, db } = makeService({ hasher: failClosedHasher() });
    const res = await service.createWebChatBinding({
      businessId: BIZ,
      label: 'Main',
      allowedOrigins: ['https://example.com'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CHANNELS_KEY_GENERATION_FAILED');
    expect(db.rows).toHaveLength(0);
  });

  it('rejects invalid input (INVALID_CHANNELS_INPUT)', async () => {
    const { service } = makeService();
    const res = await service.createWebChatBinding({
      businessId: 'not-a-uuid',
      label: '',
      allowedOrigins: ['https://example.com/path'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_CHANNELS_INPUT');
  });
});

// ---------------------------------------------------------------------------
// list / find never re-surface the key
// ---------------------------------------------------------------------------

describe('ChannelsService list/find never re-surface secret material', () => {
  it('list + find return DTOs without hash/raw key', async () => {
    const { service, db } = makeService();
    const created = await service.createWebChatBinding({
      businessId: BIZ,
      label: 'Main',
      allowedOrigins: ['https://example.com'],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data.binding.id;

    const list = await service.listWebChatBindings({ businessId: BIZ });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(JSON.stringify(list.data)).not.toContain(RAW_KEY);
      expect(list.data[0]).not.toHaveProperty('widgetKeyHash');
      expect(list.data[0]).not.toHaveProperty('rawWidgetKey');
    }

    const found = await service.findWebChatBinding({ businessId: BIZ, bindingId: id });
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.data).not.toHaveProperty('widgetKeyHash');
      expect(found.data).not.toHaveProperty('rawWidgetKey');
    }
    // The stored hash is still present in the row (only the DTO drops it).
    expect(db.rows[0].widgetKeyHash).toContain('hashed(');
  });

  it('findWebChatBinding returns NOT_FOUND for an unknown id', async () => {
    const { service } = makeService();
    const res = await service.findWebChatBinding({
      businessId: BIZ,
      bindingId: '99999999-9999-4999-8999-999999999999',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CHANNELS_BINDING_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// rotate / revoke
// ---------------------------------------------------------------------------

describe('ChannelsService.rotateWebChatBindingKey', () => {
  it('returns a NEW raw key once and emits a content-free rotate audit', async () => {
    const { service, audit } = makeService();
    const created = await service.createWebChatBinding({
      businessId: BIZ,
      label: 'Main',
      allowedOrigins: ['https://example.com'],
    });
    if (!created.ok) throw new Error('setup failed');

    const rotated = await service.rotateWebChatBindingKey({
      businessId: BIZ,
      bindingId: created.data.binding.id,
    });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.data.rawWidgetKey).toBe(RAW_KEY);
    expect(rotated.data.binding.keyRotatedAt).not.toBeNull();

    const rotateEvent = audit.events.find(
      (e) => e.action === 'channel.web_chat_binding.key_rotated',
    );
    expect(rotateEvent).toBeDefined();
    expect(JSON.stringify(rotateEvent)).not.toContain(RAW_KEY);
  });
});

describe('ChannelsService.revokeWebChatBinding', () => {
  it('revokes and emits a content-free revoke audit with the actor', async () => {
    const { service, audit } = makeService();
    const created = await service.createWebChatBinding({
      businessId: BIZ,
      label: 'Main',
      allowedOrigins: ['https://example.com'],
    });
    if (!created.ok) throw new Error('setup failed');

    const revoked = await service.revokeWebChatBinding({
      businessId: BIZ,
      bindingId: created.data.binding.id,
      revokedByUserId: USER,
    });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.data.status).toBe('REVOKED');

    const ev = audit.events.find(
      (e) => e.action === 'channel.web_chat_binding.revoked',
    );
    expect(ev).toBeDefined();
    expect(ev?.actorUserId).toBe(USER);
  });

  it('a successful operation is not blocked by an audit failure (best-effort)', async () => {
    const failingAudit = {
      events: [] as Array<Record<string, unknown>>,
      createAuditEvent: vi.fn(async () => {
        throw new Error('audit down');
      }) as unknown as AuditService['createAuditEvent'],
    };
    const { service } = makeService({ audit: failingAudit as never });
    const res = await service.createWebChatBinding({
      businessId: BIZ,
      label: 'Main',
      allowedOrigins: ['https://example.com'],
    });
    expect(res.ok).toBe(true);
  });
});
