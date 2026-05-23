// ===========================================================================
// Conversations Domain — Validation
//
// Input validation for conversations and messages.
// Includes the conversation state machine transition rules.
// ===========================================================================

import {
  CONVERSATION_STATUS_VALUES,
  MESSAGE_DIRECTION_VALUES,
  MESSAGE_SENDER_TYPE_VALUES,
  CHANNEL_TYPE_VALUES,
  type ConversationStatusValue,
  type MessageDirectionValue,
  type MessageSenderTypeValue,
  type ChannelTypeValue,
  type CreateConversationInput,
  type CreateMessageInput,
  type UpdateConversationInput,
  type InitialMessageInput,
} from './types';

// ---------------------------------------------------------------------------
// Enum validators
// ---------------------------------------------------------------------------

/** Type guard: checks if a string is a valid ConversationStatus */
export function isValidConversationStatus(
  value: string,
): value is ConversationStatusValue {
  return (CONVERSATION_STATUS_VALUES as readonly string[]).includes(value);
}

/** Type guard: checks if a string is a valid MessageDirection */
export function isValidMessageDirection(
  value: string,
): value is MessageDirectionValue {
  return (MESSAGE_DIRECTION_VALUES as readonly string[]).includes(value);
}

/** Type guard: checks if a string is a valid MessageSenderType */
export function isValidMessageSenderType(
  value: string,
): value is MessageSenderTypeValue {
  return (MESSAGE_SENDER_TYPE_VALUES as readonly string[]).includes(value);
}

