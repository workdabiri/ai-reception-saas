// ===========================================================================
// Knowledge — GET/POST /api/businesses/:businessId/knowledge
//
// Feature-gated route wiring for the verified business-context list and create
// handlers. Plain tenant-scoped data management — no AI generation.
// ===========================================================================

import { apiNotImplemented } from '@/app/api/_shared/responses';
import { areApiHandlersEnabled } from '@/app/api/_shared/feature-gate';
import { withApiErrorBoundary } from '@/app/api/_shared/handler';
import { getApiDependencies } from '@/app/api/_shared/composition';
import {
  createListKnowledgeHandler,
  createPostKnowledgeHandler,
} from './handler';

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
    return apiNotImplemented('GET /api/businesses/:businessId/knowledge');
  }
  return withApiErrorBoundary(async () => {
    const deps = getApiDependencies();
    const params = await resolveRouteParams(context);
    const handler = createListKnowledgeHandler({
      knowledgeService: deps.services.knowledge,
      authzService: deps.services.authz,
      auditService: deps.services.audit,
    });
    return handler(request, params);
  });
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!areApiHandlersEnabled()) {
    return apiNotImplemented('POST /api/businesses/:businessId/knowledge');
  }
  return withApiErrorBoundary(async () => {
    const deps = getApiDependencies();
    const params = await resolveRouteParams(context);
    const handler = createPostKnowledgeHandler({
      knowledgeService: deps.services.knowledge,
      authzService: deps.services.authz,
      auditService: deps.services.audit,
    });
    return handler(request, params);
  });
}
