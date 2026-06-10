import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Identity domain imports
// ---------------------------------------------------------------------------

import {
  USER_STATUS_VALUES,
  createUserInputSchema,
  updateUserInputSchema,
  createSessionInputSchema,
  revokeSessionInputSchema,
} from '../../src/domains/identity';

// ---------------------------------------------------------------------------
// Tenancy domain imports
// ---------------------------------------------------------------------------

import {
  BUSINESS_STATUS_VALUES,
  MEMBERSHIP_STATUS_VALUES,
  MEMBERSHIP_ROLE_VALUES,
  createBusinessInputSchema,
  updateBusinessInputSchema,
  createMembershipInputSchema,
  tenantContextSchema,
} from '../../src/domains/tenancy';

// ---------------------------------------------------------------------------
// Authz domain imports
// ---------------------------------------------------------------------------

import {
  AUTHZ_PERMISSION_VALUES,
  hasPermission,
  isSensitivePermission,
  evaluateAccess,
  isKnownPermission,
  accessCheckInputSchema,
} from '../../src/domains/authz';

// ---------------------------------------------------------------------------
// Audit domain imports
// ---------------------------------------------------------------------------

import {
  AUDIT_ACTOR_TYPE_VALUES,
  AUDIT_RESULT_VALUES,
  createAuditEventInputSchema,
} from '../../src/domains/audit';

// ===========================================================================
// Identity Validation Tests
// ===========================================================================

