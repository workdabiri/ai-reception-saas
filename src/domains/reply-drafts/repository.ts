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
  ApproveDraftInput,
  ApproveDraftResult,
  CurrentDraftInput,
  CurrentDraftResult,
  SendApprovedDraftInput,
  SendApprovedDraftResult,
  SentDraftView,
  SentMessageMetadata,
} from './types';
import { ACTIVE_DRAFT_STATUSES } from './types';

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
  // Send fields — populated by Prisma for all scalar reads, but optional here so
  // existing record literals (mocks/tests) that predate the send lifecycle still
  // typecheck. Only the send path reads them.
  sentMessageId?: string | null;
  sentAt?: Date | null;
  sentByUserId?: string | null;
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
  /**
   * Interactive transaction used by the atomic send path. The claim, the
   * outbound-message insert, and the sentMessageId attach all run on the SAME
   * `tx` so they commit together or roll back together — there is no window in
   * which a draft is SENT without a linked message.
   *
   * Optional so existing repository-DB mocks (which never exercise send) remain
   * valid; the real Prisma client always provides `$transaction`.
   */
  $transaction?<T>(fn: (tx: ReplyDraftSendTxClient) => Promise<T>): Promise<T>;
}

/**
 * Minimal transaction-client surface the atomic send needs. `message.create` is
 * the conversations-owned Message table: it is written here ONLY inside the send
 * transaction (a pure internal DB insert — never an external channel/provider)
 * so the claim and the message commit atomically. Audit + the higher-level
 * message contract stay in the caller (handler), which re-emits message.created.
 */
export interface ReplyDraftSendTxClient {
  replyDraft: {
    findUnique(args: {
      where: { id: string };
    }): Promise<ReplyDraftRecord | null>;
    updateMany(args: {
      where: {
        id: string;
        businessId: string;
        conversationId: string;
        status: ReplyDraftStatusValue;
      };
      data: {
        status: ReplyDraftStatusValue;
        sentByUserId: string | null;
        sentAt: Date | null;
      };
    }): Promise<{ count: number }>;
    update(args: {
      where: { id: string };
      data: { sentMessageId: string };
    }): Promise<ReplyDraftRecord>;
  };
  message: {
    create(args: {
      data: {
        conversationId: string;
        businessId: string;
        direction: 'OUTBOUND';
        senderType: 'OPERATOR';
        senderUserId: string | null;
        senderCustomerId: string | null;
        content: string;
        contentType: string;
      };
    }): Promise<SentMessageRecord>;
  };
}

/** Message row fields the send transaction reads back after insert. */
export interface SentMessageRecord {
  id: string;
  conversationId: string;
  businessId: string;
  direction: string;
  senderType: string;
  senderUserId: string | null;
  senderCustomerId: string | null;
  content: string;
  contentType: string;
  createdAt: Date;
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
   * Approves a draft (PENDING_REVIEW | EDITED → APPROVED).
   * Sets reviewedByUserId and reviewedAt.
   * Returns `{ approved: true }` when status was transitioned.
   * Returns `{ approved: false }` when draft was already APPROVED (idempotent).
   * Rejects DISCARDED / SENT with an error.
   * Does NOT create a Message. Does NOT call any provider.
   */
  approveDraft(
    input: ApproveDraftInput,
  ): Promise<ActionResult<ApproveDraftResult>>;

  /**
   * Returns the latest active (PENDING_REVIEW | EDITED | APPROVED) draft
   * for a conversation. Returns `{ draft: null }` when no active draft exists.
   * Includes full draftText and originalText for operator review/editing.
   * Does NOT mutate anything.
   */
  getCurrentByConversation(
    input: CurrentDraftInput,
  ): Promise<ActionResult<CurrentDraftResult>>;

  /**
   * Counts reviewable (PENDING_REVIEW | EDITED) drafts for a conversation.
   * Used for aiDraftStatus reconciliation after discard.
   */
  countReviewableByConversation(
    businessId: string,
    conversationId: string,
  ): Promise<ActionResult<number>>;

