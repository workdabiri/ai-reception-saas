// ===========================================================================
// Customers — CRM Customer API Handler Module
//
// Handler builders for customer and contact method operations.
// Uses dependency injection for testability.
// Context resolution must succeed before any service call.
// Authz must pass before all operations.
// All data is strictly business-scoped.
// ===========================================================================

import { z } from 'zod';
import {
  actionResultToResponse,
  actionResultToResponseWithStatus,
} from '@/app/api/_shared/action-result';
import { validateJsonBody } from '@/app/api/_shared/request';
import {
  validateRouteParams,
  getSearchParam,
  parseIntegerQueryParam,
} from '@/app/api/_shared/params';
import {
  resolveTenantRequestContext,
  type TenantRequestContext,
  type TenantRequestScope,
  type ContextResult,
} from '@/app/api/_shared/request-context';
import { apiError } from '@/app/api/_shared/responses';
import { assertBusinessRouteMatchesTenant } from '@/app/api/_shared/tenant-route-guard';
import type { CrmService } from '@/domains/crm/service';
import type { AuthzService } from '@/domains/authz/service';
import type { AuthzPermission } from '@/domains/authz/types';
import type { AuditService } from '@/domains/audit/service';
import type { TenantRequestContext as AuditContext } from '@/app/api/_shared/request-context';
import {
  createCustomerInputSchema,
  updateCustomerInputSchema,
  createContactMethodInputSchema,
  customerStatusSchema,
  contactMethodTypeSchema,
} from '@/domains/crm/validation';
import type { JsonValue } from '@/lib/types';

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

const businessIdParamsSchema = z.object({
  businessId: z.string().uuid(),
});

const customerParamsSchema = z.object({
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
});

const contactMethodParamsSchema = z.object({
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
  contactMethodId: z.string().uuid(),
});

/**
 * Request body for POST /customers.
 * businessId is injected from the route param, not from the body.
 */
const createCustomerRequestBodySchema = createCustomerInputSchema
  .omit({ businessId: true })
  .strict();

/**
 * Request body for PATCH /customers/:customerId.
 * At least one field required.
 */
const updateCustomerRequestBodySchema = updateCustomerInputSchema;

/**
 * Request body for POST /customers/:customerId/contact-methods.
 * customerId and businessId are injected from route params.
 */
const addContactMethodRequestBodySchema = createContactMethodInputSchema
  .omit({ customerId: true, businessId: true })
  .strict();

/**
 * Request body for POST /customers/resolve.
 * businessId is injected from the route param.
 */
