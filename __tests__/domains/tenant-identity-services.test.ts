import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '../../src/lib/result';

import { createIdentityService } from '../../src/domains/identity/implementation';
import type { IdentityRepository } from '../../src/domains/identity/repository';
import type { UserIdentity, SessionIdentity } from '../../src/domains/identity/types';

import { createTenancyService } from '../../src/domains/tenancy/implementation';
import type { TenancyRepository } from '../../src/domains/tenancy/repository';
import type { BusinessIdentity, BusinessMembershipIdentity, TenantContext } from '../../src/domains/tenancy/types';

import { createAuthzService } from '../../src/domains/authz/implementation';

import { createAuditService } from '../../src/domains/audit/implementation';
import type { AuditRepository } from '../../src/domains/audit/repository';
import type { AuditEventIdentity } from '../../src/domains/audit/types';

// ===========================================================================
// Mock data
// ===========================================================================

const MOCK_USER: UserIdentity = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@example.com',
  name: 'Test User',
  locale: 'en',
  status: 'ACTIVE',
  avatarUrl: null,
  createdAt: '2026-01-15T12:00:00.000Z',
  updatedAt: '2026-01-15T12:00:00.000Z',
};

const MOCK_SESSION: SessionIdentity = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  userId: MOCK_USER.id,
  tokenHash: 'a'.repeat(64),
  expiresAt: '2026-12-31T23:59:59.000Z',
  revokedAt: null,
  ipAddress: '127.0.0.1',
  userAgent: 'TestAgent',
  createdAt: '2026-01-15T12:00:00.000Z',
  updatedAt: '2026-01-15T12:00:00.000Z',
};

const MOCK_BUSINESS: BusinessIdentity = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  name: 'Test Business',
  slug: 'test-business',
  status: 'ACTIVE',
  timezone: 'Asia/Tehran',
  locale: 'fa',
  createdByUserId: MOCK_USER.id,
  createdAt: '2026-01-15T12:00:00.000Z',
  updatedAt: '2026-01-15T12:00:00.000Z',
};

const MOCK_MEMBERSHIP: BusinessMembershipIdentity = {
  id: '550e8400-e29b-41d4-a716-446655440003',
  businessId: MOCK_BUSINESS.id,
  userId: MOCK_USER.id,
  role: 'OWNER',
  status: 'ACTIVE',
  invitedByUserId: null,
  joinedAt: '2026-01-15T12:00:00.000Z',
  createdAt: '2026-01-15T12:00:00.000Z',
  updatedAt: '2026-01-15T12:00:00.000Z',
};

const MOCK_AUDIT_EVENT: AuditEventIdentity = {
  id: '550e8400-e29b-41d4-a716-446655440004',
  businessId: MOCK_BUSINESS.id,
  actorType: 'USER',
  actorUserId: MOCK_USER.id,
  action: 'member.invited',
  targetType: 'membership',
  targetId: MOCK_MEMBERSHIP.id,
  result: 'SUCCESS',
  metadata: { detail: 'test' },
  createdAt: '2026-01-15T12:00:00.000Z',
};

// ===========================================================================
// Mock factories
// ===========================================================================

function createMockIdentityRepo(): IdentityRepository {
  return {
    createUser: vi.fn().mockResolvedValue(ok(MOCK_USER)),
    updateUser: vi.fn().mockResolvedValue(ok(MOCK_USER)),
    updateUserStatus: vi.fn().mockResolvedValue(ok(MOCK_USER)),
    findUserById: vi.fn().mockResolvedValue(ok(MOCK_USER)),
    findUserByEmail: vi.fn().mockResolvedValue(ok(MOCK_USER)),
    createSession: vi.fn().mockResolvedValue(ok(MOCK_SESSION)),
    findSessionById: vi.fn().mockResolvedValue(ok(MOCK_SESSION)),
    findSessionByTokenHash: vi.fn().mockResolvedValue(ok(MOCK_SESSION)),
    listUserSessions: vi.fn().mockResolvedValue(ok([MOCK_SESSION])),
    revokeSession: vi.fn().mockResolvedValue(ok(MOCK_SESSION)),
  };
}

