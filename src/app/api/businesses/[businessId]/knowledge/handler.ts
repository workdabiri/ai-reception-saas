// ===========================================================================
// Knowledge — Business-Context API Handler Module
//
// Handler builders for the verified business-context store (B-R2). Lets an
// operator/admin create, list, verify, and archive the business knowledge the
// AI receptionist will later rely on. Plain tenant-scoped data management:
//
//   - No AI generation, no provider, no prompt assembly, no send path.
//   - businessId is ALWAYS the server-resolved route/tenant id, never the body.
//   - New items are created as DRAFT and only become AI-eligible after an
//     explicit verify (which records the verifier from the auth context).
//
// Mirrors the canonical handler sequence used by the customers handlers:
//   validate params -> resolve tenant context -> assert route/tenant match
//   -> require permission -> domain service call -> best-effort PII-safe audit.
// ===========================================================================

import { z } from 'zod';
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
import { apiOk, apiError } from '@/app/api/_shared/responses';
import { getHttpStatusForError } from '@/app/api/_shared/errors';
import { assertBusinessRouteMatchesTenant } from '@/app/api/_shared/tenant-route-guard';
import type { KnowledgeService } from '@/domains/knowledge/service';
import {
  BUSINESS_CONTEXT_ITEM_SOURCE_TYPE_VALUES,
  isBusinessContextItemStatus,
  type BusinessContextItemStatusValue,
} from '@/domains/knowledge/types';
import type { AuthzService } from '@/domains/authz/service';
import type { AuthzPermission } from '@/domains/authz/types';
import type { AuditService } from '@/domains/audit/service';
import type { JsonValue } from '@/lib/types';

// ---------------------------------------------------------------------------
// Bounds (mirror the Knowledge domain's internal validation)
// ---------------------------------------------------------------------------

const MAX_VALUE_LENGTH = 20_000;
const MAX_SHORT_TEXT_LENGTH = 500;
/** Upper bound on a single page of verified items returned to a caller. */
const MAX_LIST_LIMIT = 500;

const INVALID_INPUT_CODE = 'INVALID_KNOWLEDGE_INPUT';
const INVALID_INPUT_MSG = 'Invalid knowledge input';

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

const businessIdParamsSchema = z.object({
  businessId: z.string().uuid(),
});

const knowledgeItemParamsSchema = z.object({
  businessId: z.string().uuid(),
  itemId: z.string().uuid(),
});

/**
 * Request body for POST /knowledge.
 *
 * Allows ONLY the safe create fields. `.strict()` rejects any other key —
 * including businessId, status, verifiedByUserId, verifiedAt, createdByUserId,
 * createdAt, and updatedAt — so the client cannot choose tenancy, verification
 * state, or provenance stamps. businessId and the creator come from the
 * server-resolved tenant context.
 */