/** Type guard: checks if a string is a valid ChannelType */
export function isValidChannelType(value: string): value is ChannelTypeValue {
  return (CHANNEL_TYPE_VALUES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Conversation state machine
// ---------------------------------------------------------------------------

/**
 * Valid conversation status transitions.
 * Key = fromStatus, Value = set of allowed toStatus values.
 */
export const VALID_TRANSITIONS: Record<
  ConversationStatusValue,
  readonly ConversationStatusValue[]
> = {
  NEW: ['OPEN', 'ASSIGNED'],
  OPEN: ['ASSIGNED'],
  ASSIGNED: ['WAITING_CUSTOMER', 'ESCALATED', 'RESOLVED'],
  WAITING_CUSTOMER: ['WAITING_OPERATOR', 'RESOLVED'],
  WAITING_OPERATOR: ['ASSIGNED', 'ESCALATED'],
  ESCALATED: ['ASSIGNED', 'RESOLVED'],
  RESOLVED: ['OPEN'],
} as const;

/** Transitions that require audit logging */
export const AUDIT_REQUIRED_TRANSITIONS: ReadonlySet<ConversationStatusValue> =
  new Set<ConversationStatusValue>([
    'ASSIGNED',
    'ESCALATED',
    'RESOLVED',
    'OPEN', // reopen from RESOLVED
  ]);

/**
 * Checks whether a status transition is valid.
 * Returns true if the transition from → to is allowed.
 */
export function isValidTransition(
  from: ConversationStatusValue,
  to: ConversationStatusValue,
): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(to);
}

/**
 * Checks whether a status transition requires audit logging.
 */
export function isAuditRequiredTransition(
  to: ConversationStatusValue,
): boolean {
  return AUDIT_REQUIRED_TRANSITIONS.has(to);
}

// ---------------------------------------------------------------------------
// Input validation results
// ---------------------------------------------------------------------------

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function success(): ValidationResult {
  return { valid: true, errors: [] };
}

function failure(...errors: string[]): ValidationResult {
  return { valid: false, errors };
}

// ---------------------------------------------------------------------------
// Conversation input validation
// ---------------------------------------------------------------------------

/** Validates CreateConversationInput */
export function validateCreateConversationInput(
  input: Partial<CreateConversationInput>,
): ValidationResult {
  const errors: string[] = [];

  if (!input.businessId || typeof input.businessId !== 'string') {
    errors.push('businessId is required');
  }

  if (
    input.channel !== undefined &&
    !isValidChannelType(input.channel as string)
  ) {
    errors.push(
      `Invalid channel: ${input.channel}. Must be one of: ${CHANNEL_TYPE_VALUES.join(', ')}`,
    );
  }

  if (input.subject !== undefined && typeof input.subject !== 'string') {
    errors.push('subject must be a string');
  }

  if (
    input.customerId !== undefined &&
    typeof input.customerId !== 'string'
  ) {
    errors.push('customerId must be a string');
  }

  return errors.length === 0 ? success() : failure(...errors);
}

/** Validates UpdateConversationInput */
export function validateUpdateConversationInput(
  input: Partial<UpdateConversationInput>,
): ValidationResult {
  const errors: string[] = [];

  if (
    input.customerId !== undefined &&
    input.customerId !== null &&
    typeof input.customerId !== 'string'
  ) {
    errors.push('customerId must be a string or null');
  }

  if (
    input.subject !== undefined &&
    input.subject !== null &&
    typeof input.subject !== 'string'
  ) {
    errors.push('subject must be a string or null');
  }

  // At least one field should be provided
  const hasUpdate =
    input.customerId !== undefined ||
    input.subject !== undefined ||
    input.metadata !== undefined;
  if (!hasUpdate) {
    errors.push('At least one field must be provided for update');
  }

  return errors.length === 0 ? success() : failure(...errors);
}

// ---------------------------------------------------------------------------
// Message input validation
// ---------------------------------------------------------------------------

/** Allowed directions for operator-created messages */
export const OPERATOR_ALLOWED_DIRECTIONS: readonly MessageDirectionValue[] = [
  'OUTBOUND',
  'INTERNAL',
];

/** Validates CreateMessageInput */
export function validateCreateMessageInput(
  input: Partial<CreateMessageInput>,
): ValidationResult {
  const errors: string[] = [];

  if (!input.conversationId || typeof input.conversationId !== 'string') {
    errors.push('conversationId is required');
  }

  if (!input.businessId || typeof input.businessId !== 'string') {
    errors.push('businessId is required');
  }

  if (!input.direction || !isValidMessageDirection(input.direction as string)) {
    errors.push(
      `Invalid direction: ${input.direction}. Must be one of: ${MESSAGE_DIRECTION_VALUES.join(', ')}`,
    );
  }

  if (
    !input.senderType ||
    !isValidMessageSenderType(input.senderType as string)
  ) {
    errors.push(
      `Invalid senderType: ${input.senderType}. Must be one of: ${MESSAGE_SENDER_TYPE_VALUES.join(', ')}`,
    );
  }

  if (!input.content || typeof input.content !== 'string') {
    errors.push('content is required and must be a non-empty string');
  }

  if (
    input.contentType !== undefined &&
    typeof input.contentType !== 'string'
  ) {
    errors.push('contentType must be a string');
  }

  return errors.length === 0 ? success() : failure(...errors);
}

/** Validates InitialMessageInput */
export function validateInitialMessageInput(
  input: Partial<InitialMessageInput>,
): ValidationResult {
  const errors: string[] = [];

  if (!input.content || typeof input.content !== 'string') {
    errors.push('initialMessage.content is required');
  }

  if (
    !input.direction ||
    !isValidMessageDirection(input.direction as string)
  ) {
    errors.push(
      `Invalid initialMessage.direction: ${input.direction}. Must be one of: ${MESSAGE_DIRECTION_VALUES.join(', ')}`,
    );
  }

  if (
    !input.senderType ||
    !isValidMessageSenderType(input.senderType as string)
  ) {
    errors.push(
      `Invalid initialMessage.senderType: ${input.senderType}. Must be one of: ${MESSAGE_SENDER_TYPE_VALUES.join(', ')}`,
    );
  }

  return errors.length === 0 ? success() : failure(...errors);
}

/** Validates a conversation status transition */
export function validateTransition(
  from: ConversationStatusValue,
  to: ConversationStatusValue,
): ValidationResult {
  if (!isValidConversationStatus(from)) {
    return failure(`Invalid fromStatus: ${from}`);
  }
  if (!isValidConversationStatus(to)) {
    return failure(`Invalid toStatus: ${to}`);
  }
  if (!isValidTransition(from, to)) {
    return failure(
      `Invalid transition from ${from} to ${to}. Allowed: ${VALID_TRANSITIONS[from].join(', ')}`,
    );
  }
  return success();
}
