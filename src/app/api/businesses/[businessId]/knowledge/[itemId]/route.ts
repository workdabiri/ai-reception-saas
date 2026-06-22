// ===========================================================================
// Knowledge — GET /api/businesses/:businessId/knowledge/:itemId
//
// Feature-gated route wiring for the single business-context item read. May
// expose DRAFT/ARCHIVED context, so the handler requires knowledge.verify
// (OWNER/ADMIN). Plain tenant-scoped data management — no AI generation.
// ===========================================================================

import { apiNotImplemented } from '@/app/api/_shared/responses';
import { areApiHandlersEnabled } from '@/app/api/_shared/feature-gate';
import { withApiErrorBoundary } from '@/app/api/_shared/handler';
import { getApiDependencies } from '@/app/api/_shared/composition';
import { createGetKnowledgeItemHandler } from '../handler';

type RouteContext = {
  params: Promise<{ businessId: string; itemId: string }>;
};

async function resolveRouteParams(
  context: RouteContext,
): Promise<{ businessId: string; itemId: string }> {
  return await context.params;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!areApiHandlersEnabled()) {
    return apiNotImplemented(
      'GET /api/businesses/:businessId/knowledge/:itemId',
    );
  }
  return withApiErrorBoundary(async () => {
    const deps = getApiDependencies();
    const params = await resolveRouteParams(context);
    const handler = createGetKnowledgeItemHandler({
      knowledgeService: deps.services.knowledge,
      authzService: deps.services.authz,
      auditService: deps.services.audit,
    });
    return handler(request, params);
  });
}
