import { describe, it, expect, vi } from 'vitest';

import {
  createIdentityRepository,
  mapUserRecord,
  mapSessionRecord,
} from '../../src/domains/identity/repository';
import type {
  IdentityRepositoryDb,
  UserRecord,
  SessionRecord,
} from '../../src/domains/identity/repository';

import {
  createTenancyRepository,
  mapBusinessRecord,
  mapBusinessMembershipRecord,
} from '../../src/domains/tenancy/repository';
import type {
  TenancyRepositoryDb,
  BusinessRecord,
  BusinessMembershipRecord,
} from '../../src/domains/tenancy/repository';

import {
  createAuditRepository,
  mapAuditEventRecord,
} from '../../src/domains/audit/repository';
import type {
  AuditRepositoryDb,
  AuditEventRecord,
} from '../../src/domains/audit/repository';

// ===========================================================================
// Shared mock data
// ===========================================================================

const NOW = new Date('2026-01-15T12:00:00.000Z');
const LATER = new Date('2026-12-31T23:59:59.000Z');

const MOCK_USER_RECORD: UserRecord = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@example.com',
  name: 'Test User',
  locale: 'en',
  status: 'ACTIVE',
  avatarUrl: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const MOCK_SESSION_RECORD: SessionRecord = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  userId: '550e8400-e29b-41d4-a716-446655440000',
  tokenHash: 'a'.repeat(64),
  expiresAt: LATER,
  revokedAt: null,
  ipAddress: '127.0.0.1',
  userAgent: 'TestAgent',
  createdAt: NOW,
  updatedAt: NOW,
};

const MOCK_BUSINESS_RECORD: BusinessRecord = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  name: 'Test Business',
  slug: 'test-business',
  status: 'ACTIVE',
  timezone: 'Asia/Tehran',
  locale: 'fa',
  createdByUserId: '550e8400-e29b-41d4-a716-446655440000',
  createdAt: NOW,
  updatedAt: NOW,
};

