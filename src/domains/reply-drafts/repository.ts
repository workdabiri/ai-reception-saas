// ===========================================================================
// Reply Drafts Domain — Repository
//
// Prisma-backed persistence layer for reply drafts.
// Uses injected Prisma-compatible client for testability.
// ===========================================================================

import { ok, err } from '@/lib/result';
import type { ActionResult } from '@/lib/result';
import type {
  ReplyDraftSourceValue,
  ReplyDraftStatusValue,
  ReplyDraftDashboardItem,
  CreateSystemDraftInput,
  GenerateStubDraftResult,
  DiscardDraftInput,
  DiscardDraftResult,
  EditDraftInput,
  EditDraftResult,
} from './types';

// ---------------------------------------------------------------------------
// Local record types (match Prisma-selected fields)
// ---------------------------------------------------------------------------

/** Raw reply draft record joined with conversation data for dashboard */
export interface ReplyDraftDashboardRecord {
  id: string;
  conversationId: string;
  source: ReplyDraftSourceValue;
  status: ReplyDraftStatusValue;
  draftText: string;
  createdAt: Date;
  conversation: {
    subject: string | null;
    channel: string;
    customer: {
      displayName: string;
    } | null;
  };
}

/** Raw reply draft record from create/find/update operations */
export interface ReplyDraftRecord {
  id: string;
  businessId: string;
  conversationId: string;
  source: ReplyDraftSourceValue;
  status: ReplyDraftStatusValue;
  draftText: string;
  originalText: string | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Injected DB client interface
// ---------------------------------------------------------------------------

/** Prisma-compatible delegate interface for ReplyDrafts repository */
export interface ReplyDraftRepositoryDb {
  replyDraft: {
    findMany(args: {
      where: {
        businessId: string;
        status: { in: ReplyDraftStatusValue[] };
        conversationId?: string;
      };
      orderBy: { createdAt: 'desc' };
      take: number;
      include?: {
        conversation: {
          select: {
            subject: true;
            channel: true;
            customer: {
              select: {
                displayName: true;
              };
            };
          };
        };
      };
    }): Promise<(ReplyDraftDashboardRecord | ReplyDraftRecord)[]>;
    findUnique(args: {
      where: { id: string };
    }): Promise<ReplyDraftRecord | null>;
    count(args: {
      where: {
        businessId: string;
        status: { in: ReplyDraftStatusValue[] };
        conversationId?: string;
      };
    }): Promise<number>;
    create(args: {
      data: {
        businessId: string;
        conversationId: string;
        createdByUserId: string;
        source: ReplyDraftSourceValue;
        status: ReplyDraftStatusValue;
        draftText: string;
        originalText: string;
      };
    }): Promise<ReplyDraftRecord>;
    update(args: {
      where: { id: string };
      data:
        | {
            status: ReplyDraftStatusValue;
            reviewedByUserId: string;
            reviewedAt: Date;
          }
        | {
            status: ReplyDraftStatusValue;
            draftText: string;
          };
    }): Promise<ReplyDraftRecord>;
  };
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

/** Dashboard drafts result */
export interface DashboardDraftsResult {
  pendingCount: number;
  drafts: readonly ReplyDraftDashboardItem[];
}

/** Repository boundary for ReplyDraft persistence */
export interface ReplyDraftRepository {
  /**
   * Returns pending/edited drafts for the dashboard, with conversation context.
   * Limited to a small number for the dashboard panel.
   */
  getDashboardDrafts(
    businessId: string,
    limit: number,
  ): Promise<ActionResult<DashboardDraftsResult>>;

  /**
   * Finds the latest reviewable (PENDING_REVIEW | EDITED) draft for a conversation.
   * Returns null if none exists.
   */
  findLatestReviewableByConversation(
    businessId: string,
    conversationId: string,
  ): Promise<ActionResult<ReplyDraftRecord | null>>;

  /**
   * Creates a SYSTEM-generated stub draft.
   */
  createSystemDraft(
    input: CreateSystemDraftInput,
  ): Promise<ActionResult<ReplyDraftRecord>>;

  /**
   * Finds or creates a reviewable SYSTEM stub draft for a conversation.
   * Returns `{ created: true }` if a new draft was created, `{ created: false }`
   * if an existing one was reused.
   */
  generateOrReuseStubDraft(
    input: CreateSystemDraftInput,
  ): Promise<ActionResult<GenerateStubDraftResult>>;

  /**
   * Finds a draft by ID, scoped strictly by businessId and conversationId.
   * Returns null if not found or scope mismatch.
   */
  findByBusinessConversationAndId(
    businessId: string,
    conversationId: string,
    draftId: string,
  ): Promise<ActionResult<ReplyDraftRecord | null>>;

