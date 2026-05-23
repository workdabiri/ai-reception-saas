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

// ---------------------------------------------------------------------------
// Conversations + Message Domain tests (R2)
// ---------------------------------------------------------------------------

describe('Prisma Schema — Conversations Domain (R2)', () => {
  // Enums
  it('defines ConversationStatus enum with all MVP values', () => {
    expect(enumExists('ConversationStatus')).toBe(true);
    expect(enumHasValue('ConversationStatus', 'NEW')).toBe(true);
    expect(enumHasValue('ConversationStatus', 'OPEN')).toBe(true);
    expect(enumHasValue('ConversationStatus', 'ASSIGNED')).toBe(true);
    expect(enumHasValue('ConversationStatus', 'WAITING_CUSTOMER')).toBe(true);
    expect(enumHasValue('ConversationStatus', 'WAITING_OPERATOR')).toBe(true);
    expect(enumHasValue('ConversationStatus', 'ESCALATED')).toBe(true);
    expect(enumHasValue('ConversationStatus', 'RESOLVED')).toBe(true);
  });

  it('defines MessageDirection enum', () => {
    expect(enumExists('MessageDirection')).toBe(true);
    expect(enumHasValue('MessageDirection', 'INBOUND')).toBe(true);
    expect(enumHasValue('MessageDirection', 'OUTBOUND')).toBe(true);
    expect(enumHasValue('MessageDirection', 'SYSTEM')).toBe(true);
    expect(enumHasValue('MessageDirection', 'INTERNAL')).toBe(true);
  });

  it('defines MessageSenderType enum', () => {
    expect(enumExists('MessageSenderType')).toBe(true);
    expect(enumHasValue('MessageSenderType', 'CUSTOMER')).toBe(true);
    expect(enumHasValue('MessageSenderType', 'OPERATOR')).toBe(true);
    expect(enumHasValue('MessageSenderType', 'SYSTEM')).toBe(true);
    expect(enumHasValue('MessageSenderType', 'AI_RECEPTIONIST')).toBe(true);
  });

  it('defines ChannelType enum', () => {
    expect(enumExists('ChannelType')).toBe(true);
    expect(enumHasValue('ChannelType', 'INTERNAL')).toBe(true);
    expect(enumHasValue('ChannelType', 'WEBSITE_CHAT')).toBe(true);
  });

  it('defines AiClassificationStatus enum', () => {
    expect(enumExists('AiClassificationStatus')).toBe(true);
    expect(enumHasValue('AiClassificationStatus', 'NOT_REQUESTED')).toBe(true);
    expect(enumHasValue('AiClassificationStatus', 'PENDING')).toBe(true);
    expect(enumHasValue('AiClassificationStatus', 'READY')).toBe(true);
    expect(enumHasValue('AiClassificationStatus', 'FAILED')).toBe(true);
  });

  it('defines AiDraftStatus enum', () => {
    expect(enumExists('AiDraftStatus')).toBe(true);
    expect(enumHasValue('AiDraftStatus', 'NOT_REQUESTED')).toBe(true);
    expect(enumHasValue('AiDraftStatus', 'PENDING')).toBe(true);
    expect(enumHasValue('AiDraftStatus', 'READY')).toBe(true);
    expect(enumHasValue('AiDraftStatus', 'APPROVED')).toBe(true);
    expect(enumHasValue('AiDraftStatus', 'REJECTED')).toBe(true);
    expect(enumHasValue('AiDraftStatus', 'FAILED')).toBe(true);
  });

  // Models
  it('defines Conversation model', () => {
    expect(modelExists('Conversation')).toBe(true);
  });

  it('defines Message model', () => {
    expect(modelExists('Message')).toBe(true);
  });

  // Conversation required fields
  it('Conversation has required fields', () => {
    const model = schema.match(/model\s+Conversation\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    const body = model![1];
    expect(body).toContain('business_id');
    expect(body).toContain('customer_id');
    expect(body).toContain('channel');
    expect(body).toContain('status');
    expect(body).toContain('assigned_user_id');
    expect(body).toContain('ai_classification_status');
    expect(body).toContain('ai_draft_status');
    expect(body).toContain('channel_metadata');
    expect(body).toContain('closed_at');
    expect(body).toContain('created_at');
    expect(body).toContain('updated_at');
  });

  // Conversation table mapping
  it('Conversation maps to conversations table', () => {
    const model = schema.match(/model\s+Conversation\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).toContain('@@map("conversations")');
  });

  // Conversation indexes
  it('Conversation has business scoping indexes', () => {
    const model = schema.match(/model\s+Conversation\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).toContain('@@index([businessId, status])');
    expect(model![1]).toContain('@@index([businessId, createdAt])');
    expect(model![1]).toContain('@@index([businessId, assignedUserId])');
    expect(model![1]).toContain('@@index([customerId])');
    expect(model![1]).toContain('@@index([businessId, channel])');
  });

  // Conversation composite unique for tenant-safe FK from messages
  it('Conversation has @@unique([id, businessId]) for composite FK', () => {
    const model = schema.match(/model\s+Conversation\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).toContain('@@unique([id, businessId])');
  });

  // Message required fields
  it('Message has required fields', () => {
    const model = schema.match(/model\s+Message\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    const body = model![1];
    expect(body).toContain('conversation_id');
    expect(body).toContain('business_id');
    expect(body).toContain('direction');
    expect(body).toContain('sender_type');
    expect(body).toContain('sender_user_id');
    expect(body).toContain('content');
    expect(body).toContain('content_type');
    expect(body).toContain('created_at');
  });

  // Message has NO updatedAt (immutable)
  it('Message does NOT have updatedAt (immutable by design)', () => {
    const model = schema.match(/model\s+Message\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).not.toContain('updatedAt');
    expect(model![1]).not.toContain('updated_at');
  });

  // Message table mapping
  it('Message maps to messages table', () => {
    const model = schema.match(/model\s+Message\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).toContain('@@map("messages")');
  });

  // Message indexes
  it('Message has performance indexes', () => {
    const model = schema.match(/model\s+Message\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).toContain('@@index([conversationId, createdAt])');
    expect(model![1]).toContain('@@index([businessId, createdAt])');
    expect(model![1]).toContain('@@index([senderUserId])');
    expect(model![1]).toContain('@@index([senderCustomerId])');
  });

  // Message composite conversation relation enforces tenant consistency
  it('Message.conversation uses composite FK [conversationId, businessId]', () => {
    const model = schema.match(/model\s+Message\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    const body = model![1];
    expect(body).toContain('fields: [conversationId, businessId]');
    expect(body).toContain('references: [id, businessId]');
  });

  // senderCustomerId UUID + FK
  it('Message.senderCustomerId is UUID with Customer relation', () => {
    const model = schema.match(/model\s+Message\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    const body = model![1];
    expect(body).toContain('sender_customer_id');
    expect(body).toContain('@db.Uuid');
    expect(body).toContain('MessageSenderCustomer');
    expect(body).toContain('onDelete: SetNull');
  });

  // Relations
  it('Business has conversations relation', () => {
    const model = schema.match(/model\s+Business\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).toContain('Conversation[]');
  });

  it('Customer has conversations relation', () => {
    const model = schema.match(/model\s+Customer\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).toContain('conversations');
  });

  it('Customer has sentMessages relation for MessageSenderCustomer', () => {
    const model = schema.match(/model\s+Customer\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    expect(model![1]).toContain('sentMessages');
    expect(model![1]).toContain('MessageSenderCustomer');
  });

  // Forbidden concepts in Conversation/Message
  it('Conversation does NOT contain forbidden concepts', () => {
    const model = schema.match(/model\s+Conversation\s*\{([\s\S]+?)\}/);
    expect(model).not.toBeNull();
    const body = model![1];
    expect(body).not.toContain('serviceCategory');
    expect(body).not.toContain('mandoub');
    expect(body).not.toContain('order');
  });
});

// ---------------------------------------------------------------------------
// RLS in migration SQL tests
// ---------------------------------------------------------------------------

describe('Prisma Schema — R2 Migration RLS', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../prisma/migrations/20260523124455_add_conversation_message_foundation/migration.sql',
  );
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration enables RLS on conversations table', () => {
    expect(migrationSql).toContain(
      'ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY',
    );
  });

  it('migration enables RLS on messages table', () => {
    expect(migrationSql).toContain(
      'ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY',
    );
  });

  it('migration creates sender_customer_id as UUID not TEXT', () => {
    expect(migrationSql).toContain('"sender_customer_id" UUID');
    expect(migrationSql).not.toMatch(/"sender_customer_id"\s+TEXT/);
  });

  it('migration creates FK for sender_customer_id to customers', () => {
    expect(migrationSql).toContain(
      'messages_sender_customer_id_fkey',
    );
  });

  it('migration creates index on sender_customer_id', () => {
    expect(migrationSql).toContain(
      'messages_sender_customer_id_idx',
    );
  });

  // Composite unique + FK for message tenant consistency
  it('migration creates composite unique constraint on conversations(id, business_id)', () => {
    expect(migrationSql).toContain(
      'conversations_id_business_id_key',
    );
    expect(migrationSql).toMatch(
      /UNIQUE\s*\("id",\s*"business_id"\)/,
    );
  });

  it('migration creates composite FK for messages(conversation_id, business_id)', () => {
    expect(migrationSql).toContain(
      'messages_conversation_id_business_id_fkey',
    );
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("conversation_id", "business_id"\)\s+REFERENCES "conversations"\("id", "business_id"\)/,
    );
  });

  it('migration does NOT have old simple conversation_id FK', () => {
    expect(migrationSql).not.toContain(
      'messages_conversation_id_fkey',
    );
  });
});