const resolveCustomerRequestBodySchema = z
  .object({
    type: contactMethodTypeSchema,
    value: z.string().trim().min(1).max(500),
    displayName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/** Dependencies required by the customer handler module */
export interface CustomerHandlerDeps {
  readonly crmService: Pick<
    CrmService,
    | 'createCustomer'
    | 'updateCustomer'
    | 'findCustomerById'
    | 'listCustomers'
    | 'archiveCustomer'
    | 'addContactMethod'
    | 'removeContactMethod'
    | 'listContactMethods'
    | 'findOrCreateByContact'
  >;
  readonly authzService: Pick<AuthzService, 'requirePermission'>;
  readonly auditService: Pick<AuditService, 'createAuditEvent'>;
  readonly resolveTenantContext?: (
    request: Request,
    scope?: TenantRequestScope,
  ) => Promise<ContextResult<TenantRequestContext>>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function requireCustomerPermission(
  deps: CustomerHandlerDeps,
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

/**
 * Fire-and-forget audit emitter.
 * Logs audit events after successful mutations.
 * Never fails the API response — errors are silently caught.
 * Metadata is PII-safe: no contact values, notes, or customer metadata.
 */
function emitAudit(
  deps: CustomerHandlerDeps,
  context: AuditContext,
  action: string,
  targetType: string,
  targetId: string,
  metadata?: JsonValue,
): void {
  deps.auditService
    .createAuditEvent({
      businessId: context.businessId,
      actorType: 'USER',
      actorUserId: context.userId,
      action,
      targetType,
      targetId,
      result: 'SUCCESS',
      metadata: metadata ?? null,
    })
    .catch(() => {
      // Fire-and-forget: audit write failure must not break the API response
    });
}

// ---------------------------------------------------------------------------
// Handler builders
// ---------------------------------------------------------------------------

/**
 * GET /api/businesses/:businessId/customers
 *
 * 1. Validate businessId param
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require customers.read permission
 * 5. Parse query params (status, search, limit, cursor)
 * 6. Call crmService.listCustomers
 */
export function createListCustomersHandler(
  deps: CustomerHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      businessIdParamsSchema,
      'INVALID_CRM_INPUT',
      'Invalid CRM input',
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

    const authzErr = await requireCustomerPermission(deps, contextResult.context, 'customers.read');
    if (authzErr) return authzErr;

    const statusParam = getSearchParam(request, 'status');
    let status: ReturnType<typeof customerStatusSchema.parse> | undefined;
    if (statusParam !== null) {
      const statusParsed = customerStatusSchema.safeParse(statusParam);
      if (!statusParsed.success) {
        return apiError('INVALID_CRM_INPUT', 'Invalid status filter', 400);
      }
      status = statusParsed.data;
    }

    const search = getSearchParam(request, 'search') ?? undefined;
    const limit = parseIntegerQueryParam(getSearchParam(request, 'limit'));
    const cursor = getSearchParam(request, 'cursor') ?? undefined;

    const result = await deps.crmService.listCustomers({
      businessId,
      status,
      search,
      limit: limit ? Math.min(Math.max(limit, 1), 100) : undefined,
      cursor,
    });

    return actionResultToResponse(result);
  };
}

/**
 * POST /api/businesses/:businessId/customers
 *
 * 1. Validate businessId param
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require customers.update permission
 * 5. Validate JSON body
 * 6. Call crmService.createCustomer with businessId from route
 */
export function createPostCustomerHandler(
  deps: CustomerHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      businessIdParamsSchema,
      'INVALID_CRM_INPUT',
      'Invalid CRM input',
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

    const authzErr = await requireCustomerPermission(deps, contextResult.context, 'customers.update');
    if (authzErr) return authzErr;

    const bodyResult = await validateJsonBody(
      request,
      createCustomerRequestBodySchema,
      'INVALID_CRM_INPUT',
      'Invalid CRM input',
    );
    if (!bodyResult.ok) return bodyResult.response;

    const result = await deps.crmService.createCustomer({
      ...bodyResult.data,
      businessId,
    });

    if (result.ok) {
      emitAudit(deps, contextResult.context, 'customer.create', 'customer', result.data.id, {
        businessId,
        customerId: result.data.id,
      });
    }

    return actionResultToResponseWithStatus(result, 201);
  };
}

/**
 * GET /api/businesses/:businessId/customers/:customerId
 *
 * 1. Validate businessId + customerId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require customers.read permission
 * 5. Call crmService.findCustomerById
 * 6. Return 404 if not found
 */
export function createGetCustomerByIdHandler(
  deps: CustomerHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      customerParamsSchema,
      'INVALID_CRM_INPUT',
      'Invalid CRM input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, customerId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireCustomerPermission(deps, contextResult.context, 'customers.read');
    if (authzErr) return authzErr;

    const findResult = await deps.crmService.findCustomerById({
      customerId,
      businessId,
    });

    if (!findResult.ok) return actionResultToResponse(findResult);

    if (findResult.data === null) {
      return apiError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);
    }

    return actionResultToResponse(findResult);
  };
}

/**
 * PATCH /api/businesses/:businessId/customers/:customerId
 *
 * 1. Validate businessId + customerId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require customers.update permission
 * 5. Validate JSON body (at least one field)
 * 6. Call crmService.updateCustomer
 */
export function createPatchCustomerHandler(
  deps: CustomerHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      customerParamsSchema,
      'INVALID_CRM_INPUT',
      'Invalid CRM input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, customerId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireCustomerPermission(deps, contextResult.context, 'customers.update');
    if (authzErr) return authzErr;

    const bodyResult = await validateJsonBody(
      request,
      updateCustomerRequestBodySchema,
      'INVALID_CRM_INPUT',
      'Invalid CRM input',
    );
    if (!bodyResult.ok) return bodyResult.response;

    const result = await deps.crmService.updateCustomer(
      customerId,
      businessId,
      bodyResult.data,
    );

    if (result.ok) {
      emitAudit(deps, contextResult.context, 'customer.update', 'customer', customerId, {
        businessId,
        customerId,
      });
    }

    return actionResultToResponse(result);
  };
}

/**
 * POST /api/businesses/:businessId/customers/:customerId/archive
 *
 * 1. Validate businessId + customerId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require customers.update permission
 * 5. Call crmService.archiveCustomer
 */
export function createArchiveCustomerHandler(
  deps: CustomerHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      customerParamsSchema,
      'INVALID_CRM_INPUT',
      'Invalid CRM input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, customerId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireCustomerPermission(deps, contextResult.context, 'customers.update');
    if (authzErr) return authzErr;

    const result = await deps.crmService.archiveCustomer({
      customerId,
      businessId,
    });

    if (result.ok) {
      emitAudit(deps, contextResult.context, 'customer.archive', 'customer', customerId, {
        businessId,
        customerId,
      });
    }

    return actionResultToResponse(result);
  };
}

/**
 * GET /api/businesses/:businessId/customers/:customerId/contact-methods
 *
 * 1. Validate businessId + customerId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require customers.read permission
 * 5. Call crmService.listContactMethods
 */
export function createListContactMethodsHandler(
  deps: CustomerHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      customerParamsSchema,
      'INVALID_CRM_INPUT',
      'Invalid CRM input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, customerId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireCustomerPermission(deps, contextResult.context, 'customers.read');
    if (authzErr) return authzErr;

    const result = await deps.crmService.listContactMethods({
      customerId,
      businessId,
    });

    return actionResultToResponse(result);
  };
}