  /**
   * Discards a draft (PENDING_REVIEW | EDITED → DISCARDED).
   * Sets reviewedByUserId and reviewedAt.
   * Returns `{ discarded: true }` when status was transitioned.
   * Returns `{ discarded: false }` when draft was already DISCARDED (idempotent).
   * Rejects APPROVED / SENT with an error.
   */
  discardDraft(
    input: DiscardDraftInput,
  ): Promise<ActionResult<DiscardDraftResult>>;

  /**
   * Edits a reviewable draft (PENDING_REVIEW | EDITED → EDITED).
   * Updates draftText and sets status to EDITED.
   * Preserves originalText and source.
   * Does NOT set reviewedAt/reviewedByUserId (reserved for approve/discard/send).
   * Rejects DISCARDED / APPROVED / SENT with an error.
   */
  editDraft(
    input: EditDraftInput,
  ): Promise<ActionResult<EditDraftResult>>;

  /**
   * Counts reviewable (PENDING_REVIEW | EDITED) drafts for a conversation.
   * Used for aiDraftStatus reconciliation after discard.
   */
  countReviewableByConversation(
    businessId: string,
    conversationId: string,
  ): Promise<ActionResult<number>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ERROR_CODE = 'REPLY_DRAFT_REPOSITORY_ERROR';
const REPO_ERROR_MSG = 'Reply draft repository operation failed';

/** Maximum preview length for dashboard draft text */
const PREVIEW_MAX_LENGTH = 120;

/** Safely truncates draft text to a preview */
function truncatePreview(text: string): string {
  if (text.length <= PREVIEW_MAX_LENGTH) return text;
  return text.slice(0, PREVIEW_MAX_LENGTH).trimEnd() + '…';
}

/** Maps a dashboard record to a dashboard DTO */
function mapToDashboardItem(
  record: ReplyDraftDashboardRecord,
): ReplyDraftDashboardItem {
  return {
    id: record.id,
    conversationId: record.conversationId,
    customerName: record.conversation.customer?.displayName ?? null,
    subject: record.conversation.subject,
    channel: record.conversation.channel,
    draftTextPreview: truncatePreview(record.draftText),
    source: record.source,
    status: record.status as 'PENDING_REVIEW' | 'EDITED',
    createdAt: record.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Reviewable statuses for dashboard queries */
const REVIEWABLE_STATUSES: ReplyDraftStatusValue[] = [
  'PENDING_REVIEW',
  'EDITED',
];

/** Creates a ReplyDraft repository backed by the given DB client */
export function createReplyDraftRepository(
  db: ReplyDraftRepositoryDb,
): ReplyDraftRepository {
  return {
    async getDashboardDrafts(businessId, limit) {
      try {
        const [count, records] = await Promise.all([
          db.replyDraft.count({
            where: { businessId, status: { in: REVIEWABLE_STATUSES } },
          }),
          db.replyDraft.findMany({
            where: { businessId, status: { in: REVIEWABLE_STATUSES } },
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
              conversation: {
                select: {
                  subject: true,
                  channel: true,
                  customer: {
                    select: {
                      displayName: true,
                    },
                  },
                },
              },
            },
          }),
        ]);

        return ok({
          pendingCount: count,
          drafts: (records as ReplyDraftDashboardRecord[]).map(mapToDashboardItem),
        });
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async findLatestReviewableByConversation(businessId, conversationId) {
      try {
        const records = await db.replyDraft.findMany({
          where: {
            businessId,
            conversationId,
            status: { in: REVIEWABLE_STATUSES },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        });
        const record = records[0] ?? null;
        return ok(record as ReplyDraftRecord | null);
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async createSystemDraft(input) {
      try {
        const record = await db.replyDraft.create({
          data: {
            businessId: input.businessId,
            conversationId: input.conversationId,
            createdByUserId: input.createdByUserId,
            source: 'SYSTEM',
            status: 'PENDING_REVIEW',
            draftText: input.draftText,
            originalText: input.draftText,
          },
        });
        return ok(record);
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async generateOrReuseStubDraft(input) {
      try {
        // Check for existing reviewable draft
        const existingResult = await this.findLatestReviewableByConversation(
          input.businessId,
          input.conversationId,
        );
        if (!existingResult.ok) {
          return err(existingResult.error.code, existingResult.error.message);
        }

        if (existingResult.data) {
          const existing = existingResult.data;
          return ok({
            created: false,
            draft: {
              id: existing.id,
              conversationId: existing.conversationId,
              source: existing.source,
              status: existing.status as 'PENDING_REVIEW' | 'EDITED',
              draftTextPreview: truncatePreview(existing.draftText),
              createdAt: existing.createdAt.toISOString(),
            },
          });
        }

        // Create new stub draft
        const createResult = await this.createSystemDraft(input);
        if (!createResult.ok) {
          return err(createResult.error.code, createResult.error.message);
        }

        const created = createResult.data;
        return ok({
          created: true,
          draft: {
            id: created.id,
            conversationId: created.conversationId,
            source: created.source,
            status: created.status as 'PENDING_REVIEW' | 'EDITED',
            draftTextPreview: truncatePreview(created.draftText),
            createdAt: created.createdAt.toISOString(),
          },
        });
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async findByBusinessConversationAndId(businessId, conversationId, draftId) {
      try {
        const record = await db.replyDraft.findUnique({
          where: { id: draftId },
        });
        if (!record) return ok(null);
        // Scope guard: reject if record doesn't belong to the right business/conversation
        if (record.businessId !== businessId || record.conversationId !== conversationId) {
          return ok(null);
        }
        return ok(record);
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async discardDraft(input) {
      try {
        // Fetch draft with scope guard
        const findResult = await this.findByBusinessConversationAndId(
          input.businessId,
          input.conversationId,
          input.draftId,
        );
        if (!findResult.ok) {
          return err(findResult.error.code, findResult.error.message);
        }
        if (!findResult.data) {
          return err('DRAFT_NOT_FOUND', 'Draft not found');
        }

        const draft = findResult.data;

        // Already discarded → idempotent success
        if (draft.status === 'DISCARDED') {
          return ok({
            discarded: false,
            previousStatus: null,
            draft: {
              id: draft.id,
              conversationId: draft.conversationId,
              status: draft.status,
              source: draft.source,
              reviewedAt: draft.reviewedAt?.toISOString() ?? null,
              reviewedByUserId: draft.reviewedByUserId,
              updatedAt: draft.updatedAt.toISOString(),
            },
          });
        }

        // APPROVED or SENT → reject
        if (draft.status === 'APPROVED' || draft.status === 'SENT') {
          return err('DRAFT_NOT_DISCARDABLE', 'Cannot discard an approved or sent draft');
        }

        // PENDING_REVIEW or EDITED → transition to DISCARDED
        const now = new Date();
        const updated = await db.replyDraft.update({
          where: { id: input.draftId },
          data: {
            status: 'DISCARDED',
            reviewedByUserId: input.reviewedByUserId,
            reviewedAt: now,
          },
        });

        return ok({
          discarded: true,
          previousStatus: draft.status,
          draft: {
            id: updated.id,
            conversationId: updated.conversationId,
            status: updated.status,
            source: updated.source,
            reviewedAt: updated.reviewedAt?.toISOString() ?? null,
            reviewedByUserId: updated.reviewedByUserId,
            updatedAt: updated.updatedAt.toISOString(),
          },
        });
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async editDraft(input) {
      try {
        // Fetch draft with scope guard
        const findResult = await this.findByBusinessConversationAndId(
          input.businessId,
          input.conversationId,
          input.draftId,
        );
        if (!findResult.ok) {
          return err(findResult.error.code, findResult.error.message);
        }
        if (!findResult.data) {
          return err('DRAFT_NOT_FOUND', 'Draft not found');
        }

        const draft = findResult.data;

        // Only PENDING_REVIEW or EDITED can be edited
        if (draft.status !== 'PENDING_REVIEW' && draft.status !== 'EDITED') {
          return err('DRAFT_NOT_EDITABLE', 'Cannot edit a discarded, approved, or sent draft');
        }

        const previousStatus = draft.status;
        const previousTextLength = draft.draftText.length;

        // Update draftText and set status to EDITED
        const updated = await db.replyDraft.update({
          where: { id: input.draftId },
          data: {
            status: 'EDITED',
            draftText: input.draftText,
          },
        });

        return ok({
          previousStatus,
          previousTextLength,
          newTextLength: input.draftText.length,
          draft: {
            id: updated.id,
            conversationId: updated.conversationId,
            status: updated.status,
            source: updated.source,
            draftText: updated.draftText,
            draftTextPreview: truncatePreview(updated.draftText),
            originalText: draft.originalText ?? null,
            updatedAt: updated.updatedAt.toISOString(),
          },
        });
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async countReviewableByConversation(businessId, conversationId) {
      try {
        const count = await db.replyDraft.count({
          where: {
            businessId,
            conversationId,
            status: { in: REVIEWABLE_STATUSES },
          },
        });
        return ok(count);
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },
  };
}
