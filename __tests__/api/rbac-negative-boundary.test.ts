// ===========================================================================
// A-R4 — RBAC Negative-Boundary Tests
//
// Proves that roles, permissions, and membership states cannot reach actions
// outside their allowed boundary. Two complementary layers:
//
//   1. Catalog deny-set (source of truth) — the real authz catalog
//      (ROLE_PERMISSIONS / evaluateAccess / requirePermission) denies every
//      permission a role does not hold. Closes the audit's "OPERATOR
//      negative-boundary coverage is thin" gap (AREA-A-authorization.md §7).
//
//   2. Handler enforcement with the REAL catalog — every other handler test
//      mocks `authzService.requirePermission`; here we wire the real
//      `createAuthzService()` into the high-risk handlers and prove a
//      lower-privilege role is actually rejected end-to-end (403 ACCESS_DENIED)
//      and the underlying domain service is never invoked.
//
// Membership-state resolution (ACTIVE-only membership; suspended/archived
// business) is verified at the resolver layer by A-R3
// (__tests__/domains/tenant-identity-repositories.test.ts). This file proves
// the handler layer fails closed when resolution denies — it does not
// re-test the resolver internals.
//
// Scope: A-R4 only. No production code changed. No RLS, no policy engine.
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';

import { createAuthzService } from '@/domains/authz/implementation';
import {
  hasPermission,
  evaluateAccess,
  isSensitivePermission,
  ROLE_PERMISSIONS,
  SENSITIVE_PERMISSIONS,
} from '@/domains/authz/permissions';
import { AUTHZ_PERMISSION_VALUES, type AuthzPermission } from '@/domains/authz/types';
import type { MembershipRoleValue } from '@/domains/tenancy/types';

import {
  createTenantRequestContext,
  type TenantRequestContext,
  type ContextResult,
} from '@/app/api/_shared/request-context';
import { apiError } from '@/app/api/_shared/responses';
import { getHttpStatusForError } from '@/app/api/_shared/errors';
import { makeJsonRequest } from '@/app/api/_shared/request';
import { createDevHeaderAuthContextAdapter } from '@/app/api/_shared/auth-context-adapter';

import {
  createGetBusinessMembershipsHandler,
  createPostBusinessMembershipsHandler,
  createPatchMembershipRoleHandler,
  createDeleteMembershipHandler,
} from '@/app/api/businesses/[businessId]/memberships/handler';
import { createPatchBusinessByIdHandler } from '@/app/api/businesses/handler';
import { createGetAuditEventsHandler } from '@/app/api/businesses/[businessId]/audit-events/handler';
import { createPatchCustomerHandler } from '@/app/api/businesses/[businessId]/customers/handler';
import { createPostMessageHandler } from '@/app/api/businesses/[businessId]/conversations/handler';
import { createApproveDraftHandler } from '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/handler';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_USER_ID = '22222222-2222-4222-8222-222222222222';
const BUSINESS_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_BUSINESS_ID = '55555555-5555-4555-8555-555555555555';
const MEMBERSHIP_ID = '66666666-6666-4666-8666-666666666666';
const CONVERSATION_ID = '77777777-7777-4777-8777-777777777777';
const CUSTOMER_ID = '88888888-8888-4888-8888-888888888888';
const DRAFT_ID = '99999999-9999-4999-8999-999999999999';

/** The real RBAC catalog — wired into handlers exactly as composition does. */
const realAuthz = createAuthzService();

function tenantContextFor(
  role: MembershipRoleValue,
  businessId: string = BUSINESS_ID,
): TenantRequestContext {
  return createTenantRequestContext({
    requestId: null,
    tenant: { userId: USER_ID, businessId, membershipId: MEMBERSHIP_ID, role },
  });
}

