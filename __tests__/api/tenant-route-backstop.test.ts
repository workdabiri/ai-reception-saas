// ===========================================================================
// A-H4 — Auth/Tenant Middleware Backstop
//
// Proves the centralized defense-in-depth backstop denies a request whenever a
// handler holds a tenant context resolved for one business (Business A) while
// operating on a route for a different business (Business B).
//
// Three layers:
//
//   1. Shared guard (source of truth) — assertBusinessRouteMatchesTenant from
//      @/app/api/_shared/tenant-route-guard returns null when aligned and a
//      403 TENANT_ACCESS_DENIED response on mismatch.
//
//   2. Known-gap regression — createPatchBusinessByIdHandler (and its read
//      sibling createGetBusinessByIdHandler) previously lacked the route/
//      business mismatch check that every other business-scoped handler
//      already had (AREA-A remediation A-H4; identified by A-R4). These prove
//      the gap is now closed: a Business A context replayed against a Business
//      B route is denied BEFORE authz and BEFORE the domain service is called.
//
//   3. Cross-category backstop coverage — one handler from every business-
//      scoped category (membership, audit, customer, conversation/message,
//      reply-draft, dashboard) proves the same fail-closed behavior end to end.
//
// In every replay test the resolver is stubbed to return a Business A context
// regardless of the requested scope, modelling exactly the defect class the
// backstop defends against: a resolver / header path / dev adapter that yields
// a context for the wrong business. The role is OWNER (holds every permission)
// so the denial isolates the tenant/route backstop from RBAC — the backstop
// must fire before the permission grant is consulted.
//
// Scope: A-H4 only. No RLS, no policy engine. No schema/migration changes.
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';

import { assertBusinessRouteMatchesTenant } from '@/app/api/_shared/tenant-route-guard';
import {
  createTenantRequestContext,
  type TenantRequestContext,
  type TenantRequestScope,
  type ContextResult,
} from '@/app/api/_shared/request-context';
import { makeJsonRequest } from '@/app/api/_shared/request';
import { ok } from '@/lib/result';
import type { MembershipRoleValue } from '@/domains/tenancy/types';

import {
  createGetBusinessByIdHandler,
  createPatchBusinessByIdHandler,
} from '@/app/api/businesses/handler';
import { createGetBusinessMembershipsHandler } from '@/app/api/businesses/[businessId]/memberships/handler';
import { createGetAuditEventsHandler } from '@/app/api/businesses/[businessId]/audit-events/handler';
import { createPatchCustomerHandler } from '@/app/api/businesses/[businessId]/customers/handler';
import { createPostMessageHandler } from '@/app/api/businesses/[businessId]/conversations/handler';
import { createApproveDraftHandler } from '@/app/api/businesses/[businessId]/conversations/[conversationId]/reply-drafts/[draftId]/approve/handler';
import { createGetDashboardSummaryHandler } from '@/app/api/businesses/[businessId]/dashboard/summary/handler';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-4111-8111-111111111111';
/** Business A — the business the resolved tenant context belongs to. */
const CONTEXT_BUSINESS_ID = '44444444-4444-4444-8444-444444444444';
/** Business B — the business the route path targets. */
const ROUTE_BUSINESS_ID = '55555555-5555-4555-8555-555555555555';
const MEMBERSHIP_ID = '66666666-6666-4666-8666-666666666666';
const CONVERSATION_ID = '77777777-7777-4777-8777-777777777777';
const CUSTOMER_ID = '88888888-8888-4888-8888-888888888888';
const DRAFT_ID = '99999999-9999-4999-8999-999999999999';

function tenantContextForBusinessA(
  role: MembershipRoleValue = 'OWNER',
): TenantRequestContext {
  return createTenantRequestContext({
    requestId: null,
    tenant: {
      userId: USER_ID,
      businessId: CONTEXT_BUSINESS_ID,
      membershipId: MEMBERSHIP_ID,
      role,
    },
  });
}

/**
 * Resolver stub that always yields a Business A context, ignoring the scope the
 * handler requests. Models a resolved-context/route mismatch: the handler asked
 * to resolve Business B (route-param scope) but received a context for Business
 * A. The real Auth.js adapter never does this — the backstop exists for the day
 * a resolver, header path, or test/dev adapter does.
 */
function resolveAsBusinessA(
  role: MembershipRoleValue = 'OWNER',
): (
  request: Request,
  scope?: TenantRequestScope,
) => Promise<ContextResult<TenantRequestContext>> {
  return async () => ({ ok: true as const, context: tenantContextForBusinessA(role) });
}

/** Allow-all authz spy: proves the backstop fires BEFORE the permission grant. */
function allowAllAuthz() {
  return { requirePermission: vi.fn().mockResolvedValue(ok({ allowed: true })) };
}

