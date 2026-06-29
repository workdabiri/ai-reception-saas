// ===========================================================================
// Reply Draft Send — POST route
//
// POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/:draftId/send
//
// Feature-gated route wiring for the send draft handler. Sends an APPROVED draft
// (APPROVED → SENT) by creating one internal OUTBOUND operator message. No real
// provider, channel, webhook, or external network is involved.
// ===========================================================================

import { apiNotImplemented } from '@/app/api/_shared/responses';
import { areApiHandlersEnabled } from '@/app/api/_shared/feature-gate';
import { withApiErrorBoundary } from '@/app/api/_shared/handler';
import { getApiDependencies } from '@/app/api/_shared/composition';
import { createSendDraftHandler } from './handler';

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
      'POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/:draftId/send',
    );
  }
  return withApiErrorBoundary(async () => {
    const deps = getApiDependencies();
    const params = await resolveRouteParams(context);
    const handler = createSendDraftHandler({
      replyDraftRepository: deps.repositories.replyDrafts,
      conversationService: deps.services.conversations,
      authzService: deps.services.authz,
      auditService: deps.services.audit,
    });
    return handler(request, params);
  });
}
