// ===========================================================================
// Dashboard Summary — GET /api/businesses/:businessId/dashboard/summary
//
// Feature-gated route wiring for dashboard aggregate summary handler.
// ===========================================================================

import { apiNotImplemented } from '@/app/api/_shared/responses';
import { areApiHandlersEnabled } from '@/app/api/_shared/feature-gate';
import { withApiErrorBoundary } from '@/app/api/_shared/handler';
import { getApiDependencies } from '@/app/api/_shared/composition';
import { createGetDashboardSummaryHandler } from './handler';

type RouteContext = {
  params: Promise<{ businessId: string }>;
};

async function resolveRouteParams(
  context: RouteContext,
): Promise<{ businessId: string }> {
  return await context.params;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!areApiHandlersEnabled()) {
    return apiNotImplemented(
      'GET /api/businesses/:businessId/dashboard/summary',
    );
  }
  return withApiErrorBoundary(async () => {
    const deps = getApiDependencies();
    const params = await resolveRouteParams(context);
    const handler = createGetDashboardSummaryHandler({
      conversationRepository: deps.repositories.conversations,
      auditRepository: deps.repositories.audit,
      authzService: deps.services.authz,
    });
    return handler(request, params);
  });
}