async function bodyCode(r: Response): Promise<string> {
  return (await r.json()).error.code as string;
}

// ===========================================================================
// 1. Shared guard — source of truth
// ===========================================================================

describe('A-H4 shared backstop — assertBusinessRouteMatchesTenant', () => {
  it('returns null when the route businessId matches the tenant context', () => {
    const ctx = tenantContextForBusinessA('OWNER');
    expect(assertBusinessRouteMatchesTenant(ctx, CONTEXT_BUSINESS_ID)).toBeNull();
  });

  it('returns a 403 TENANT_ACCESS_DENIED response when route businessId differs', async () => {
    const ctx = tenantContextForBusinessA('OWNER');
    const res = assertBusinessRouteMatchesTenant(ctx, ROUTE_BUSINESS_ID);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
    expect(await bodyCode(res as Response)).toBe('TENANT_ACCESS_DENIED');
  });
});

// ===========================================================================
// 2. Known-gap regression — businesses/[businessId] handlers
//
// Before A-H4, these two handlers went straight from context resolution to
// requirePermission. With an OWNER-of-A context replayed against a B route,
// authz (OWNER holds business.update / business.read) would have ALLOWED, and
// the handler would have mutated/read Business B via the route param. The
// backstop now denies first.
// ===========================================================================

function businessDeps() {
  const tenancyService = {
    createBusiness: vi.fn(),
    listUserBusinesses: vi.fn(),
    findBusinessById: vi.fn(),
    updateBusiness: vi.fn(),
  };
  return {
    tenancyService,
    authzService: allowAllAuthz(),
    resolveTenantContext: resolveAsBusinessA('OWNER'),
  };
}

