// ===========================================================================
// Integration Tests — Tenant Identity Repositories
//
// Runs against a real local PostgreSQL database.
// Gated by RUN_INTEGRATION_TESTS=true and requires DATABASE_URL.
// Normal `pnpm test` skips these tests cleanly.
// ===========================================================================

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';

import { createIdentityRepository } from '../../src/domains/identity/repository';
import type { IdentityRepositoryDb } from '../../src/domains/identity/repository';
import { createTenancyRepository } from '../../src/domains/tenancy/repository';
import type { TenancyRepositoryDb } from '../../src/domains/tenancy/repository';
import { createAuditRepository } from '../../src/domains/audit/repository';
import type { AuditRepositoryDb } from '../../src/domains/audit/repository';
import { createApiDependencies } from '../../src/app/api/_shared/composition';
import type { PrismaCompatibleClient } from '../../src/app/api/_shared/composition.types';

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';

const describeIntegration = integrationEnabled ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Local-only safety guard
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
// ---------------------------------------------------------------------------

async function cleanDatabase(prisma: PrismaClient): Promise<void> {
  // FK-safe order: tenant-owned children first, then business, then user.
  await prisma.replyDraft.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.customerContactMethod.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.session.deleteMany();
  await prisma.businessMembership.deleteMany();
  await prisma.business.deleteMany();
  await prisma.user.deleteMany();
}

// ---------------------------------------------------------------------------
// DB type adapters
//
// PrismaClient's delegate generics are more complex than the simplified
// RepositoryDb interfaces. These adapters provide a type-safe bridge.
// ---------------------------------------------------------------------------

function identityDb(prisma: PrismaClient): IdentityRepositoryDb {
  return prisma as unknown as IdentityRepositoryDb;
}

function tenancyDb(prisma: PrismaClient): TenancyRepositoryDb {
  return prisma as unknown as TenancyRepositoryDb;
}