const createKnowledgeItemBodySchema = z
  .object({
    category: z.string().trim().min(1).max(MAX_SHORT_TEXT_LENGTH),
    key: z.string().trim().min(1).max(MAX_SHORT_TEXT_LENGTH),
    value: z.string().min(1).max(MAX_VALUE_LENGTH),
    sourceType: z.enum(BUSINESS_CONTEXT_ITEM_SOURCE_TYPE_VALUES),
    sourceLabel: z.string().trim().max(MAX_SHORT_TEXT_LENGTH).nullish(),
    sourceUrl: z.string().trim().url().max(MAX_SHORT_TEXT_LENGTH).nullish(),
    sourceMetadata: z.unknown().nullish(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Knowledge error → HTTP status mapping
//
// The Knowledge domain's error codes are not in the shared API_ERROR_STATUS_MAP
// (src/app/api/_shared/errors.ts), so map them here to keep correct statuses
// without modifying shared infrastructure. Unknown codes fall back to the
// shared mapper (which defaults to 500).
// ---------------------------------------------------------------------------

const KNOWLEDGE_ERROR_STATUS: Record<string, number> = {
  INVALID_KNOWLEDGE_INPUT: 400,
  BUSINESS_CONTEXT_ITEM_NOT_FOUND: 404,
  BUSINESS_CONTEXT_ITEM_NOT_VERIFIABLE: 409,
  KNOWLEDGE_REPOSITORY_ERROR: 500,
};

function knowledgeErrorResponse(error: {
  code: string;
  message: string;
}): Response {
  const status =
    KNOWLEDGE_ERROR_STATUS[error.code] ?? getHttpStatusForError(error.code);
  return apiError(error.code, error.message, status);
}

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/** Dependencies required by the knowledge handler module */
export interface KnowledgeHandlerDeps {
  readonly knowledgeService: Pick<
    KnowledgeService,
    | 'createItem'
    | 'listVerifiedItems'
    | 'listItems'
    | 'findItem'
    | 'verifyItem'
    | 'archiveItem'
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

async function requireKnowledgePermission(
  deps: KnowledgeHandlerDeps,
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
    return apiError(
      authzResult.error.code,
      authzResult.error.message,
      getHttpStatusForError(authzResult.error.code),
    );
  }

  if (!authzResult.data.allowed) {
    return apiError('ACCESS_DENIED', 'Access denied', 403);
  }

  return null;
}

/**
 * Maps a requested list `status` filter to the permission that may see it.
 *
 * VERIFIED (and the default, no-status case) is ordinary read data. DRAFT and
 * ARCHIVED are review/retired queues, so they require the same elevated
 * permissions that mutate them — keeping VIEWER/OPERATOR from seeing
 * non-verified items unless their role already grants verify/archive.
 */
function permissionForListStatus(
  status: BusinessContextItemStatusValue | undefined,
): AuthzPermission {
  switch (status) {
    case 'DRAFT':
      return 'knowledge.verify';
    case 'ARCHIVED':
      return 'knowledge.archive';
    case 'VERIFIED':
    default:
      return 'knowledge.read';
  }
}

/**
 * Fire-and-forget audit emitter.
 *
 * Logs audit events after successful mutations. Never fails the API response —
 * errors are silently caught. Metadata is PII-safe and content-free: only the
 * item id, status, category, and source type — never the context `value`,
 * `sourceUrl`, `sourceMetadata`, or any customer/message content.
 */
function emitAudit(
  deps: KnowledgeHandlerDeps,
  context: TenantRequestContext,
  action: string,
  targetId: string,
  metadata: JsonValue,
): void {
  deps.auditService
    .createAuditEvent({
      businessId: context.businessId,
      actorType: 'USER',
      actorUserId: context.userId,
      action,
      targetType: 'business_context_item',
      targetId,
      result: 'SUCCESS',
      metadata,
    })
    .catch(() => {
      // Fire-and-forget: audit write failure must not break the API response
    });
}

// ---------------------------------------------------------------------------
// Handler builders
// ---------------------------------------------------------------------------

/**
 * GET /api/businesses/:businessId/knowledge
 *
 * Lists business-context items for the route/tenant business. By default (no
 * `status` query) returns VERIFIED-only items, preserving the original
 * behavior. An explicit `?status=DRAFT|VERIFIED|ARCHIVED` filters by lifecycle
 * status and is gated per status:
 *   - VERIFIED (and the default) → knowledge.read
 *   - DRAFT    → knowledge.verify
 *   - ARCHIVED → knowledge.archive
 * so VIEWER/OPERATOR cannot see non-verified review queues. Supports optional
 * `category` and `limit` query filters.
 *
 * 1. Validate businessId param + `status` query (invalid status → 400)
 * 2. Resolve tenant context
 * 3. Assert businessId matches tenant
 * 4. Require the permission mapped to the requested status
 * 5. Call the verified-only or status-filtered domain list method
 */
export function createListKnowledgeHandler(
  deps: KnowledgeHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      businessIdParamsSchema,
      INVALID_INPUT_CODE,
      INVALID_INPUT_MSG,
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId } = paramsResult.data;

    // Validate the optional status query as part of the params/query stage.
    // An unknown status is a client error (400) and short-circuits before any
    // tenant resolution, authz, or service call.
    const statusParam = getSearchParam(request, 'status');
    let status: BusinessContextItemStatusValue | undefined;
    if (statusParam !== null) {
      if (!isBusinessContextItemStatus(statusParam)) {
        return apiError(INVALID_INPUT_CODE, INVALID_INPUT_MSG, 400);
      }
      status = statusParam;
    }

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(
      contextResult.context,
      businessId,
    );
    if (mismatch) return mismatch;

    const authzErr = await requireKnowledgePermission(
      deps,
      contextResult.context,
      permissionForListStatus(status),
    );
    if (authzErr) return authzErr;

    const category = getSearchParam(request, 'category') ?? undefined;
    const limitParam = parseIntegerQueryParam(getSearchParam(request, 'limit'));
    const limit = limitParam
      ? Math.min(Math.max(limitParam, 1), MAX_LIST_LIMIT)
      : undefined;

    // No status → keep the original verified-only path. An explicit status uses
    // the status-filtered method (already authorized above for that status).
    const result =
      status === undefined
        ? await deps.knowledgeService.listVerifiedItems({
            businessId,
            category,
            limit,
          })
        : await deps.knowledgeService.listItems({
            businessId,
            status,
            category,
            limit,
          });

    if (!result.ok) return knowledgeErrorResponse(result.error);
    return apiOk(result.data);
  };
}

/**
 * GET /api/businesses/:businessId/knowledge/:itemId
 *
 * Fetches a single business-context item by id, scoped to the route/tenant
 * business. Because this can expose DRAFT or ARCHIVED context, it requires
 * knowledge.verify (OWNER/ADMIN) for this PR — it is intentionally not a
 * VIEWER/OPERATOR read. Cross-tenant or missing items return 404.
 *
 * 1. Validate businessId + itemId params
 * 2. Resolve tenant context
 * 3. Assert businessId matches tenant
 * 4. Require knowledge.verify permission
 * 5. Call knowledgeService.findItem
 */
export function createGetKnowledgeItemHandler(
  deps: KnowledgeHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      knowledgeItemParamsSchema,
      INVALID_INPUT_CODE,
      INVALID_INPUT_MSG,
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, itemId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(
      contextResult.context,
      businessId,
    );
    if (mismatch) return mismatch;

    const authzErr = await requireKnowledgePermission(
      deps,
      contextResult.context,
      'knowledge.verify',
    );
    if (authzErr) return authzErr;

    const result = await deps.knowledgeService.findItem({ businessId, itemId });

    if (!result.ok) return knowledgeErrorResponse(result.error);
    return apiOk(result.data);
  };
}

