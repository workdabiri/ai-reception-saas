// ===========================================================================
// Tenancy Domain — Types
//
// Domain-level type definitions for businesses and memberships.
// ===========================================================================

import type { UserDisplayInfo } from '@/domains/identity/types';

// Re-export so existing callers importing UserDisplayInfo from tenancy still work.
export type { UserDisplayInfo };

/** Allowed business status values */
export const BUSINESS_STATUS_VALUES = [
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
] as const;

/** Allowed membership status values */
export const MEMBERSHIP_STATUS_VALUES = [
  'INVITED',
  'ACTIVE',
  'DECLINED',
  'EXPIRED',
  'REMOVED',
  'LEFT',
] as const;

/** Allowed membership role values */
export const MEMBERSHIP_ROLE_VALUES = [
  'OWNER',
  'ADMIN',
  'OPERATOR',
  'VIEWER',
] as const;

/** Business lifecycle status */
export type BusinessStatusValue = (typeof BUSINESS_STATUS_VALUES)[number];

/** Membership lifecycle status */
export type MembershipStatusValue = (typeof MEMBERSHIP_STATUS_VALUES)[number];

/** Membership role */
export type MembershipRoleValue = (typeof MEMBERSHIP_ROLE_VALUES)[number];

/** Domain representation of a business */
export interface BusinessIdentity {
  id: string;
  name: string;
  slug: string;
  status: BusinessStatusValue;
  timezone: string;
  locale: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}


/** Domain representation of a business membership */
export interface BusinessMembershipIdentity {
  id: string;
  businessId: string;
  userId: string;
  role: MembershipRoleValue;
  status: MembershipStatusValue;
  invitedByUserId: string | null;
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Resolved user display info (present when loaded via list query) */
  user?: UserDisplayInfo;
}

/** Resolved tenant context for the current request */
export interface TenantContext {
  businessId: string;
  userId: string;
  membershipId: string;
  role: MembershipRoleValue;
}

/** Input for creating a new business */
export interface CreateBusinessInput {
  name: string;
  slug: string;
  createdByUserId: string;
  timezone?: string;
  locale?: string;
}

/** Input for updating an existing business */
export interface UpdateBusinessInput {
  businessId: string;
  name?: string;
  slug?: string;
  status?: BusinessStatusValue;
  timezone?: string;
  locale?: string;
}

/** Input for creating a membership */
export interface CreateMembershipInput {
  businessId: string;
  userId: string;
  role?: MembershipRoleValue;
  status?: MembershipStatusValue;
  invitedByUserId?: string;
}

/** Input for updating a membership role */
export interface UpdateMembershipRoleInput {
  membershipId: string;
  role: MembershipRoleValue;
}

/** Input for updating a membership status */
export interface UpdateMembershipStatusInput {
  membershipId: string;
  status: MembershipStatusValue;
  joinedAt?: string;
}

/** Input for resolving tenant context */
export interface ResolveTenantContextInput {
  userId: string;
  businessId: string;
}