/**
 * POST /api/businesses/:businessId/customers/:customerId/contact-methods
 *
 * 1. Validate businessId + customerId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require customers.update permission
 * 5. Validate JSON body
 * 6. Call crmService.addContactMethod with customerId and businessId from route
 */
export function createAddContactMethodHandler(
  deps: CustomerHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      customerParamsSchema,
      'INVALID_CRM_INPUT',
      'Invalid CRM input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, customerId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireCustomerPermission(deps, contextResult.context, 'customers.update');
    if (authzErr) return authzErr;

    const bodyResult = await validateJsonBody(
      request,
      addContactMethodRequestBodySchema,
      'INVALID_CRM_INPUT',
      'Invalid CRM input',
    );
    if (!bodyResult.ok) return bodyResult.response;

    const result = await deps.crmService.addContactMethod({
      ...bodyResult.data,
      customerId,
      businessId,
    });

    if (result.ok) {
      emitAudit(deps, contextResult.context, 'customer_contact_method.create', 'customer_contact_method', result.data.id, {
        businessId,
        customerId,
        contactMethodId: result.data.id,
        contactMethodType: result.data.type,
      });
    }

    return actionResultToResponseWithStatus(result, 201);
  };
}

/**
 * DELETE /api/businesses/:businessId/customers/:customerId/contact-methods/:contactMethodId
 *
 * 1. Validate businessId + customerId + contactMethodId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require customers.update permission
 * 5. Call crmService.removeContactMethod
 */
export function createRemoveContactMethodHandler(
  deps: CustomerHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      contactMethodParamsSchema,
      'INVALID_CRM_INPUT',
      'Invalid CRM input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, customerId, contactMethodId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireCustomerPermission(deps, contextResult.context, 'customers.update');
    if (authzErr) return authzErr;

    const result = await deps.crmService.removeContactMethod({
      contactMethodId,
      customerId,
      businessId,
    });

    if (result.ok) {
      emitAudit(deps, contextResult.context, 'customer_contact_method.delete', 'customer_contact_method', contactMethodId, {
        businessId,
        customerId,
        contactMethodId,
      });
    }

    return actionResultToResponse(result);
  };
}

/**
 * POST /api/businesses/:businessId/customers/resolve
 *
 * 1. Validate businessId param
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require customers.update permission
 * 5. Validate JSON body (type, value, displayName?)
 * 6. Call crmService.findOrCreateByContact
 */
export function createResolveCustomerHandler(
  deps: CustomerHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      businessIdParamsSchema,
      'INVALID_CRM_INPUT',
      'Invalid CRM input',
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

    const authzErr = await requireCustomerPermission(deps, contextResult.context, 'customers.update');
    if (authzErr) return authzErr;

    const bodyResult = await validateJsonBody(
      request,
      resolveCustomerRequestBodySchema,
      'INVALID_CRM_INPUT',
      'Invalid CRM input',
    );
    if (!bodyResult.ok) return bodyResult.response;

    const result = await deps.crmService.findOrCreateByContact({
      businessId,
      type: bodyResult.data.type,
      value: bodyResult.data.value,
      displayName: bodyResult.data.displayName,
    });

    if (result.ok) {
      emitAudit(deps, contextResult.context, 'customer.resolve', 'customer', result.data.id, {
        businessId,
        customerId: result.data.id,
        contactMethodType: bodyResult.data.type,
      });
    }

    return actionResultToResponse(result);
  };
}

// ---------------------------------------------------------------------------
// Combined handler factory
// ---------------------------------------------------------------------------

/** Creates all customer and contact method handlers */
export function createCustomerHandlers(deps: CustomerHandlerDeps): {
  LIST: (request: Request, params: unknown) => Promise<Response>;
  CREATE: (request: Request, params: unknown) => Promise<Response>;
  GET_BY_ID: (request: Request, params: unknown) => Promise<Response>;
  PATCH: (request: Request, params: unknown) => Promise<Response>;
  ARCHIVE: (request: Request, params: unknown) => Promise<Response>;
  LIST_CONTACT_METHODS: (request: Request, params: unknown) => Promise<Response>;
  ADD_CONTACT_METHOD: (request: Request, params: unknown) => Promise<Response>;
  REMOVE_CONTACT_METHOD: (request: Request, params: unknown) => Promise<Response>;
  RESOLVE: (request: Request, params: unknown) => Promise<Response>;
} {
  return {
    LIST: createListCustomersHandler(deps),
    CREATE: createPostCustomerHandler(deps),
    GET_BY_ID: createGetCustomerByIdHandler(deps),
    PATCH: createPatchCustomerHandler(deps),
    ARCHIVE: createArchiveCustomerHandler(deps),
    LIST_CONTACT_METHODS: createListContactMethodsHandler(deps),
    ADD_CONTACT_METHOD: createAddContactMethodHandler(deps),
    REMOVE_CONTACT_METHOD: createRemoveContactMethodHandler(deps),
    RESOLVE: createResolveCustomerHandler(deps),
  };
}
