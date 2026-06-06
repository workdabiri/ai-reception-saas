// ===========================================================================
// Dashboard Summary — API Handler Module
//
// Handler builder for the dashboard summary aggregate endpoint.
// Uses dependency injection for testability.
// Context resolution must succeed before any service call.
// Conversation metrics require conversations.read permission.
// Audit alert metric conditionally included when audit.read is available.
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
import type { ConversationRepository } from '@/domains/conversations/repository';
import type { AuditRepository } from '@/domains/audit/repository';
import type { AuthzService } from '@/domains/authz/service';
import { hasPermission } from '@/domains/authz/permissions';

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

const businessIdParamsSchema = z.object({
  businessId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

/** Dashboard summary aggregate response */
export interface DashboardSummaryResponse {
  /** Total non-resolved conversations */
  openConversations: number;
  /** Conversations in WAITING_OPERATOR status */
  waitingForOperator: number;
  /** Active conversations with no recent response (>24h, last msg inbound) */
  needsFollowUp: number;
  /** Conversations with aiDraftStatus = READY and not resolved */
  draftsPendingReview: number;
  /** Denied audit events in last 24h. Null if caller lacks audit.read. */
  accessAlerts: number | null;
  /** ISO timestamp when this summary was computed */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/** Dependencies required by the dashboard summary handler */
export interface DashboardSummaryHandlerDeps {
  readonly conversationRepository: Pick<
    ConversationRepository,
    | 'countOpenConversations'
    | 'countByStatus'
    | 'countDraftsPendingReview'
    | 'countNeedingFollowUp'
  >;
  readonly auditRepository: Pick<AuditRepository, 'countDeniedEvents'>;
  readonly authzService: Pick<AuthzService, 'requirePermission'>;
  readonly resolveTenantContext?: (
    request: Request,
    scope?: TenantRequestScope,
  ) => Promise<ContextResult<TenantRequestContext>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Follow-up cutoff: 24 hours */
const FOLLOWUP_HOURS = 24;

/** Access alerts window: 24 hours */
const ALERTS_HOURS = 24;

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

async function requireConversationsReadPermission(
  deps: DashboardSummaryHandlerDeps,
  context: TenantRequestContext,
): Promise<Response | null> {
  const authzResult = await deps.authzService.requirePermission({
    userId: context.userId,
    businessId: context.businessId,
    role: context.role,
    permission: 'conversations.read',
  });
  if (!authzResult.ok) return actionResultToResponse(authzResult);
  if (!authzResult.data.allowed) return apiError('ACCESS_DENIED', 'Access denied', 403);
  return null;
}

// ---------------------------------------------------------------------------
// Handler builder
// ---------------------------------------------------------------------------

/**
 * GET /api/businesses/:businessId/dashboard/summary
 *
 * 1. Validate businessId param
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require conversations.read permission
 * 5. Run aggregate queries in parallel
 * 6. Conditionally include access alerts (requires audit.read)
 * 7. Return DashboardSummaryResponse
 */
export function createGetDashboardSummaryHandler(
  deps: DashboardSummaryHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // 1. Validate route params
    const paramsResult = validateRouteParams(
      params,
      businessIdParamsSchema,
      'INVALID_DASHBOARD_INPUT',
      'Invalid dashboard input',
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

    // 4. Require conversations.read
    const authzErr = await requireConversationsReadPermission(
      deps,
      contextResult.context,
    );
    if (authzErr) return authzErr;

    // 5. Compute cutoffs
    const now = new Date();
    const followUpCutoff = new Date(now.getTime() - FOLLOWUP_HOURS * 60 * 60 * 1000);
    const alertsCutoff = new Date(now.getTime() - ALERTS_HOURS * 60 * 60 * 1000);

    // 6. Run conversation aggregate queries in parallel
    const [openResult, waitingResult, followUpResult, draftsResult] =
      await Promise.all([
        deps.conversationRepository.countOpenConversations(businessId),
        deps.conversationRepository.countByStatus(businessId, 'WAITING_OPERATOR'),
        deps.conversationRepository.countNeedingFollowUp(businessId, followUpCutoff),
        deps.conversationRepository.countDraftsPendingReview(businessId),
      ]);

    // Check for errors
    if (!openResult.ok) return actionResultToResponse(openResult);
    if (!waitingResult.ok) return actionResultToResponse(waitingResult);
    if (!followUpResult.ok) return actionResultToResponse(followUpResult);
    if (!draftsResult.ok) return actionResultToResponse(draftsResult);

    // 7. Conditionally include access alerts
    let accessAlerts: number | null = null;
    const canReadAudit = hasPermission(contextResult.context.role, 'audit.read');
    if (canReadAudit) {
      const alertsResult = await deps.auditRepository.countDeniedEvents(
        businessId,
        alertsCutoff,
      );
      if (!alertsResult.ok) return actionResultToResponse(alertsResult);
      accessAlerts = alertsResult.data;
    }

    // 8. Assemble response
    const summary: DashboardSummaryResponse = {
      openConversations: openResult.data,
      waitingForOperator: waitingResult.data,
      needsFollowUp: followUpResult.data,
      draftsPendingReview: draftsResult.data,
      accessAlerts,
      generatedAt: now.toISOString(),
    };

    return apiOk(summary);
  };
}
