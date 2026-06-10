// ===========================================================================
// Authz Domain — Types
//
// Permission constants, access decision types, and access check input.
// ===========================================================================

import type { MembershipRoleValue } from '../tenancy/types';

/** All known permissions in the system */
export const AUTHZ_PERMISSION_VALUES = [
  'business.read',
  'business.update',
  'business.delete',
  'members.read',
  'members.invite',
  'members.remove',
  'members.change_role',
  'customers.read',
  'customers.update',
  'conversations.read',
  'conversations.reply',
  'conversations.assign',
  'conversations.close',
  'messages.read',
  'messages.create',
  'ai_drafts.read',
  'ai_drafts.generate',
  'ai_drafts.approve',
  'ai_drafts.send',
  'audit.read',
  'settings.read',
  'settings.update',
] as const;

/** A known permission string */
export type AuthzPermission = (typeof AUTHZ_PERMISSION_VALUES)[number];

/** Map of roles to their allowed permissions */
export type RolePermissionMap = Record<MembershipRoleValue, readonly AuthzPermission[]>;

/** Result of an access check */
export interface AccessDecision {
  allowed: boolean;
  reason?: string;
}

/** Input for evaluating access */
export interface AccessCheckInput {
  userId: string;
  businessId: string;
  role: MembershipRoleValue;
  permission: AuthzPermission;
}
