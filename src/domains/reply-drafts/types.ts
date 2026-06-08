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
