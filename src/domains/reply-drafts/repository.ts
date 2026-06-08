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
      };
      orderBy: { createdAt: 'desc' };
      take: number;
      include: {
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
    }): Promise<ReplyDraftDashboardRecord[]>;
    count(args: {
      where: {
        businessId: string;
        status: { in: ReplyDraftStatusValue[] };
      };
    }): Promise<number>;
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
          drafts: records.map(mapToDashboardItem),
        });
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },
  };
}