describe('Identity Validation', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440000';

  it('createUserInputSchema lowercases and trims email', () => {
    const result = createUserInputSchema.parse({
      email: '  Test@Example.COM  ',
      name: 'Test User',
    });
    expect(result.email).toBe('test@example.com');
  });

  it('createUserInputSchema defaults locale to en', () => {
    const result = createUserInputSchema.parse({
      email: 'user@example.com',
      name: 'Test User',
    });
    expect(result.locale).toBe('en');
  });

  it('createUserInputSchema rejects invalid email', () => {
    const result = createUserInputSchema.safeParse({
      email: 'not-an-email',
      name: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('updateUserInputSchema rejects empty update object', () => {
    const result = updateUserInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('createSessionInputSchema accepts valid input', () => {
    const result = createSessionInputSchema.safeParse({
      userId: validUuid,
      tokenHash: 'a'.repeat(64),
      expiresAt: '2026-12-31T23:59:59.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('createSessionInputSchema rejects short tokenHash', () => {
    const result = createSessionInputSchema.safeParse({
      userId: validUuid,
      tokenHash: 'short',
      expiresAt: '2026-12-31T23:59:59.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('revokeSessionInputSchema accepts valid input', () => {
    const result = revokeSessionInputSchema.safeParse({
      sessionId: validUuid,
    });
    expect(result.success).toBe(true);
  });

  it('exports USER_STATUS_VALUES correctly', () => {
    expect(USER_STATUS_VALUES).toEqual(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']);
  });
});

// ===========================================================================
// Tenancy Validation Tests
// ===========================================================================

describe('Tenancy Validation', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440000';

  it('createBusinessInputSchema lowercases slug', () => {
    const result = createBusinessInputSchema.parse({
      name: 'My Business',
      slug: 'My-Business-123',
      createdByUserId: validUuid,
    });
    expect(result.slug).toBe('my-business-123');
  });

  it('createBusinessInputSchema defaults timezone and locale', () => {
    const result = createBusinessInputSchema.parse({
      name: 'My Business',
      slug: 'my-business',
      createdByUserId: validUuid,
    });
    expect(result.timezone).toBe('Asia/Tehran');
    expect(result.locale).toBe('fa');
  });

  it('createBusinessInputSchema rejects invalid slug', () => {
    const result = createBusinessInputSchema.safeParse({
      name: 'My Business',
      slug: '-invalid-slug-',
      createdByUserId: validUuid,
    });
    expect(result.success).toBe(false);
  });

  it('createBusinessInputSchema rejects too short slug', () => {
    const result = createBusinessInputSchema.safeParse({
      name: 'My Business',
      slug: 'ab',
      createdByUserId: validUuid,
    });
    expect(result.success).toBe(false);
  });

  it('updateBusinessInputSchema rejects empty update object except businessId', () => {
    const result = updateBusinessInputSchema.safeParse({
      businessId: validUuid,
    });
    expect(result.success).toBe(false);
  });

  it('createMembershipInputSchema defaults role to VIEWER and status to INVITED', () => {
    const result = createMembershipInputSchema.parse({
      businessId: validUuid,
      userId: validUuid,
    });
    expect(result.role).toBe('VIEWER');
    expect(result.status).toBe('INVITED');
  });

  it('tenantContextSchema accepts valid context', () => {
    const result = tenantContextSchema.safeParse({
      businessId: validUuid,
      userId: validUuid,
      membershipId: validUuid,
      role: 'OPERATOR',
    });
    expect(result.success).toBe(true);
  });

  it('exports status and role constants correctly', () => {
    expect(BUSINESS_STATUS_VALUES).toEqual(['ACTIVE', 'SUSPENDED', 'ARCHIVED']);
    expect(MEMBERSHIP_STATUS_VALUES).toEqual([
      'INVITED',
      'ACTIVE',
      'DECLINED',
      'EXPIRED',
      'REMOVED',
      'LEFT',
    ]);
    expect(MEMBERSHIP_ROLE_VALUES).toEqual([
      'OWNER',
      'ADMIN',
      'OPERATOR',
      'VIEWER',
    ]);
  });
});

// ===========================================================================
// Authz Tests
// ===========================================================================

describe('Authz Permissions', () => {
  it('OWNER has all permissions', () => {
    for (const perm of AUTHZ_PERMISSION_VALUES) {
      expect(hasPermission('OWNER', perm)).toBe(true);
    }
  });

  it('ADMIN cannot business.delete', () => {
    expect(hasPermission('ADMIN', 'business.delete')).toBe(false);
  });

  it('ADMIN has all other permissions', () => {
    const adminPerms = AUTHZ_PERMISSION_VALUES.filter(
      (p) => p !== 'business.delete',
    );
    for (const perm of adminPerms) {
      expect(hasPermission('ADMIN', perm)).toBe(true);
    }
  });

  it('OPERATOR can conversations.reply', () => {
    expect(hasPermission('OPERATOR', 'conversations.reply')).toBe(true);
  });

  it('VIEWER can messages.read', () => {
    expect(hasPermission('VIEWER', 'messages.read')).toBe(true);
  });

  it('VIEWER cannot messages.create', () => {
    expect(hasPermission('VIEWER', 'messages.create')).toBe(false);
  });

  it('isSensitivePermission returns true for members.remove', () => {
    expect(isSensitivePermission('members.remove')).toBe(true);
  });

  it('isSensitivePermission returns false for messages.read', () => {
    expect(isSensitivePermission('messages.read')).toBe(false);
  });

  it('evaluateAccess returns allowed false with reason ROLE_NOT_PERMITTED', () => {
    const decision = evaluateAccess({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      businessId: '550e8400-e29b-41d4-a716-446655440000',
      role: 'VIEWER',
      permission: 'messages.create',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('ROLE_NOT_PERMITTED');
  });

  it('evaluateAccess returns allowed true for permitted action', () => {
    const decision = evaluateAccess({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      businessId: '550e8400-e29b-41d4-a716-446655440000',
      role: 'OWNER',
      permission: 'business.delete',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it('isKnownPermission works correctly', () => {
    expect(isKnownPermission('business.read')).toBe(true);
    expect(isKnownPermission('unknown.perm')).toBe(false);
  });

  it('accessCheckInputSchema rejects invalid role', () => {
    const result = accessCheckInputSchema.safeParse({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      businessId: '550e8400-e29b-41d4-a716-446655440000',
      role: 'INVALID_ROLE',
      permission: 'business.read',
    });
    expect(result.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // ai_drafts.send permission tests
  // -------------------------------------------------------------------------

  it('ai_drafts.send is a known permission', () => {
    expect(isKnownPermission('ai_drafts.send')).toBe(true);
  });

  it('OWNER has ai_drafts.send', () => {
    expect(hasPermission('OWNER', 'ai_drafts.send')).toBe(true);
  });

  it('ADMIN has ai_drafts.send', () => {
    expect(hasPermission('ADMIN', 'ai_drafts.send')).toBe(true);
  });

  it('OPERATOR has ai_drafts.send', () => {
    expect(hasPermission('OPERATOR', 'ai_drafts.send')).toBe(true);
  });

  it('VIEWER does NOT have ai_drafts.send', () => {
    expect(hasPermission('VIEWER', 'ai_drafts.send')).toBe(false);
  });

  it('ai_drafts.send is a sensitive permission', () => {
    expect(isSensitivePermission('ai_drafts.send')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // ai_drafts regression: existing permissions unchanged
  // -------------------------------------------------------------------------

  it('ai_drafts.read remains a known permission', () => {
    expect(isKnownPermission('ai_drafts.read')).toBe(true);
  });

  it('ai_drafts.generate remains a known permission', () => {
    expect(isKnownPermission('ai_drafts.generate')).toBe(true);
  });

  it('ai_drafts.approve remains a known permission', () => {
    expect(isKnownPermission('ai_drafts.approve')).toBe(true);
  });

  it('OPERATOR retains ai_drafts.read', () => {
    expect(hasPermission('OPERATOR', 'ai_drafts.read')).toBe(true);
  });

  it('OPERATOR retains ai_drafts.generate', () => {
    expect(hasPermission('OPERATOR', 'ai_drafts.generate')).toBe(true);
  });

  it('OPERATOR retains ai_drafts.approve', () => {
    expect(hasPermission('OPERATOR', 'ai_drafts.approve')).toBe(true);
  });

  it('ai_drafts.approve remains sensitive', () => {
    expect(isSensitivePermission('ai_drafts.approve')).toBe(true);
  });
});

// ===========================================================================
// Audit Validation Tests
// ===========================================================================

describe('Audit Validation', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440000';

  it('accepts USER actor when actorUserId is present', () => {
    const result = createAuditEventInputSchema.safeParse({
      actorType: 'USER',
      actorUserId: validUuid,
      action: 'member.invited',
      result: 'SUCCESS',
    });
    expect(result.success).toBe(true);
  });

  it('rejects USER actor without actorUserId', () => {
    const result = createAuditEventInputSchema.safeParse({
      actorType: 'USER',
      action: 'member.invited',
      result: 'SUCCESS',
    });
    expect(result.success).toBe(false);
  });

  it('accepts SYSTEM actor without actorUserId', () => {
    const result = createAuditEventInputSchema.safeParse({
      actorType: 'SYSTEM',
      action: 'session.expired',
      result: 'SUCCESS',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action format', () => {
    const result = createAuditEventInputSchema.safeParse({
      actorType: 'SYSTEM',
      action: 'INVALID-Action!',
      result: 'SUCCESS',
    });
    expect(result.success).toBe(false);
  });

  it('accepts action with dots and colons', () => {
    const result = createAuditEventInputSchema.safeParse({
      actorType: 'SYSTEM',
      action: 'business.member:role.changed',
      result: 'SUCCESS',
    });
    expect(result.success).toBe(true);
  });

  it('exports audit constants correctly', () => {
    expect(AUDIT_ACTOR_TYPE_VALUES).toEqual([
      'USER',
      'SYSTEM',
      'AI_RECEPTIONIST',
    ]);
    expect(AUDIT_RESULT_VALUES).toEqual(['SUCCESS', 'DENIED', 'FAILED']);
  });
});

// ===========================================================================
// Domain Index Export Tests
// ===========================================================================

describe('Domain Index Exports', () => {
  it('identity domain exports work', async () => {
    const identity = await import('../../src/domains/identity');
    expect(identity.USER_STATUS_VALUES).toBeDefined();
    expect(identity.createUserInputSchema).toBeDefined();
  });

  it('tenancy domain exports work', async () => {
    const tenancy = await import('../../src/domains/tenancy');
    expect(tenancy.MEMBERSHIP_ROLE_VALUES).toBeDefined();
    expect(tenancy.createBusinessInputSchema).toBeDefined();
  });

  it('authz domain exports work', async () => {
    const authz = await import('../../src/domains/authz');
    expect(authz.AUTHZ_PERMISSION_VALUES).toBeDefined();
    expect(authz.hasPermission).toBeDefined();
    expect(authz.evaluateAccess).toBeDefined();
  });

  it('audit domain exports work', async () => {
    const audit = await import('../../src/domains/audit');
    expect(audit.AUDIT_ACTOR_TYPE_VALUES).toBeDefined();
    expect(audit.createAuditEventInputSchema).toBeDefined();
  });
});
