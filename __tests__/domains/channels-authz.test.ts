// ===========================================================================
// Tests — Channels Authz (Area C, P12-B)
//
// Locks the role mapping + sensitivity for the two new permissions:
//   channels.read   — OWNER + ADMIN only; OPERATOR + VIEWER denied; NON-sensitive.
//   channels.manage — OWNER + ADMIN only; OPERATOR + VIEWER denied; SENSITIVE.
// Also proves the addition is purely additive (no other role broadened).
// ===========================================================================

import { describe, it, expect } from 'vitest';

import {
  hasPermission,
  isSensitivePermission,
  ROLE_PERMISSIONS,
  SENSITIVE_PERMISSIONS,
} from '@/domains/authz/permissions';
import { AUTHZ_PERMISSION_VALUES } from '@/domains/authz/types';

const NEW_PERMS = ['channels.read', 'channels.manage'] as const;

describe('channels permissions are registered', () => {
  it('both new strings are in the catalog', () => {
    for (const p of NEW_PERMS) {
      expect((AUTHZ_PERMISSION_VALUES as readonly string[]).includes(p)).toBe(true);
    }
  });
});

describe('channels role mapping (OWNER/ADMIN only)', () => {
  it('OWNER and ADMIN hold both channels permissions', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      for (const p of NEW_PERMS) {
        expect(hasPermission(role, p)).toBe(true);
      }
    }
  });

  it('OPERATOR is denied both (not in alpha)', () => {
    for (const p of NEW_PERMS) {
      expect(hasPermission('OPERATOR', p)).toBe(false);
    }
  });

  it('VIEWER is denied both', () => {
    for (const p of NEW_PERMS) {
      expect(hasPermission('VIEWER', p)).toBe(false);
    }
  });
});

describe('channels sensitivity classification', () => {
  it('channels.manage is sensitive / audit-required', () => {
    expect(isSensitivePermission('channels.manage')).toBe(true);
    expect((SENSITIVE_PERMISSIONS as readonly string[]).includes('channels.manage')).toBe(
      true,
    );
  });

  it('channels.read is NOT sensitive for alpha', () => {
    expect(isSensitivePermission('channels.read')).toBe(false);
    expect((SENSITIVE_PERMISSIONS as readonly string[]).includes('channels.read')).toBe(
      false,
    );
  });
});

describe('the addition is purely additive (no existing role broadened)', () => {
  it('VIEWER retains exactly its prior read-only set (no channels.* added)', () => {
    expect([...ROLE_PERMISSIONS.VIEWER].sort()).toEqual(
      [
        'business.read',
        'conversations.read',
        'customers.read',
        'messages.read',
        'knowledge.read',
      ].sort(),
    );
  });

  it('OPERATOR gained no channels.* permission', () => {
    const op = ROLE_PERMISSIONS.OPERATOR as readonly string[];
    expect(op.some((p) => p.startsWith('channels.'))).toBe(false);
  });
});
