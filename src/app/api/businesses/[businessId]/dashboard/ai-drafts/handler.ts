// ===========================================================================
// AI Drafts Dashboard — API Handler Module
//
// Handler builder for the dashboard AI drafts aggregate endpoint.
// Uses dependency injection for testability.
//
// Returns pending/edited reply drafts for the dashboard panel.
// Permission: ai_drafts.read (OPERATOR, ADMIN, OWNER).
// ===========================================================================

import { z } from 'zod';
import {
  validateRouteParams,
} from '@/app/api/_shared/params';
import {
  resolveTenantRequestContext,
  type TenantRequestContext,
  type TenantRequestScope,
  type ContextResult,
} from '@/app/api/_shared/request-context';
import { apiOk, apiError } from '@/app/api/_shared/responses';
import { actionResultToResponse } from '@/app/api/_shared/action-result';
import type { ReplyDraftRepository } from '@/domains/reply-drafts/repository';
import type { AuthzService } from '@/domains/authz/service';
import type { ReplyDraftDashboardItem } from '@/domains/reply-drafts/types';

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

const businessIdParamsSchema = z.object({
  businessId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

/** AI drafts dashboard response */
export interface AiDraftsDashboardResponse {
  businessId: string;
  generatedAt: string;
  pendingCount: number;
  drafts: ReplyDraftDashboardItem[];
}

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/** Dependencies required by the AI drafts dashboard handler */
export interface AiDraftsDashboardHandlerDeps {
  readonly replyDraftRepository: Pick<
    ReplyDraftRepository,
    'getDashboardDrafts'
  >;
  readonly authzService: Pick<AuthzService, 'requirePermission'>;
  readonly resolveTenantContext?: (
    request: Request,
    scope?: TenantRequestScope,
  ) => Promise<ContextResult<TenantRequestContext>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of drafts to return for the dashboard panel */
const DASHBOARD_DRAFTS_LIMIT = 10;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function assertBusinessRouteMatchesTenant(
  context: TenantRequestContext,
  businessId: string,
): Response | null {
  if (businessId !== context.businessId) {
    return apiError('TENANT_ACCESS_DENIED', 'Tenant access denied', 403);
  }
  return null;
}

async function requireAiDraftsReadPermission(
  deps: AiDraftsDashboardHandlerDeps,
  context: TenantRequestContext,
): Promise<Response | null> {
  const authzResult = await deps.authzService.requirePermission({
    userId: context.userId,
    businessId: context.businessId,
    role: context.role,
    permission: 'ai_drafts.read',
  });
  if (!authzResult.ok) return actionResultToResponse(authzResult);
  if (!authzResult.data.allowed) return apiError('ACCESS_DENIED', 'Access denied', 403);
  return null;
}

// ---------------------------------------------------------------------------
// Handler builder
// ---------------------------------------------------------------------------

/**
 * GET /api/businesses/:businessId/dashboard/ai-drafts
 *
 * 1. Validate businessId param
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require ai_drafts.read permission
 * 5. Query pending/edited drafts
 * 6. Return AiDraftsDashboardResponse
 */
export function createGetAiDraftsDashboardHandler(
  deps: AiDraftsDashboardHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // 1. Validate route params
    const paramsResult = validateRouteParams(
      params,
      businessIdParamsSchema,
      'INVALID_AI_DRAFTS_INPUT',
      'Invalid AI drafts input',
    );
    if (!paramsResult.ok) return paramsResult.response;
    const { businessId } = paramsResult.data;

    // 2. Resolve tenant context
    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    // 3. Check businessId matches tenant
    const mismatch = assertBusinessRouteMatchesTenant(
      contextResult.context,
      businessId,
    );
    if (mismatch) return mismatch;

    // 4. Require ai_drafts.read
    const authzErr = await requireAiDraftsReadPermission(
      deps,
      contextResult.context,
    );
    if (authzErr) return authzErr;

    // 5. Query dashboard drafts
    const now = new Date();
    const draftsResult = await deps.replyDraftRepository.getDashboardDrafts(
      businessId,
      DASHBOARD_DRAFTS_LIMIT,
    );
    if (!draftsResult.ok) return actionResultToResponse(draftsResult);

    // 6. Assemble response
    const response: AiDraftsDashboardResponse = {
      businessId,
      generatedAt: now.toISOString(),
      pendingCount: draftsResult.data.pendingCount,
      drafts: [...draftsResult.data.drafts],
    };

    return apiOk(response);
  };
}
