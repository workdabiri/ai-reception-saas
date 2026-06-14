// ===========================================================================
// Memberships — Business Membership API Handler Module
//
// Handler builders for business membership operations.
// Uses dependency injection for testability.
// Context resolution must succeed before any service call.
// Authz must pass before membership operations.
// Membership business ownership checked before mutations.
// ===========================================================================

import { z } from 'zod';
import { actionResultToResponse } from '@/app/api/_shared/action-result';
import { validateJsonBody } from '@/app/api/_shared/request';
import {
  validateRouteParams,
  parseBooleanQueryParam,
  getSearchParam,
} from '@/app/api/_shared/params';
import {
  resolveTenantRequestContext,
  type TenantRequestContext,
  type TenantRequestScope,
  type ContextResult,
} from '@/app/api/_shared/request-context';
import { apiError } from '@/app/api/_shared/responses';
import { assertBusinessRouteMatchesTenant } from '@/app/api/_shared/tenant-route-guard';
import type { TenancyService } from '@/domains/tenancy/service';
import type { AuthzService } from '@/domains/authz/service';
import type { AuthzPermission } from '@/domains/authz/types';
import {
  membershipRoleSchema,
  membershipStatusSchema,
} from '@/domains/tenancy/validation';
import type { BusinessMembershipIdentity } from '@/domains/tenancy/types';

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

const businessIdParamsSchema = z.object({
  businessId: z.string().uuid(),
});

const businessMembershipParamsSchema = z.object({
  businessId: z.string().uuid(),
  membershipId: z.string().uuid(),
});

const createMembershipRequestBodySchema = z
  .object({
    userId: z.string().uuid(),
    role: membershipRoleSchema.optional(),
    status: membershipStatusSchema.optional(),
  })
  .strict();

const updateMembershipRoleRequestBodySchema = z
  .object({
    role: membershipRoleSchema,
  })
  .strict();

