// ===========================================================================
// Reply Draft Edit — API Handler
//
// POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/:draftId/edit
//
// Edits a reviewable reply draft (PENDING_REVIEW | EDITED → EDITED).
// Updates draftText. Preserves originalText and source.
// Does NOT set reviewedAt/reviewedByUserId (reserved for approve/discard/send).
// Reconciles Conversation.aiDraftStatus to READY after successful edit.
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

const editBodySchema = z.object({
  draftText: z
    .string()
    .trim()
    .min(1, 'draftText must not be empty')
    .max(5000, 'draftText must not exceed 5000 characters'),
});

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/** Dependencies required by the edit draft handler */
export interface EditDraftHandlerDeps {
  readonly replyDraftRepository: Pick<
    ReplyDraftRepository,
    'editDraft'
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
  deps: EditDraftHandlerDeps,
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
 * POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/:draftId/edit
 *
 * 1. Validate businessId + conversationId + draftId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require ai_drafts.approve permission
 * 5. Parse and validate request body (draftText)
 * 6. Verify conversation exists and belongs to business
 * 7. Edit draft (validates status lifecycle)
 * 8. Reconcile Conversation.aiDraftStatus to READY
 * 9. Emit audit event (best-effort)
 * 10. Return result
 */
export function createEditDraftHandler(
  deps: EditDraftHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    // 1. Validate route params
    const paramsResult = validateRouteParams(
      params,
      routeParamsSchema,
      'INVALID_EDIT_INPUT',
      'Invalid edit input',
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

    // 5. Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError('INVALID_EDIT_INPUT', 'Request body is required', 400);
    }

    const bodyResult = editBodySchema.safeParse(body);
    if (!bodyResult.success) {
      const firstError = bodyResult.error.issues[0]?.message ?? 'Invalid input';
      return apiError('INVALID_EDIT_INPUT', firstError, 400);
    }

    const { draftText } = bodyResult.data;

    // 6. Verify conversation exists and belongs to business
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

    // 7. Edit draft
    const editResult = await deps.replyDraftRepository.editDraft({
      businessId,
      conversationId,
      draftId,
      draftText,
    });

    if (!editResult.ok) {
      // Map known error codes to HTTP statuses
      if (editResult.error.code === 'DRAFT_NOT_FOUND') {
        return apiError('DRAFT_NOT_FOUND', 'Draft not found', 404);
      }
      if (editResult.error.code === 'DRAFT_NOT_EDITABLE') {
        return apiError(
          'DRAFT_NOT_EDITABLE',
          editResult.error.message,
          409,
        );
      }
      return actionResultToResponse(editResult);
    }

    // 8. Reconcile Conversation.aiDraftStatus to READY (best-effort)
    try {
      const statusResult = await deps.conversationRepository.updateConversation(
        conversationId,
        { aiDraftStatus: 'READY' },
      );
      if (!statusResult.ok) {
        console.error(
          `[reply-draft-edit] Failed to reconcile aiDraftStatus for conversation ${conversationId}:`,
          statusResult.error,
        );
      }
    } catch {
      console.error(
        `[reply-draft-edit] Failed to reconcile aiDraftStatus for conversation ${conversationId}`,
      );
    }

    // 9. Emit audit event (best-effort)
    if (deps.auditService) {
      try {
        await deps.auditService.createAuditEvent({
          businessId,
          actorType: 'USER',
          actorUserId: contextResult.context.userId,
          action: 'ai_draft.edited',
          targetType: 'reply_draft',
          targetId: draftId,
          result: 'SUCCESS',
          metadata: {
            conversationId,
            previousStatus: editResult.data.previousStatus,
            newStatus: 'EDITED',
            previousTextLength: editResult.data.previousTextLength,
            newTextLength: editResult.data.newTextLength,
          },
        });
      } catch {
        // Best-effort audit — do not fail the edit request
        console.error(
          `[reply-draft-edit] Failed to emit audit event for draft ${draftId}`,
        );
      }
    }

    // 10. Return result
    return apiOk({
      businessId,
      conversationId,
      draft: editResult.data.draft,
      edited: true,
    });
  };
}
