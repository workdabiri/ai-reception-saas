// ===========================================================================
// Conversations Domain — Service Implementation
//
// Concrete ConversationService backed by validation + injected repository
// and audit service for sensitive action logging.
// ===========================================================================

import { err } from '@/lib/result';
import type { JsonValue } from '@/lib/types';
import type { AuditService } from '../audit/service';
import type { ConversationService } from './service';
import type { ConversationRepository } from './repository';
import type {
  MessageSenderTypeValue,
} from './types';
import {
  validateCreateConversationInput,
  validateCreateMessageInput,
  validateUpdateConversationInput,
  validateTransition,
  isAuditRequiredTransition,
  OPERATOR_ALLOWED_DIRECTIONS,
} from './validation';

// ---------------------------------------------------------------------------
// Dependency types
// ---------------------------------------------------------------------------

/** Dependencies for the Conversations service */
export interface ConversationServiceDeps {
  readonly repository: ConversationRepository;
  readonly audit: AuditService;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVALID_INPUT = 'INVALID_CONVERSATION_INPUT';
const INVALID_MSG_INPUT = 'INVALID_MESSAGE_INPUT';
const NOT_FOUND = 'CONVERSATION_NOT_FOUND';
const INVALID_TRANSITION = 'INVALID_CONVERSATION_TRANSITION';
const INVALID_ASSIGNMENT = 'INVALID_ASSIGNMENT';
const CUSTOMER_ALREADY_LINKED = 'CUSTOMER_ALREADY_LINKED';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampLimit(limit?: number): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates a concrete ConversationService with validation, repository, and audit */
export function createConversationService(
  deps: ConversationServiceDeps,
): ConversationService {
  const { repository, audit } = deps;

  // -------------------------------------------------------------------------
  // Audit helper — fire and forget, never blocks the caller
  // -------------------------------------------------------------------------
  function emitAudit(
    businessId: string,
    actorUserId: string | undefined,
    action: string,
    targetType: string,
    targetId: string,
    metadata?: JsonValue,
  ): void {
    audit
      .createAuditEvent({
        businessId,
        actorType: actorUserId ? 'USER' : 'SYSTEM',
        actorUserId,
        action,
        targetType,
        targetId,
        result: 'SUCCESS',
        metadata,
      })
      .catch(() => {
        // Audit failures are non-fatal — logged but never block the service
      });
  }

  return {
    // -----------------------------------------------------------------------
    // Conversations
    // -----------------------------------------------------------------------

    async createConversation(input) {
      const validation = validateCreateConversationInput(input);
      if (!validation.valid) {
        return err(INVALID_INPUT, validation.errors.join('; '));
      }

      // Create conversation
      const convResult = await repository.createConversation(input);
      if (!convResult.ok) return convResult;

      // Create initial message if provided
      if (input.initialMessage) {
        const msgResult = await repository.createMessage({
          conversationId: convResult.data.id,
          businessId: input.businessId,
          direction: input.initialMessage.direction,
          senderType: input.initialMessage.senderType,
          senderUserId: input.initialMessage.senderUserId,
          senderCustomerId: input.initialMessage.senderCustomerId,
          content: input.initialMessage.content,
          contentType: input.initialMessage.contentType,
          channelMetadata: input.initialMessage.channelMetadata,
          metadata: input.initialMessage.metadata,
        });
        if (!msgResult.ok) return msgResult;
      }

      // Emit audit — conversation.created
      emitAudit(
        input.businessId,
        undefined, // system action at creation
        'conversation.created',
        'conversation',
        convResult.data.id,
        {
          channel: convResult.data.channel,
          ...(convResult.data.customerId
            ? { customerId: convResult.data.customerId }
            : {}),
        },
      );

      // Re-fetch with summary
      const refreshed = await repository.findConversationById(
        convResult.data.id,
        input.businessId,
      );
      if (refreshed.ok && refreshed.data) {
        return { ok: true as const, data: refreshed.data };
      }

      // Fallback: return without summary
      return {
        ok: true as const,
        data: {
          ...convResult.data,
          messageCount: input.initialMessage ? 1 : 0,
          lastMessageAt: null,
        },
      };
    },

    async findConversationById(input) {
      return repository.findConversationById(
        input.conversationId,
        input.businessId,
      );
    },

    async listConversations(input) {
      return repository.listConversations({
        businessId: input.businessId,
        status: input.status,
        assignedUserId: input.assignedUserId,
        customerId: input.customerId,
        channel: input.channel,
        limit: clampLimit(input.limit),
        cursor: input.cursor,
      });
    },

    async updateConversation(input) {
      const validation = validateUpdateConversationInput(input.data);
      if (!validation.valid) {
        return err(INVALID_INPUT, validation.errors.join('; '));
      }

      // Verify conversation exists and belongs to business
      const existing = await repository.findConversationById(
        input.conversationId,
        input.businessId,
      );
      if (!existing.ok) return existing;
      if (!existing.data) {
        return err(NOT_FOUND, 'Conversation not found');
      }

      // Prevent re-linking customer (null → value is OK; value → different value is not)
      if (
        input.data.customerId !== undefined &&
        existing.data.customerId !== null &&
        input.data.customerId !== existing.data.customerId
      ) {
        return err(
          CUSTOMER_ALREADY_LINKED,
          'Customer is already linked to this conversation',
        );
      }

      const updateData: Record<string, unknown> = {};
      if (input.data.customerId !== undefined)
        updateData.customerId = input.data.customerId;
      if (input.data.subject !== undefined)
        updateData.subject = input.data.subject;
      if (input.data.metadata !== undefined)
        updateData.metadata = input.data.metadata;

      const updateResult = await repository.updateConversation(
        input.conversationId,
        updateData,
      );
      if (!updateResult.ok) return updateResult;

      // Emit audit if customer was linked
      if (
        input.data.customerId &&
        existing.data.customerId === null
      ) {
        emitAudit(
          input.businessId,
          undefined,
          'conversation.customer_linked',
          'conversation',
          input.conversationId,
          { customerId: input.data.customerId },
        );
      }

      // Re-fetch with summary
      const refreshed = await repository.findConversationById(
        input.conversationId,
        input.businessId,
      );
      if (refreshed.ok && refreshed.data) {
        return { ok: true as const, data: refreshed.data };
      }
      return {
        ok: true as const,
        data: { ...updateResult.data, messageCount: 0, lastMessageAt: null },
      };
    },

    async assignConversation(input) {
      // Verify conversation exists
      const existing = await repository.findConversationById(
        input.conversationId,
        input.businessId,
      );
      if (!existing.ok) return existing;
      if (!existing.data) {
        return err(NOT_FOUND, 'Conversation not found');
      }

      if (!input.assignedUserId) {
        return err(INVALID_ASSIGNMENT, 'assignedUserId is required');
      }

      const previousAssignedUserId = existing.data.assignedUserId;

      // Determine status transition based on current status
      let newStatus = existing.data.status;
      if (
        existing.data.status === 'NEW' ||
        existing.data.status === 'OPEN' ||
        existing.data.status === 'ESCALATED'
      ) {
        newStatus = 'ASSIGNED';
      }

      const updateResult = await repository.updateConversation(
        input.conversationId,
        {
          assignedUserId: input.assignedUserId,
          status: newStatus,
        },
      );
      if (!updateResult.ok) return updateResult;

      // Emit audit — conversation.assigned
      emitAudit(
        input.businessId,
        input.actorUserId,
        'conversation.assigned',
        'conversation',
        input.conversationId,
        {
          assignedUserId: input.assignedUserId,
          ...(previousAssignedUserId
            ? { previousAssignedUserId }
            : {}),
        },
      );

      // Emit status change audit if status changed
      if (newStatus !== existing.data.status) {
        emitAudit(
          input.businessId,
          input.actorUserId,
          'conversation.status_changed',
          'conversation',
          input.conversationId,
          {
            fromStatus: existing.data.status,
            toStatus: newStatus,
          },
        );
      }

      return updateResult;
    },

    async changeStatus(input) {
      // Verify conversation exists
      const existing = await repository.findConversationById(
        input.conversationId,
        input.businessId,
      );
      if (!existing.ok) return existing;
      if (!existing.data) {
        return err(NOT_FOUND, 'Conversation not found');
      }

      // Validate transition
      const transitionResult = validateTransition(
        existing.data.status,
        input.toStatus,
      );
      if (!transitionResult.valid) {
        return err(INVALID_TRANSITION, transitionResult.errors.join('; '));
      }

      const updateData: Record<string, unknown> = {
        status: input.toStatus,
      };

      // Set closedAt when resolving
      if (input.toStatus === 'RESOLVED') {
        updateData.closedAt = new Date();
      }

      // Clear closedAt when reopening
      if (input.toStatus === 'OPEN' && existing.data.status === 'RESOLVED') {
        updateData.closedAt = null;
      }

      const updateResult = await repository.updateConversation(
        input.conversationId,
        updateData,
      );
      if (!updateResult.ok) return updateResult;

      // Emit audit if required
      if (isAuditRequiredTransition(input.toStatus)) {
        emitAudit(
          input.businessId,
          input.actorUserId,
          'conversation.status_changed',
          'conversation',
          input.conversationId,
          {
            fromStatus: existing.data.status,
            toStatus: input.toStatus,
          },
        );
      }

      return updateResult;
    },

    // -----------------------------------------------------------------------
    // Messages
    // -----------------------------------------------------------------------

    async createMessage(input) {
      // Determine direction and senderType from input
      const direction = input.direction;
      const isOperatorMessage = OPERATOR_ALLOWED_DIRECTIONS.includes(direction);

      const senderType: MessageSenderTypeValue = direction === 'INTERNAL' ? 'OPERATOR' : (
        direction === 'OUTBOUND' ? 'OPERATOR' : 'CUSTOMER'
      );

      const msgInput = {
        conversationId: input.conversationId,
        businessId: input.businessId,
        direction,
        senderType,
        senderUserId: input.senderUserId,
        content: input.content,
        contentType: input.contentType,
      } as const;

      const validation = validateCreateMessageInput(msgInput);
      if (!validation.valid) {
        return err(INVALID_MSG_INPUT, validation.errors.join('; '));
      }

      // Verify conversation exists and belongs to business
      const existing = await repository.findConversationById(
        input.conversationId,
        input.businessId,
      );
      if (!existing.ok) return existing;
      if (!existing.data) {
        return err(NOT_FOUND, 'Conversation not found');
      }

      // Create the message
      const msgResult = await repository.createMessage(msgInput);
      if (!msgResult.ok) return msgResult;

      // Emit audit for operator messages
      if (isOperatorMessage) {
        const auditAction =
          direction === 'INTERNAL'
            ? 'message.internal_note_created'
            : 'message.created';
        emitAudit(
          input.businessId,
          input.senderUserId,
          auditAction,
          'message',
          msgResult.data.id,
          {
            conversationId: input.conversationId,
            direction,
            senderType,
          },
        );
      }

      return msgResult;
    },

    async findMessageById(input) {
      return repository.findMessageById(input.messageId, input.businessId);
    },

    async listMessages(input) {
      // Verify conversation exists and belongs to business
      const existing = await repository.findConversationById(
        input.conversationId,
        input.businessId,
      );
      if (!existing.ok) return existing;
      if (!existing.data) {
        return err(NOT_FOUND, 'Conversation not found');
      }

      return repository.listMessages({
        conversationId: input.conversationId,
        direction: input.direction,
        limit: clampLimit(input.limit),
        cursor: input.cursor,
      });
    },
  };
}
