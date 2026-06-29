// ===========================================================================
// Reply Draft Send — API Handler
//
// POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/:draftId/send
//
// Sends an APPROVED reply draft: transitions APPROVED → SENT and creates exactly
// one OUTBOUND operator Message carrying the draft text. This is an explicit,
// human-triggered operator action (permission: ai_drafts.send) — never auto-send.
//
// Atomicity: the claim (APPROVED → SENT), the outbound-message insert, and the
// sentMessageId link all happen inside ONE DB transaction in the repository, so
// a crash mid-send rolls everything back (the draft stays APPROVED, no message)
// — a draft is never left SENT without a linked message. The status-guarded
// claim prevents duplicate messages on double-click / concurrent requests.
//
// Scope (deliberately bounded):
//   - Creates an INTERNAL outbound Message DB record only. It does NOT call any
//     LLM/provider, channel provider, webhook, WhatsApp, email, SMS, or any
//     external network. There is no external delivery here.
//   - The outbound message is created in the send transaction (a pure DB insert).
//     Because that bypasses the conversations service, this handler re-emits the
//     existing `message.created` audit semantics, content-free.
//
// Permission: ai_drafts.send (OPERATOR, ADMIN, OWNER). VIEWER is denied.
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
import type { ConversationService } from '@/domains/conversations/service';
import type { MessageIdentity } from '@/domains/conversations/types';
import type { ReplyDraftRepository } from '@/domains/reply-drafts/repository';
import type { SentMessageMetadata } from '@/domains/reply-drafts/types';
import type { AuditService } from '@/domains/audit/service';
import type { CreateAuditEventInput } from '@/domains/audit/types';

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

/** Dependencies required by the send draft handler */
export interface SendDraftHandlerDeps {
  readonly replyDraftRepository: Pick<ReplyDraftRepository, 'sendApprovedDraft'>;
  // Conversation reads only: existence/tenant check + idempotent message lookup.
  // The outbound message is INSERTED atomically inside the repository's send
  // transaction, so the service's createMessage is intentionally not used here.
  readonly conversationService: Pick<
    ConversationService,
    'findConversationById' | 'findMessageById'
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

async function requirePermission(
  deps: SendDraftHandlerDeps,
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

/** PII-safe message metadata for the response (no message content). */
function toMessageMetadata(message: MessageIdentity): SentMessageMetadata {
  return {
    id: message.id,
    conversationId: message.conversationId,
    direction: message.direction,
    senderType: message.senderType,
    senderUserId: message.senderUserId,
    createdAt: message.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Handler builder
// ---------------------------------------------------------------------------

/**
 * POST /api/businesses/:businessId/conversations/:conversationId/reply-drafts/:draftId/send
 *
 *  1. Validate businessId + conversationId + draftId params (uuid)
 *  2. Resolve tenant context (route-param scoped)
 *  3. Check businessId matches tenant (fail closed 403)
 *  4. Require ai_drafts.send permission
 *  5. Verify conversation exists and belongs to business
 *  6. Atomically send (claim APPROVED → SENT + create message + link, in one tx)
 *  7. ALREADY_SENT → idempotent success (no new message)
 *  8. SENT_NOW → emit message.created + ai_draft.sent audits (content-free)
 *  9. Return the sent draft + created message metadata
 */
export function createSendDraftHandler(
  deps: SendDraftHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  // Best-effort audit — never fails the send (mirrors approve/createMessage).
  async function safeAudit(
    input: CreateAuditEventInput,
    label: string,
  ): Promise<void> {
    if (!deps.auditService) return;
    try {
      await deps.auditService.createAuditEvent(input);
    } catch {
      console.error(`[reply-draft-send] Failed to emit ${label} audit`);
    }
  }

  return async (request: Request, params: unknown): Promise<Response> => {
    // 1. Validate route params
    const paramsResult = validateRouteParams(
      params,
      routeParamsSchema,
      'INVALID_SEND_INPUT',
      'Invalid send input',
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

    // 3. Check businessId matches tenant (tenant/route backstop, fails closed)
    const mismatch = assertBusinessRouteMatchesTenant(
      contextResult.context,
      businessId,
    );
    if (mismatch) return mismatch;

    // 4. Require ai_drafts.send (sensitive permission)
    const authzErr = await requirePermission(
      deps,
      contextResult.context,
      'ai_drafts.send',
    );
    if (authzErr) return authzErr;

    // 5. Verify conversation exists and belongs to business (before any write)
    const convResult = await deps.conversationService.findConversationById({
      conversationId,
      businessId,
    });
    if (!convResult.ok) {
      return actionResultToResponse(convResult);
    }
    if (convResult.data === null) {
      return apiError('CONVERSATION_NOT_FOUND', 'Conversation not found', 404);
    }

    // 6. Atomically send: claim APPROVED → SENT + insert message + link, in one tx
    const sendResult = await deps.replyDraftRepository.sendApprovedDraft({
      businessId,
      conversationId,
      draftId,
      sentByUserId: contextResult.context.userId,
    });

    if (!sendResult.ok) {
      if (sendResult.error.code === 'DRAFT_NOT_FOUND') {
        return apiError('DRAFT_NOT_FOUND', 'Draft not found', 404);
      }
      if (sendResult.error.code === 'DRAFT_NOT_SENDABLE') {
        return apiError('DRAFT_NOT_SENDABLE', sendResult.error.message, 409);
      }
      return actionResultToResponse(sendResult);
    }

    const { outcome, draft } = sendResult.data;

    // 7. Idempotent path — already SENT. Do NOT create or audit a new message.
    if (outcome === 'ALREADY_SENT') {
      let messageMetadata: SentMessageMetadata | null = null;
      if (draft.sentMessageId) {
        const existingMsg = await deps.conversationService.findMessageById({
          messageId: draft.sentMessageId,
          businessId,
        });
        if (existingMsg.ok && existingMsg.data) {
          messageMetadata = toMessageMetadata(existingMsg.data);
        }
      }
      return apiOk({
        businessId,
        conversationId,
        draft,
        message: messageMetadata,
        sent: true,
        idempotent: true,
      });
    }

    // 8. SENT_NOW — emit audits (content-free), best-effort, only on real send.
    const message = sendResult.data.message;
    if (message) {
      // Preserve the existing operator message.created audit semantics.
      await safeAudit(
        {
          businessId,
          actorType: 'USER',
          actorUserId: contextResult.context.userId,
          action: 'message.created',
          targetType: 'message',
          targetId: message.id,
          result: 'SUCCESS',
          metadata: {
            conversationId,
            direction: 'OUTBOUND',
            senderType: 'OPERATOR',
          },
        },
        'message.created',
      );
      // The draft lifecycle event.
      await safeAudit(
        {
          businessId,
          actorType: 'USER',
          actorUserId: contextResult.context.userId,
          action: 'ai_draft.sent',
          targetType: 'reply_draft',
          targetId: draftId,
          result: 'SUCCESS',
          metadata: {
            conversationId,
            previousStatus: 'APPROVED',
            newStatus: 'SENT',
            messageId: message.id,
          },
        },
        'ai_draft.sent',
      );
    }

    // 9. Return the sent draft + created message metadata
    return apiOk({
      businessId,
      conversationId,
      draft,
      message,
      sent: true,
      idempotent: false,
    });
  };
}
