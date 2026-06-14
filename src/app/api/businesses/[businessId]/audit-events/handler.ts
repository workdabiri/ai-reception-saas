// ===========================================================================
// Audit Events — Tenant Audit API Handler Module
//
// Handler builders for tenant audit read operations.
// Uses dependency injection for testability.
// Context resolution must succeed before any service call.
// Authz must pass before audit read operations.
// Audit event business ownership checked before detail response.
// ===========================================================================

import { z } from 'zod';
import { actionResultToResponse } from '@/app/api/_shared/action-result';
import {
  validateRouteParams,
  parseIntegerQueryParam,
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
import type { AuditService } from '@/domains/audit/service';
import type { AuthzService } from '@/domains/authz/service';
import {
  auditActorTypeSchema,
  auditResultSchema,
} from '@/domains/audit/validation';
import type { AuditEventIdentity } from '@/domains/audit/types';

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

const businessIdParamsSchema = z.object({
  businessId: z.string().uuid(),
});

const auditEventParamsSchema = z.object({
  businessId: z.string().uuid(),
  auditEventId: z.string().uuid(),
});

const AUDIT_ACTION_REGEX = /^[a-z][a-z0-9_.:-]*$/;

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/** Dependencies required by the audit events handler module */
export interface AuditEventsHandlerDeps {
  readonly auditService: Pick<AuditService, 'listAuditEvents' | 'findAuditEventById'>;
  readonly authzService: Pick<AuthzService, 'requirePermission'>;
  readonly resolveTenantContext?: (
    request: Request,
    scope?: TenantRequestScope,
  ) => Promise<ContextResult<TenantRequestContext>>;
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

interface AuditListQuery {
  actorUserId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  result?: 'SUCCESS' | 'DENIED' | 'FAILED';
  actorType?: 'USER' | 'SYSTEM' | 'AI_RECEPTIONIST';
  limit?: number;
}

function parseAuditListQuery(
  request: Request,
): { ok: true; data: AuditListQuery } | { ok: false; response: Response } {
  const query: AuditListQuery = {};
  const errResp = () => apiError('INVALID_AUDIT_INPUT', 'Invalid audit input', 400);

  const actorUserId = getSearchParam(request, 'actorUserId');
  if (actorUserId !== null) {
    const r = z.string().uuid().safeParse(actorUserId);
    if (!r.success) return { ok: false, response: errResp() };
    query.actorUserId = r.data;
  }

  const action = getSearchParam(request, 'action');
  if (action !== null) {
    if (action.length < 3 || action.length > 120 || !AUDIT_ACTION_REGEX.test(action)) {
      return { ok: false, response: errResp() };
    }
    query.action = action;
  }

  const targetType = getSearchParam(request, 'targetType');
  if (targetType !== null) {
    if (targetType.length < 1 || targetType.length > 120) return { ok: false, response: errResp() };
    query.targetType = targetType;
  }

  const targetId = getSearchParam(request, 'targetId');
  if (targetId !== null) {
    if (targetId.length < 1 || targetId.length > 160) return { ok: false, response: errResp() };
    query.targetId = targetId;
  }

  const result = getSearchParam(request, 'result');
  if (result !== null) {
    const r = auditResultSchema.safeParse(result);
    if (!r.success) return { ok: false, response: errResp() };
    query.result = r.data;
  }

  const actorType = getSearchParam(request, 'actorType');
  if (actorType !== null) {
    const r = auditActorTypeSchema.safeParse(actorType);
    if (!r.success) return { ok: false, response: errResp() };
    query.actorType = r.data;
  }

  const limitRaw = getSearchParam(request, 'limit');
  if (limitRaw !== null) {
    const parsed = parseIntegerQueryParam(limitRaw);
    if (parsed === undefined || parsed < 1 || parsed > 100) {
      return { ok: false, response: errResp() };
    }
    query.limit = parsed;
  }

  return { ok: true, data: query };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function requireAuditReadPermission(
  deps: AuditEventsHandlerDeps,
  context: TenantRequestContext,
): Promise<Response | null> {
  const authzResult = await deps.authzService.requirePermission({
    userId: context.userId,
    businessId: context.businessId,
    role: context.role,
    permission: 'audit.read',
  });
  if (!authzResult.ok) return actionResultToResponse(authzResult);
  if (!authzResult.data.allowed) return apiError('ACCESS_DENIED', 'Access denied', 403);
  return null;
}

function ensureAuditEventBelongsToBusiness(
  event: AuditEventIdentity,
  businessId: string,
): Response | null {
  if (event.businessId !== businessId) {
    return apiError('TENANT_ACCESS_DENIED', 'Tenant access denied', 403);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler builders
// ---------------------------------------------------------------------------

/**
 * GET /api/businesses/:businessId/audit-events
 *
 * 1. Resolve tenant context
 * 2. Validate businessId param
 * 3. Check businessId matches tenant
 * 4. Require audit.read permission
 * 5. Parse and validate query filters
 * 6. Call listAuditEvents scoped to businessId
 */
export function createGetAuditEventsHandler(
  deps: AuditEventsHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // Parse route params first for explicit scope
    const paramsResult = validateRouteParams(params, businessIdParamsSchema, 'INVALID_AUDIT_INPUT', 'Invalid audit input');
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

    const authzErr = await requireAuditReadPermission(deps, contextResult.context);
    if (authzErr) return authzErr;

    const queryResult = parseAuditListQuery(request);
    if (!queryResult.ok) return queryResult.response;

    const result = await deps.auditService.listAuditEvents({
      businessId,
      ...queryResult.data,
    });

    return actionResultToResponse(result);
  };
}

/**
 * GET /api/businesses/:businessId/audit-events/:auditEventId
 *
 * 1. Resolve tenant context
 * 2. Validate businessId + auditEventId params
 * 3. Check businessId matches tenant
 * 4. Require audit.read permission
 * 5. Find audit event by ID
 * 6. Check event belongs to business
 * 7. Return result
 */
export function createGetAuditEventByIdHandler(
  deps: AuditEventsHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // Parse route params first for explicit scope
    const paramsResult = validateRouteParams(params, auditEventParamsSchema, 'INVALID_AUDIT_INPUT', 'Invalid audit input');
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, auditEventId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireAuditReadPermission(deps, contextResult.context);
    if (authzErr) return authzErr;

    const findResult = await deps.auditService.findAuditEventById({ auditEventId });
    if (!findResult.ok) return actionResultToResponse(findResult);
    if (findResult.data === null) {
      return apiError('AUDIT_EVENT_NOT_FOUND', 'Audit event not found', 404);
    }

    const ownershipErr = ensureAuditEventBelongsToBusiness(findResult.data, businessId);
    if (ownershipErr) return ownershipErr;

    return actionResultToResponse(findResult);
  };
}

// ---------------------------------------------------------------------------
// Combined handler factory
// ---------------------------------------------------------------------------

/** Creates all tenant audit event handlers */
export function createAuditEventHandlers(
  deps: AuditEventsHandlerDeps,
): {
  LIST: (request: Request, params: unknown) => Promise<Response>;
  GET_BY_ID: (request: Request, params: unknown) => Promise<Response>;
} {
  return {
    LIST: createGetAuditEventsHandler(deps),
    GET_BY_ID: createGetAuditEventByIdHandler(deps),
  };
}
