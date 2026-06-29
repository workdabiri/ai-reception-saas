// ===========================================================================
// Reply Drafts Domain — Types
//
// Domain-level type definitions for reply drafts.
// These types mirror the Prisma schema but are decoupled from it.
// ===========================================================================

/** Allowed reply draft source values */
export const REPLY_DRAFT_SOURCE_VALUES = [
  'AI',
  'SYSTEM',
  'OPERATOR',
] as const;

/** Reply draft source */
export type ReplyDraftSourceValue = (typeof REPLY_DRAFT_SOURCE_VALUES)[number];

/** Allowed reply draft status values */
export const REPLY_DRAFT_STATUS_VALUES = [
  'PENDING_REVIEW',
  'EDITED',
  'APPROVED',
  'DISCARDED',
  'SENT',
] as const;

/** Reply draft status */
export type ReplyDraftStatusValue =
  (typeof REPLY_DRAFT_STATUS_VALUES)[number];

/** Reviewable draft statuses (shown on dashboard) */
export const REVIEWABLE_DRAFT_STATUSES: readonly ReplyDraftStatusValue[] = [
  'PENDING_REVIEW',
  'EDITED',
];

// ---------------------------------------------------------------------------
// Domain entities
// ---------------------------------------------------------------------------

/** Domain representation of a reply draft */
export interface ReplyDraftIdentity {
  id: string;
  businessId: string;
  conversationId: string;
  sourceMessageId: string | null;
  createdByUserId: string | null;
  source: ReplyDraftSourceValue;
  status: ReplyDraftStatusValue;
  draftText: string;
  originalText: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  sentMessageId: string | null;
  modelProvider: string | null;
  modelName: string | null;
  promptVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Dashboard-optimised reply draft item */
export interface ReplyDraftDashboardItem {
  id: string;
  conversationId: string;
  customerName: string | null;
  subject: string | null;
  channel: string;
  draftTextPreview: string;
  source: ReplyDraftSourceValue;
  status: 'PENDING_REVIEW' | 'EDITED';
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Generate stub types
// ---------------------------------------------------------------------------

/** Input for creating a SYSTEM-generated stub draft */
export interface CreateSystemDraftInput {
  businessId: string;
  conversationId: string;
  createdByUserId: string;
  draftText: string;
}

/** Result of generate-or-reuse stub draft */
export interface GenerateStubDraftResult {
  created: boolean;
  draft: {
    id: string;
    conversationId: string;
    source: ReplyDraftSourceValue;
    status: 'PENDING_REVIEW' | 'EDITED';
    draftTextPreview: string;
    createdAt: string;
  };
}

// ---------------------------------------------------------------------------
// Discard types
// ---------------------------------------------------------------------------

/** Input for discarding a reply draft */
export interface DiscardDraftInput {
  businessId: string;
  conversationId: string;
  draftId: string;
  reviewedByUserId: string;
}

/** Result of discard operation */
export interface DiscardDraftResult {
  discarded: boolean;
  /** The draft status before transition. Set when discarded=true, null on idempotent path. */
  previousStatus: ReplyDraftStatusValue | null;
  draft: {
    id: string;
    conversationId: string;
    status: ReplyDraftStatusValue;
    source: ReplyDraftSourceValue;
    reviewedAt: string | null;
    reviewedByUserId: string | null;
    updatedAt: string;
  };
}

// ---------------------------------------------------------------------------
// Edit types
// ---------------------------------------------------------------------------

/** Input for editing a reply draft */
export interface EditDraftInput {
  businessId: string;
  conversationId: string;
  draftId: string;
  draftText: string;
}

/** Result of edit operation */
export interface EditDraftResult {
  /** The draft status before edit (PENDING_REVIEW or EDITED). */
  previousStatus: ReplyDraftStatusValue;
  /** Length of draftText before edit. */
  previousTextLength: number;
  /** Length of draftText after edit. */
  newTextLength: number;
  draft: {
    id: string;
    conversationId: string;
    status: ReplyDraftStatusValue;
    source: ReplyDraftSourceValue;
    draftText: string;
    draftTextPreview: string;
    originalText: string | null;
    updatedAt: string;
  };
}

// ---------------------------------------------------------------------------
// Approve types
// ---------------------------------------------------------------------------

/** Input for approving a reply draft */
export interface ApproveDraftInput {
  businessId: string;
  conversationId: string;
  draftId: string;
  reviewedByUserId: string;
}

/** Result of approve operation */
export interface ApproveDraftResult {
  approved: boolean;
  /** The draft status before transition. Set when approved=true, null on idempotent path. */
  previousStatus: ReplyDraftStatusValue | null;
  draft: {
    id: string;
    conversationId: string;
    status: ReplyDraftStatusValue;
    source: ReplyDraftSourceValue;
    draftTextPreview: string;
    reviewedAt: string | null;
    reviewedByUserId: string | null;
    updatedAt: string;
  };
}

// ---------------------------------------------------------------------------
// Current draft read types
// ---------------------------------------------------------------------------

/** Input for reading the current active draft for a conversation */
export interface CurrentDraftInput {
  businessId: string;
  conversationId: string;
}

/** Active statuses included in current draft lookup */
export const ACTIVE_DRAFT_STATUSES: readonly ReplyDraftStatusValue[] = [
  'PENDING_REVIEW',
  'EDITED',
  'APPROVED',
];

/** Result of current draft read — draft is null when no active draft exists */
export interface CurrentDraftResult {
  draft: {
    id: string;
    conversationId: string;
    status: 'PENDING_REVIEW' | 'EDITED' | 'APPROVED';
    source: ReplyDraftSourceValue;
    draftText: string;
    draftTextPreview: string;
    originalText: string | null;
    reviewedAt: string | null;
    reviewedByUserId: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Send types
//
// Sending an APPROVED draft is an explicit, human-triggered operator action
// (permission: ai_drafts.send). It transitions APPROVED → SENT and links the
// draft to the outbound Message that the operator's reply created. It is NOT
// auto-send: nothing transitions to SENT without an operator request, and the
// outbound Message is an internal DB record only — no external channel/provider.
//
// The transition is performed as ONE atomic DB transaction:
//   (status-guarded claim APPROVED → SENT) + (outbound Message insert) +
//   (attach sentMessageId)
// commit together or not at all. This makes "SENT with sentMessageId = null"
// structurally impossible (a crash mid-send rolls the whole thing back, leaving
// the draft APPROVED and no message), while the status-guarded claim still
// prevents duplicate messages under concurrent/double-click requests.
// ---------------------------------------------------------------------------

/** Input for atomically sending an APPROVED draft. */
export interface SendApprovedDraftInput {
  businessId: string;
  conversationId: string;
  draftId: string;
  /** The authenticated operator performing the send. */
  sentByUserId: string;
}

/**
 * Outcome of an atomic send:
 * - SENT_NOW: this call transitioned APPROVED → SENT and created the message.
 * - ALREADY_SENT: the draft was already SENT (idempotent — no new message).
 */
export type SendApprovedDraftOutcome = 'SENT_NOW' | 'ALREADY_SENT';

/** Draft view returned by send operations (preview only — never the full text). */
export interface SentDraftView {
  id: string;
  conversationId: string;
  status: ReplyDraftStatusValue;
  source: ReplyDraftSourceValue;
  draftTextPreview: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  sentMessageId: string | null;
  sentAt: string | null;
  sentByUserId: string | null;
  updatedAt: string;
}

/** Metadata of the outbound message linked to a sent draft (no content). */
export interface SentMessageMetadata {
  id: string;
  conversationId: string;
  direction: string;
  senderType: string;
  senderUserId: string | null;
  createdAt: string;
}

/** Result of an atomic send. */
export interface SendApprovedDraftResult {
  outcome: SendApprovedDraftOutcome;
  draft: SentDraftView;
  /**
   * The created outbound message metadata — present when outcome is SENT_NOW;
   * null when ALREADY_SENT (the caller looks up the linked message by id).
   */
  message: SentMessageMetadata | null;
}