const updateMembershipStatusRequestBodySchema = z
  .object({
    status: membershipStatusSchema,
    joinedAt: z.string().datetime().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/** Dependencies required by the business membership handler module */
export interface BusinessMembershipsHandlerDeps {
  readonly tenancyService: Pick<
    TenancyService,
    | 'createMembership'
    | 'findMembershipById'
    | 'listBusinessMemberships'
    | 'updateMembershipRole'
    | 'updateMembershipStatus'
    | 'removeMembership'
  >;
  readonly authzService: Pick<AuthzService, 'requirePermission'>;
  readonly resolveTenantContext?: (
    request: Request,
    scope?: TenantRequestScope,
  ) => Promise<ContextResult<TenantRequestContext>>;
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function requireMembershipPermission(
  deps: BusinessMembershipsHandlerDeps,
  context: TenantRequestContext,
  permission: AuthzPermission,
): Promise<Response | null> {
  const authzResult = await deps.authzService.requirePermission({
    userId: context.userId,
    businessId: context.businessId,
    role: context.role,
    permission,
  });

  if (!authzResult.ok) {
    return actionResultToResponse(authzResult);
  }

  if (!authzResult.data.allowed) {
    return apiError('ACCESS_DENIED', 'Access denied', 403);
  }

  return null;
}

function ensureMembershipBelongsToBusiness(
  membership: BusinessMembershipIdentity,
  businessId: string,
): Response | null {
  if (membership.businessId !== businessId) {
    return apiError('TENANT_ACCESS_DENIED', 'Tenant access denied', 403);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler builders
// ---------------------------------------------------------------------------

/**
 * GET /api/businesses/:businessId/memberships
 *
 * 1. Resolve tenant context
 * 2. Validate businessId param
 * 3. Check businessId matches tenant
 * 4. Require members.read permission
 * 5. Parse includeRemoved query param
 * 6. Call listBusinessMemberships
 */
export function createGetBusinessMembershipsHandler(
  deps: BusinessMembershipsHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // Parse route params first for explicit scope
    const paramsResult = validateRouteParams(
      params,
      businessIdParamsSchema,
      'INVALID_TENANCY_INPUT',
      'Invalid tenancy input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireMembershipPermission(deps, contextResult.context, 'members.read');
    if (authzErr) return authzErr;

    const includeRemoved = parseBooleanQueryParam(
      getSearchParam(request, 'includeRemoved'),
    );

    const result = await deps.tenancyService.listBusinessMemberships({
      businessId,
      includeRemoved: includeRemoved ?? false,
    });

    return actionResultToResponse(result);
  };
}

/**
 * POST /api/businesses/:businessId/memberships
 *
 * 1. Resolve tenant context
 * 2. Validate businessId param
 * 3. Check businessId matches tenant
 * 4. Require members.invite permission
 * 5. Validate JSON body
 * 6. Call createMembership with route businessId and context userId as invitedByUserId
 */
export function createPostBusinessMembershipsHandler(
  deps: BusinessMembershipsHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // Parse route params first for explicit scope
    const paramsResult = validateRouteParams(
      params,
      businessIdParamsSchema,
      'INVALID_TENANCY_INPUT',
      'Invalid tenancy input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireMembershipPermission(deps, contextResult.context, 'members.invite');
    if (authzErr) return authzErr;

    const bodyResult = await validateJsonBody(
      request,
      createMembershipRequestBodySchema,
      'INVALID_TENANCY_INPUT',
      'Invalid tenancy input',
    );
    if (!bodyResult.ok) return bodyResult.response;

    const result = await deps.tenancyService.createMembership({
      businessId,
      userId: bodyResult.data.userId,
      role: bodyResult.data.role,
      status: bodyResult.data.status,
      invitedByUserId: contextResult.context.userId,
    });

    return actionResultToResponse(result);
  };
}

/**
 * PATCH /api/businesses/:businessId/memberships/:membershipId/role
 *
 * 1. Resolve tenant context
 * 2. Validate businessId + membershipId params
 * 3. Check businessId matches tenant
 * 4. Require members.change_role permission
 * 5. Validate JSON body role
 * 6. Find membership by ID
 * 7. Check membership belongs to business
 * 8. Update role
 */
export function createPatchMembershipRoleHandler(
  deps: BusinessMembershipsHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // Parse route params first for explicit scope
    const paramsResult = validateRouteParams(
      params,
      businessMembershipParamsSchema,
      'INVALID_TENANCY_INPUT',
      'Invalid tenancy input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, membershipId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireMembershipPermission(deps, contextResult.context, 'members.change_role');
    if (authzErr) return authzErr;

    const bodyResult = await validateJsonBody(
      request,
      updateMembershipRoleRequestBodySchema,
      'INVALID_TENANCY_INPUT',
      'Invalid tenancy input',
    );
    if (!bodyResult.ok) return bodyResult.response;

    const findResult = await deps.tenancyService.findMembershipById({ membershipId });
    if (!findResult.ok) return actionResultToResponse(findResult);
    if (findResult.data === null) {
      return apiError('MEMBERSHIP_NOT_FOUND', 'Membership not found', 404);
    }

    const ownershipErr = ensureMembershipBelongsToBusiness(findResult.data, businessId);
    if (ownershipErr) return ownershipErr;

    const result = await deps.tenancyService.updateMembershipRole({
      membershipId,
      role: bodyResult.data.role,
    });

    return actionResultToResponse(result);
  };
}

/**
 * PATCH /api/businesses/:businessId/memberships/:membershipId/status
 *
 * 1. Resolve tenant context
 * 2. Validate businessId + membershipId params
 * 3. Check businessId matches tenant
 * 4. Require members.change_role permission (no explicit members.change_status)
 * 5. Validate JSON body status/joinedAt
 * 6. Find membership by ID
 * 7. Check membership belongs to business
 * 8. Update status
 */
export function createPatchMembershipStatusHandler(
  deps: BusinessMembershipsHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // Parse route params first for explicit scope
    const paramsResult = validateRouteParams(
      params,
      businessMembershipParamsSchema,
      'INVALID_TENANCY_INPUT',
      'Invalid tenancy input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, membershipId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireMembershipPermission(deps, contextResult.context, 'members.change_role');
    if (authzErr) return authzErr;

    const bodyResult = await validateJsonBody(
      request,
      updateMembershipStatusRequestBodySchema,
      'INVALID_TENANCY_INPUT',
      'Invalid tenancy input',
    );
    if (!bodyResult.ok) return bodyResult.response;

    const findResult = await deps.tenancyService.findMembershipById({ membershipId });
    if (!findResult.ok) return actionResultToResponse(findResult);
    if (findResult.data === null) {
      return apiError('MEMBERSHIP_NOT_FOUND', 'Membership not found', 404);
    }

    const ownershipErr = ensureMembershipBelongsToBusiness(findResult.data, businessId);
    if (ownershipErr) return ownershipErr;

    const result = await deps.tenancyService.updateMembershipStatus({
      membershipId,
      status: bodyResult.data.status,
      joinedAt: bodyResult.data.joinedAt,
    });

    return actionResultToResponse(result);
  };
}

/**
 * DELETE /api/businesses/:businessId/memberships/:membershipId
 *
 * 1. Resolve tenant context
 * 2. Validate businessId + membershipId params
 * 3. Check businessId matches tenant
 * 4. Require members.remove permission
 * 5. Find membership by ID
 * 6. Check membership belongs to business
 * 7. Call removeMembership with removedByUserId from context
 */
export function createDeleteMembershipHandler(
  deps: BusinessMembershipsHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // Parse route params first for explicit scope
    const paramsResult = validateRouteParams(
      params,
      businessMembershipParamsSchema,
      'INVALID_TENANCY_INPUT',
      'Invalid tenancy input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, membershipId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireMembershipPermission(deps, contextResult.context, 'members.remove');
    if (authzErr) return authzErr;

    const findResult = await deps.tenancyService.findMembershipById({ membershipId });
    if (!findResult.ok) return actionResultToResponse(findResult);
    if (findResult.data === null) {
      return apiError('MEMBERSHIP_NOT_FOUND', 'Membership not found', 404);
    }

    const ownershipErr = ensureMembershipBelongsToBusiness(findResult.data, businessId);
    if (ownershipErr) return ownershipErr;

    const result = await deps.tenancyService.removeMembership({
      membershipId,
      removedByUserId: contextResult.context.userId,
    });

    return actionResultToResponse(result);
  };
}

// ---------------------------------------------------------------------------
// Combined handler factory
// ---------------------------------------------------------------------------

/** Creates all business membership handlers */
export function createBusinessMembershipHandlers(
  deps: BusinessMembershipsHandlerDeps,
): {
  LIST: (request: Request, params: unknown) => Promise<Response>;
  CREATE: (request: Request, params: unknown) => Promise<Response>;
  UPDATE_ROLE: (request: Request, params: unknown) => Promise<Response>;
  UPDATE_STATUS: (request: Request, params: unknown) => Promise<Response>;
  DELETE: (request: Request, params: unknown) => Promise<Response>;
} {
  return {
    LIST: createGetBusinessMembershipsHandler(deps),
    CREATE: createPostBusinessMembershipsHandler(deps),
    UPDATE_ROLE: createPatchMembershipRoleHandler(deps),
    UPDATE_STATUS: createPatchMembershipStatusHandler(deps),
    DELETE: createDeleteMembershipHandler(deps),
  };
}
