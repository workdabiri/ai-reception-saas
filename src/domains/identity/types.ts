// ===========================================================================
// Identity Domain — Types
//
// Domain-level type definitions for users and sessions.
// These types mirror the Prisma schema but are decoupled from it.
// ===========================================================================

/** Allowed user status values */
export const USER_STATUS_VALUES = [
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
] as const;

/** User lifecycle status */
export type UserStatusValue = (typeof USER_STATUS_VALUES)[number];

/** Domain representation of a user identity */
export interface UserIdentity {
  id: string;
  email: string;
  name: string;
  locale: string;
  status: UserStatusValue;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Tenant-safe user display info — a read-only subset of UserIdentity.
 * Intentionally excludes email, locale, timestamps, and status to prevent
 * PII leakage across tenant-scoped API responses.
 */
export interface UserDisplayInfo {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** Domain representation of a session */
export interface SessionIdentity {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating a new user */
export interface CreateUserInput {
  email: string;
  name: string;
  locale?: string;
  avatarUrl?: string;
}

/** Input for updating an existing user */
export interface UpdateUserInput {
  name?: string;
  locale?: string;
  avatarUrl?: string | null;
  status?: UserStatusValue;
}

/** Input for creating a new session */
export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: string;
  ipAddress?: string;
  userAgent?: string;
}

/** Input for revoking a session */
export interface RevokeSessionInput {
  sessionId: string;
  revokedAt?: string;
}
