// ===========================================================================
// Integration Tests — Channels Tenant Isolation (Area C, P12-B)
//
// Runs against a real local PostgreSQL database. Gated by
// RUN_INTEGRATION_TESTS=true and requires a localhost DATABASE_URL. Normal
// `pnpm test` skips these cleanly (parity with the Area A/B isolation gates).
//
// Proves against real Postgres:
//  - a binding/key created for business A never resolves to or lists under
//    business B;
//  - cross-tenant findBindingById returns nothing (composite-key scoped);
//  - a REVOKED binding never resolves (fail closed);
//  - the persisted row stores the keyed hash only (no plaintext key column);
//  - rotation is immediate (the rotated-away key no longer resolves).
// ===========================================================================

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';

import {
  createChannelsRepository,
  type ChannelsRepositoryDb,
} from '../../src/domains/channels';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeIntegration = integrationEnabled ? describe : describe.skip;

function assertLocalDatabase(url: string): void {
  const lower = url.toLowerCase();
  if (!lower.includes('localhost') && !lower.includes('127.0.0.1')) {
    throw new Error(
      'Integration tests require a local DATABASE_URL (localhost or 127.0.0.1). ' +
        'Refusing to run destructive cleanup against a remote database.',
    );
  }
}

async function cleanDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.webChatChannelBinding.deleteMany();
  await prisma.businessMembership.deleteMany();
  await prisma.business.deleteMany();
  await prisma.user.deleteMany();
}

function channelsDb(prisma: PrismaClient): ChannelsRepositoryDb {
  return prisma as unknown as ChannelsRepositoryDb;
}

describeIntegration('Channels tenant isolation integration', () => {
  let prisma: PrismaClient;
  let bizA: string;
  let bizB: string;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL is required when RUN_INTEGRATION_TESTS=true (local Postgres).',
      );
    }
    assertLocalDatabase(databaseUrl);
    const adapter = new PrismaPg(databaseUrl);
    prisma = new PrismaClient({ adapter });
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

  async function seedTwoBusinesses(): Promise<{
    userId: string;
    bizA: string;
    bizB: string;
  }> {
    const user = await prisma.user.create({
      data: { email: `u-${randomUUID()}@test.local`, name: 'Owner' },
    });
    const a = await prisma.business.create({
      data: {
        name: 'Biz A',
        slug: `a-${randomUUID()}`,
        createdByUserId: user.id,
      },
    });
    const b = await prisma.business.create({
      data: {
        name: 'Biz B',
        slug: `b-${randomUUID()}`,
        createdByUserId: user.id,
      },
    });
    bizA = a.id;
    bizB = b.id;
    return { userId: user.id, bizA: a.id, bizB: b.id };
  }

  it('a binding for A never resolves to or lists under B; stores hash only', async () => {
    await seedTwoBusinesses();
    const repo = createChannelsRepository(channelsDb(prisma));

    const created = await repo.createBinding({
      businessId: bizA,
      label: 'A widget',
      allowedOrigins: ['https://a.example.com'],
      widgetKeyHash: `hash-A-${randomUUID()}`,
      widgetKeyLast4: 'aaaa',
      createdByUserId: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const hashA = (await prisma.webChatChannelBinding.findFirst({
      where: { businessId: bizA },
    }))!.widgetKeyHash;

    // Lists are tenant-scoped.
    const listA = await repo.listBindings(bizA);
    const listB = await repo.listBindings(bizB);
    expect(listA.ok && listA.data).toHaveLength(1);
    expect(listB.ok && listB.data).toHaveLength(0);

    // Cross-tenant find returns nothing.
    const crossFind = await repo.findBindingById(created.data.id, bizB);
    expect(crossFind.ok).toBe(true);
    if (crossFind.ok) expect(crossFind.data).toBeNull();

    // Resolve yields ONLY A's scope; the DTO/persisted column carries no plaintext.
    const resolved = await repo.resolveActiveByKeyHash(hashA);
    expect(resolved.ok && resolved.data?.businessId).toBe(bizA);
    expect(created.data).not.toHaveProperty('widgetKeyHash');
  });

  it('a revoked binding never resolves (fail closed)', async () => {
    const { userId } = await seedTwoBusinesses();
    const repo = createChannelsRepository(channelsDb(prisma));
    const hash = `hash-rev-${randomUUID()}`;
    const created = await repo.createBinding({
      businessId: bizA,
      label: 'A widget',
      allowedOrigins: ['https://a.example.com'],
      widgetKeyHash: hash,
      widgetKeyLast4: 'aaaa',
    });
    if (!created.ok) throw new Error('seed failed');

    // Revocation is stamped with a real authorized actor (the seeded user).
    const revoked = await repo.revokeBinding(created.data.id, bizA, userId);
    expect(revoked.ok).toBe(true);
    if (revoked.ok) expect(revoked.data.revokedByUserId).toBe(userId);
    const resolved = await repo.resolveActiveByKeyHash(hash);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.data).toBeNull();
  });

  it('rotation is immediate — the rotated-away key no longer resolves', async () => {
    await seedTwoBusinesses();
    const repo = createChannelsRepository(channelsDb(prisma));
    const oldHash = `old-${randomUUID()}`;
    const newHash = `new-${randomUUID()}`;
    const created = await repo.createBinding({
      businessId: bizA,
      label: 'A widget',
      allowedOrigins: ['https://a.example.com'],
      widgetKeyHash: oldHash,
      widgetKeyLast4: 'old4',
    });
    if (!created.ok) throw new Error('seed failed');

    await repo.rotateKey(created.data.id, bizA, newHash, 'new4');

    const byOld = await repo.resolveActiveByKeyHash(oldHash);
    expect(byOld.ok && byOld.data).toBeNull();
    const byNew = await repo.resolveActiveByKeyHash(newHash);
    expect(byNew.ok && byNew.data?.businessId).toBe(bizA);
  });
});
