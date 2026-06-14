// ===========================================================================
// Reply Draft Current — API Handler
//
// GET /api/businesses/:businessId/conversations/:conversationId/reply-drafts/current
//
// Returns the latest active draft for a conversation (PENDING_REVIEW | EDITED | APPROVED).
// Returns draft: null with 200 when no active draft exists.
// Excludes DISCARDED and SENT drafts.
// Includes full draftText for operator review/editing.
// Does NOT mutate anything. Does NOT use LLM.
// Does NOT create any Message record.
// Permission: ai_drafts.read (OPERATOR, ADMIN, OWNER).
// ===========================================================================

import { z } from 'zod';
import { apiError, apiOk } from '@/app/api/_shared/responses';
import { assertBusinessRouteMatchesTenant } from '@/app/api/_shared/tenant-route-guard';
import { validateRouteParams } from '@/app/api/_shared/params';
import {
  resolveTenantRequestContext,
  type TenantRequestContext,
  type TenantRequestScope,
  type ContextResult,
} from '@/app/api/_shared/request-context';
import { actionResultToResponse } from '@/app/api/_shared/action-result';
import type { AuthzService } from '@/domains/authz/service';
import type { AuthzPermission } from '@/domains/authz/types';
import type { ConversationRepository } from '@/domains/conversations/repository';
import type { ReplyDraftRepository } from '@/domains/reply-drafts/repository';

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

const routeParamsSchema = z.object({
  businessId: z.string().uuid(),
  conversationId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/** Dependencies required by the current draft read handler */
export interface CurrentDraftHandlerDeps {
  readonly replyDraftRepository: Pick<
    ReplyDraftRepository,
    'getCurrentByConversation'
  >;
  readonly conversationRepository: Pick<
    ConversationRepository,
    'findConversationById'
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

async function requirePermission(
  deps: CurrentDraftHandlerDeps,
  context: TenantRequestContext,
  permission: AuthzPermission,
): Promise<Response | null> {
  const authzResult = await deps.authzService.requirePermission({
    userId: context.userId,
    businessId: context.businessId,
    role: context.role,
    permission,
  });

  if (!authzResult.ok) {
    return actionResultToResponse(authzResult);
  }

  if (!authzResult.data.allowed) {
    return apiError('ACCESS_DENIED', 'Access denied', 403);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Handler builder
// ---------------------------------------------------------------------------

/**
 * GET /api/businesses/:businessId/conversations/:conversationId/reply-drafts/current
 *
 * 1. Validate businessId + conversationId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require ai_drafts.read permission
 * 5. Verify conversation exists and belongs to business
 * 6. Fetch current active draft
 * 7. Return result (draft or null)
 */
export function createCurrentDraftHandler(
  deps: CurrentDraftHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // 1. Validate route params
    const paramsResult = validateRouteParams(
      params,
      routeParamsSchema,
      'INVALID_CURRENT_DRAFT_INPUT',
      'Invalid current draft input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, conversationId } = paramsResult.data;

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
    const authzErr = await requirePermission(
      deps,
      contextResult.context,
      'ai_drafts.read',
    );
    if (authzErr) return authzErr;

    // 5. Verify conversation exists and belongs to business
    const convResult = await deps.conversationRepository.findConversationById(
      conversationId,
      businessId,
    );
    if (!convResult.ok) {
      return actionResultToResponse(convResult);
    }
    if (convResult.data === null) {
      return apiError(
        'CONVERSATION_NOT_FOUND',
        'Conversation not found',
        404,
      );
    }

    // 6. Fetch current active draft
    const draftResult = await deps.replyDraftRepository.getCurrentByConversation({
      businessId,
      conversationId,
    });
    if (!draftResult.ok) {
      return actionResultToResponse(draftResult);
    }

    // 7. Return result
    return apiOk({
      businessId,
      conversationId,
      draft: draftResult.data.draft,
    });
  };
}
