// ===========================================================================
// Authz Domain — Permissions
//
// Hardcoded role-permission map for MVP. This replaces database-backed
// permission tables until custom roles are needed.
// ===========================================================================

import type { MembershipRoleValue } from '../tenancy/types';
import {
  AUTHZ_PERMISSION_VALUES,
  type AuthzPermission,
  type AccessCheckInput,
  type AccessDecision,
  type RolePermissionMap,
} from './types';

// ---------------------------------------------------------------------------
// Role → Permission mapping
// ---------------------------------------------------------------------------

/** Complete role-to-permission mapping */
export const ROLE_PERMISSIONS: RolePermissionMap = {
  OWNER: [...AUTHZ_PERMISSION_VALUES],

  ADMIN: AUTHZ_PERMISSION_VALUES.filter((p) => p !== 'business.delete'),

  OPERATOR: [
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
  ],

  VIEWER: [
    'business.read',
    'customers.read',
    'conversations.read',
    'messages.read',
  ],
} as const;

// ---------------------------------------------------------------------------
// Sensitive permissions (require audit)
// ---------------------------------------------------------------------------

/** Permissions that require explicit audit logging */
export const SENSITIVE_PERMISSIONS: readonly AuthzPermission[] = [
  'business.delete',
  'members.invite',
  'members.remove',
  'members.change_role',
  'customers.update',
  'conversations.assign',
  'conversations.close',
  'ai_drafts.approve',
  'ai_drafts.send',
  'settings.update',
];

// ---------------------------------------------------------------------------
// Permission check functions
// ---------------------------------------------------------------------------

/** Type guard: checks if a string is a known permission */
export function isKnownPermission(
  permission: string,
): permission is AuthzPermission {
  return (AUTHZ_PERMISSION_VALUES as readonly string[]).includes(permission);
}

/** Checks whether a role has a given permission */
export function hasPermission(
  role: MembershipRoleValue,
  permission: AuthzPermission,
): boolean {
  const allowed = ROLE_PERMISSIONS[role];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(permission);
}

/** Checks whether a permission is sensitive (requires audit) */
export function isSensitivePermission(permission: AuthzPermission): boolean {
  return (SENSITIVE_PERMISSIONS as readonly string[]).includes(permission);
}

/** Evaluates an access check and returns a decision */
export function evaluateAccess(input: AccessCheckInput): AccessDecision {
  const { role, permission } = input;

  if (!isKnownPermission(permission)) {
    return { allowed: false, reason: 'UNKNOWN_PERMISSION' };
  }

  if (hasPermission(role, permission)) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'ROLE_NOT_PERMITTED' };
}
