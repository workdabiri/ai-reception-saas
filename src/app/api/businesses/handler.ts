// ===========================================================================
// Businesses — Workspace API Handler Module
//
// Handler builders for business workspace operations.
// Uses dependency injection for testability.
// Context resolution must succeed before any service call.
// Authz must pass before tenant-scoped read/update operations.
// ===========================================================================

import { z } from 'zod';
import { actionResultToResponse } from '@/app/api/_shared/action-result';
import { validateJsonBody } from '@/app/api/_shared/request';
import {
  validateRouteParams,
  parseBooleanQueryParam,
  getSearchParam,
  uuidParamSchema,
} from '@/app/api/_shared/params';
import {
  resolveAuthenticatedRequestContext,
  resolveTenantRequestContext,
  type AuthenticatedUserRequestContext,
  type TenantRequestContext,
  type TenantRequestScope,
  type ContextResult,
} from '@/app/api/_shared/request-context';
import { apiError } from '@/app/api/_shared/responses';
import { assertBusinessRouteMatchesTenant } from '@/app/api/_shared/tenant-route-guard';
import type { TenancyService } from '@/domains/tenancy/service';
import type { AuthzService } from '@/domains/authz/service';
import {
  createBusinessInputSchema,
  businessStatusSchema,
  businessSlugSchema,
} from '@/domains/tenancy/validation';

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

/**
 * Request body schema for POST /api/businesses.
 * createdByUserId is omitted — it must come from the authenticated context.
 */
const createBusinessRequestBodySchema = createBusinessInputSchema
  .omit({ createdByUserId: true })
  .strict();

/**
 * Request body schema for PATCH /api/businesses/:businessId.
 * businessId comes from route param, not body.
 */
const updateBusinessRequestBodySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    slug: businessSlugSchema.optional(),
    status: businessStatusSchema.optional(),
    timezone: z.string().min(1).max(64).optional(),
    locale: z.enum(['en', 'fa']).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.slug !== undefined ||
      data.status !== undefined ||
      data.timezone !== undefined ||
      data.locale !== undefined,
    { message: 'At least one update field must be provided' },
  );

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/** Dependencies required by the business workspace handler module */
export interface BusinessWorkspaceHandlerDeps {
  readonly tenancyService: Pick<
    TenancyService,
    'createBusiness' | 'listUserBusinesses' | 'findBusinessById' | 'updateBusiness'
  >;
  readonly authzService: Pick<AuthzService, 'requirePermission'>;
  readonly resolveAuthenticatedContext?: (
    request: Request,
  ) => Promise<ContextResult<AuthenticatedUserRequestContext>>;
  readonly resolveTenantContext?: (
    request: Request,
    scope?: TenantRequestScope,
  ) => Promise<ContextResult<TenantRequestContext>>;
}

// ---------------------------------------------------------------------------
// Handler builders
// ---------------------------------------------------------------------------

/**
 * Creates a POST /api/businesses handler.
 *
 * 1. Resolves authenticated request context
 * 2. Validates JSON body (createdByUserId excluded — comes from context)
 * 3. Calls tenancyService.createBusiness
 * 4. Returns the result as a Response
 */
export function createPostBusinessesHandler(
  deps: BusinessWorkspaceHandlerDeps,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const resolve =
      deps.resolveAuthenticatedContext ?? resolveAuthenticatedRequestContext;
    const contextResult = await resolve(request);

    if (!contextResult.ok) {
      return contextResult.response;
    }

    const bodyResult = await validateJsonBody(
      request,
      createBusinessRequestBodySchema,
      'INVALID_TENANCY_INPUT',
      'Invalid tenancy input',
    );

    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const result = await deps.tenancyService.createBusiness({
      ...bodyResult.data,
      createdByUserId: contextResult.context.userId,
    });

    return actionResultToResponse(result);
  };
}

/**
 * Creates a GET /api/businesses handler.
 *
 * 1. Resolves authenticated request context
 * 2. Reads includeInactive query param
 * 3. Calls tenancyService.listUserBusinesses
 * 4. Returns the result as a Response
 */
export function createGetBusinessesHandler(
  deps: BusinessWorkspaceHandlerDeps,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const resolve =
      deps.resolveAuthenticatedContext ?? resolveAuthenticatedRequestContext;
    const contextResult = await resolve(request);

    if (!contextResult.ok) {
      return contextResult.response;
    }

    const includeInactive = parseBooleanQueryParam(
      getSearchParam(request, 'includeInactive'),
    );

    const result = await deps.tenancyService.listUserBusinesses({
      userId: contextResult.context.userId,
      includeInactive: includeInactive ?? false,
    });

    return actionResultToResponse(result);
  };
}