function createMockTenancyRepo(): TenancyRepository {
  return {
    createBusiness: vi.fn().mockResolvedValue(ok(MOCK_BUSINESS)),
    updateBusiness: vi.fn().mockResolvedValue(ok(MOCK_BUSINESS)),
    findBusinessById: vi.fn().mockResolvedValue(ok(MOCK_BUSINESS)),
    findBusinessBySlug: vi.fn().mockResolvedValue(ok(MOCK_BUSINESS)),
    listUserBusinesses: vi.fn().mockResolvedValue(ok([MOCK_BUSINESS])),
    createMembership: vi.fn().mockResolvedValue(ok(MOCK_MEMBERSHIP)),
    findMembership: vi.fn().mockResolvedValue(ok(MOCK_MEMBERSHIP)),
    findMembershipById: vi.fn().mockResolvedValue(ok(MOCK_MEMBERSHIP)),
    listBusinessMemberships: vi.fn().mockResolvedValue(ok([MOCK_MEMBERSHIP])),
    updateMembershipRole: vi.fn().mockResolvedValue(ok(MOCK_MEMBERSHIP)),
    updateMembershipStatus: vi.fn().mockResolvedValue(ok(MOCK_MEMBERSHIP)),
    removeMembership: vi.fn().mockResolvedValue(ok(MOCK_MEMBERSHIP)),
    resolveTenantContext: vi.fn().mockResolvedValue(ok<TenantContext>({
      businessId: MOCK_BUSINESS.id,
      userId: MOCK_USER.id,
      membershipId: MOCK_MEMBERSHIP.id,
      role: 'OWNER',
    })),
  };
}

function createMockAuditRepo(): AuditRepository {
  return {
    createAuditEvent: vi.fn().mockResolvedValue(ok(MOCK_AUDIT_EVENT)),
    findAuditEventById: vi.fn().mockResolvedValue(ok(MOCK_AUDIT_EVENT)),
    listAuditEvents: vi.fn().mockResolvedValue(ok([MOCK_AUDIT_EVENT])),
    countDeniedEvents: vi.fn().mockResolvedValue(ok(0)),
  };
}

// ===========================================================================
// Identity Service Tests
// ===========================================================================