const MOCK_MEMBERSHIP_RECORD: BusinessMembershipRecord = {
  id: '550e8400-e29b-41d4-a716-446655440003',
  businessId: '550e8400-e29b-41d4-a716-446655440002',
  userId: '550e8400-e29b-41d4-a716-446655440000',
  role: 'OWNER',
  status: 'ACTIVE',
  invitedByUserId: null,
  joinedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

const MOCK_AUDIT_RECORD: AuditEventRecord = {
  id: '550e8400-e29b-41d4-a716-446655440004',
  businessId: '550e8400-e29b-41d4-a716-446655440002',
  actorType: 'USER',
  actorUserId: '550e8400-e29b-41d4-a716-446655440000',
  action: 'member.invited',
  targetType: 'membership',
  targetId: '550e8400-e29b-41d4-a716-446655440003',
  result: 'SUCCESS',
  metadata: { detail: 'test' },
  createdAt: NOW,
};

// ===========================================================================
// Helper: create mock identity DB
// ===========================================================================

function createMockIdentityDb(): IdentityRepositoryDb {
  return {
    user: {
      create: vi.fn().mockResolvedValue(MOCK_USER_RECORD),
      update: vi.fn().mockResolvedValue(MOCK_USER_RECORD),
      findUnique: vi.fn().mockResolvedValue(MOCK_USER_RECORD),
    },
    session: {
      create: vi.fn().mockResolvedValue(MOCK_SESSION_RECORD),
      update: vi.fn().mockResolvedValue(MOCK_SESSION_RECORD),
      findUnique: vi.fn().mockResolvedValue(MOCK_SESSION_RECORD),
      findMany: vi.fn().mockResolvedValue([MOCK_SESSION_RECORD]),
    },
  };
}

function createMockTenancyDb(): TenancyRepositoryDb {
  return {
    business: {
      create: vi.fn().mockResolvedValue(MOCK_BUSINESS_RECORD),
      update: vi.fn().mockResolvedValue(MOCK_BUSINESS_RECORD),
      findUnique: vi.fn().mockResolvedValue(MOCK_BUSINESS_RECORD),
      findMany: vi.fn().mockResolvedValue([MOCK_BUSINESS_RECORD]),
    },
    businessMembership: {
      create: vi.fn().mockResolvedValue(MOCK_MEMBERSHIP_RECORD),
      update: vi.fn().mockResolvedValue(MOCK_MEMBERSHIP_RECORD),
      findUnique: vi.fn().mockResolvedValue(MOCK_MEMBERSHIP_RECORD),
      findMany: vi.fn().mockResolvedValue([MOCK_MEMBERSHIP_RECORD]),
      findFirst: vi.fn().mockResolvedValue(MOCK_MEMBERSHIP_RECORD),
    },
  };
}

function createMockAuditDb(): AuditRepositoryDb {
  return {
    auditEvent: {
      create: vi.fn().mockResolvedValue(MOCK_AUDIT_RECORD),
      findUnique: vi.fn().mockResolvedValue(MOCK_AUDIT_RECORD),
      findMany: vi.fn().mockResolvedValue([MOCK_AUDIT_RECORD]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

// ===========================================================================
// Identity Repository Tests
// ===========================================================================

describe('Identity Repository', () => {
  it('createIdentityRepository exists and returns a repository', () => {
    const db = createMockIdentityDb();
    const repo = createIdentityRepository(db);
    expect(repo).toBeDefined();
    expect(typeof repo.createUser).toBe('function');
    expect(typeof repo.findUserById).toBe('function');
  });

  it('createUser maps Date fields to ISO strings', async () => {
    const db = createMockIdentityDb();
    const repo = createIdentityRepository(db);
    const result = await repo.createUser({ email: 'a@b.com', name: 'A' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.createdAt).toBe(NOW.toISOString());
      expect(result.data.updatedAt).toBe(NOW.toISOString());
      expect(typeof result.data.createdAt).toBe('string');
    }
  });

  it('findUserById returns ok(null) when not found', async () => {
    const db = createMockIdentityDb();
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null);
    const repo = createIdentityRepository(db);
    const result = await repo.findUserById({ userId: 'nonexistent' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeNull();
    }
  });

  it('createSession converts expiresAt string to Date in db call', async () => {
    const db = createMockIdentityDb();
    const repo = createIdentityRepository(db);
    const expiresAtStr = '2026-12-31T23:59:59.000Z';
    await repo.createSession({
      userId: MOCK_USER_RECORD.id,
      tokenHash: 'hash123',
      expiresAt: expiresAtStr,
    });
    expect(db.session.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expiresAt: new Date(expiresAtStr),
      }),
    });
  });

  it('listUserSessions excludes revoked sessions by default', async () => {
    const db = createMockIdentityDb();
    const repo = createIdentityRepository(db);
    await repo.listUserSessions({ userId: MOCK_USER_RECORD.id });
    expect(db.session.findMany).toHaveBeenCalledWith({
      where: { userId: MOCK_USER_RECORD.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('listUserSessions includes revoked when requested', async () => {
    const db = createMockIdentityDb();
    const repo = createIdentityRepository(db);
    await repo.listUserSessions({
      userId: MOCK_USER_RECORD.id,
      includeRevoked: true,
    });
    expect(db.session.findMany).toHaveBeenCalledWith({
      where: { userId: MOCK_USER_RECORD.id },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('revokeSession sets revokedAt Date', async () => {
    const db = createMockIdentityDb();
    const repo = createIdentityRepository(db);
    const revokedAtStr = '2026-06-15T10:00:00.000Z';
    await repo.revokeSession({
      sessionId: MOCK_SESSION_RECORD.id,
      revokedAt: revokedAtStr,
    });
    expect(db.session.update).toHaveBeenCalledWith({
      where: { id: MOCK_SESSION_RECORD.id },
      data: { revokedAt: new Date(revokedAtStr) },
    });
  });

  it('repository catches errors and returns ok false', async () => {
    const db = createMockIdentityDb();
    vi.mocked(db.user.create).mockRejectedValueOnce(new Error('DB down'));
    const repo = createIdentityRepository(db);
    const result = await repo.createUser({ email: 'a@b.com', name: 'A' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('IDENTITY_REPOSITORY_ERROR');
    }
  });
});

describe('Identity Mappers', () => {
  it('mapUserRecord converts Date to ISO string', () => {
    const mapped = mapUserRecord(MOCK_USER_RECORD);
    expect(mapped.createdAt).toBe(NOW.toISOString());
    expect(mapped.updatedAt).toBe(NOW.toISOString());
  });

  it('mapSessionRecord converts nullable Date', () => {
    const withRevoked: SessionRecord = {
      ...MOCK_SESSION_RECORD,
      revokedAt: NOW,
    };
    const mapped = mapSessionRecord(withRevoked);
    expect(mapped.revokedAt).toBe(NOW.toISOString());

    const withoutRevoked = mapSessionRecord(MOCK_SESSION_RECORD);
    expect(withoutRevoked.revokedAt).toBeNull();
  });
});

// ===========================================================================
// Tenancy Repository Tests
// ===========================================================================

describe('Tenancy Repository', () => {
  it('createTenancyRepository exists and returns a repository', () => {
    const db = createMockTenancyDb();
    const repo = createTenancyRepository(db);
    expect(repo).toBeDefined();
    expect(typeof repo.createBusiness).toBe('function');
    expect(typeof repo.resolveTenantContext).toBe('function');
  });

  it('createBusiness maps Date fields', async () => {
    const db = createMockTenancyDb();
    const repo = createTenancyRepository(db);
    const result = await repo.createBusiness({
      name: 'Biz',
      slug: 'biz',
      createdByUserId: MOCK_USER_RECORD.id,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.createdAt).toBe(NOW.toISOString());
      expect(result.data.updatedAt).toBe(NOW.toISOString());
    }
  });

  it('findBusinessBySlug returns ok(null) when missing', async () => {
    const db = createMockTenancyDb();
    vi.mocked(db.business.findUnique).mockResolvedValueOnce(null);
    const repo = createTenancyRepository(db);
    const result = await repo.findBusinessBySlug({ slug: 'nonexistent' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeNull();
    }
  });

  it('findMembership uses compound userId_businessId selector', async () => {
    const db = createMockTenancyDb();
    const repo = createTenancyRepository(db);
    await repo.findMembership({
      userId: MOCK_USER_RECORD.id,
      businessId: MOCK_BUSINESS_RECORD.id,
    });
    expect(db.businessMembership.findUnique).toHaveBeenCalledWith({
      where: {
        userId_businessId: {
          userId: MOCK_USER_RECORD.id,
          businessId: MOCK_BUSINESS_RECORD.id,
        },
      },
    });
  });

  it('listBusinessMemberships excludes REMOVED by default', async () => {
    const db = createMockTenancyDb();
    const repo = createTenancyRepository(db);
    await repo.listBusinessMemberships({
      businessId: MOCK_BUSINESS_RECORD.id,
    });
    expect(db.businessMembership.findMany).toHaveBeenCalledWith({
      where: {
        businessId: MOCK_BUSINESS_RECORD.id,
        status: { not: 'REMOVED' },
      },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('resolveTenantContext returns ok tenant context for ACTIVE membership', async () => {
    const db = createMockTenancyDb();
    const repo = createTenancyRepository(db);
    const result = await repo.resolveTenantContext({
      userId: MOCK_USER_RECORD.id,
      businessId: MOCK_BUSINESS_RECORD.id,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        businessId: MOCK_BUSINESS_RECORD.id,
        userId: MOCK_USER_RECORD.id,
        membershipId: MOCK_MEMBERSHIP_RECORD.id,
        role: 'OWNER',
      });
    }
  });

  it('resolveTenantContext returns TENANT_ACCESS_DENIED if membership missing', async () => {
    const db = createMockTenancyDb();
    vi.mocked(db.businessMembership.findFirst).mockResolvedValueOnce(null);
    const repo = createTenancyRepository(db);
    const result = await repo.resolveTenantContext({
      userId: 'unknown-user',
      businessId: MOCK_BUSINESS_RECORD.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TENANT_ACCESS_DENIED');
    }
  });

  it('repository catches errors and returns ok false', async () => {
    const db = createMockTenancyDb();
    vi.mocked(db.business.create).mockRejectedValueOnce(
      new Error('DB down'),
    );
    const repo = createTenancyRepository(db);
    const result = await repo.createBusiness({
      name: 'Biz',
      slug: 'biz',
      createdByUserId: MOCK_USER_RECORD.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TENANCY_REPOSITORY_ERROR');
    }
  });
});

describe('Tenancy Mappers', () => {
  it('mapBusinessRecord converts Date fields', () => {
    const mapped = mapBusinessRecord(MOCK_BUSINESS_RECORD);
    expect(mapped.createdAt).toBe(NOW.toISOString());
  });

  it('mapBusinessMembershipRecord converts nullable joinedAt', () => {
    const mapped = mapBusinessMembershipRecord(MOCK_MEMBERSHIP_RECORD);
    expect(mapped.joinedAt).toBe(NOW.toISOString());

    const withoutJoined: BusinessMembershipRecord = {
      ...MOCK_MEMBERSHIP_RECORD,
      joinedAt: null,
    };
    const mapped2 = mapBusinessMembershipRecord(withoutJoined);
    expect(mapped2.joinedAt).toBeNull();
  });

  it('mapBusinessMembershipRecord includes user display info when present', () => {
    const withUser: BusinessMembershipRecord = {
      ...MOCK_MEMBERSHIP_RECORD,
      user: { id: MOCK_USER_RECORD.id, name: 'Test User', avatarUrl: null },
    };
    const mapped = mapBusinessMembershipRecord(withUser);
    expect(mapped.user).toEqual({ id: MOCK_USER_RECORD.id, name: 'Test User', avatarUrl: null });
  });

  it('mapBusinessMembershipRecord omits user when not present', () => {
    const mapped = mapBusinessMembershipRecord(MOCK_MEMBERSHIP_RECORD);
    expect(mapped.user).toBeUndefined();
  });
});

// ===========================================================================
// Audit Repository Tests
// ===========================================================================

describe('Audit Repository', () => {
  it('createAuditRepository exists and returns a repository', () => {
    const db = createMockAuditDb();
    const repo = createAuditRepository(db);
    expect(repo).toBeDefined();
    expect(typeof repo.createAuditEvent).toBe('function');
  });

  it('createAuditEvent maps Date field and metadata', async () => {
    const db = createMockAuditDb();
    const repo = createAuditRepository(db);
    const result = await repo.createAuditEvent({
      actorType: 'USER',
      action: 'test.action',
      result: 'SUCCESS',
      metadata: { key: 'value' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.createdAt).toBe(NOW.toISOString());
      expect(result.data.metadata).toEqual({ detail: 'test' });
    }
  });

  it('listAuditEvents applies default limit 50', async () => {
    const db = createMockAuditDb();
    const repo = createAuditRepository(db);
    await repo.listAuditEvents({});
    expect(db.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  it('listAuditEvents caps limit to 100', async () => {
    const db = createMockAuditDb();
    const repo = createAuditRepository(db);
    await repo.listAuditEvents({ limit: 500 });
    expect(db.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it('listAuditEvents passes actorUser include to Prisma findMany', async () => {
    const db = createMockAuditDb();
    const repo = createAuditRepository(db);
    await repo.listAuditEvents({});
    expect(db.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          actorUser: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
            },
          },
        },
      }),
    );
    // Verify email is NOT selected — guards against PII leakage
    const callArgs = vi.mocked(db.auditEvent.findMany).mock.calls[0][0];
    const select = callArgs.include?.actorUser?.select as Record<string, unknown> | undefined;
    expect(select).toBeDefined();
    expect(select).not.toHaveProperty('email');
  });

  it('findAuditEventById returns ok(null) when not found', async () => {
    const db = createMockAuditDb();
    vi.mocked(db.auditEvent.findUnique).mockResolvedValueOnce(null);
    const repo = createAuditRepository(db);
    const result = await repo.findAuditEventById({
      auditEventId: 'nonexistent',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeNull();
    }
  });

  it('repository catches errors and returns ok false', async () => {
    const db = createMockAuditDb();
    vi.mocked(db.auditEvent.create).mockRejectedValueOnce(
      new Error('DB down'),
    );
    const repo = createAuditRepository(db);
    const result = await repo.createAuditEvent({
      actorType: 'USER',
      action: 'test.action',
      result: 'SUCCESS',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUDIT_REPOSITORY_ERROR');
    }
  });
});

describe('Audit Mappers', () => {
  it('mapAuditEventRecord converts Date and preserves metadata', () => {
    const mapped = mapAuditEventRecord(MOCK_AUDIT_RECORD);
    expect(mapped.createdAt).toBe(NOW.toISOString());
    expect(mapped.metadata).toEqual({ detail: 'test' });
  });

  it('mapAuditEventRecord includes actorUser display info when present', () => {
    const withActorUser: AuditEventRecord = {
      ...MOCK_AUDIT_RECORD,
      actorUser: { id: MOCK_USER_RECORD.id, name: 'Test User', avatarUrl: null },
    };
    const mapped = mapAuditEventRecord(withActorUser);
    expect(mapped.actorUser).toEqual({ id: MOCK_USER_RECORD.id, name: 'Test User', avatarUrl: null });
  });

  it('mapAuditEventRecord omits actorUser when not present', () => {
    const mapped = mapAuditEventRecord(MOCK_AUDIT_RECORD);
    expect(mapped.actorUser).toBeUndefined();
  });

  it('mapAuditEventRecord omits actorUser when null', () => {
    const withNull: AuditEventRecord = {
      ...MOCK_AUDIT_RECORD,
      actorUser: null,
    };
    const mapped = mapAuditEventRecord(withNull);
    expect(mapped.actorUser).toBeUndefined();
  });
});

// ===========================================================================
// Domain Index Export Tests
// ===========================================================================

describe('Domain Index Exports', () => {
  it('importing createIdentityRepository from identity domain works', async () => {
    const mod = await import('../../src/domains/identity');
    expect(mod.createIdentityRepository).toBeDefined();
    expect(typeof mod.createIdentityRepository).toBe('function');
  });

  it('importing createTenancyRepository from tenancy domain works', async () => {
    const mod = await import('../../src/domains/tenancy');
    expect(mod.createTenancyRepository).toBeDefined();
    expect(typeof mod.createTenancyRepository).toBe('function');
  });

  it('importing createAuditRepository from audit domain works', async () => {
    const mod = await import('../../src/domains/audit');
    expect(mod.createAuditRepository).toBeDefined();
    expect(typeof mod.createAuditRepository).toBe('function');
  });
});