function auditDb(prisma: PrismaClient): AuditRepositoryDb {
  return prisma as unknown as AuditRepositoryDb;
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describeIntegration('Tenant identity repositories integration', () => {
  let prisma: PrismaClient;

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

  // =========================================================================
  // Identity Repository
  // =========================================================================

  describe('Identity Repository', () => {
    it('can create and read a user', async () => {
      const suffix = randomUUID();
      const repo = createIdentityRepository(identityDb(prisma));

      // Create user
      const createResult = await repo.createUser({
        email: `integration-${suffix}@example.com`,
        name: 'Integration User',
        locale: 'en',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const user = createResult.data;
      expect(user.id).toBeDefined();
      expect(user.email).toBe(`integration-${suffix}@example.com`);
      expect(user.name).toBe('Integration User');
      expect(user.locale).toBe('en');
      expect(user.status).toBe('ACTIVE');
      expect(user.avatarUrl).toBeNull();
      expect(typeof user.createdAt).toBe('string');
      expect(typeof user.updatedAt).toBe('string');
      // Verify ISO string format
      expect(() => new Date(user.createdAt).toISOString()).not.toThrow();

      // Find by ID
      const findByIdResult = await repo.findUserById({ userId: user.id });
      expect(findByIdResult.ok).toBe(true);
      if (findByIdResult.ok) {
        expect(findByIdResult.data).not.toBeNull();
        expect(findByIdResult.data?.id).toBe(user.id);
      }

      // Find by email
      const findByEmailResult = await repo.findUserByEmail({
        email: `integration-${suffix}@example.com`,
      });
      expect(findByEmailResult.ok).toBe(true);
      if (findByEmailResult.ok) {
        expect(findByEmailResult.data).not.toBeNull();
        expect(findByEmailResult.data?.email).toBe(user.email);
      }
    });

    it('can create, list, find, and revoke a session', async () => {
      const suffix = randomUUID();
      const repo = createIdentityRepository(identityDb(prisma));

      // Create user first
      const userResult = await repo.createUser({
        email: `session-${suffix}@example.com`,
        name: 'Session User',
        locale: 'en',
      });
      expect(userResult.ok).toBe(true);
      if (!userResult.ok) return;
      const user = userResult.data;

      // Create session
      const tokenHash = `integration-token-${suffix}`.padEnd(32, '0');
      const expiresAt = new Date(Date.now() + 86400000).toISOString();

      const sessionResult = await repo.createSession({
        userId: user.id,
        tokenHash,
        expiresAt,
        ipAddress: '127.0.0.1',
        userAgent: 'IntegrationTest',
      });
      expect(sessionResult.ok).toBe(true);
      if (!sessionResult.ok) return;
      const session = sessionResult.data;

      expect(session.id).toBeDefined();
      expect(session.userId).toBe(user.id);
      expect(session.tokenHash).toBe(tokenHash);
      expect(session.revokedAt).toBeNull();
      expect(typeof session.expiresAt).toBe('string');
      expect(typeof session.createdAt).toBe('string');

      // Find by ID
      const findResult = await repo.findSessionById({ sessionId: session.id });
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data?.id).toBe(session.id);
      }

      // Find by tokenHash
      const findByHashResult = await repo.findSessionByTokenHash({ tokenHash });
      expect(findByHashResult.ok).toBe(true);
      if (findByHashResult.ok) {
        expect(findByHashResult.data).not.toBeNull();
        expect(findByHashResult.data?.tokenHash).toBe(tokenHash);
      }

      // List sessions
      const listResult = await repo.listUserSessions({ userId: user.id });
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.data.length).toBeGreaterThanOrEqual(1);
        expect(listResult.data[0].id).toBe(session.id);
      }

      // Revoke session
      const revokeResult = await repo.revokeSession({ sessionId: session.id });
      expect(revokeResult.ok).toBe(true);
      if (revokeResult.ok) {
        expect(revokeResult.data.revokedAt).not.toBeNull();
        expect(typeof revokeResult.data.revokedAt).toBe('string');
      }
    });
  });

  // =========================================================================
  // Tenancy Repository
  // =========================================================================

  describe('Tenancy Repository', () => {
    it('can create and read a business', async () => {
      const suffix = randomUUID();
      const identityRepo = createIdentityRepository(identityDb(prisma));
      const tenancyRepo = createTenancyRepository(tenancyDb(prisma));

      // Create user first
      const userResult = await identityRepo.createUser({
        email: `biz-owner-${suffix}@example.com`,
        name: 'Biz Owner',
        locale: 'en',
      });
      expect(userResult.ok).toBe(true);
      if (!userResult.ok) return;
      const user = userResult.data;

      // Create business
      const bizResult = await tenancyRepo.createBusiness({
        name: 'Integration Business',
        slug: `int-biz-${suffix}`.slice(0, 64),
        createdByUserId: user.id,
        timezone: 'Asia/Tehran',
        locale: 'fa',
      });
      expect(bizResult.ok).toBe(true);
      if (!bizResult.ok) return;
      const business = bizResult.data;

      expect(business.id).toBeDefined();
      expect(business.name).toBe('Integration Business');
      expect(business.slug).toBe(`int-biz-${suffix}`.slice(0, 64));
      expect(business.status).toBe('ACTIVE');
      expect(business.timezone).toBe('Asia/Tehran');
      expect(business.locale).toBe('fa');
      expect(business.createdByUserId).toBe(user.id);
      expect(typeof business.createdAt).toBe('string');
      expect(typeof business.updatedAt).toBe('string');

      // Find by ID
      const findByIdResult = await tenancyRepo.findBusinessById({
        businessId: business.id,
      });
      expect(findByIdResult.ok).toBe(true);
      if (findByIdResult.ok) {
        expect(findByIdResult.data).not.toBeNull();
        expect(findByIdResult.data?.id).toBe(business.id);
      }

      // Find by slug
      const findBySlugResult = await tenancyRepo.findBusinessBySlug({
        slug: business.slug,
      });
      expect(findBySlugResult.ok).toBe(true);
      if (findBySlugResult.ok) {
        expect(findBySlugResult.data).not.toBeNull();
        expect(findBySlugResult.data?.slug).toBe(business.slug);
      }

      // List user businesses (requires membership)
      await tenancyRepo.createMembership({
        businessId: business.id,
        userId: user.id,
        role: 'OWNER',
        status: 'ACTIVE',
      });

      const listResult = await tenancyRepo.listUserBusinesses({ userId: user.id });
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.data.length).toBeGreaterThanOrEqual(1);
        expect(listResult.data.some((b) => b.id === business.id)).toBe(true);
      }
    });

    it('can create membership and resolve tenant context', async () => {
      const suffix = randomUUID();
      const identityRepo = createIdentityRepository(identityDb(prisma));
      const tenancyRepo = createTenancyRepository(tenancyDb(prisma));

      // Create user
      const userResult = await identityRepo.createUser({
        email: `member-${suffix}@example.com`,
        name: 'Member User',
        locale: 'en',
      });
      expect(userResult.ok).toBe(true);
      if (!userResult.ok) return;
      const user = userResult.data;

      // Create business
      const bizResult = await tenancyRepo.createBusiness({
        name: 'Tenant Context Biz',
        slug: `ctx-biz-${suffix}`.slice(0, 64),
        createdByUserId: user.id,
        timezone: 'Asia/Tehran',
        locale: 'fa',
      });
      expect(bizResult.ok).toBe(true);
      if (!bizResult.ok) return;
      const business = bizResult.data;

      // Create active OWNER membership
      const memResult = await tenancyRepo.createMembership({
        businessId: business.id,
        userId: user.id,
        role: 'OWNER',
        status: 'ACTIVE',
      });
      expect(memResult.ok).toBe(true);
      if (!memResult.ok) return;
      const membership = memResult.data;

      // Find by userId/businessId
      const findResult = await tenancyRepo.findMembership({
        userId: user.id,
        businessId: business.id,
      });
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data?.id).toBe(membership.id);
      }

      // Find by id
      const findByIdResult = await tenancyRepo.findMembershipById({
        membershipId: membership.id,
      });
      expect(findByIdResult.ok).toBe(true);
      if (findByIdResult.ok) {
        expect(findByIdResult.data).not.toBeNull();
        expect(findByIdResult.data?.role).toBe('OWNER');
      }

      // Resolve tenant context
      const ctxResult = await tenancyRepo.resolveTenantContext({
        userId: user.id,
        businessId: business.id,
      });
      expect(ctxResult.ok).toBe(true);
      if (ctxResult.ok) {
        expect(ctxResult.data.userId).toBe(user.id);
        expect(ctxResult.data.businessId).toBe(business.id);
        expect(ctxResult.data.membershipId).toBe(membership.id);
        expect(ctxResult.data.role).toBe('OWNER');
      }
    });

    it('removeMembership sets status REMOVED and denies tenant context', async () => {
      const suffix = randomUUID();
      const identityRepo = createIdentityRepository(identityDb(prisma));
      const tenancyRepo = createTenancyRepository(tenancyDb(prisma));

      // Create user + business + active membership
      const userResult = await identityRepo.createUser({
        email: `remove-${suffix}@example.com`,
        name: 'Remove User',
        locale: 'en',
      });
      expect(userResult.ok).toBe(true);
      if (!userResult.ok) return;
      const user = userResult.data;

      const bizResult = await tenancyRepo.createBusiness({
        name: 'Remove Biz',
        slug: `rm-biz-${suffix}`.slice(0, 64),
        createdByUserId: user.id,
      });
      expect(bizResult.ok).toBe(true);
      if (!bizResult.ok) return;
      const business = bizResult.data;

      const memResult = await tenancyRepo.createMembership({
        businessId: business.id,
        userId: user.id,
        role: 'OWNER',
        status: 'ACTIVE',
      });
      expect(memResult.ok).toBe(true);
      if (!memResult.ok) return;
      const membership = memResult.data;

      // Remove membership
      const removeResult = await tenancyRepo.removeMembership({
        membershipId: membership.id,
        removedByUserId: user.id,
      });
      expect(removeResult.ok).toBe(true);
      if (removeResult.ok) {
        expect(removeResult.data.status).toBe('REMOVED');
      }

      // Resolve tenant context should deny
      const ctxResult = await tenancyRepo.resolveTenantContext({
        userId: user.id,
        businessId: business.id,
      });
      expect(ctxResult.ok).toBe(false);
      if (!ctxResult.ok) {
        expect(ctxResult.error.code).toBe('TENANT_ACCESS_DENIED');
      }
    });
  });

  // =========================================================================
  // Audit Repository
  // =========================================================================

  describe('Audit Repository', () => {
    it('can create, find, and list audit events', async () => {
      const suffix = randomUUID();
      const identityRepo = createIdentityRepository(identityDb(prisma));
      const tenancyRepo = createTenancyRepository(tenancyDb(prisma));
      const auditRepo = createAuditRepository(auditDb(prisma));

      // Setup: create user + business + membership
      const userResult = await identityRepo.createUser({
        email: `audit-${suffix}@example.com`,
        name: 'Audit User',
        locale: 'en',
      });
      expect(userResult.ok).toBe(true);
      if (!userResult.ok) return;
      const user = userResult.data;

      const bizResult = await tenancyRepo.createBusiness({
        name: 'Audit Business',
        slug: `audit-biz-${suffix}`.slice(0, 64),
        createdByUserId: user.id,
      });
      expect(bizResult.ok).toBe(true);
      if (!bizResult.ok) return;
      const business = bizResult.data;

      await tenancyRepo.createMembership({
        businessId: business.id,
        userId: user.id,
        role: 'OWNER',
        status: 'ACTIVE',
      });

      // Create audit event
      const auditResult = await auditRepo.createAuditEvent({
        businessId: business.id,
        actorType: 'USER',
        actorUserId: user.id,
        action: 'integration.test',
        targetType: 'business',
        targetId: business.id,
        result: 'SUCCESS',
        metadata: { source: 'integration-test' },
      });
      expect(auditResult.ok).toBe(true);
      if (!auditResult.ok) return;
      const auditEvent = auditResult.data;

      expect(auditEvent.id).toBeDefined();
      expect(auditEvent.businessId).toBe(business.id);
      expect(auditEvent.actorType).toBe('USER');
      expect(auditEvent.actorUserId).toBe(user.id);
      expect(auditEvent.action).toBe('integration.test');
      expect(auditEvent.targetType).toBe('business');
      expect(auditEvent.targetId).toBe(business.id);
      expect(auditEvent.result).toBe('SUCCESS');
      expect(auditEvent.metadata).toEqual({ source: 'integration-test' });
      expect(typeof auditEvent.createdAt).toBe('string');
      expect(() => new Date(auditEvent.createdAt).toISOString()).not.toThrow();

      // Find by ID
      const findResult = await auditRepo.findAuditEventById({
        auditEventId: auditEvent.id,
      });
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data?.id).toBe(auditEvent.id);
        expect(findResult.data?.metadata).toEqual({ source: 'integration-test' });
      }

      // List by businessId
      const listResult = await auditRepo.listAuditEvents({
        businessId: business.id,
      });
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.data.length).toBeGreaterThanOrEqual(1);
        expect(listResult.data.some((e) => e.id === auditEvent.id)).toBe(true);
      }
    });
  });

  // =========================================================================
  // Cross-Repository Flow
  // =========================================================================

  describe('Cross-Repository Flow', () => {
    it('full tenant identity audit flow works end-to-end', async () => {
      const suffix = randomUUID();
      const identityRepo = createIdentityRepository(identityDb(prisma));
      const tenancyRepo = createTenancyRepository(tenancyDb(prisma));
      const auditRepo = createAuditRepository(auditDb(prisma));

      // 1. Create user
      const userResult = await identityRepo.createUser({
        email: `e2e-${suffix}@example.com`,
        name: 'E2E User',
        locale: 'en',
      });
      expect(userResult.ok).toBe(true);
      if (!userResult.ok) return;
      const user = userResult.data;

      // 2. Create business
      const bizResult = await tenancyRepo.createBusiness({
        name: 'E2E Business',
        slug: `e2e-biz-${suffix}`.slice(0, 64),
        createdByUserId: user.id,
        timezone: 'Asia/Tehran',
        locale: 'fa',
      });
      expect(bizResult.ok).toBe(true);
      if (!bizResult.ok) return;
      const business = bizResult.data;

      // 3. Create membership
      const memResult = await tenancyRepo.createMembership({
        businessId: business.id,
        userId: user.id,
        role: 'OWNER',
        status: 'ACTIVE',
      });
      expect(memResult.ok).toBe(true);
      if (!memResult.ok) return;
      const membership = memResult.data;

      // 4. Resolve tenant context
      const ctxResult = await tenancyRepo.resolveTenantContext({
        userId: user.id,
        businessId: business.id,
      });
      expect(ctxResult.ok).toBe(true);
      if (!ctxResult.ok) return;
      expect(ctxResult.data.userId).toBe(user.id);
      expect(ctxResult.data.businessId).toBe(business.id);
      expect(ctxResult.data.membershipId).toBe(membership.id);
      expect(ctxResult.data.role).toBe('OWNER');

      // 5. Create session
      const tokenHash = `e2e-token-${suffix}`.padEnd(32, '0');
      const sessionResult = await identityRepo.createSession({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(sessionResult.ok).toBe(true);
      if (!sessionResult.ok) return;
      const session = sessionResult.data;
      expect(session.userId).toBe(user.id);

      // 6. Create audit event
      const auditResult = await auditRepo.createAuditEvent({
        businessId: business.id,
        actorType: 'USER',
        actorUserId: user.id,
        action: 'e2e.flow.completed',
        targetType: 'business',
        targetId: business.id,
        result: 'SUCCESS',
        metadata: { sessionId: session.id, membershipId: membership.id },
      });
      expect(auditResult.ok).toBe(true);
      if (!auditResult.ok) return;

      // 7. Verify all IDs match
      expect(auditResult.data.businessId).toBe(business.id);
      expect(auditResult.data.actorUserId).toBe(user.id);
      expect(auditResult.data.targetId).toBe(business.id);
    });
  });

  // =========================================================================
  // Cross-Tenant Isolation (A-R1)
  //
  // PRD-v1.1 §9 hard gate: prove a Business A context cannot read, list,
  // mutate, or infer Business B data across the tenant-owned resources —
  // customers, conversations, messages, and reply drafts.
  //
  // Data is seeded through the real repositories (no audit side effects) and
  // assertions run against the production wiring from
  // createApiDependencies({ prisma }) — the same services + repositories the
  // API handlers use — plus the repository scoping primitives and the
  // Message composite FK (conversation_id, business_id).
  // =========================================================================

  describe('Cross-Tenant Isolation (A-R1)', () => {
    let deps: ReturnType<typeof createApiDependencies>;

    // Business A is the "intruder" context; Business B owns the protected data.
    let aUserId: string;
    let aBusinessId: string;
    let aCustomerId: string;
    let aConversationId: string;
    let aDraftId: string;

    let bUserId: string;
    let bBusinessId: string;
    let bCustomerId: string;
    let bContactMethodId: string;
    let bConversationId: string;
    let bMessageId: string;
    let bDraftId: string;

    beforeEach(async () => {
      deps = createApiDependencies({
        prisma: prisma as unknown as PrismaCompatibleClient,
      });
      const { identity, tenancy, crm, conversations, replyDrafts } =
        deps.repositories;
      const suffix = randomUUID();

      async function seedBusiness(label: string): Promise<{ userId: string; businessId: string }> {
        const userRes = await identity.createUser({
          email: `${label}-owner-${suffix}@example.com`,
          name: `${label} Owner`,
          locale: 'en',
        });
        if (!userRes.ok) throw new Error(`seed ${label} user failed`);
        const bizRes = await tenancy.createBusiness({
          name: `Business ${label}`,
          slug: `biz-${label}-${suffix}`.slice(0, 64),
          createdByUserId: userRes.data.id,
        });
        if (!bizRes.ok) throw new Error(`seed ${label} business failed`);
        const memRes = await tenancy.createMembership({
          businessId: bizRes.data.id,
          userId: userRes.data.id,
          role: 'OWNER',
          status: 'ACTIVE',
        });
        if (!memRes.ok) throw new Error(`seed ${label} membership failed`);
        return { userId: userRes.data.id, businessId: bizRes.data.id };
      }

      const a = await seedBusiness('a');
      aUserId = a.userId;
      aBusinessId = a.businessId;
      const b = await seedBusiness('b');
      bUserId = b.userId;
      bBusinessId = b.businessId;

      // Business A owns a customer, a conversation, and a reply draft (positive controls).
      const aCustomer = await crm.createCustomer({ businessId: aBusinessId, displayName: 'A Customer' });
      if (!aCustomer.ok) throw new Error('seed A customer failed');
      aCustomerId = aCustomer.data.id;
      const aConv = await conversations.createConversation({ businessId: aBusinessId, channel: 'INTERNAL' });
      if (!aConv.ok) throw new Error('seed A conversation failed');
      aConversationId = aConv.data.id;
      const aDraft = await replyDrafts.createSystemDraft({
        businessId: aBusinessId,
        conversationId: aConversationId,
        createdByUserId: aUserId,
        draftText: 'A private draft',
      });
      if (!aDraft.ok) throw new Error('seed A draft failed');
      aDraftId = aDraft.data.id;

      // Business B owns the protected rows A must never reach.
      const bCustomer = await crm.createCustomer({ businessId: bBusinessId, displayName: 'B Customer' });
      if (!bCustomer.ok) throw new Error('seed B customer failed');
      bCustomerId = bCustomer.data.id;
      const bContact = await crm.createContactMethod({
        customerId: bCustomerId,
        businessId: bBusinessId,
        type: 'EMAIL',
        value: `b-contact-${suffix}@example.com`,
      });
      if (!bContact.ok) throw new Error('seed B contact method failed');
      bContactMethodId = bContact.data.id;
      const bConv = await conversations.createConversation({
        businessId: bBusinessId,
        customerId: bCustomerId,
        channel: 'INTERNAL',
      });
      if (!bConv.ok) throw new Error('seed B conversation failed');
      bConversationId = bConv.data.id;
      const bMsg = await conversations.createMessage({
        conversationId: bConversationId,
        businessId: bBusinessId,
        direction: 'OUTBOUND',
        senderType: 'OPERATOR',
        senderUserId: bUserId,
        content: 'B private message',
      });
      if (!bMsg.ok) throw new Error('seed B message failed');
      bMessageId = bMsg.data.id;
      const bDraft = await replyDrafts.createSystemDraft({
        businessId: bBusinessId,
        conversationId: bConversationId,
        createdByUserId: bUserId,
        draftText: 'B private draft',
      });
      if (!bDraft.ok) throw new Error('seed B draft failed');
      bDraftId = bDraft.data.id;
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------

    it('Customers — Business A cannot read, list, update, archive, or read contact methods of a Business B customer', async () => {
      const crm = deps.services.crm;
      const crmRepo = deps.repositories.crm;

      // list — A sees its own customer, never B's
      const listed = await crm.listCustomers({ businessId: aBusinessId });
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        const ids = listed.data.data.map((c) => c.id);
        expect(ids).toContain(aCustomerId);
        expect(ids).not.toContain(bCustomerId);
      }

      // read (service + repository defense-in-depth) — foreign customer resolves to null
      const read = await crm.findCustomerById({ customerId: bCustomerId, businessId: aBusinessId });
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.data).toBeNull();
      const repoRead = await crmRepo.findCustomerById(bCustomerId, aBusinessId);
      expect(repoRead.ok).toBe(true);
      if (repoRead.ok) expect(repoRead.data).toBeNull();

      // update — denied
      const upd = await crm.updateCustomer(bCustomerId, aBusinessId, { displayName: 'HACKED' });
      expect(upd.ok).toBe(false);
      if (!upd.ok) expect(upd.error.code).toBe('CUSTOMER_NOT_FOUND');

      // archive — denied
      const arch = await crm.archiveCustomer({ customerId: bCustomerId, businessId: aBusinessId });
      expect(arch.ok).toBe(false);
      if (!arch.ok) expect(arch.error.code).toBe('CUSTOMER_NOT_FOUND');

      // contact methods — A cannot list or add to B's customer (service ownership gate)
      const cmList = await crm.listContactMethods({ customerId: bCustomerId, businessId: aBusinessId });
      expect(cmList.ok).toBe(false);
      if (!cmList.ok) expect(cmList.error.code).toBe('CUSTOMER_NOT_FOUND');
      const cmAdd = await crm.addContactMethod({ customerId: bCustomerId, businessId: aBusinessId, type: 'EMAIL', value: 'intruder@example.com' });
      expect(cmAdd.ok).toBe(false);
      if (!cmAdd.ok) expect(cmAdd.error.code).toBe('CUSTOMER_NOT_FOUND');

      // B's customer is intact and still visible to B, with its single contact method
      const bView = await crm.findCustomerById({ customerId: bCustomerId, businessId: bBusinessId });
      expect(bView.ok).toBe(true);
      if (bView.ok) {
        expect(bView.data).not.toBeNull();
        expect(bView.data?.displayName).toBe('B Customer');
        expect(bView.data?.status).toBe('ACTIVE');
        expect(bView.data?.contactMethods.map((c) => c.id)).toEqual([bContactMethodId]);
      }
    });

    // -----------------------------------------------------------------------
    // Conversations
    // -----------------------------------------------------------------------

    it('Conversations — Business A cannot read, list, update, or change status of a Business B conversation', async () => {
      const convService = deps.services.conversations;
      const convRepo = deps.repositories.conversations;

      // list — A sees its own conversation, never B's
      const listed = await convService.listConversations({ businessId: aBusinessId });
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        const ids = listed.data.data.map((c) => c.id);
        expect(ids).toContain(aConversationId);
        expect(ids).not.toContain(bConversationId);
      }

      // read (service + repository) — null
      const read = await convService.findConversationById({ conversationId: bConversationId, businessId: aBusinessId });
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.data).toBeNull();
      const repoRead = await convRepo.findConversationById(bConversationId, aBusinessId);
      expect(repoRead.ok).toBe(true);
      if (repoRead.ok) expect(repoRead.data).toBeNull();

      // update — denied
      const upd = await convService.updateConversation({ conversationId: bConversationId, businessId: aBusinessId, data: { subject: 'HACKED' }, actorUserId: aUserId });
      expect(upd.ok).toBe(false);
      if (!upd.ok) expect(upd.error.code).toBe('CONVERSATION_NOT_FOUND');

      // change status — denied
      const status = await convService.changeStatus({ conversationId: bConversationId, businessId: aBusinessId, toStatus: 'OPEN', actorUserId: aUserId });
      expect(status.ok).toBe(false);
      if (!status.ok) expect(status.error.code).toBe('CONVERSATION_NOT_FOUND');

      // B's conversation is intact (no subject, status unchanged) and visible to B
      const bView = await convService.findConversationById({ conversationId: bConversationId, businessId: bBusinessId });
      expect(bView.ok).toBe(true);
      if (bView.ok) {
        expect(bView.data).not.toBeNull();
        expect(bView.data?.subject ?? null).toBeNull();
        expect(bView.data?.status).toBe('NEW');
      }
    });

    // -----------------------------------------------------------------------
    // Messages
    // -----------------------------------------------------------------------

    it('Messages — Business A cannot read, list, or create messages in a Business B conversation; composite FK blocks cross-business attach', async () => {
      const convService = deps.services.conversations;
      const convRepo = deps.repositories.conversations;

      // read message by id (service + repository) — null
      const read = await convService.findMessageById({ messageId: bMessageId, businessId: aBusinessId });
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.data).toBeNull();
      const repoRead = await convRepo.findMessageById(bMessageId, aBusinessId);
      expect(repoRead.ok).toBe(true);
      if (repoRead.ok) expect(repoRead.data).toBeNull();

      // list messages for B's conversation from A — denied at the conversation gate
      const listed = await convService.listMessages({ conversationId: bConversationId, businessId: aBusinessId });
      expect(listed.ok).toBe(false);
      if (!listed.ok) expect(listed.error.code).toBe('CONVERSATION_NOT_FOUND');

      // create a message in B's conversation from A (service) — denied
      const created = await convService.createMessage({ conversationId: bConversationId, businessId: aBusinessId, direction: 'OUTBOUND', content: 'intruder', senderUserId: aUserId });
      expect(created.ok).toBe(false);
      if (!created.ok) expect(created.error.code).toBe('CONVERSATION_NOT_FOUND');

      // composite FK (DB level): repo createMessage with A's businessId + B's conversationId is rejected
      const fkAttempt = await convRepo.createMessage({ conversationId: bConversationId, businessId: aBusinessId, direction: 'OUTBOUND', senderType: 'OPERATOR', senderUserId: aUserId, content: 'intruder-direct' });
      expect(fkAttempt.ok).toBe(false);
      if (!fkAttempt.ok) expect(fkAttempt.error.code).toBe('CONVERSATION_REPOSITORY_ERROR');

      // B's conversation still has exactly its original message, visible only to B
      const bMessages = await convService.listMessages({ conversationId: bConversationId, businessId: bBusinessId });
      expect(bMessages.ok).toBe(true);
      if (bMessages.ok) {
        expect(bMessages.data.data.map((m) => m.id)).toEqual([bMessageId]);
      }
    });

    // -----------------------------------------------------------------------
    // Reply drafts
    // -----------------------------------------------------------------------

    it('Reply drafts — Business A cannot read, edit, approve, or discard a Business B reply draft', async () => {
      const drafts = deps.repositories.replyDrafts;

      // current draft for B's conversation from A — null
      const current = await drafts.getCurrentByConversation({ businessId: aBusinessId, conversationId: bConversationId });
      expect(current.ok).toBe(true);
      if (current.ok) expect(current.data.draft).toBeNull();

      // scoped find with A's businessId — null (scope guard)
      const found = await drafts.findByBusinessConversationAndId(aBusinessId, bConversationId, bDraftId);
      expect(found.ok).toBe(true);
      if (found.ok) expect(found.data).toBeNull();

      // latest reviewable for B's conversation from A — null (A's generate path cannot reuse B's draft)
      const latest = await drafts.findLatestReviewableByConversation(aBusinessId, bConversationId);
      expect(latest.ok).toBe(true);
      if (latest.ok) expect(latest.data).toBeNull();

      // edit / approve / discard — all denied with DRAFT_NOT_FOUND
      const edit = await drafts.editDraft({ businessId: aBusinessId, conversationId: bConversationId, draftId: bDraftId, draftText: 'HACKED' });
      expect(edit.ok).toBe(false);
      if (!edit.ok) expect(edit.error.code).toBe('DRAFT_NOT_FOUND');
      const approve = await drafts.approveDraft({ businessId: aBusinessId, conversationId: bConversationId, draftId: bDraftId, reviewedByUserId: aUserId });
      expect(approve.ok).toBe(false);
      if (!approve.ok) expect(approve.error.code).toBe('DRAFT_NOT_FOUND');
      const discard = await drafts.discardDraft({ businessId: aBusinessId, conversationId: bConversationId, draftId: bDraftId, reviewedByUserId: aUserId });
      expect(discard.ok).toBe(false);
      if (!discard.ok) expect(discard.error.code).toBe('DRAFT_NOT_FOUND');

      // dashboard — A sees only its own draft, never B's
      const dash = await drafts.getDashboardDrafts(aBusinessId, 50);
      expect(dash.ok).toBe(true);
      if (dash.ok) {
        const ids = dash.data.drafts.map((d) => d.id);
        expect(ids).toContain(aDraftId);
        expect(ids).not.toContain(bDraftId);
        expect(dash.data.pendingCount).toBe(1);
      }

      // B's draft is intact (text + status unchanged) and visible to B
      const bView = await drafts.getCurrentByConversation({ businessId: bBusinessId, conversationId: bConversationId });
      expect(bView.ok).toBe(true);
      if (bView.ok) {
        expect(bView.data.draft).not.toBeNull();
        expect(bView.data.draft?.id).toBe(bDraftId);
        expect(bView.data.draft?.status).toBe('PENDING_REVIEW');
        expect(bView.data.draft?.draftText).toBe('B private draft');
      }
    });
  });
});