/** Resolver stub that yields a tenant context for the given role/business. */
function resolveAs(
  role: MembershipRoleValue,
  businessId: string = BUSINESS_ID,
): () => Promise<ContextResult<TenantRequestContext>> {
  return async () => ({ ok: true as const, context: tenantContextFor(role, businessId) });
}

/**
 * Resolver stub that denies — models what the Auth.js adapter returns for a
 * non-member / inactive / removed / suspended principal (verified in A-R3).
 */
function resolveDenied(
  code: string,
  status: number,
): () => Promise<ContextResult<TenantRequestContext>> {
  return async () => ({ ok: false as const, response: apiError(code, code, status) });
}

/** Computes the set of permissions a role does NOT hold. */
function denySetFor(role: MembershipRoleValue): AuthzPermission[] {
  const allowed = new Set<string>(ROLE_PERMISSIONS[role]);
  return AUTHZ_PERMISSION_VALUES.filter((p) => !allowed.has(p));
}

// ===========================================================================
// 1. Catalog deny-set — source of truth
// ===========================================================================

const ROLES_WITH_DENIALS: readonly MembershipRoleValue[] = ['ADMIN', 'OPERATOR', 'VIEWER'];

const DENY_MATRIX: Array<[MembershipRoleValue, AuthzPermission]> = ROLES_WITH_DENIALS.flatMap(
  (role) =>
    denySetFor(role).map(
      (perm) => [role, perm] as [MembershipRoleValue, AuthzPermission],
    ),
);

