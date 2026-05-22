import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Prisma Schema Structure Tests
 *
 * Validates the prisma/schema.prisma file contains the expected
 * enums, models, constraints, and mappings without requiring
 * a live database connection.
 */

const SCHEMA_PATH = path.resolve(__dirname, '../../prisma/schema.prisma');
const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enumExists(name: string): boolean {
  return new RegExp(`enum\\s+${name}\\s*\\{`).test(schema);
}

function enumHasValue(enumName: string, value: string): boolean {
  const match = schema.match(
    new RegExp(`enum\\s+${enumName}\\s*\\{([^}]+)\\}`, 's'),
  );
  if (!match) return false;
  return match[1].includes(value);
}

function modelExists(name: string): boolean {
  return new RegExp(`model\\s+${name}\\s*\\{`).test(schema);
}

function modelDoesNotExist(name: string): boolean {
  return !modelExists(name);
}

// ---------------------------------------------------------------------------
// Enum tests
// ---------------------------------------------------------------------------

describe('Prisma Schema — Enums', () => {
  it('defines UserStatus with ACTIVE, SUSPENDED, DEACTIVATED', () => {
    expect(enumExists('UserStatus')).toBe(true);
    expect(enumHasValue('UserStatus', 'ACTIVE')).toBe(true);
    expect(enumHasValue('UserStatus', 'SUSPENDED')).toBe(true);
    expect(enumHasValue('UserStatus', 'DEACTIVATED')).toBe(true);
  });

  it('defines BusinessStatus with ACTIVE, SUSPENDED, ARCHIVED', () => {
    expect(enumExists('BusinessStatus')).toBe(true);
    expect(enumHasValue('BusinessStatus', 'ACTIVE')).toBe(true);
    expect(enumHasValue('BusinessStatus', 'SUSPENDED')).toBe(true);
    expect(enumHasValue('BusinessStatus', 'ARCHIVED')).toBe(true);
  });

  it('defines MembershipStatus with INVITED, ACTIVE, DECLINED, EXPIRED, REMOVED, LEFT', () => {
    expect(enumExists('MembershipStatus')).toBe(true);
    expect(enumHasValue('MembershipStatus', 'INVITED')).toBe(true);
    expect(enumHasValue('MembershipStatus', 'ACTIVE')).toBe(true);
    expect(enumHasValue('MembershipStatus', 'DECLINED')).toBe(true);
    expect(enumHasValue('MembershipStatus', 'EXPIRED')).toBe(true);
    expect(enumHasValue('MembershipStatus', 'REMOVED')).toBe(true);
    expect(enumHasValue('MembershipStatus', 'LEFT')).toBe(true);
  });

  it('defines MembershipRole with OWNER, ADMIN, OPERATOR, VIEWER', () => {
    expect(enumExists('MembershipRole')).toBe(true);
    expect(enumHasValue('MembershipRole', 'OWNER')).toBe(true);
    expect(enumHasValue('MembershipRole', 'ADMIN')).toBe(true);
    expect(enumHasValue('MembershipRole', 'OPERATOR')).toBe(true);
    expect(enumHasValue('MembershipRole', 'VIEWER')).toBe(true);
  });

  it('defines AuditActorType with USER, SYSTEM, AI_RECEPTIONIST', () => {
    expect(enumExists('AuditActorType')).toBe(true);
    expect(enumHasValue('AuditActorType', 'USER')).toBe(true);
    expect(enumHasValue('AuditActorType', 'SYSTEM')).toBe(true);
    expect(enumHasValue('AuditActorType', 'AI_RECEPTIONIST')).toBe(true);
  });

  it('defines AuditResult with SUCCESS, DENIED, FAILED', () => {
    expect(enumExists('AuditResult')).toBe(true);
    expect(enumHasValue('AuditResult', 'SUCCESS')).toBe(true);
    expect(enumHasValue('AuditResult', 'DENIED')).toBe(true);
    expect(enumHasValue('AuditResult', 'FAILED')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Model existence tests
// ---------------------------------------------------------------------------

describe('Prisma Schema — Required Models', () => {
  it('defines User model', () => {
    expect(modelExists('User')).toBe(true);
  });

  it('defines Session model', () => {
    expect(modelExists('Session')).toBe(true);
  });

  it('defines Business model', () => {
    expect(modelExists('Business')).toBe(true);
  });

  it('defines BusinessMembership model', () => {
    expect(modelExists('BusinessMembership')).toBe(true);
  });

  it('defines AuditEvent model', () => {
    expect(modelExists('AuditEvent')).toBe(true);
  });

  it('defines Account model (Auth.js provider persistence)', () => {
    expect(modelExists('Account')).toBe(true);
  });

  it('defines VerificationToken model (Auth.js provider persistence)', () => {
    expect(modelExists('VerificationToken')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Forbidden model tests
// ---------------------------------------------------------------------------

describe('Prisma Schema — Forbidden Models', () => {
  it.each([
    'Role',
    'Permission',
    'RolePermission',
    'PolicyRule',
  ])('does not define deferred model: %s', (name) => {
    expect(modelDoesNotExist(name)).toBe(true);
  });

  it.each([
    'Conversation',
    'Message',
    'Channel',
    'Billing',
    'Analytics',
  ])('does not define out-of-scope model: %s', (name) => {
    expect(modelDoesNotExist(name)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Table mapping tests
// ---------------------------------------------------------------------------

describe('Prisma Schema — Table Mappings', () => {
  it('maps BusinessMembership to business_memberships', () => {
    expect(schema).toContain('@@map("business_memberships")');
  });

  it('maps AuditEvent to audit_events', () => {
    expect(schema).toContain('@@map("audit_events")');
  });

  it('maps User to users', () => {
    expect(schema).toContain('@@map("users")');
  });

  it('maps Session to sessions', () => {
    expect(schema).toContain('@@map("sessions")');
  });

  it('maps Business to businesses', () => {
    expect(schema).toContain('@@map("businesses")');
  });

  it('maps Account to accounts', () => {
    expect(schema).toContain('@@map("accounts")');
  });

  it('maps VerificationToken to verification_tokens', () => {
    expect(schema).toContain('@@map("verification_tokens")');
  });
});

// ---------------------------------------------------------------------------
// Constraint tests
// ---------------------------------------------------------------------------

describe('Prisma Schema — Constraints', () => {
  it('has unique constraint on userId + businessId in BusinessMembership', () => {
    expect(schema).toContain('@@unique([userId, businessId])');
  });

  it('has unique constraint on User email', () => {
    // Within the User model, email should have @unique
    const userModel = schema.match(/model\s+User\s*\{([\s\S]+?)\}/);
    expect(userModel).not.toBeNull();
    expect(userModel![1]).toContain('@unique');
    expect(userModel![1]).toContain('email');
  });

  it('has unique constraint on Session tokenHash', () => {
    const sessionModel = schema.match(/model\s+Session\s*\{([\s\S]+?)\}/);
    expect(sessionModel).not.toBeNull();
    expect(sessionModel![1]).toContain('tokenHash');
    expect(sessionModel![1]).toContain('@unique');
  });

  it('has unique constraint on Business slug', () => {
    const businessModel = schema.match(/model\s+Business\s*\{([\s\S]+?)\}/);
    expect(businessModel).not.toBeNull();
    expect(businessModel![1]).toContain('slug');
    expect(businessModel![1]).toContain('@unique');
  });

  it('has unique constraint on Account provider + providerAccountId', () => {
    expect(schema).toContain('@@unique([provider, providerAccountId])');
  });

  it('has unique constraint on VerificationToken identifier + token', () => {
    expect(schema).toContain('@@unique([identifier, token])');
  });
});

// ---------------------------------------------------------------------------
// Security tests — no provider-specific fields
// ---------------------------------------------------------------------------

describe('Prisma Schema — No Provider-Specific Fields', () => {
  it('does not contain clerkId', () => {
    expect(schema).not.toContain('clerkId');
  });

  it('does not contain supabaseUid', () => {
    expect(schema).not.toContain('supabaseUid');
  });

  it('does not contain auth0Id', () => {
    expect(schema).not.toContain('auth0Id');
  });
});

// ---------------------------------------------------------------------------
// Auth provider persistence tests (TASK-0031)
// ---------------------------------------------------------------------------

describe('Prisma Schema — Auth Provider Persistence (TASK-0031)', () => {
  it('User has emailVerified nullable DateTime field', () => {
    const userModel = schema.match(/model\s+User\s*\{([\s\S]+?)\}/);
    expect(userModel).not.toBeNull();
    expect(userModel![1]).toContain('emailVerified');
    expect(userModel![1]).toContain('DateTime?');
    expect(userModel![1]).toContain('@map("email_verified")');
  });

  it('User has accounts relation to Account[]', () => {
    const userModel = schema.match(/model\s+User\s*\{([\s\S]+?)\}/);
    expect(userModel).not.toBeNull();
    expect(userModel![1]).toContain('accounts');
    expect(userModel![1]).toContain('Account[]');
  });

  it('User does not have image field (uses avatarUrl)', () => {
    const userModel = schema.match(/model\s+User\s*\{([\s\S]+?)\}/);
    expect(userModel).not.toBeNull();
    // Must not contain standalone 'image' field — avatarUrl is canonical
    expect(userModel![1]).not.toMatch(/^\s+image\s/m);
  });

  it('User.name remains required (not nullable)', () => {
    const userModel = schema.match(/model\s+User\s*\{([\s\S]+?)\}/);
    expect(userModel).not.toBeNull();
    const nameLine = userModel![1].match(/^\s+name\s+.*/m);
    expect(nameLine).not.toBeNull();
    expect(nameLine![0]).toContain('String');
    expect(nameLine![0]).not.toContain('String?');
  });

  it('User.email remains required (not nullable)', () => {
    const userModel = schema.match(/model\s+User\s*\{([\s\S]+?)\}/);
    expect(userModel).not.toBeNull();
    const emailLine = userModel![1].match(/^\s+email\s+.*/m);
    expect(emailLine).not.toBeNull();
    expect(emailLine![0]).toContain('String');
    expect(emailLine![0]).not.toContain('String?');
  });

  it('Account model uses UUID primary key', () => {
    const accountModel = schema.match(/model\s+Account\s*\{([\s\S]+?)\}/);
    expect(accountModel).not.toBeNull();
    expect(accountModel![1]).toContain('@db.Uuid');
    expect(accountModel![1]).toContain('@default(uuid())');
  });

  it('Account has onDelete: Cascade to User', () => {
    const accountModel = schema.match(/model\s+Account\s*\{([\s\S]+?)\}/);
    expect(accountModel).not.toBeNull();
    expect(accountModel![1]).toContain('onDelete: Cascade');
  });

  it('Account has userId index', () => {
    const accountModel = schema.match(/model\s+Account\s*\{([\s\S]+?)\}/);
    expect(accountModel).not.toBeNull();
    expect(accountModel![1]).toContain('@@index([userId])');
  });

  it('Account has all required Auth.js fields', () => {
    const accountModel = schema.match(/model\s+Account\s*\{([\s\S]+?)\}/);
    expect(accountModel).not.toBeNull();
    const body = accountModel![1];
    expect(body).toContain('type');
    expect(body).toContain('provider');
    expect(body).toContain('providerAccountId');
    expect(body).toContain('refreshToken');
    expect(body).toContain('accessToken');
    expect(body).toContain('expiresAt');
    expect(body).toContain('tokenType');
    expect(body).toContain('scope');
    expect(body).toContain('idToken');
    expect(body).toContain('sessionState');
  });

  it('VerificationToken has no id field (uses composite key)', () => {
    const vtModel = schema.match(/model\s+VerificationToken\s*\{([\s\S]+?)\}/);
    expect(vtModel).not.toBeNull();
    expect(vtModel![1]).not.toContain('@id');
  });

  it('VerificationToken has identifier, token, and expires fields', () => {
    const vtModel = schema.match(/model\s+VerificationToken\s*\{([\s\S]+?)\}/);
    expect(vtModel).not.toBeNull();
    expect(vtModel![1]).toContain('identifier');
    expect(vtModel![1]).toContain('token');
    expect(vtModel![1]).toContain('expires');
  });

  it('VerificationToken has expires index for cleanup queries', () => {
    const vtModel = schema.match(/model\s+VerificationToken\s*\{([\s\S]+?)\}/);
    expect(vtModel).not.toBeNull();
    expect(vtModel![1]).toContain('@@index([expires])');
  });

  it('uses exact Auth.js model name Account (not AuthAccount)', () => {
    expect(modelExists('Account')).toBe(true);
    expect(modelDoesNotExist('AuthAccount')).toBe(true);
  });

  it('uses exact Auth.js model name VerificationToken (not AuthVerificationToken)', () => {
    expect(modelExists('VerificationToken')).toBe(true);
    expect(modelDoesNotExist('AuthVerificationToken')).toBe(true);
  });

  it('does not add Auth.js database Session model (JWT strategy)', () => {
    // There should be exactly one Session model — the internal one
    // AuthSession should not exist
    expect(modelDoesNotExist('AuthSession')).toBe(true);
    // Internal Session should exist with tokenHash (our internal model)
    const sessionModel = schema.match(/model\s+Session\s*\{([\s\S]+?)\}/);
    expect(sessionModel).not.toBeNull();
    expect(sessionModel![1]).toContain('tokenHash');
  });

  it('internal Session model remains unchanged', () => {
    const sessionModel = schema.match(/model\s+Session\s*\{([\s\S]+?)\}/);
    expect(sessionModel).not.toBeNull();
    const body = sessionModel![1];
    expect(body).toContain('tokenHash');
    expect(body).toContain('expiresAt');
    expect(body).toContain('revokedAt');
    expect(body).toContain('ipAddress');
    expect(body).toContain('userAgent');
    expect(body).toContain('@@map("sessions")');
  });
});

// ---------------------------------------------------------------------------
// CRM Domain model tests (R1)
// ---------------------------------------------------------------------------

describe('Prisma Schema — CRM Domain (R1)', () => {
  it('defines CustomerStatus enum with ACTIVE, ARCHIVED', () => {
    expect(enumExists('CustomerStatus')).toBe(true);
    expect(enumHasValue('CustomerStatus', 'ACTIVE')).toBe(true);
    expect(enumHasValue('CustomerStatus', 'ARCHIVED')).toBe(true);
  });

  it('defines ContactMethodType enum with all expected values', () => {
    expect(enumExists('ContactMethodType')).toBe(true);
    expect(enumHasValue('ContactMethodType', 'EMAIL')).toBe(true);
    expect(enumHasValue('ContactMethodType', 'PHONE')).toBe(true);
    expect(enumHasValue('ContactMethodType', 'WHATSAPP')).toBe(true);
    expect(enumHasValue('ContactMethodType', 'INSTAGRAM')).toBe(true);
    expect(enumHasValue('ContactMethodType', 'TELEGRAM')).toBe(true);
    expect(enumHasValue('ContactMethodType', 'WEBSITE_CHAT')).toBe(true);
    expect(enumHasValue('ContactMethodType', 'CUSTOM')).toBe(true);
  });

  it('defines Customer model', () => {
    expect(modelExists('Customer')).toBe(true);
  });

  it('defines CustomerContactMethod model', () => {
    expect(modelExists('CustomerContactMethod')).toBe(true);
  });

  it('Customer has required fields', () => {
    const model = schema.match(/model\s+Customer\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    const body = model![1];
    expect(body).toContain('businessId');
    expect(body).toContain('displayName');
    expect(body).toContain('status');
    expect(body).toContain('notes');
    expect(body).toContain('metadata');
    expect(body).toContain('locale');
  });

  it('Customer maps to customers table', () => {
    const model = schema.match(/model\s+Customer\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).toContain('@@map("customers")');
  });

  it('Customer has business scoping indexes', () => {
    const model = schema.match(/model\s+Customer\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).toContain('@@index([businessId, status])');
    expect(model![1]).toContain('@@index([businessId, createdAt])');
    expect(model![1]).toContain('@@index([businessId, displayName])');
  });

  it('CustomerContactMethod has identity resolution unique constraint', () => {
    expect(schema).toContain('@@unique([businessId, type, value])');
  });

  it('CustomerContactMethod maps to customer_contact_methods table', () => {
    const model = schema.match(/model\s+CustomerContactMethod\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).toContain('@@map("customer_contact_methods")');
  });

  it('CustomerContactMethod has cascade delete from Customer', () => {
    const model = schema.match(/model\s+CustomerContactMethod\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).toContain('onDelete: Cascade');
  });

  it('Customer does NOT contain forbidden concepts', () => {
    const model = schema.match(/model\s+Customer\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    const body = model![1];
    expect(body).not.toContain('serviceCategory');
    expect(body).not.toContain('mandoub');
    expect(body).not.toContain('order');
  });

  it('Business model has customers relation', () => {
    const model = schema.match(/model\s+Business\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).toContain('customers');
    expect(model![1]).toContain('Customer[]');
  });
});
