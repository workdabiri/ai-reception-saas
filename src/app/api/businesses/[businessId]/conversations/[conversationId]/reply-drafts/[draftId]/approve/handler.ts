// ===========================================================================
// Reply Draft Approve — API Handler
//
// POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/:draftId/approve
//
// Approves a reviewable reply draft (PENDING_REVIEW | EDITED → APPROVED).
// Idempotent for already-APPROVED drafts. Rejects DISCARDED/SENT.
// Reconciles Conversation.aiDraftStatus to APPROVED after successful approve.
// Does NOT send any message. Does NOT use LLM.
// Does NOT create any Message record.
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

/** Dependencies required by the approve draft handler */
export interface ApproveDraftHandlerDeps {
  readonly replyDraftRepository: Pick<
    ReplyDraftRepository,
    'approveDraft'
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
  deps: ApproveDraftHandlerDeps,
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
 * POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/:draftId/approve
 *
 * 1. Validate businessId + conversationId + draftId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require ai_drafts.approve permission
 * 5. Verify conversation exists and belongs to business
 * 6. Approve draft (validates status lifecycle)
 * 7. Reconcile Conversation.aiDraftStatus to APPROVED (best-effort)
 * 8. Emit audit event (best-effort, only when approved=true)
 * 9. Return result
 */
export function createApproveDraftHandler(
  deps: ApproveDraftHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // 1. Validate route params
    const paramsResult = validateRouteParams(
      params,
      routeParamsSchema,
      'INVALID_APPROVE_INPUT',
      'Invalid approve input',
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

    // 6. Approve draft
    const approveResult = await deps.replyDraftRepository.approveDraft({
      businessId,
      conversationId,
      draftId,
      reviewedByUserId: contextResult.context.userId,
    });

    if (!approveResult.ok) {
      // Map known error codes to HTTP statuses
      if (approveResult.error.code === 'DRAFT_NOT_FOUND') {
        return apiError('DRAFT_NOT_FOUND', 'Draft not found', 404);
      }
      if (approveResult.error.code === 'DRAFT_NOT_APPROVABLE') {
        return apiError(
          'DRAFT_NOT_APPROVABLE',
          approveResult.error.message,
          409,
        );
      }
      return actionResultToResponse(approveResult);
    }

    // 7. Reconcile Conversation.aiDraftStatus to APPROVED (best-effort)
    try {
      const statusResult = await deps.conversationRepository.updateConversation(
        conversationId,
        { aiDraftStatus: 'APPROVED' },
      );
      if (!statusResult.ok) {
        console.error(
          `[reply-draft-approve] Failed to reconcile aiDraftStatus for conversation ${conversationId}:`,
          statusResult.error,
        );
      }
    } catch {
      console.error(
        `[reply-draft-approve] Failed to reconcile aiDraftStatus for conversation ${conversationId}`,
      );
    }

    // 8. Emit audit event (best-effort, only on actual transition)
    if (deps.auditService && approveResult.data.approved) {
      try {
        await deps.auditService.createAuditEvent({
          businessId,
          actorType: 'USER',
          actorUserId: contextResult.context.userId,
          action: 'ai_draft.approved',
          targetType: 'reply_draft',
          targetId: draftId,
          result: 'SUCCESS',
          metadata: {
            conversationId,
            previousStatus: approveResult.data.previousStatus,
            newStatus: 'APPROVED',
            approved: approveResult.data.approved,
          },
        });
      } catch {
        // Best-effort audit — do not fail the approve request
        console.error(
          `[reply-draft-approve] Failed to emit audit event for draft ${draftId}`,
        );
      }
    }

    // 9. Return result
    return apiOk({
      businessId,
      conversationId,
      draft: approveResult.data.draft,
      approved: approveResult.data.approved,
    });
  };
}
