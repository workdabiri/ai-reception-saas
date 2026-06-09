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
