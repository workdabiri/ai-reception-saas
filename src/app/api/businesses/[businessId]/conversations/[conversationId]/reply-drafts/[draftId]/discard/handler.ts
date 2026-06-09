// ===========================================================================
// Reply Draft Discard — API Handler
//
// POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/:draftId/discard
//
// Discards a reviewable reply draft (PENDING_REVIEW | EDITED → DISCARDED).
// Idempotent for already-DISCARDED drafts. Rejects APPROVED/SENT.
// Reconciles Conversation.aiDraftStatus to REJECTED when no reviewable
// drafts remain for the conversation.
// Does NOT send any message. Does NOT use LLM.
// Permission: ai_drafts.approve (OPERATOR, ADMIN, OWNER).
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
import type { AuditService } from '@/domains/audit/service';

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

const routeParamsSchema = z.object({
  businessId: z.string().uuid(),
  conversationId: z.string().uuid(),
  draftId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/** Dependencies required by the discard draft handler */
export interface DiscardDraftHandlerDeps {
  readonly replyDraftRepository: Pick<
    ReplyDraftRepository,
    'discardDraft' | 'countReviewableByConversation'
  >;
  readonly conversationRepository: Pick<
    ConversationRepository,
    'findConversationById' | 'updateConversation'
  >;
  readonly authzService: Pick<AuthzService, 'requirePermission'>;
  readonly auditService?: Pick<AuditService, 'createAuditEvent'>;
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
  deps: DiscardDraftHandlerDeps,
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
 * POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/:draftId/discard
 *
 * 1. Validate businessId + conversationId + draftId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require ai_drafts.approve permission
 * 5. Verify conversation exists and belongs to business
 * 6. Discard draft (validates status lifecycle)
 * 7. Reconcile Conversation.aiDraftStatus to REJECTED if no reviewable drafts remain
 * 8. Emit audit event (best-effort)
 * 9. Return result
 */
export function createDiscardDraftHandler(
  deps: DiscardDraftHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // 1. Validate route params
    const paramsResult = validateRouteParams(
      params,
      routeParamsSchema,
      'INVALID_DISCARD_INPUT',
      'Invalid discard input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, conversationId, draftId } = paramsResult.data;

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

    // 4. Require ai_drafts.approve
    const authzErr = await requirePermission(
      deps,
      contextResult.context,
      'ai_drafts.approve',
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

    // 6. Discard draft
    const discardResult = await deps.replyDraftRepository.discardDraft({
      businessId,
      conversationId,
      draftId,
      reviewedByUserId: contextResult.context.userId,
    });

    if (!discardResult.ok) {
      // Map known error codes to HTTP statuses
      if (discardResult.error.code === 'DRAFT_NOT_FOUND') {
        return apiError('DRAFT_NOT_FOUND', 'Draft not found', 404);
      }
      if (discardResult.error.code === 'DRAFT_NOT_DISCARDABLE') {
        return apiError(
          'DRAFT_NOT_DISCARDABLE',
          discardResult.error.message,
          409,
        );
      }
      return actionResultToResponse(discardResult);
    }

    // 7. Reconcile Conversation.aiDraftStatus to REJECTED if no reviewable drafts remain
    const countResult = await deps.replyDraftRepository.countReviewableByConversation(
      businessId,
      conversationId,
    );
    if (countResult.ok && countResult.data === 0) {
      const statusResult = await deps.conversationRepository.updateConversation(
        conversationId,
        { aiDraftStatus: 'REJECTED' },
      );
      if (!statusResult.ok) {
        // Best-effort reconciliation — log but don't fail the discard
        console.error(
          `[reply-draft-discard] Failed to reconcile aiDraftStatus for conversation ${conversationId}:`,
          statusResult.error,
        );
      }
    } else if (!countResult.ok) {
      // Best-effort — log but don't fail
      console.error(
        `[reply-draft-discard] Failed to count reviewable drafts for conversation ${conversationId}:`,
        countResult.error,
      );
    }

    // 8. Emit audit event (best-effort)
    if (deps.auditService && discardResult.data.discarded) {
      try {
        await deps.auditService.createAuditEvent({
          businessId,
          actorType: 'USER',
          actorUserId: contextResult.context.userId,
          action: 'ai_draft.discarded',
          targetType: 'reply_draft',
          targetId: draftId,
          result: 'SUCCESS',
          metadata: {
            conversationId,
            previousStatus: discardResult.data.draft.status === 'DISCARDED'
              ? 'DISCARDED'
              : 'transitioned',
          },
        });
      } catch {
        // Best-effort audit — do not fail the discard request
        console.error(
          `[reply-draft-discard] Failed to emit audit event for draft ${draftId}`,
        );
      }
    }

    // 9. Return result
    return apiOk({
      businessId,
      conversationId,
      draft: discardResult.data.draft,
      discarded: discardResult.data.discarded,
    });
  };
}
