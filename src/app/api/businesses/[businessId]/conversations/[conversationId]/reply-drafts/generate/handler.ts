// ===========================================================================
// Reply Draft Generate — API Handler
//
// POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/generate
//
// Generates a deterministic SYSTEM stub reply draft for a conversation.
// Reuses existing reviewable draft if one exists.
// Does NOT send any message. Does NOT use LLM.
// Permission: ai_drafts.generate (OPERATOR, ADMIN, OWNER).
// ===========================================================================

import { z } from 'zod';
import { apiError, apiOk } from '@/app/api/_shared/responses';
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
// Constants
// ---------------------------------------------------------------------------

/**
 * Deterministic SYSTEM stub draft text.
 * This is NOT an LLM-generated response — it is a safe placeholder
 * for operators to review and edit before sending.
 */
export const STUB_DRAFT_TEXT =
  'Thanks for your message. We received your request and an operator will review it before replying.';

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

/** Dependencies required by the generate stub draft handler */
export interface GenerateStubDraftHandlerDeps {
  readonly replyDraftRepository: Pick<
    ReplyDraftRepository,
    'generateOrReuseStubDraft'
  >;
  readonly conversationRepository: Pick<
    ConversationRepository,
    'findConversationById' | 'updateConversation'
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

function assertBusinessRouteMatchesTenant(
  context: TenantRequestContext,
  businessId: string,
): Response | null {
  if (businessId !== context.businessId) {
    return apiError('TENANT_ACCESS_DENIED', 'Tenant access denied', 403);
  }
  return null;
}

async function requirePermission(
  deps: GenerateStubDraftHandlerDeps,
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
 * POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/generate
 *
 * 1. Validate businessId + conversationId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require ai_drafts.generate permission
 * 5. Verify conversation exists and belongs to business
 * 6. Generate or reuse SYSTEM stub draft
 * 7. Reconcile Conversation.aiDraftStatus to READY
 * 8. Return result
 */
export function createGenerateStubDraftHandler(
  deps: GenerateStubDraftHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // 1. Validate route params
    const paramsResult = validateRouteParams(
      params,
      routeParamsSchema,
      'INVALID_DRAFT_INPUT',
      'Invalid draft input',
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

    // 4. Require ai_drafts.generate
    const authzErr = await requirePermission(
      deps,
      contextResult.context,
      'ai_drafts.generate',
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

    // 6. Generate or reuse stub draft
    const draftResult = await deps.replyDraftRepository.generateOrReuseStubDraft({
      businessId,
      conversationId,
      createdByUserId: contextResult.context.userId,
      draftText: STUB_DRAFT_TEXT,
    });
    if (!draftResult.ok) {
      return actionResultToResponse(draftResult);
    }

    // 7. Reconcile Conversation.aiDraftStatus to READY
    // Best-effort reconciliation — whether the draft was newly created
    // or reused, ensure Conversation.aiDraftStatus reflects the
    // existence of a reviewable draft. This covers the edge case where
    // a prior status update failed after draft creation.
    const statusResult = await deps.conversationRepository.updateConversation(
      conversationId,
      { aiDraftStatus: 'READY' },
    );
    if (!statusResult.ok) {
      // Log but don't fail — the draft is already persisted.
      console.error(
        `[reply-draft-generate] Failed to reconcile aiDraftStatus for conversation ${conversationId}:`,
        statusResult.error,
      );
    }

    // 8. Return result
    return apiOk({
      businessId,
      conversationId,
      generatedAt: new Date().toISOString(),
      created: draftResult.data.created,
      draft: draftResult.data.draft,
    });
  };
}