describe('A-H4 known-gap regression — businesses/[businessId]', () => {
  it('PATCH denies a Business A context on a Business B route → 403 TENANT_ACCESS_DENIED, no mutation', async () => {
    const d = businessDeps();
    const res = await createPatchBusinessByIdHandler(d)(
      makeJsonRequest({ name: 'Renamed Co' }),
      { businessId: ROUTE_BUSINESS_ID },
    );
    expect(res.status).toBe(403);
    expect(await bodyCode(res)).toBe('TENANT_ACCESS_DENIED');
    // Fails closed before authz and before the update service is reached.
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
    expect(d.tenancyService.updateBusiness).not.toHaveBeenCalled();
  });

  it('GET-by-id denies a Business A context on a Business B route → 403 TENANT_ACCESS_DENIED, no read', async () => {
    const d = businessDeps();
    const res = await createGetBusinessByIdHandler(d)(
      new Request('http://x'),
      { businessId: ROUTE_BUSINESS_ID },
    );
    expect(res.status).toBe(403);
    expect(await bodyCode(res)).toBe('TENANT_ACCESS_DENIED');
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
    expect(d.tenancyService.findBusinessById).not.toHaveBeenCalled();
  });

  it('PATCH still mutates when context and route agree (no false positive)', async () => {
    const tenancyService = {
      createBusiness: vi.fn(),
      listUserBusinesses: vi.fn(),
      findBusinessById: vi.fn(),
      updateBusiness: vi.fn().mockResolvedValue(
        ok({
          id: CONTEXT_BUSINESS_ID,
          name: 'Renamed Co',
          slug: 'renamed-co',
          status: 'ACTIVE',
          timezone: 'Asia/Tehran',
          locale: 'fa',
          createdByUserId: USER_ID,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
    };
    const d = {
      tenancyService,
      authzService: allowAllAuthz(),
      resolveTenantContext: resolveAsBusinessA('OWNER'),
    };
    // Route param now equals the context's business — guard must let it through.
    const res = await createPatchBusinessByIdHandler(d)(
      makeJsonRequest({ name: 'Renamed Co' }),
      { businessId: CONTEXT_BUSINESS_ID },
    );
    expect(res.status).toBe(200);
    expect(d.authzService.requirePermission).toHaveBeenCalledOnce();
    expect(tenancyService.updateBusiness).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// 3. Cross-category backstop coverage
//
// Each existing business-scoped category must also fail closed when a Business
// A context is replayed against a Business B route — proving the backstop is
// consistent across the surface, not just on the patched handler.
// ===========================================================================

describe('A-H4 cross-category backstop — Business A context replayed against Business B route', () => {
  it('membership handler denies and never lists memberships', async () => {
    const tenancyService = {
      createMembership: vi.fn(),
      findMembershipById: vi.fn(),
      listBusinessMemberships: vi.fn(),
      updateMembershipRole: vi.fn(),
      updateMembershipStatus: vi.fn(),
      removeMembership: vi.fn(),
    };
    const d = {
      tenancyService,
      authzService: allowAllAuthz(),
      resolveTenantContext: resolveAsBusinessA('OWNER'),
    };
    const res = await createGetBusinessMembershipsHandler(d)(new Request('http://x'), {
      businessId: ROUTE_BUSINESS_ID,
    });
    expect(res.status).toBe(403);
    expect(await bodyCode(res)).toBe('TENANT_ACCESS_DENIED');
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
    expect(tenancyService.listBusinessMemberships).not.toHaveBeenCalled();
  });

  it('audit handler denies and never lists audit events', async () => {
    const auditService = {
      listAuditEvents: vi.fn(),
      findAuditEventById: vi.fn(),
    };
    const d = {
      auditService,
      authzService: allowAllAuthz(),
      resolveTenantContext: resolveAsBusinessA('OWNER'),
    };
    const res = await createGetAuditEventsHandler(d)(new Request('http://x'), {
      businessId: ROUTE_BUSINESS_ID,
    });
    expect(res.status).toBe(403);
    expect(await bodyCode(res)).toBe('TENANT_ACCESS_DENIED');
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
    expect(auditService.listAuditEvents).not.toHaveBeenCalled();
  });

  it('customer handler denies and never updates the customer', async () => {
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
    const d = {
      crmService,
      auditService: { createAuditEvent: vi.fn() },
      authzService: allowAllAuthz(),
      resolveTenantContext: resolveAsBusinessA('OWNER'),
    };
    const res = await createPatchCustomerHandler(d)(makeJsonRequest({ status: 'ACTIVE' }), {
      businessId: ROUTE_BUSINESS_ID,
      customerId: CUSTOMER_ID,
    });
    expect(res.status).toBe(403);
    expect(await bodyCode(res)).toBe('TENANT_ACCESS_DENIED');
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
    expect(crmService.updateCustomer).not.toHaveBeenCalled();
  });

  it('conversation/message handler denies and never creates a message', async () => {
    const conversationService = {
      createConversation: vi.fn(),
      findConversationById: vi.fn(),
      listConversations: vi.fn(),
      updateConversation: vi.fn(),
      changeStatus: vi.fn(),
      createMessage: vi.fn(),
      listMessages: vi.fn(),
    };
    const d = {
      conversationService,
      authzService: allowAllAuthz(),
      resolveTenantContext: resolveAsBusinessA('OWNER'),
    };
    const res = await createPostMessageHandler(d)(
      makeJsonRequest({ content: 'hello', direction: 'OUTBOUND' }),
      { businessId: ROUTE_BUSINESS_ID, conversationId: CONVERSATION_ID },
    );
    expect(res.status).toBe(403);
    expect(await bodyCode(res)).toBe('TENANT_ACCESS_DENIED');
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
    expect(conversationService.createMessage).not.toHaveBeenCalled();
  });

  it('reply-draft handler denies and never reads the conversation or approves the draft', async () => {
    const replyDraftRepository = { approveDraft: vi.fn() };
    const conversationRepository = {
      findConversationById: vi.fn(),
      updateConversation: vi.fn(),
    };
    const d = {
      replyDraftRepository,
      conversationRepository,
      authzService: allowAllAuthz(),
      resolveTenantContext: resolveAsBusinessA('OWNER'),
    };
    const res = await createApproveDraftHandler(d)(
      new Request('http://x', { method: 'POST' }),
      { businessId: ROUTE_BUSINESS_ID, conversationId: CONVERSATION_ID, draftId: DRAFT_ID },
    );
    expect(res.status).toBe(403);
    expect(await bodyCode(res)).toBe('TENANT_ACCESS_DENIED');
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
    expect(conversationRepository.findConversationById).not.toHaveBeenCalled();
    expect(replyDraftRepository.approveDraft).not.toHaveBeenCalled();
  });

  it('dashboard handler denies and never runs aggregate queries', async () => {
    const conversationRepository = {
      countOpenConversations: vi.fn(),
      countByStatus: vi.fn(),
      countDraftsPendingReview: vi.fn(),
      countNeedingFollowUp: vi.fn(),
    };
    const auditRepository = { countDeniedEvents: vi.fn() };
    const d = {
      conversationRepository,
      auditRepository,
      authzService: allowAllAuthz(),
      resolveTenantContext: resolveAsBusinessA('OWNER'),
    };
    const res = await createGetDashboardSummaryHandler(d)(new Request('http://x'), {
      businessId: ROUTE_BUSINESS_ID,
    });
    expect(res.status).toBe(403);
    expect(await bodyCode(res)).toBe('TENANT_ACCESS_DENIED');
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
    expect(conversationRepository.countOpenConversations).not.toHaveBeenCalled();
    expect(auditRepository.countDeniedEvents).not.toHaveBeenCalled();
  });
});