describe('A-R4 catalog deny-set — pure helpers', () => {
  it('the matrix actually covers denials for ADMIN, OPERATOR, and VIEWER', () => {
    // Guards against a vacuous matrix if the catalog ever changes shape.
    expect(DENY_MATRIX.length).toBeGreaterThan(0);
    for (const role of ROLES_WITH_DENIALS) {
      expect(DENY_MATRIX.some(([r]) => r === role)).toBe(true);
    }
  });

  it.each(DENY_MATRIX)(
    '%s is denied %s by hasPermission + evaluateAccess (ROLE_NOT_PERMITTED)',
    (role, permission) => {
      expect(hasPermission(role, permission)).toBe(false);
      const decision = evaluateAccess({
        userId: USER_ID,
        businessId: BUSINESS_ID,
        role,
        permission,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('ROLE_NOT_PERMITTED');
    },
  );

  it.each(DENY_MATRIX)(
    '%s requirePermission(%s) → ACCESS_DENIED via the real AuthzService',
    async (role, permission) => {
      const result = await realAuthz.requirePermission({
        userId: USER_ID,
        businessId: BUSINESS_ID,
        role,
        permission,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('ACCESS_DENIED');
    },
  );
});

describe('A-R4 catalog deny-set — audit-aligned boundaries', () => {
  it('OWNER holds every permission (empty deny-set)', () => {
    expect(denySetFor('OWNER')).toEqual([]);
    for (const p of AUTHZ_PERMISSION_VALUES) {
      expect(hasPermission('OWNER', p)).toBe(true);
    }
  });

  it('ADMIN is denied only business.delete', () => {
    expect(denySetFor('ADMIN')).toEqual(['business.delete']);
  });

  it('OPERATOR cannot delete the business', () => {
    expect(hasPermission('OPERATOR', 'business.delete')).toBe(false);
  });

  it('OPERATOR cannot manage memberships (members.*)', () => {
    for (const p of [
      'members.read',
      'members.invite',
      'members.remove',
      'members.change_role',
    ] as const) {
      expect(hasPermission('OPERATOR', p)).toBe(false);
    }
  });

  it('OPERATOR cannot update business config or read audit/settings (security-sensitive)', () => {
    for (const p of [
      'business.update',
      'audit.read',
      'settings.read',
      'settings.update',
    ] as const) {
      expect(hasPermission('OPERATOR', p)).toBe(false);
    }
  });

  it('VIEWER is denied every write / sensitive permission', () => {
    const viewerDeny = denySetFor('VIEWER');
    for (const p of [
      'business.update',
      'business.delete',
      'members.invite',
      'members.remove',
      'members.change_role',
      'customers.update',
      'conversations.reply',
      'conversations.assign',
      'conversations.close',
      'messages.create',
      'ai_drafts.generate',
      'ai_drafts.approve',
      'ai_drafts.send',
      'settings.update',
      'audit.read',
    ] as const) {
      expect(viewerDeny).toContain(p);
      expect(hasPermission('VIEWER', p)).toBe(false);
    }
  });

  it('VIEWER retains only read permissions', () => {
    expect([...ROLE_PERMISSIONS.VIEWER].sort()).toEqual(
      ['business.read', 'conversations.read', 'customers.read', 'messages.read'].sort(),
    );
  });

  it('an unknown permission is never silently allowed', () => {
    const decision = evaluateAccess({
      userId: USER_ID,
      businessId: BUSINESS_ID,
      role: 'OWNER',
      // deliberately not a catalog permission
      permission: 'business.superuser' as AuthzPermission,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('UNKNOWN_PERMISSION');
  });
});

describe('A-R4 sensitive permissions are real and enforced', () => {
  it('every sensitive permission is a known catalog permission', () => {
    for (const p of SENSITIVE_PERMISSIONS) {
      expect((AUTHZ_PERMISSION_VALUES as readonly string[]).includes(p)).toBe(true);
    }
  });

  it('a role lacking a sensitive permission is denied with ACCESS_DENIED (mapped to 403)', async () => {
    const checks: Array<[MembershipRoleValue, AuthzPermission]> = [
      ['ADMIN', 'business.delete'],
      ['OPERATOR', 'members.invite'],
      ['OPERATOR', 'members.remove'],
      ['OPERATOR', 'members.change_role'],
      ['OPERATOR', 'settings.update'],
      ['VIEWER', 'customers.update'],
      ['VIEWER', 'conversations.assign'],
      ['VIEWER', 'conversations.close'],
      ['VIEWER', 'ai_drafts.approve'],
      ['VIEWER', 'ai_drafts.send'],
    ];
    for (const [role, permission] of checks) {
      expect(isSensitivePermission(permission)).toBe(true);
      const result = await realAuthz.requirePermission({
        userId: USER_ID,
        businessId: BUSINESS_ID,
        role,
        permission,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('ACCESS_DENIED');
    }
    // Authorization failures use the existing error/HTTP mapping consistently.
    expect(getHttpStatusForError('ACCESS_DENIED')).toBe(403);
    expect(getHttpStatusForError('TENANT_ACCESS_DENIED')).toBe(403);
  });
});

// ===========================================================================
// 2. Handler enforcement with the REAL catalog
// ===========================================================================

// --- Dependency builders (real authz + spy-able domain services) -----------

function membershipDeps(role: MembershipRoleValue, businessId: string = BUSINESS_ID) {
  const tenancyService = {
    createMembership: vi.fn(),
    findMembershipById: vi.fn(),
    listBusinessMemberships: vi.fn(),
    updateMembershipRole: vi.fn(),
    updateMembershipStatus: vi.fn(),
    removeMembership: vi.fn(),
  };
  return {
    tenancyService,
    authzService: realAuthz,
    resolveTenantContext: resolveAs(role, businessId),
  };
}

function businessDeps(role: MembershipRoleValue, businessId: string = BUSINESS_ID) {
  const tenancyService = {
    createBusiness: vi.fn(),
    listUserBusinesses: vi.fn(),
    findBusinessById: vi.fn(),
    updateBusiness: vi.fn(),
  };
  return {
    tenancyService,
    authzService: realAuthz,
    resolveTenantContext: resolveAs(role, businessId),
  };
}

function auditDeps(role: MembershipRoleValue, businessId: string = BUSINESS_ID) {
  const auditService = {
    listAuditEvents: vi.fn(),
    findAuditEventById: vi.fn(),
  };
  return {
    auditService,
    authzService: realAuthz,
    resolveTenantContext: resolveAs(role, businessId),
  };
}

function customerDeps(role: MembershipRoleValue) {
  const crmService = {
    createCustomer: vi.fn(),
    updateCustomer: vi.fn(),
    findCustomerById: vi.fn(),
    listCustomers: vi.fn(),
    archiveCustomer: vi.fn(),
    addContactMethod: vi.fn(),
    removeContactMethod: vi.fn(),
    listContactMethods: vi.fn(),
    findOrCreateByContact: vi.fn(),
  };
  const auditService = { createAuditEvent: vi.fn() };
  return {
    crmService,
    auditService,
    authzService: realAuthz,
    resolveTenantContext: resolveAs(role),
  };
}

function conversationDeps(role: MembershipRoleValue) {
  const conversationService = {
    createConversation: vi.fn(),
    findConversationById: vi.fn(),
    listConversations: vi.fn(),
    updateConversation: vi.fn(),
    changeStatus: vi.fn(),
    createMessage: vi.fn(),
    listMessages: vi.fn(),
  };
  return {
    conversationService,
    authzService: realAuthz,
    resolveTenantContext: resolveAs(role),
  };
}

function approveDraftDeps(role: MembershipRoleValue) {
  const replyDraftRepository = { approveDraft: vi.fn() };
  const conversationRepository = {
    findConversationById: vi.fn(),
    updateConversation: vi.fn(),
  };
  return {
    replyDraftRepository,
    conversationRepository,
    authzService: realAuthz,
    resolveTenantContext: resolveAs(role),
  };
}

async function bodyCode(r: Response): Promise<string> {
  return (await r.json()).error.code as string;
}

// --- Membership management (members.*) -------------------------------------

describe('A-R4 handler enforcement (real catalog) — membership management', () => {
  for (const role of ['OPERATOR', 'VIEWER'] as const) {
    it(`${role} cannot list memberships → 403 ACCESS_DENIED, no service call`, async () => {
      const d = membershipDeps(role);
      const r = await createGetBusinessMembershipsHandler(d)(new Request('http://x'), {
        businessId: BUSINESS_ID,
      });
      expect(r.status).toBe(403);
      expect(await bodyCode(r)).toBe('ACCESS_DENIED');
      expect(d.tenancyService.listBusinessMemberships).not.toHaveBeenCalled();
    });

    it(`${role} cannot invite a member → 403, no service call`, async () => {
      const d = membershipDeps(role);
      const r = await createPostBusinessMembershipsHandler(d)(
        makeJsonRequest({ userId: TARGET_USER_ID }),
        { businessId: BUSINESS_ID },
      );
      expect(r.status).toBe(403);
      expect(await bodyCode(r)).toBe('ACCESS_DENIED');
      expect(d.tenancyService.createMembership).not.toHaveBeenCalled();
    });

    it(`${role} cannot change a member's role → 403, no lookup or mutation`, async () => {
      const d = membershipDeps(role);
      const r = await createPatchMembershipRoleHandler(d)(
        makeJsonRequest({ role: 'ADMIN' }),
        { businessId: BUSINESS_ID, membershipId: MEMBERSHIP_ID },
      );
      expect(r.status).toBe(403);
      expect(await bodyCode(r)).toBe('ACCESS_DENIED');
      expect(d.tenancyService.findMembershipById).not.toHaveBeenCalled();
      expect(d.tenancyService.updateMembershipRole).not.toHaveBeenCalled();
    });

    it(`${role} cannot remove a member → 403, no lookup or mutation`, async () => {
      const d = membershipDeps(role);
      const r = await createDeleteMembershipHandler(d)(
        new Request('http://x', { method: 'DELETE' }),
        { businessId: BUSINESS_ID, membershipId: MEMBERSHIP_ID },
      );
      expect(r.status).toBe(403);
      expect(await bodyCode(r)).toBe('ACCESS_DENIED');
      expect(d.tenancyService.findMembershipById).not.toHaveBeenCalled();
      expect(d.tenancyService.removeMembership).not.toHaveBeenCalled();
    });
  }
});

// --- Owner/admin-only business config (business.update) ---------------------

describe('A-R4 handler enforcement (real catalog) — business configuration', () => {
  for (const role of ['OPERATOR', 'VIEWER'] as const) {
    it(`${role} cannot update the business → 403 ACCESS_DENIED, no mutation`, async () => {
      const d = businessDeps(role);
      const r = await createPatchBusinessByIdHandler(d)(
        makeJsonRequest({ name: 'Renamed Co' }),
        { businessId: BUSINESS_ID },
      );
      expect(r.status).toBe(403);
      expect(await bodyCode(r)).toBe('ACCESS_DENIED');
      expect(d.tenancyService.updateBusiness).not.toHaveBeenCalled();
    });
  }
});

// --- Audit / security-sensitive reads (audit.read) --------------------------

describe('A-R4 handler enforcement (real catalog) — audit log reads', () => {
  for (const role of ['OPERATOR', 'VIEWER'] as const) {
    it(`${role} cannot read the audit log → 403 ACCESS_DENIED, no service call`, async () => {
      const d = auditDeps(role);
      const r = await createGetAuditEventsHandler(d)(new Request('http://x'), {
        businessId: BUSINESS_ID,
      });
      expect(r.status).toBe(403);
      expect(await bodyCode(r)).toBe('ACCESS_DENIED');
      expect(d.auditService.listAuditEvents).not.toHaveBeenCalled();
    });
  }
});

// --- Customer mutations (customers.update) ----------------------------------

describe('A-R4 handler enforcement (real catalog) — customer mutations', () => {
  it('VIEWER cannot update a customer → 403 ACCESS_DENIED, no mutation', async () => {
    const d = customerDeps('VIEWER');
    const r = await createPatchCustomerHandler(d)(makeJsonRequest({ status: 'ACTIVE' }), {
      businessId: BUSINESS_ID,
      customerId: CUSTOMER_ID,
    });
    expect(r.status).toBe(403);
    expect(await bodyCode(r)).toBe('ACCESS_DENIED');
    expect(d.crmService.updateCustomer).not.toHaveBeenCalled();
  });
});

// --- Conversation mutations (messages.create) -------------------------------

describe('A-R4 handler enforcement (real catalog) — conversation mutations', () => {
  it('VIEWER cannot post a message → 403 ACCESS_DENIED, no mutation', async () => {
    const d = conversationDeps('VIEWER');
    const r = await createPostMessageHandler(d)(
      makeJsonRequest({ content: 'hello', direction: 'OUTBOUND' }),
      { businessId: BUSINESS_ID, conversationId: CONVERSATION_ID },
    );
    expect(r.status).toBe(403);
    expect(await bodyCode(r)).toBe('ACCESS_DENIED');
    expect(d.conversationService.createMessage).not.toHaveBeenCalled();
  });
});

// --- Reply-draft actions (ai_drafts.approve) --------------------------------

describe('A-R4 handler enforcement (real catalog) — reply-draft actions', () => {
  it('VIEWER cannot approve a reply draft → 403 ACCESS_DENIED, no repository call', async () => {
    const d = approveDraftDeps('VIEWER');
    const r = await createApproveDraftHandler(d)(new Request('http://x', { method: 'POST' }), {
      businessId: BUSINESS_ID,
      conversationId: CONVERSATION_ID,
      draftId: DRAFT_ID,
    });
    expect(r.status).toBe(403);
    expect(await bodyCode(r)).toBe('ACCESS_DENIED');
    expect(d.conversationRepository.findConversationById).not.toHaveBeenCalled();
    expect(d.replyDraftRepository.approveDraft).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3. Cross-business permission boundary
// ===========================================================================

describe('A-R4 cross-business permission boundary', () => {
  it('OWNER of business A is denied on business B when not a member (resolution denies)', async () => {
    // Real adapter: resolving business B for a non-member returns ACCESS_DENIED.
    const d = businessDeps('OWNER');
    d.resolveTenantContext = resolveDenied('ACCESS_DENIED', 403);
    const r = await createPatchBusinessByIdHandler(d)(makeJsonRequest({ name: 'Renamed Co' }), {
      businessId: OTHER_BUSINESS_ID,
    });
    expect(r.status).toBe(403);
    expect(await bodyCode(r)).toBe('ACCESS_DENIED');
    expect(d.tenancyService.updateBusiness).not.toHaveBeenCalled();
  });

  it('OWNER context for business A cannot be replayed against business B route (defense-in-depth)', async () => {
    // Context resolves to business A; the route targets business B. Even though
    // OWNER holds members.read in A, the tenant-route mismatch is rejected
    // before the permission grant is consulted.
    const d = membershipDeps('OWNER', BUSINESS_ID);
    const r = await createGetBusinessMembershipsHandler(d)(new Request('http://x'), {
      businessId: OTHER_BUSINESS_ID,
    });
    expect(r.status).toBe(403);
    expect(await bodyCode(r)).toBe('TENANT_ACCESS_DENIED');
    expect(d.tenancyService.listBusinessMemberships).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. Membership-state denial + no silent auth fallback (handler layer)
// ===========================================================================

describe('A-R4 membership-state denial propagates to tenant-scoped handlers', () => {
  // A-R3 verifies resolveTenantContext denies non-ACTIVE memberships
  // (INVITED/DECLINED/EXPIRED/REMOVED/LEFT) and SUSPENDED/ARCHIVED businesses
  // with TENANT_ACCESS_DENIED. These assert the handler fails closed on denial.

  it('a denied principal (no active membership) cannot create memberships → 403, no service call', async () => {
    const d = membershipDeps('OWNER');
    d.resolveTenantContext = resolveDenied('ACCESS_DENIED', 403);
    const r = await createPostBusinessMembershipsHandler(d)(
      makeJsonRequest({ userId: TARGET_USER_ID }),
      { businessId: BUSINESS_ID },
    );
    expect(r.status).toBe(403);
    expect(d.tenancyService.createMembership).not.toHaveBeenCalled();
  });

  it('a denied principal (suspended/archived business) cannot read the audit log → 403, no service call', async () => {
    const d = auditDeps('OWNER');
    d.resolveTenantContext = resolveDenied('TENANT_ACCESS_DENIED', 403);
    const r = await createGetAuditEventsHandler(d)(new Request('http://x'), {
      businessId: BUSINESS_ID,
    });
    expect(r.status).toBe(403);
    expect(d.auditService.listAuditEvents).not.toHaveBeenCalled();
  });
});

describe('A-R4 tenant-scoped auth does not silently fall back to a default context', () => {
  it('dev-header adapter fails closed (501) when dev auth is disabled — no fabricated tenant context', async () => {
    // Even with full dev headers present, a disabled dev-auth flag must NOT
    // produce a privileged tenant context.
    const adapter = createDevHeaderAuthContextAdapter({ env: {} });
    const result = await adapter.resolveTenant(
      new Request('http://x', {
        headers: {
          'x-dev-user-id': USER_ID,
          'x-dev-business-id': BUSINESS_ID,
          'x-dev-membership-id': MEMBERSHIP_ID,
          'x-dev-role': 'OWNER',
        },
      }),
      { businessId: BUSINESS_ID, source: 'route-param' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(501);
      expect(await bodyCode(result.response)).toBe('AUTH_CONTEXT_UNAVAILABLE');
    }
  });
});