/**
 * Creates a GET /api/businesses/:businessId handler.
 *
 * 1. Resolves tenant context
 * 2. Validates businessId route param
 * 3. Checks route businessId matches tenant context businessId
 * 4. Runs authz requirePermission for business.read
 * 5. Calls tenancyService.findBusinessById
 * 6. Returns the result as a Response
 *
 * Authz must pass before findBusinessById is called.
 */
export function createGetBusinessByIdHandler(
  deps: BusinessWorkspaceHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // Parse route params first to get businessId for explicit scope
    const paramsResult = validateRouteParams(
      params,
      uuidParamSchema('businessId'),
      'INVALID_TENANCY_INPUT',
      'Invalid tenancy input',
    );

    if (!paramsResult.ok) {
      return paramsResult.response;
    }

    const { businessId } = paramsResult.data;

    const resolve =
      deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });

    if (!contextResult.ok) {
      return contextResult.response;
    }

    // Defense-in-depth backstop (A-H4): deny if the resolved tenant context is
    // for a different business than the route param, before authz or any read.
    const mismatch = assertBusinessRouteMatchesTenant(
      contextResult.context,
      businessId,
    );
    if (mismatch) {
      return mismatch;
    }

    const authzResult = await deps.authzService.requirePermission({
      userId: contextResult.context.userId,
      businessId: contextResult.context.businessId,
      role: contextResult.context.role,
      permission: 'business.read',
    });

    if (!authzResult.ok) {
      return actionResultToResponse(authzResult);
    }

    if (!authzResult.data.allowed) {
      return apiError('ACCESS_DENIED', 'Access denied', 403);
    }

    const findResult = await deps.tenancyService.findBusinessById({
      businessId,
    });

    if (!findResult.ok) {
      return actionResultToResponse(findResult);
    }

    if (findResult.data === null) {
      return apiError('BUSINESS_NOT_FOUND', 'Business not found', 404);
    }

    return actionResultToResponse(findResult);
  };
}

/**
 * Creates a PATCH /api/businesses/:businessId handler.
 *
 * 1. Resolves tenant context
 * 2. Validates businessId route param
 * 3. Checks route businessId matches tenant context businessId
 * 4. Runs authz requirePermission for business.update
 * 5. Validates JSON body
 * 6. Calls tenancyService.updateBusiness
 * 7. Returns the result as a Response
 *
 * Context, authz, and body validation all happen before mutation.
 */
export function createPatchBusinessByIdHandler(
  deps: BusinessWorkspaceHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // Parse route params first to get businessId for explicit scope
    const paramsResult = validateRouteParams(
      params,
      uuidParamSchema('businessId'),
      'INVALID_TENANCY_INPUT',
      'Invalid tenancy input',
    );

    if (!paramsResult.ok) {
      return paramsResult.response;
    }

    const { businessId } = paramsResult.data;

    const resolve =
      deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });

    if (!contextResult.ok) {
      return contextResult.response;
    }

    // Defense-in-depth backstop (A-H4): deny if the resolved tenant context is
    // for a different business than the route param, before authz or mutation.
    const mismatch = assertBusinessRouteMatchesTenant(
      contextResult.context,
      businessId,
    );
    if (mismatch) {
      return mismatch;
    }

    const authzResult = await deps.authzService.requirePermission({
      userId: contextResult.context.userId,
      businessId: contextResult.context.businessId,
      role: contextResult.context.role,
      permission: 'business.update',
    });

    if (!authzResult.ok) {
      return actionResultToResponse(authzResult);
    }

    if (!authzResult.data.allowed) {
      return apiError('ACCESS_DENIED', 'Access denied', 403);
    }

    const bodyResult = await validateJsonBody(
      request,
      updateBusinessRequestBodySchema,
      'INVALID_TENANCY_INPUT',
      'Invalid tenancy input',
    );

    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const result = await deps.tenancyService.updateBusiness({
      ...bodyResult.data,
      businessId,
    });

    return actionResultToResponse(result);
  };
}

// ---------------------------------------------------------------------------
// Combined handler factory
// ---------------------------------------------------------------------------

/** Creates POST, GET, GET_BY_ID, and PATCH_BY_ID handlers for business workspace */
export function createBusinessWorkspaceHandlers(
  deps: BusinessWorkspaceHandlerDeps,
): {
  POST: (request: Request) => Promise<Response>;
  GET: (request: Request) => Promise<Response>;
  GET_BY_ID: (request: Request, params: unknown) => Promise<Response>;
  PATCH_BY_ID: (request: Request, params: unknown) => Promise<Response>;
} {
  return {
    POST: createPostBusinessesHandler(deps),
    GET: createGetBusinessesHandler(deps),
    GET_BY_ID: createGetBusinessByIdHandler(deps),
    PATCH_BY_ID: createPatchBusinessByIdHandler(deps),
  };
}
