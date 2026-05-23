// ===========================================================================
// Conversations Domain — Public API
//
// Re-exports the domain types, service interface, service factory,
// repository factory, and repository DB type.
// This module is the single entry point for Conversations domain functionality.
//
// @module
// ===========================================================================

export {
  CONVERSATION_STATUS_VALUES,
  MESSAGE_DIRECTION_VALUES,
  MESSAGE_SENDER_TYPE_VALUES,
  CHANNEL_TYPE_VALUES,
  AI_CLASSIFICATION_STATUS_VALUES,
  AI_DRAFT_STATUS_VALUES,
  type ConversationStatusValue,
  type MessageDirectionValue,
  type MessageSenderTypeValue,
  type ChannelTypeValue,
  type AiClassificationStatusValue,
  type AiDraftStatusValue,
  type ConversationIdentity,
  type MessageIdentity,
  type ConversationWithSummary,
  type CreateConversationInput,
  type InitialMessageInput,
  type UpdateConversationInput,
  type CreateMessageInput,
  type AssignConversationInput,
  type ChangeConversationStatusInput,
} from './types';

export {
  isValidConversationStatus,
  isValidMessageDirection,
  isValidMessageSenderType,
  isValidChannelType,
  isValidUuid,
  VALID_TRANSITIONS,
  AUDIT_REQUIRED_TRANSITIONS,
  isValidTransition,
  isAuditRequiredTransition,
  validateCreateConversationInput,
  validateUpdateConversationInput,
  validateCreateMessageInput,
  validateInitialMessageInput,
  validateTransition,
  OPERATOR_ALLOWED_DIRECTIONS,
  type ValidationResult,
} from './validation';

export {
  createConversationRepository,
  mapConversationRecord,
  mapConversationWithSummary,
  mapMessageRecord,
  type ConversationRepositoryDb,
  type ConversationRepository,
  type ConversationRecord,
  type ConversationRecordWithSummary,
  type MessageRecord,
  type ListConversationsRepoInput,
  type ListMessagesRepoInput,
  type PaginatedConversations,
  type PaginatedMessages,
} from './repository';

export {
  CONVERSATION_ERROR_CODES,
  type ConversationErrorCode,
  type ConversationService,
  type CreateConversationServiceInput,
  type FindConversationByIdInput,
  type ListConversationsInput,
  type UpdateConversationServiceInput,
  type AssignConversationServiceInput,
  type ChangeStatusServiceInput,
  type CreateMessageServiceInput,
  type FindMessageByIdInput,
  type ListMessagesInput,
  type PaginatedConversationsResult,
  type PaginatedMessagesResult,
} from './service';

export {
  createConversationService,
  type ConversationServiceDeps,
} from './implementation';