describe('Identity Service', () => {
  it('createIdentityService exists and returns a service', () => {
    const repo = createMockIdentityRepo();
    const service = createIdentityService({ repository: repo });
    expect(service).toBeDefined();
    expect(typeof service.createUser).toBe('function');
  });

  it('createUser validates and passes normalized email to repository', async () => {
    const repo = createMockIdentityRepo();
    const service = createIdentityService({ repository: repo });
    const result = await service.createUser({ email: '  Test@Example.COM  ', name: 'Test' });
    expect(result.ok).toBe(true);
    expect(repo.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@example.com', name: 'Test' }),
    );
  });

  it('createUser rejects invalid email with INVALID_IDENTITY_INPUT', async () => {
    const repo = createMockIdentityRepo();
    const service = createIdentityService({ repository: repo });
    const result = await service.createUser({ email: 'not-an-email', name: 'Test' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_IDENTITY_INPUT');
    }
    expect(repo.createUser).not.toHaveBeenCalled();
  });

  it('updateUser rejects empty update object', async () => {
    const repo = createMockIdentityRepo();
    const service = createIdentityService({ repository: repo });
    const result = await service.updateUser(MOCK_USER.id, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_IDENTITY_INPUT');
    }
  });

  it('findUserByEmail lowercases email before repository call', async () => {
    const repo = createMockIdentityRepo();
    const service = createIdentityService({ repository: repo });
    await service.findUserByEmail({ email: '  Admin@EXAMPLE.com  ' });
    expect(repo.findUserByEmail).toHaveBeenCalledWith({ email: 'admin@example.com' });
  });

  it('createSession rejects short tokenHash', async () => {
    const repo = createMockIdentityRepo();
    const service = createIdentityService({ repository: repo });
    const result = await service.createSession({
      userId: MOCK_USER.id,
      tokenHash: 'short',
      expiresAt: '2026-12-31T23:59:59.000Z',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_IDENTITY_INPUT');
    }
  });

  it('repository failure is passed through', async () => {
    const repo = createMockIdentityRepo();
    vi.mocked(repo.createUser).mockResolvedValueOnce(
      err('IDENTITY_REPOSITORY_ERROR', 'DB down'),
    );
    const service = createIdentityService({ repository: repo });
    const result = await service.createUser({ email: 'valid@example.com', name: 'Test' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('IDENTITY_REPOSITORY_ERROR');
    }
  });
});

// ===========================================================================
// Tenancy Service Tests
// ===========================================================================

describe('Tenancy Service', () => {
  it('createTenancyService exists and returns a service', () => {
    const repo = createMockTenancyRepo();
    const service = createTenancyService({ repository: repo });
    expect(service).toBeDefined();
    expect(typeof service.createBusiness).toBe('function');
  });

  it('createBusiness lowercases slug before repository call', async () => {
    const repo = createMockTenancyRepo();
    const service = createTenancyService({ repository: repo });
    await service.createBusiness({
      name: 'My Business',
      slug: 'My-Business-123',
      createdByUserId: MOCK_USER.id,
    });
    expect(repo.createBusiness).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'my-business-123' }),
    );
  });

  it('createBusiness defaults timezone Asia/Tehran and locale fa', async () => {
    const repo = createMockTenancyRepo();
    const service = createTenancyService({ repository: repo });
    await service.createBusiness({
      name: 'My Business',
      slug: 'my-business',
      createdByUserId: MOCK_USER.id,
    });
    expect(repo.createBusiness).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'Asia/Tehran', locale: 'fa' }),
    );
  });

  it('createBusiness rejects invalid slug with INVALID_TENANCY_INPUT', async () => {
    const repo = createMockTenancyRepo();
    const service = createTenancyService({ repository: repo });
    const result = await service.createBusiness({
      name: 'My Business',
      slug: 'a', // too short
      createdByUserId: MOCK_USER.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TENANCY_INPUT');
    }
  });

  it('updateBusiness rejects empty update object except businessId', async () => {
    const repo = createMockTenancyRepo();
    const service = createTenancyService({ repository: repo });
    const result = await service.updateBusiness({
      businessId: MOCK_BUSINESS.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TENANCY_INPUT');
    }
  });

  it('findBusinessBySlug lowercases slug', async () => {
    const repo = createMockTenancyRepo();
    const service = createTenancyService({ repository: repo });
    await service.findBusinessBySlug({ slug: 'Test-Business' });
    expect(repo.findBusinessBySlug).toHaveBeenCalledWith({ slug: 'test-business' });
  });

  it('createMembership defaults role VIEWER and status INVITED', async () => {
    const repo = createMockTenancyRepo();
    const service = createTenancyService({ repository: repo });
    await service.createMembership({
      businessId: MOCK_BUSINESS.id,
      userId: MOCK_USER.id,
    });
    expect(repo.createMembership).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'VIEWER', status: 'INVITED' }),
    );
  });

  it('resolveTenantContext passes repository TENANT_ACCESS_DENIED through', async () => {
    const repo = createMockTenancyRepo();
    vi.mocked(repo.resolveTenantContext).mockResolvedValueOnce(
      err('TENANT_ACCESS_DENIED', 'Tenant access denied'),
    );
    const service = createTenancyService({ repository: repo });
    const result = await service.resolveTenantContext({
      userId: MOCK_USER.id,
      businessId: MOCK_BUSINESS.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TENANT_ACCESS_DENIED');
    }
  });
});

// ===========================================================================
// Authz Service Tests
// ===========================================================================

