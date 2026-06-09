// ===========================================================================
// Reply Draft Approve — POST route
//
// POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/:draftId/approve
//
// Feature-gated route wiring for the approve draft handler.
// ===========================================================================

import { apiNotImplemented } from '@/app/api/_shared/responses';
import { areApiHandlersEnabled } from '@/app/api/_shared/feature-gate';
import { withApiErrorBoundary } from '@/app/api/_shared/handler';
import { getApiDependencies } from '@/app/api/_shared/composition';
import { createApproveDraftHandler } from './handler';

type RouteContext = {
  params: Promise<{
    businessId: string;
    conversationId: string;
    draftId: string;
  }>;
};

async function resolveRouteParams(
  context: RouteContext,
): Promise<{ businessId: string; conversationId: string; draftId: string }> {
  return await context.params;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!areApiHandlersEnabled()) {
    return apiNotImplemented(
      'POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/:draftId/approve',
    );
  }
  return withApiErrorBoundary(async () => {
    const deps = getApiDependencies();
    const params = await resolveRouteParams(context);
    const handler = createApproveDraftHandler({
      replyDraftRepository: deps.repositories.replyDrafts,
      conversationRepository: deps.repositories.conversations,
      authzService: deps.services.authz,
      auditService: deps.services.audit,
    });
    return handler(request, params);
  });
}
