// ===========================================================================
// AI Drafts Dashboard — GET /api/businesses/:businessId/dashboard/ai-drafts
//
// Feature-gated route wiring for AI drafts dashboard handler.
// ===========================================================================

import { apiNotImplemented } from '@/app/api/_shared/responses';
import { areApiHandlersEnabled } from '@/app/api/_shared/feature-gate';
import { withApiErrorBoundary } from '@/app/api/_shared/handler';
import { getApiDependencies } from '@/app/api/_shared/composition';
import { createGetAiDraftsDashboardHandler } from './handler';

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
      'GET /api/businesses/:businessId/dashboard/ai-drafts',
    );
  }
  return withApiErrorBoundary(async () => {
    const deps = getApiDependencies();
    const params = await resolveRouteParams(context);
    const handler = createGetAiDraftsDashboardHandler({
      replyDraftRepository: deps.repositories.replyDrafts,
      authzService: deps.services.authz,
    });
    return handler(request, params);
  });
}
