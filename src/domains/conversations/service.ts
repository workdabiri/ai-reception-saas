// ===========================================================================
// Conversations Domain — Service Interface
//
// Pure service boundary for conversation and message operations.
// No implementation — interface definitions only.
// ===========================================================================

import type { ActionResult } from '@/lib/result';
import type {
  ConversationIdentity,
  ConversationWithSummary,
  MessageIdentity,
  ConversationStatusValue,
  ChannelTypeValue,
  MessageDirectionValue,
  CreateConversationInput,
  UpdateConversationInput,
  InitialMessageInput,
} from './types';

// ---------------------------------------------------------------------------
// Service-specific input types
// ---------------------------------------------------------------------------

/** Input for creating a conversation with optional initial message */
export interface CreateConversationServiceInput extends CreateConversationInput {
  readonly initialMessage?: InitialMessageInput;
  readonly actorUserId?: string;
}

/** Input for finding a conversation by ID */
export interface FindConversationByIdInput {
  readonly conversationId: string;
  readonly businessId: string;
}

/** Input for listing conversations */
export interface ListConversationsInput {
  readonly businessId: string;
  readonly status?: ConversationStatusValue;
  readonly assignedUserId?: string;
  readonly customerId?: string;
  readonly channel?: ChannelTypeValue;
  readonly limit?: number;
  readonly cursor?: string;
}

/** Input for updating a conversation */
export interface UpdateConversationServiceInput {
  readonly conversationId: string;
  readonly businessId: string;
  readonly data: UpdateConversationInput;
  readonly actorUserId?: string;
}

/** Input for assigning a conversation */
export interface AssignConversationServiceInput {
  readonly conversationId: string;
  readonly businessId: string;
  readonly assignedUserId: string;
  readonly actorUserId: string;
}

/** Input for changing conversation status */
export interface ChangeStatusServiceInput {
  readonly conversationId: string;
  readonly businessId: string;
  readonly toStatus: ConversationStatusValue;
  readonly actorUserId: string;
}

/** Input for creating a message */
export interface CreateMessageServiceInput {
  readonly conversationId: string;
  readonly businessId: string;
  readonly content: string;
  readonly direction: MessageDirectionValue;
  readonly senderUserId?: string;
  readonly senderCustomerId?: string;
  readonly contentType?: string;
}

/** Input for finding a message by ID */
export interface FindMessageByIdInput {
  readonly messageId: string;
  readonly businessId: string;
}

/** Input for listing messages */
export interface ListMessagesInput {
  readonly conversationId: string;
  readonly businessId: string;
  readonly direction?: MessageDirectionValue;
  readonly limit?: number;
  readonly cursor?: string;
}

/** Paginated conversation list result */
export interface PaginatedConversationsResult {
  data: readonly ConversationWithSummary[];
  nextCursor: string | null;
}

/** Paginated message list result */
export interface PaginatedMessagesResult {
  data: readonly MessageIdentity[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/** Conversations service error code constants */
export const CONVERSATION_ERROR_CODES = [
  'CONVERSATION_NOT_FOUND',
  'MESSAGE_NOT_FOUND',
  'INVALID_CONVERSATION_INPUT',
  'INVALID_MESSAGE_INPUT',
  'INVALID_CONVERSATION_TRANSITION',
  'INVALID_ASSIGNMENT',
  'CUSTOMER_ALREADY_LINKED',
  'CONVERSATION_REPOSITORY_ERROR',
] as const;

/** Conversations service error code type */
export type ConversationErrorCode =
  (typeof CONVERSATION_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/** Service boundary for conversation and message operations */
export interface ConversationService {
  createConversation(
    input: CreateConversationServiceInput,
  ): Promise<ActionResult<ConversationWithSummary>>;

  findConversationById(
    input: FindConversationByIdInput,
  ): Promise<ActionResult<ConversationWithSummary | null>>;

  listConversations(
    input: ListConversationsInput,
  ): Promise<ActionResult<PaginatedConversationsResult>>;

  updateConversation(
    input: UpdateConversationServiceInput,
  ): Promise<ActionResult<ConversationWithSummary>>;

  assignConversation(
    input: AssignConversationServiceInput,
  ): Promise<ActionResult<ConversationIdentity>>;

  changeStatus(
    input: ChangeStatusServiceInput,
  ): Promise<ActionResult<ConversationIdentity>>;

  createMessage(
    input: CreateMessageServiceInput,
  ): Promise<ActionResult<MessageIdentity>>;

  findMessageById(
    input: FindMessageByIdInput,
  ): Promise<ActionResult<MessageIdentity | null>>;

  listMessages(
    input: ListMessagesInput,
  ): Promise<ActionResult<PaginatedMessagesResult>>;
}