/**
 * POST /api/businesses/:businessId/knowledge
 *
 * Creates a DRAFT business-context item (NOT AI-eligible until verified).
 *
 * 1. Validate businessId param
 * 2. Resolve tenant context
 * 3. Assert businessId matches tenant
 * 4. Require knowledge.create permission
 * 5. Validate JSON body (safe create fields only; body businessId rejected)
 * 6. Call knowledgeService.createItem with businessId + creator from context
 */
export function createPostKnowledgeHandler(
  deps: KnowledgeHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      businessIdParamsSchema,
      INVALID_INPUT_CODE,
      INVALID_INPUT_MSG,
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(
      contextResult.context,
      businessId,
    );
    if (mismatch) return mismatch;

    const authzErr = await requireKnowledgePermission(
      deps,
      contextResult.context,
      'knowledge.create',
    );
    if (authzErr) return authzErr;

    const bodyResult = await validateJsonBody(
      request,
      createKnowledgeItemBodySchema,
      INVALID_INPUT_CODE,
      INVALID_INPUT_MSG,
    );
    if (!bodyResult.ok) return bodyResult.response;

    const result = await deps.knowledgeService.createItem({
      businessId,
      category: bodyResult.data.category,
      key: bodyResult.data.key,
      value: bodyResult.data.value,
      sourceType: bodyResult.data.sourceType,
      sourceLabel: bodyResult.data.sourceLabel,
      sourceUrl: bodyResult.data.sourceUrl,
      sourceMetadata: bodyResult.data.sourceMetadata,
      createdByUserId: contextResult.context.userId,
    });

    if (!result.ok) return knowledgeErrorResponse(result.error);

    emitAudit(deps, contextResult.context, 'knowledge.create', result.data.id, {
      itemId: result.data.id,
      status: result.data.status,
      category: result.data.category,
      sourceType: result.data.sourceType,
    });

    return apiOk(result.data, { status: 201 });
  };
}

