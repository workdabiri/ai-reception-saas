// ===========================================================================
// Knowledge — POST /api/businesses/:businessId/knowledge/:itemId/verify
//
// Feature-gated route wiring for the business-context verify handler.
// Promotes a DRAFT item to VERIFIED (the only AI-eligible status), recording
// the verifier from the authenticated context.
// ===========================================================================

import { apiNotImplemented } from '@/app/api/_shared/responses';
import { areApiHandlersEnabled } from '@/app/api/_shared/feature-gate';
import { withApiErrorBoundary } from '@/app/api/_shared/handler';
import { getApiDependencies } from '@/app/api/_shared/composition';
import { createVerifyKnowledgeHandler } from '../../handler';

type RouteContext = {
  params: Promise<{ businessId: string; itemId: string }>;
};

async function resolveRouteParams(
  context: RouteContext,
): Promise<{ businessId: string; itemId: string }> {
  return await context.params;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!areApiHandlersEnabled()) {
    return apiNotImplemented(
      'POST /api/businesses/:businessId/knowledge/:itemId/verify',
    );
  }
  return withApiErrorBoundary(async () => {
    const deps = getApiDependencies();
    const params = await resolveRouteParams(context);
    const handler = createVerifyKnowledgeHandler({
      knowledgeService: deps.services.knowledge,
      authzService: deps.services.authz,
      auditService: deps.services.audit,
    });
    return handler(request, params);
  });
}
