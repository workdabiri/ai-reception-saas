// ===========================================================================
// Tests — API Composition Root
//
// Verifies dependency wiring, singleton behavior, and route skeleton
// isolation. No real DB connection required.
// ===========================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaCompatibleClient } from '@/app/api/_shared/composition.types';

// ---------------------------------------------------------------------------
// Mock prisma delegate factories
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock Prisma-compatible client.
 * Each delegate has stubbed methods that satisfy the repository DB interfaces.
 *
 * The stubs are never called in these tests — we only verify that the
 * composition root wires the correct shapes. The cast at the end is safe
 * because the structure matches PrismaCompatibleClient's required keys.
 */
function createMockPrisma(): PrismaCompatibleClient {
  // Build delegate stubs that structurally satisfy the repository DB
  // interfaces. We use `unknown` narrowing at the delegate level to
  // avoid `any` while still allowing the stubs to pass typecheck.
  const stubRecord = {
    id: 'mock',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const userDelegate: PrismaCompatibleClient['user'] = {
    create: () =>
      Promise.resolve({
        ...stubRecord,
        email: 'mock@test.com',
        name: 'Mock',
        locale: 'en',
        status: 'ACTIVE' as const,
        avatarUrl: null,
      }),
    update: () =>
      Promise.resolve({
        ...stubRecord,
        email: 'mock@test.com',
        name: 'Mock',
        locale: 'en',
        status: 'ACTIVE' as const,
        avatarUrl: null,
      }),
    findUnique: () => Promise.resolve(null),
  };

  const sessionDelegate: PrismaCompatibleClient['session'] = {
    create: () =>
      Promise.resolve({
        ...stubRecord,
        userId: 'mock',
        tokenHash: 'mock-hash',
        expiresAt: new Date(),
        revokedAt: null,
        ipAddress: null,
        userAgent: null,
      }),
    update: () =>
      Promise.resolve({
        ...stubRecord,
        userId: 'mock',
        tokenHash: 'mock-hash',
        expiresAt: new Date(),
        revokedAt: new Date(),
        ipAddress: null,
        userAgent: null,
      }),
    findUnique: () => Promise.resolve(null),
    findMany: () => Promise.resolve([]),
  };

  const businessDelegate: PrismaCompatibleClient['business'] = {
    create: () =>
      Promise.resolve({
        ...stubRecord,
        name: 'Mock Biz',
        slug: 'mock-biz',
        status: 'ACTIVE' as const,
        timezone: 'UTC',
        locale: 'en',
        createdByUserId: 'mock',
      }),
    update: () =>
      Promise.resolve({
        ...stubRecord,
        name: 'Mock Biz',
        slug: 'mock-biz',
        status: 'ACTIVE' as const,
        timezone: 'UTC',
        locale: 'en',
        createdByUserId: 'mock',
      }),
    findUnique: () => Promise.resolve(null),
    findMany: () => Promise.resolve([]),
  };

  const membershipDelegate: PrismaCompatibleClient['businessMembership'] = {
    create: () =>
      Promise.resolve({
        ...stubRecord,
        businessId: 'mock',
        userId: 'mock',
        role: 'VIEWER' as const,
        status: 'ACTIVE' as const,
        invitedByUserId: null,
        joinedAt: null,
      }),
    update: () =>
      Promise.resolve({
        ...stubRecord,
        businessId: 'mock',
        userId: 'mock',
        role: 'VIEWER' as const,
        status: 'ACTIVE' as const,
        invitedByUserId: null,
        joinedAt: null,
      }),
    findUnique: () => Promise.resolve(null),
    findMany: () => Promise.resolve([]),
    findFirst: () => Promise.resolve(null),
  };

  const auditEventDelegate: PrismaCompatibleClient['auditEvent'] = {
    create: () =>
      Promise.resolve({
        id: 'mock',
        businessId: null,
        actorType: 'SYSTEM' as const,
        actorUserId: null,
        action: 'test.action',
        targetType: null,
        targetId: null,
        result: 'SUCCESS' as const,
        metadata: null,
        createdAt: new Date(),
      }),
    findUnique: () => Promise.resolve(null),
    findMany: () => Promise.resolve([]),
    count: () => Promise.resolve(0),
  };

  const customerDelegate: PrismaCompatibleClient['customer'] = {
    create: () =>
      Promise.resolve({
        ...stubRecord,
        businessId: 'mock',
        displayName: 'Mock Customer',
        status: 'ACTIVE' as const,
        locale: null,
        notes: null,
        metadata: null,
        contactMethods: [],
      }),
    update: () =>
      Promise.resolve({
        ...stubRecord,
        businessId: 'mock',
        displayName: 'Mock Customer',
        status: 'ACTIVE' as const,
        locale: null,
        notes: null,
        metadata: null,
        contactMethods: [],
      }),
    findUnique: () => Promise.resolve(null),
    findMany: () => Promise.resolve([]),
  };

  const customerContactMethodDelegate: PrismaCompatibleClient['customerContactMethod'] = {
    create: () =>
      Promise.resolve({
        ...stubRecord,
        customerId: 'mock',
        businessId: 'mock',
        type: 'EMAIL' as const,
        value: 'mock@test.com',
        label: null,
        isPrimary: false,
        verified: false,
      }),
    update: () =>
      Promise.resolve({
        ...stubRecord,
        customerId: 'mock',
        businessId: 'mock',
        type: 'EMAIL' as const,
        value: 'mock@test.com',
        label: null,
        isPrimary: false,
        verified: false,
      }),
    delete: () =>
      Promise.resolve({
        ...stubRecord,
        customerId: 'mock',
        businessId: 'mock',
        type: 'EMAIL' as const,
        value: 'mock@test.com',
        label: null,
        isPrimary: false,
        verified: false,
      }),
    findUnique: () => Promise.resolve(null),
    findMany: () => Promise.resolve([]),
  };

  const conversationDelegate: PrismaCompatibleClient['conversation'] = {
    create: () =>
      Promise.resolve({
        ...stubRecord,
        businessId: 'mock',
        customerId: null,
        channel: 'INTERNAL' as const,
        status: 'NEW' as const,
        subject: null,
        assignedUserId: null,
        aiClassificationStatus: 'NOT_REQUESTED' as const,
        aiDraftStatus: 'NOT_REQUESTED' as const,
        channelMetadata: null,
        metadata: null,
        closedAt: null,
      }),
    update: () =>
      Promise.resolve({
        ...stubRecord,
        businessId: 'mock',
        customerId: null,
        channel: 'INTERNAL' as const,
        status: 'NEW' as const,
        subject: null,
        assignedUserId: null,
        aiClassificationStatus: 'NOT_REQUESTED' as const,
        aiDraftStatus: 'NOT_REQUESTED' as const,
        channelMetadata: null,
        metadata: null,
        closedAt: null,
      }),
    findUnique: () => Promise.resolve(null),
    findMany: () => Promise.resolve([]),
    count: () => Promise.resolve(0),
    groupBy: () => Promise.resolve([]),
  };

  const messageDelegate: PrismaCompatibleClient['message'] = {
    create: () =>
      Promise.resolve({
        id: 'mock',
        conversationId: 'mock',
        businessId: 'mock',
        direction: 'INBOUND' as const,
        senderType: 'CUSTOMER' as const,
        senderUserId: null,
        senderCustomerId: null,
        content: 'mock',
        contentType: 'text/plain',
        channelMetadata: null,
        metadata: null,
        createdAt: new Date(),
      }),
    findUnique: () => Promise.resolve(null),
    findMany: () => Promise.resolve([]),
  };

  return {
    user: userDelegate,
    session: sessionDelegate,
    business: businessDelegate,
    businessMembership: membershipDelegate,
    auditEvent: auditEventDelegate,
    customer: customerDelegate,
    customerContactMethod: customerContactMethodDelegate,
    conversation: conversationDelegate,
    message: messageDelegate,
    replyDraft: {
      findMany: () => Promise.resolve([]),
      count: () => Promise.resolve(0),
      create: () => Promise.resolve({
        id: 'mock',
        businessId: 'mock',
        conversationId: 'mock',
        source: 'SYSTEM' as const,
        status: 'PENDING_REVIEW' as const,
        draftText: 'mock',
        createdAt: new Date(),
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// 1. createApiDependencies wires repositories and services
// ---------------------------------------------------------------------------

describe('createApiDependencies', () => {
  it('wires all repositories and services from mock prisma', () => {
    // Dynamic import to avoid module-level getPrisma call
    return import('@/app/api/_shared/composition').then(
      ({ createApiDependencies }) => {
        const mockPrisma = createMockPrisma();
        const deps = createApiDependencies({ prisma: mockPrisma });

        // Repositories
        expect(deps.repositories.identity).toBeDefined();
        expect(deps.repositories.tenancy).toBeDefined();
        expect(deps.repositories.audit).toBeDefined();
        expect(deps.repositories.crm).toBeDefined();
        expect(deps.repositories.conversations).toBeDefined();
        expect(deps.repositories.replyDrafts).toBeDefined();

        // Services
        expect(deps.services.identity).toBeDefined();
        expect(deps.services.tenancy).toBeDefined();
        expect(deps.services.authz).toBeDefined();
        expect(deps.services.audit).toBeDefined();
        expect(deps.services.crm).toBeDefined();
        expect(deps.services.conversations).toBeDefined();
      },
    );
  });

  it('returns repositories with expected interface methods', () => {
    return import('@/app/api/_shared/composition').then(
      ({ createApiDependencies }) => {
        const deps = createApiDependencies({ prisma: createMockPrisma() });

        // Identity repository methods
        expect(typeof deps.repositories.identity.createUser).toBe('function');
        expect(typeof deps.repositories.identity.findUserById).toBe(
          'function',
        );
        expect(typeof deps.repositories.identity.createSession).toBe(
          'function',
        );

        // Tenancy repository methods
        expect(typeof deps.repositories.tenancy.createBusiness).toBe(
          'function',
        );
        expect(typeof deps.repositories.tenancy.createMembership).toBe(
          'function',
        );
        expect(typeof deps.repositories.tenancy.resolveTenantContext).toBe(
          'function',
        );

        // Audit repository methods
        expect(typeof deps.repositories.audit.createAuditEvent).toBe(
          'function',
        );
        expect(typeof deps.repositories.audit.listAuditEvents).toBe(
          'function',
        );

        // CRM repository methods
        expect(typeof deps.repositories.crm.createCustomer).toBe(
          'function',
        );
        expect(typeof deps.repositories.crm.findCustomerById).toBe(
          'function',
        );
        expect(typeof deps.repositories.crm.listCustomers).toBe(
          'function',
        );
        expect(typeof deps.repositories.crm.findByContactMethod).toBe(
          'function',
        );
      },
    );
  });

  it('returns services with expected interface methods', () => {
    return import('@/app/api/_shared/composition').then(
      ({ createApiDependencies }) => {
        const deps = createApiDependencies({ prisma: createMockPrisma() });

        // Identity service methods
        expect(typeof deps.services.identity.createUser).toBe('function');
        expect(typeof deps.services.identity.findUserByEmail).toBe('function');
        expect(typeof deps.services.identity.revokeSession).toBe('function');

        // Tenancy service methods
        expect(typeof deps.services.tenancy.createBusiness).toBe('function');
        expect(typeof deps.services.tenancy.updateMembershipRole).toBe(
          'function',
        );
        expect(typeof deps.services.tenancy.resolveTenantContext).toBe(
          'function',
        );

        // Authz service methods
        expect(typeof deps.services.authz.evaluateAccess).toBe('function');
        expect(typeof deps.services.authz.requirePermission).toBe('function');
        expect(typeof deps.services.authz.listRolePermissions).toBe(
          'function',
        );

        // Audit service methods
        expect(typeof deps.services.audit.createAuditEvent).toBe('function');
        expect(typeof deps.services.audit.findAuditEventById).toBe('function');

        // CRM service methods
        expect(typeof deps.services.crm.createCustomer).toBe('function');
        expect(typeof deps.services.crm.findCustomerById).toBe('function');
        expect(typeof deps.services.crm.listCustomers).toBe('function');
        expect(typeof deps.services.crm.findOrCreateByContact).toBe('function');
        expect(typeof deps.services.crm.addContactMethod).toBe('function');
        expect(typeof deps.services.crm.removeContactMethod).toBe('function');
      },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. getApiDependencies singleton
// ---------------------------------------------------------------------------

// Mock getPrisma so the singleton path doesn't require a real DB
vi.mock('@/lib/prisma', () => ({
  getPrisma: () => createMockPrisma(),
}));

describe('getApiDependencies', () => {
  beforeEach(async () => {
    const { resetApiDependenciesForTests } = await import(
      '@/app/api/_shared/composition'
    );
    resetApiDependenciesForTests();
  });

  it('returns the same singleton instance on subsequent calls', async () => {
    const { getApiDependencies } = await import(
      '@/app/api/_shared/composition'
    );
    const first = getApiDependencies();
    const second = getApiDependencies();
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// 3. resetApiDependenciesForTests clears singleton
// ---------------------------------------------------------------------------

describe('resetApiDependenciesForTests', () => {
  it('clears singleton so next call creates a new instance', async () => {
    const { getApiDependencies, resetApiDependenciesForTests } = await import(
      '@/app/api/_shared/composition'
    );

    const first = getApiDependencies();
    resetApiDependenciesForTests();
    const second = getApiDependencies();

    expect(first).not.toBe(second);
  });
});

// ---------------------------------------------------------------------------
// 4. Route skeletons still return NOT_IMPLEMENTED
// ---------------------------------------------------------------------------

describe('Route skeletons unchanged', () => {
  it('GET /api/identity/me still returns 501 NOT_IMPLEMENTED', async () => {
    const { GET } = await import('@/app/api/identity/me/route');
    const res = await GET(new Request('http://localhost/api/identity/me'));
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('POST /api/businesses still returns 501 NOT_IMPLEMENTED', async () => {
    const { POST } = await import('@/app/api/businesses/route');
    const res = await POST(new Request('http://localhost/api/businesses', { method: 'POST' }));
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('POST /api/authz/evaluate still returns 501 NOT_IMPLEMENTED', async () => {
    const { POST } = await import('@/app/api/authz/evaluate/route');
    const res = await POST(
      new Request('http://localhost/api/authz/evaluate', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
    );
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
  });
});

// ---------------------------------------------------------------------------
// 5. Composition root does not require route invocation
// ---------------------------------------------------------------------------

describe('Composition root isolation', () => {
  it('can create dependencies without importing route modules', () => {
    return import('@/app/api/_shared/composition').then(
      ({ createApiDependencies }) => {
        // This test verifies that creating dependencies is independent
        // of route module imports
        const deps = createApiDependencies({ prisma: createMockPrisma() });
        expect(deps).toBeDefined();
        expect(deps.repositories).toBeDefined();
        expect(deps.services).toBeDefined();
      },
    );
  });

  it('route files do not import composition root', async () => {
    // Verify that the composition root is not a transitive dependency
    // of route modules by checking that route modules work without
    // composition being initialized
    const { resetApiDependenciesForTests } = await import(
      '@/app/api/_shared/composition'
    );
    resetApiDependenciesForTests();

    // Routes should still work (return NOT_IMPLEMENTED) without
    // composition being wired
    const { GET } = await import('@/app/api/identity/me/route');
    const res = await GET(new Request('http://localhost/api/identity/me'));
    expect(res.status).toBe(501);
  });
});