  /**
   * Atomically send an APPROVED draft. In ONE transaction this:
   *   1. status-guarded claims APPROVED → SENT (stamping sentByUserId/sentAt),
   *   2. inserts the outbound OPERATOR message carrying the draft text,
   *   3. attaches the new message id to the draft (sentMessageId).
   * All three commit together — a crash at any point rolls everything back, so a
   * draft is never left SENT without a linked message.
   *
   * - APPROVED → `{ outcome: 'SENT_NOW', draft, message }`.
   * - Already SENT (or lost the concurrent claim) → `{ outcome: 'ALREADY_SENT',
   *   message: null }` (idempotent — NO second message is created).
   * - Not found / wrong tenant scope → DRAFT_NOT_FOUND.
   * - PENDING_REVIEW / EDITED / DISCARDED (or empty draft text) → DRAFT_NOT_SENDABLE.
   *
   * The message insert is a pure internal DB write — it never calls any external
   * channel/provider/network.
   */
  sendApprovedDraft(
    input: SendApprovedDraftInput,
  ): Promise<ActionResult<SendApprovedDraftResult>>;
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

/** Maps a draft record to the send-operation view (preview only, never full text) */
function toSentView(record: ReplyDraftRecord): SentDraftView {
  return {
    id: record.id,
    conversationId: record.conversationId,
    status: record.status,
    source: record.source,
    draftTextPreview: truncatePreview(record.draftText),
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    reviewedByUserId: record.reviewedByUserId,
    sentMessageId: record.sentMessageId ?? null,
    sentAt: record.sentAt?.toISOString() ?? null,
    sentByUserId: record.sentByUserId ?? null,
    updatedAt: record.updatedAt.toISOString(),
  };
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

    async approveDraft(input) {
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

        // Already APPROVED → idempotent success
        if (draft.status === 'APPROVED') {
          return ok({
            approved: false,
            previousStatus: null,
            draft: {
              id: draft.id,
              conversationId: draft.conversationId,
              status: draft.status,
              source: draft.source,
              draftTextPreview: truncatePreview(draft.draftText),
              reviewedAt: draft.reviewedAt?.toISOString() ?? null,
              reviewedByUserId: draft.reviewedByUserId,
              updatedAt: draft.updatedAt.toISOString(),
            },
          });
        }

        // DISCARDED or SENT → reject
        if (draft.status === 'DISCARDED' || draft.status === 'SENT') {
          return err('DRAFT_NOT_APPROVABLE', 'Cannot approve a discarded or sent draft');
        }

        // PENDING_REVIEW or EDITED → transition to APPROVED
        const now = new Date();
        const updated = await db.replyDraft.update({
          where: { id: input.draftId },
          data: {
            status: 'APPROVED',
            reviewedByUserId: input.reviewedByUserId,
            reviewedAt: now,
          },
        });

        return ok({
          approved: true,
          previousStatus: draft.status,
          draft: {
            id: updated.id,
            conversationId: updated.conversationId,
            status: updated.status,
            source: updated.source,
            draftTextPreview: truncatePreview(updated.draftText),
            reviewedAt: updated.reviewedAt?.toISOString() ?? null,
            reviewedByUserId: updated.reviewedByUserId,
            updatedAt: updated.updatedAt.toISOString(),
          },
        });
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async getCurrentByConversation(input) {
      try {
        const records = await db.replyDraft.findMany({
          where: {
            businessId: input.businessId,
            conversationId: input.conversationId,
            status: { in: [...ACTIVE_DRAFT_STATUSES] as ReplyDraftStatusValue[] },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        });
        const record = (records[0] as ReplyDraftRecord | undefined) ?? null;
        if (!record) {
          return ok({ draft: null });
        }
        return ok({
          draft: {
            id: record.id,
            conversationId: record.conversationId,
            status: record.status as 'PENDING_REVIEW' | 'EDITED' | 'APPROVED',
            source: record.source,
            draftText: record.draftText,
            draftTextPreview: truncatePreview(record.draftText),
            originalText: record.originalText ?? null,
            reviewedAt: record.reviewedAt?.toISOString() ?? null,
            reviewedByUserId: record.reviewedByUserId,
            createdAt: record.createdAt.toISOString(),
            updatedAt: record.updatedAt.toISOString(),
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

    async sendApprovedDraft(input) {
      // The atomic send requires an interactive transaction. The real Prisma
      // client always provides one; a mock that omits it fails closed here.
      const runInTransaction = db.$transaction;
      if (!runInTransaction) {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }

      // Discriminated transaction result — classification happens inside the tx
      // (consistent snapshot); the ActionResult is built after it commits.
      type TxResult =
        | { kind: 'SENT_NOW'; draft: SentDraftView; message: SentMessageMetadata }
        | { kind: 'ALREADY_SENT'; draft: SentDraftView }
        | { kind: 'NOT_FOUND' }
        | { kind: 'NOT_SENDABLE' };

      try {
        const result = await runInTransaction<TxResult>(async (tx) => {
          const existing = await tx.replyDraft.findUnique({
            where: { id: input.draftId },
          });

          // Scope guard: must belong to this business + conversation.
          if (
            !existing ||
            existing.businessId !== input.businessId ||
            existing.conversationId !== input.conversationId
          ) {
            return { kind: 'NOT_FOUND' };
          }

          // Already sent → idempotent (no new message).
          if (existing.status === 'SENT') {
            return { kind: 'ALREADY_SENT', draft: toSentView(existing) };
          }

          // Only an APPROVED draft can be sent.
          if (existing.status !== 'APPROVED') {
            return { kind: 'NOT_SENDABLE' };
          }

          // Defensive: never send an empty message (mirrors message validation).
          const content = existing.draftText;
          if (!content || content.trim().length === 0) {
            return { kind: 'NOT_SENDABLE' };
          }

          // Status-guarded claim. Under the row lock taken here, a concurrent
          // sender's identical claim re-evaluates against committed data and
          // matches 0 rows — so only one transaction proceeds to create a
          // message (no duplicates on double-click).
          const now = new Date();
          const claim = await tx.replyDraft.updateMany({
            where: {
              id: input.draftId,
              businessId: input.businessId,
              conversationId: input.conversationId,
              status: 'APPROVED',
            },
            data: {
              status: 'SENT',
              sentByUserId: input.sentByUserId,
              sentAt: now,
            },
          });

          if (claim.count === 0) {
            // A concurrent transaction won the claim. Re-read for idempotency.
            const after = await tx.replyDraft.findUnique({
              where: { id: input.draftId },
            });
            if (after && after.status === 'SENT') {
              return { kind: 'ALREADY_SENT', draft: toSentView(after) };
            }
            return { kind: 'NOT_SENDABLE' };
          }

          // Create the outbound operator message in the SAME transaction. A
          // crash/throw here rolls back the claim above → the draft returns to
          // APPROVED with no message (no "SENT + sentMessageId null" orphan).
          const message = await tx.message.create({
            data: {
              conversationId: input.conversationId,
              businessId: input.businessId,
              direction: 'OUTBOUND',
              senderType: 'OPERATOR',
              senderUserId: input.sentByUserId,
              senderCustomerId: null,
              content,
              contentType: 'text/plain',
            },
          });

          // Link the message to the draft (still inside the transaction).
          const updated = await tx.replyDraft.update({
            where: { id: input.draftId },
            data: { sentMessageId: message.id },
          });

          return {
            kind: 'SENT_NOW',
            draft: toSentView(updated),
            message: {
              id: message.id,
              conversationId: message.conversationId,
              direction: message.direction,
              senderType: message.senderType,
              senderUserId: message.senderUserId,
              createdAt: message.createdAt.toISOString(),
            },
          };
        });

        if (result.kind === 'NOT_FOUND') {
          return err('DRAFT_NOT_FOUND', 'Draft not found');
        }
        if (result.kind === 'NOT_SENDABLE') {
          return err('DRAFT_NOT_SENDABLE', 'Only an approved draft can be sent');
        }
        if (result.kind === 'ALREADY_SENT') {
          return ok({
            outcome: 'ALREADY_SENT',
            draft: result.draft,
            message: null,
          });
        }
        return ok({
          outcome: 'SENT_NOW',
          draft: result.draft,
          message: result.message,
        });
      } catch {
        // Any failure (incl. a mid-transaction crash) rolls the transaction
        // back; the draft is left untouched (APPROVED), never a SENT orphan.
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },
  };
}