/**
 * POST /api/businesses/:businessId/knowledge/:itemId/verify
 *
 * Verifies a DRAFT item (DRAFT -> VERIFIED), recording the verifier from the
 * authenticated context. Only then is the item eligible as AI context.
 *
 * 1. Validate businessId + itemId params
 * 2. Resolve tenant context
 * 3. Assert businessId matches tenant
 * 4. Require knowledge.verify permission
 * 5. Call knowledgeService.verifyItem with verifier from context
 */
export function createVerifyKnowledgeHandler(
  deps: KnowledgeHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      knowledgeItemParamsSchema,
      INVALID_INPUT_CODE,
      INVALID_INPUT_MSG,
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, itemId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(
      contextResult.context,
      businessId,
    );
    if (mismatch) return mismatch;

    const authzErr = await requireKnowledgePermission(
      deps,
      contextResult.context,
      'knowledge.verify',
    );
    if (authzErr) return authzErr;

    const result = await deps.knowledgeService.verifyItem({
      businessId,
      itemId,
      verifiedByUserId: contextResult.context.userId,
    });

    if (!result.ok) return knowledgeErrorResponse(result.error);

    emitAudit(deps, contextResult.context, 'knowledge.verify', result.data.id, {
      itemId: result.data.id,
      status: result.data.status,
      category: result.data.category,
      sourceType: result.data.sourceType,
    });

    return apiOk(result.data);
  };
}

/**
 * POST /api/businesses/:businessId/knowledge/:itemId/archive
 *
 * Archives an item (any status -> ARCHIVED), removing it from AI eligibility.
 *
 * 1. Validate businessId + itemId params
 * 2. Resolve tenant context
 * 3. Assert businessId matches tenant
 * 4. Require knowledge.archive permission
 * 5. Call knowledgeService.archiveItem
 */
export function createArchiveKnowledgeHandler(
  deps: KnowledgeHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      knowledgeItemParamsSchema,
      INVALID_INPUT_CODE,
      INVALID_INPUT_MSG,
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, itemId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(
      contextResult.context,
      businessId,
    );
    if (mismatch) return mismatch;

    const authzErr = await requireKnowledgePermission(
      deps,
      contextResult.context,
      'knowledge.archive',
    );
    if (authzErr) return authzErr;

    const result = await deps.knowledgeService.archiveItem({
      businessId,
      itemId,
    });

    if (!result.ok) return knowledgeErrorResponse(result.error);

    emitAudit(
      deps,
      contextResult.context,
      'knowledge.archive',
      result.data.id,
      {
        itemId: result.data.id,
        status: result.data.status,
        category: result.data.category,
        sourceType: result.data.sourceType,
      },
    );

    return apiOk(result.data);
  };
}

// ---------------------------------------------------------------------------
// Combined handler factory
// ---------------------------------------------------------------------------

/** Creates all knowledge handlers */
export function createKnowledgeHandlers(deps: KnowledgeHandlerDeps): {
  LIST: (request: Request, params: unknown) => Promise<Response>;
  GET_ITEM: (request: Request, params: unknown) => Promise<Response>;
  CREATE: (request: Request, params: unknown) => Promise<Response>;
  VERIFY: (request: Request, params: unknown) => Promise<Response>;
  ARCHIVE: (request: Request, params: unknown) => Promise<Response>;
} {
  return {
    LIST: createListKnowledgeHandler(deps),
    GET_ITEM: createGetKnowledgeItemHandler(deps),
    CREATE: createPostKnowledgeHandler(deps),
    VERIFY: createVerifyKnowledgeHandler(deps),
    ARCHIVE: createArchiveKnowledgeHandler(deps),
  };
}
