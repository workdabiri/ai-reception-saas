// ===========================================================================
// Operator Workload — API Handler Module
//
// Handler builder for the operator workload dashboard endpoint.
// Uses dependency injection for testability.
//
// Returns per-operator assignment counts and unassigned conversation totals.
// Permission: conversations.read (same gate as dashboard summary).
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
import { assertBusinessRouteMatchesTenant } from '@/app/api/_shared/tenant-route-guard';
import { actionResultToResponse } from '@/app/api/_shared/action-result';
import type { ConversationRepository } from '@/domains/conversations/repository';
import type { TenancyRepository } from '@/domains/tenancy/repository';
import type { AuthzService } from '@/domains/authz/service';
import type { MembershipRoleValue } from '@/domains/tenancy/types';

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

const businessIdParamsSchema = z.object({
  businessId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/** Per-operator workload entry */
export interface OperatorWorkloadEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: MembershipRoleValue;
  /** Conversations assigned to this operator in non-RESOLVED status */
  openAssigned: number;
  /** Conversations assigned with closedAt today */
  resolvedToday: number;
}

/** Unassigned conversation counts */
export interface UnassignedWorkload {
  /** Conversations with assignedUserId = null, status ≠ RESOLVED */
  open: number;
}

/** Complete operator workload response */
export interface OperatorWorkloadResponse {
  businessId: string;
  generatedAt: string;
  operators: OperatorWorkloadEntry[];
  unassigned: UnassignedWorkload;
}

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/** Dependencies required by the operator workload handler */
export interface OperatorWorkloadHandlerDeps {
  readonly conversationRepository: Pick<
    ConversationRepository,
    | 'getWorkloadByAssignee'
    | 'getResolvedTodayByAssignee'
    | 'countUnassignedOpen'
  >;
  readonly tenancyRepository: Pick<
    TenancyRepository,
    'listBusinessMemberships'
  >;
  readonly authzService: Pick<AuthzService, 'requirePermission'>;
  readonly resolveTenantContext?: (
    request: Request,
    scope?: TenantRequestScope,
  ) => Promise<ContextResult<TenantRequestContext>>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function requireConversationsReadPermission(
  deps: OperatorWorkloadHandlerDeps,
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
// Helper: start of today in UTC
// ---------------------------------------------------------------------------

function getStartOfTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// ---------------------------------------------------------------------------
// Handler builder
// ---------------------------------------------------------------------------

/**
 * GET /api/businesses/:businessId/dashboard/operator-workload
 *
 * 1. Validate businessId param
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require conversations.read permission
 * 5. Run workload aggregate queries in parallel
 * 6. Merge with active membership display info
 * 7. Return OperatorWorkloadResponse
 */
export function createGetOperatorWorkloadHandler(
  deps: OperatorWorkloadHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // 1. Validate route params
    const paramsResult = validateRouteParams(
      params,
      businessIdParamsSchema,
      'INVALID_WORKLOAD_INPUT',
      'Invalid workload input',
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

    // 5. Compute start of today for resolved-today count
    const now = new Date();
    const startOfToday = getStartOfTodayUTC();

    // 6. Run all queries in parallel
    const [workloadResult, resolvedResult, unassignedResult, membersResult] =
      await Promise.all([
        deps.conversationRepository.getWorkloadByAssignee(businessId),
        deps.conversationRepository.getResolvedTodayByAssignee(businessId, startOfToday),
        deps.conversationRepository.countUnassignedOpen(businessId),
        deps.tenancyRepository.listBusinessMemberships({
          businessId,
          includeRemoved: false,
        }),
      ]);

    // Check for errors
    if (!workloadResult.ok) return actionResultToResponse(workloadResult);
    if (!resolvedResult.ok) return actionResultToResponse(resolvedResult);
    if (!unassignedResult.ok) return actionResultToResponse(unassignedResult);
    if (!membersResult.ok) return actionResultToResponse(membersResult);

    // 7. Build lookup maps
    const openMap = new Map<string, number>();
    for (const entry of workloadResult.data) {
      openMap.set(entry.assignedUserId, entry.openCount);
    }

    const resolvedMap = new Map<string, number>();
    for (const entry of resolvedResult.data) {
      resolvedMap.set(entry.assignedUserId, entry.resolvedCount);
    }

    // 8. Merge with active members who have conversation assignments
    // Include operators who have assignments even if they have 0 open right now
    const assignedUserIds = new Set([...openMap.keys(), ...resolvedMap.keys()]);

    // Build member info map from active memberships
    const memberMap = new Map<string, {
      name: string;
      avatarUrl: string | null;
      role: MembershipRoleValue;
    }>();
    for (const member of membersResult.data) {
      memberMap.set(member.userId, {
        name: member.user?.name ?? member.userId.slice(0, 8),
        avatarUrl: member.user?.avatarUrl ?? null,
        role: member.role,
      });
    }

    // 9. Assemble operator entries
    const operators: OperatorWorkloadEntry[] = [];
    for (const userId of assignedUserIds) {
      const memberInfo = memberMap.get(userId);
      operators.push({
        userId,
        name: memberInfo?.name ?? userId.slice(0, 8),
        avatarUrl: memberInfo?.avatarUrl ?? null,
        role: memberInfo?.role ?? 'OPERATOR',
        openAssigned: openMap.get(userId) ?? 0,
        resolvedToday: resolvedMap.get(userId) ?? 0,
      });
    }

    // Sort by most open assignments first (descending), then by name
    operators.sort((a, b) => {
      const diff = b.openAssigned - a.openAssigned;
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    });

    // 10. Assemble response
    const response: OperatorWorkloadResponse = {
      businessId,
      generatedAt: now.toISOString(),
      operators,
      unassigned: {
        open: unassignedResult.data,
      },
    };

    return apiOk(response);
  };
}
