// ===========================================================================
// Conversations Domain — Types
//
// Domain-level type definitions for conversations and messages.
// These types mirror the Prisma schema but are decoupled from it.
// ===========================================================================

/** Allowed conversation status values */
export const CONVERSATION_STATUS_VALUES = [
  'NEW',
  'OPEN',
  'ASSIGNED',
  'WAITING_CUSTOMER',
  'WAITING_OPERATOR',
  'ESCALATED',
  'RESOLVED',
] as const;

/** Conversation lifecycle status */
export type ConversationStatusValue =
  (typeof CONVERSATION_STATUS_VALUES)[number];

/** Allowed message direction values */
export const MESSAGE_DIRECTION_VALUES = [
  'INBOUND',
  'OUTBOUND',
  'SYSTEM',
  'INTERNAL',
] as const;

/** Message direction */
export type MessageDirectionValue = (typeof MESSAGE_DIRECTION_VALUES)[number];

/** Allowed message sender type values */
export const MESSAGE_SENDER_TYPE_VALUES = [
  'CUSTOMER',
  'OPERATOR',
  'SYSTEM',
  'AI_RECEPTIONIST',
] as const;

/** Message sender type */
export type MessageSenderTypeValue =
  (typeof MESSAGE_SENDER_TYPE_VALUES)[number];

/** Allowed channel type values */
export const CHANNEL_TYPE_VALUES = ['INTERNAL', 'WEBSITE_CHAT'] as const;

/** Channel type */
export type ChannelTypeValue = (typeof CHANNEL_TYPE_VALUES)[number];

/** Allowed AI classification status values */
export const AI_CLASSIFICATION_STATUS_VALUES = [
  'NOT_REQUESTED',
  'PENDING',
  'READY',
  'FAILED',
] as const;

/** AI classification status */
export type AiClassificationStatusValue =
  (typeof AI_CLASSIFICATION_STATUS_VALUES)[number];

/** Allowed AI draft status values */
export const AI_DRAFT_STATUS_VALUES = [
  'NOT_REQUESTED',
  'PENDING',
  'READY',
  'APPROVED',
  'REJECTED',
  'FAILED',
] as const;

/** AI draft status */
export type AiDraftStatusValue = (typeof AI_DRAFT_STATUS_VALUES)[number];

// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

/** Domain representation of a conversation */
export interface ConversationIdentity {
  id: string;
  businessId: string;
  customerId: string | null;
  channel: ChannelTypeValue;
  status: ConversationStatusValue;
  subject: string | null;
  assignedUserId: string | null;
  aiClassificationStatus: AiClassificationStatusValue;
  aiDraftStatus: AiDraftStatusValue;
  channelMetadata: unknown | null;
  metadata: unknown | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Domain representation of a message */
export interface MessageIdentity {
  id: string;
  conversationId: string;
  businessId: string;
  direction: MessageDirectionValue;
  senderType: MessageSenderTypeValue;
  senderUserId: string | null;
  senderCustomerId: string | null;
  content: string;
  contentType: string;
  channelMetadata: unknown | null;
  metadata: unknown | null;
  createdAt: string;
}

/** Conversation with message count summary */
export interface ConversationWithSummary extends ConversationIdentity {
  messageCount: number;
  lastMessageAt: string | null;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Input for creating a new conversation */
export interface CreateConversationInput {
  businessId: string;
  customerId?: string;
  channel?: ChannelTypeValue;
  subject?: string;
  channelMetadata?: unknown;
  metadata?: unknown;
}

/** Input for the optional initial message when creating a conversation */
export interface InitialMessageInput {
  content: string;
  direction: MessageDirectionValue;
  senderType: MessageSenderTypeValue;
  senderUserId?: string;
  senderCustomerId?: string;
  contentType?: string;
  channelMetadata?: unknown;
  metadata?: unknown;
}

/** Input for updating a conversation */
export interface UpdateConversationInput {
  customerId?: string;
  subject?: string | null;
  metadata?: unknown | null;
}

/** Input for creating a message */
export interface CreateMessageInput {
  conversationId: string;
  businessId: string;
  direction: MessageDirectionValue;
  senderType: MessageSenderTypeValue;
  senderUserId?: string;
  senderCustomerId?: string;
  content: string;
  contentType?: string;
  channelMetadata?: unknown;
  metadata?: unknown;
}

/** Input for assigning a conversation */
export interface AssignConversationInput {
  conversationId: string;
  businessId: string;
  assignedUserId: string;
}

/** Input for changing conversation status */
export interface ChangeConversationStatusInput {
  conversationId: string;
  businessId: string;
  toStatus: ConversationStatusValue;
}