describe('Authz Service', () => {
  it('createAuthzService exists and returns a service', () => {
    const service = createAuthzService();
    expect(service).toBeDefined();
    expect(typeof service.evaluateAccess).toBe('function');
  });

  it('evaluateAccess allows OWNER business.delete', async () => {
    const service = createAuthzService();
    const result = await service.evaluateAccess({
      userId: MOCK_USER.id,
      businessId: MOCK_BUSINESS.id,
      role: 'OWNER',
      permission: 'business.delete',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.allowed).toBe(true);
    }
  });

  it('requirePermission returns ACCESS_DENIED for VIEWER messages.create', async () => {
    const service = createAuthzService();
    const result = await service.requirePermission({
      userId: MOCK_USER.id,
      businessId: MOCK_BUSINESS.id,
      role: 'VIEWER',
      permission: 'messages.create',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ACCESS_DENIED');
    }
  });

  it('listRolePermissions returns permissions for OPERATOR', async () => {
    const service = createAuthzService();
    const result = await service.listRolePermissions({ role: 'OPERATOR' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('conversations.read');
      expect(result.data).toContain('messages.create');
      expect(result.data).not.toContain('business.delete');
    }
  });

  it('isSensitivePermission returns true for members.remove', async () => {
    const service = createAuthzService();
    const result = await service.isSensitivePermission('members.remove');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(true);
    }
  });

  it('isSensitivePermission rejects unknown permission with UNKNOWN_PERMISSION', async () => {
    const service = createAuthzService();
    const unsafeService = service as {
      isSensitivePermission(permission: unknown): ReturnType<typeof service.isSensitivePermission>;
    };
    const result = await unsafeService.isSensitivePermission('not.a.real.permission');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNKNOWN_PERMISSION');
    }
  });

  it('evaluateAccess rejects invalid role with INVALID_AUTHZ_INPUT', async () => {
    const service = createAuthzService();
    const unsafeService = service as {
      evaluateAccess(input: {
        userId: string;
        businessId: string;
        role: unknown;
        permission: 'business.read';
      }): ReturnType<typeof service.evaluateAccess>;
    };
    const result = await unsafeService.evaluateAccess({
      userId: MOCK_USER.id,
      businessId: MOCK_BUSINESS.id,
      role: 'INVALID_ROLE',
      permission: 'business.read',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_AUTHZ_INPUT');
    }
  });
});

// ===========================================================================
// Audit Service Tests
// ===========================================================================

describe('Audit Service', () => {
  it('createAuditService exists and returns a service', () => {
    const repo = createMockAuditRepo();
    const service = createAuditService({ repository: repo });
    expect(service).toBeDefined();
    expect(typeof service.createAuditEvent).toBe('function');
  });

  it('createAuditEvent accepts USER actor with actorUserId', async () => {
    const repo = createMockAuditRepo();
    const service = createAuditService({ repository: repo });
    const result = await service.createAuditEvent({
      actorType: 'USER',
      actorUserId: MOCK_USER.id,
      action: 'member.invited',
      result: 'SUCCESS',
    });
    expect(result.ok).toBe(true);
  });

  it('createAuditEvent rejects USER actor without actorUserId', async () => {
    const repo = createMockAuditRepo();
    const service = createAuditService({ repository: repo });
    const result = await service.createAuditEvent({
      actorType: 'USER',
      action: 'member.invited',
      result: 'SUCCESS',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_AUDIT_INPUT');
    }
  });

  it('createAuditEvent rejects invalid action', async () => {
    const repo = createMockAuditRepo();
    const service = createAuditService({ repository: repo });
    const result = await service.createAuditEvent({
      actorType: 'SYSTEM',
      action: 'A', // too short and starts uppercase
      result: 'SUCCESS',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_AUDIT_INPUT');
    }
  });

  it('listAuditEvents validates limit max 100', async () => {
    const repo = createMockAuditRepo();
    const service = createAuditService({ repository: repo });
    const result = await service.listAuditEvents({ limit: 500 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_AUDIT_INPUT');
    }
  });

  it('findAuditEventById rejects invalid uuid', async () => {
    const repo = createMockAuditRepo();
    const service = createAuditService({ repository: repo });
    const result = await service.findAuditEventById({ auditEventId: 'not-a-uuid' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_AUDIT_INPUT');
    }
  });

  it('repository failure is passed through', async () => {
    const repo = createMockAuditRepo();
    vi.mocked(repo.createAuditEvent).mockResolvedValueOnce(
      err('AUDIT_REPOSITORY_ERROR', 'DB down'),
    );
    const service = createAuditService({ repository: repo });
    const result = await service.createAuditEvent({
      actorType: 'SYSTEM',
      action: 'system.startup',
      result: 'SUCCESS',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUDIT_REPOSITORY_ERROR');
    }
  });
});

// ===========================================================================
// Domain Index Export Tests
// ===========================================================================

describe('Domain Index Exports', () => {
  it('importing createIdentityService from identity domain works', async () => {
    const mod = await import('../../src/domains/identity');
    expect(mod.createIdentityService).toBeDefined();
    expect(typeof mod.createIdentityService).toBe('function');
  });

  it('importing createTenancyService from tenancy domain works', async () => {
    const mod = await import('../../src/domains/tenancy');
    expect(mod.createTenancyService).toBeDefined();
    expect(typeof mod.createTenancyService).toBe('function');
  });

  it('importing createAuthzService from authz domain works', async () => {
    const mod = await import('../../src/domains/authz');
    expect(mod.createAuthzService).toBeDefined();
    expect(typeof mod.createAuthzService).toBe('function');
  });

  it('importing createAuditService from audit domain works', async () => {
    const mod = await import('../../src/domains/audit');
    expect(mod.createAuditService).toBeDefined();
    expect(typeof mod.createAuditService).toBe('function');
  });
});
