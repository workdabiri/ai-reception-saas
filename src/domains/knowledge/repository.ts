// ===========================================================================
// Knowledge Domain — Repository
//
// Prisma-backed persistence for the verified business-context store (B-R2).
// Uses an injected Prisma-compatible client for testability.
//
// SECURITY:
//  - Every read/write is scoped by a server-resolved `businessId`. The caller
//    passes `businessId` from `TenantRequestContext`; the repository never
//    derives tenancy from client input.
//  - `listVerifiedByBusiness` ALWAYS filters by BOTH `businessId` and
//    `status: VERIFIED`; DRAFT/ARCHIVED items are never returned.
//  - This repository reads ONLY the `business_context_items` table. It never
//    reads customer / conversation / message content, and it assembles no
//    prompts and calls no AI provider.
// ===========================================================================

import { ok, err } from '@/lib/result';
import type { ActionResult } from '@/lib/result';
import type {
  BusinessContextItem,
  BusinessContextItemStatusValue,
  BusinessContextItemSourceTypeValue,
  CreateBusinessContextItemInput,
  VerifyBusinessContextItemInput,
  ArchiveBusinessContextItemInput,
  ListVerifiedContextItemsInput,
  ListBusinessContextItemsInput,
} from './types';
import { AI_ELIGIBLE_BUSINESS_CONTEXT_ITEM_STATUS } from './types';

// ---------------------------------------------------------------------------
// Local record type (matches Prisma-selected fields)
// ---------------------------------------------------------------------------

/** Raw business-context item record from the database */
export interface BusinessContextItemRecord {
  id: string;
  businessId: string;
  category: string;
  key: string;
  value: string;
  status: BusinessContextItemStatusValue;
  sourceType: BusinessContextItemSourceTypeValue;
  sourceLabel: string | null;
  sourceUrl: string | null;
  sourceMetadata: unknown | null;
  verifiedByUserId: string | null;
  verifiedAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Injected DB client interface
// ---------------------------------------------------------------------------

/** Where filter for verified-context listing (businessId + VERIFIED enforced) */
export interface ListContextItemsWhere {
  businessId: string;
  status: BusinessContextItemStatusValue;
  category?: string;
}

/**
 * Tenant-scoped compound unique selector. Matches the Prisma-generated key for
 * `@@unique([id, businessId])`, so single-row reads/writes are scoped by BOTH
 * `id` and `businessId` at the DB query level — not by a post-fetch check.
 */
export interface BusinessContextItemWhereUnique {
  id_businessId: { id: string; businessId: string };
}

/**
 * Prisma-compatible delegate interface for the Knowledge repository.
 * Exposes ONLY the `businessContextItem` delegate — no customer / conversation
 * / message delegates are reachable from here.
 */
export interface KnowledgeRepositoryDb {
  businessContextItem: {
    create(args: {
      data: {
        businessId: string;
        category: string;
        key: string;
        value: string;
        status: BusinessContextItemStatusValue;
        sourceType: BusinessContextItemSourceTypeValue;
        sourceLabel?: string | null;
        sourceUrl?: string | null;
        sourceMetadata?: unknown | null;
        createdByUserId?: string | null;
      };
    }): Promise<BusinessContextItemRecord>;
    findMany(args: {
      where: ListContextItemsWhere;
      orderBy: { updatedAt: 'desc' };
      take: number;
    }): Promise<BusinessContextItemRecord[]>;
    findUnique(args: {
      where: BusinessContextItemWhereUnique;
    }): Promise<BusinessContextItemRecord | null>;
    update(args: {
      where: BusinessContextItemWhereUnique;
      data:
        | {
            status: BusinessContextItemStatusValue;
            verifiedByUserId: string;
            verifiedAt: Date;
          }
        | { status: BusinessContextItemStatusValue };
    }): Promise<BusinessContextItemRecord>;
  };
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

/** Repository boundary for the verified business-context store */
export interface KnowledgeRepository {
  /** Creates a business-context item (defaults to DRAFT / unverified). */
  createItem(
    input: CreateBusinessContextItemInput,
  ): Promise<ActionResult<BusinessContextItem>>;

  /**
   * Lists VERIFIED business-context items for a business.
   * ALWAYS filters by `businessId` AND `status: VERIFIED`; DRAFT/ARCHIVED items
   * are never returned.
   */
  listVerifiedByBusiness(
    input: ListVerifiedContextItemsInput,
  ): Promise<ActionResult<readonly BusinessContextItem[]>>;

  /**
   * Lists items for a business filtered by lifecycle `status`. ALWAYS filters by
   * `businessId`; when `status` is omitted it is fail-safe and pins
   * `status: VERIFIED` (DRAFT/ARCHIVED are not returned by default).
   */
  listByBusiness(
    input: ListBusinessContextItemsInput,
  ): Promise<ActionResult<readonly BusinessContextItem[]>>;

  /**
   * Finds an item by id, scoped strictly by `businessId`.
   * Returns null if not found or if it belongs to another business.
   */
  findByBusinessAndId(
    businessId: string,
    itemId: string,
  ): Promise<ActionResult<BusinessContextItem | null>>;

  /** Verifies an item (DRAFT → VERIFIED), capturing provenance. Scoped by businessId. */
  verifyItem(
    input: VerifyBusinessContextItemInput,
  ): Promise<ActionResult<BusinessContextItem>>;

  /** Archives an item (any status → ARCHIVED). Scoped by businessId. */
  archiveItem(
    input: ArchiveBusinessContextItemInput,
  ): Promise<ActionResult<BusinessContextItem>>;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/** Maps a raw record to a domain BusinessContextItem (dates → ISO strings) */
export function mapBusinessContextItemRecord(
  record: BusinessContextItemRecord,
): BusinessContextItem {
  return {
    id: record.id,
    businessId: record.businessId,
    category: record.category,
    key: record.key,
    value: record.value,
    status: record.status,
    sourceType: record.sourceType,
    sourceLabel: record.sourceLabel,
    sourceUrl: record.sourceUrl,
    sourceMetadata: record.sourceMetadata,
    verifiedByUserId: record.verifiedByUserId,
    verifiedAt: record.verifiedAt ? record.verifiedAt.toISOString() : null,
    createdByUserId: record.createdByUserId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ERROR_CODE = 'KNOWLEDGE_REPOSITORY_ERROR';
const REPO_ERROR_MSG = 'Knowledge repository operation failed';
const NOT_FOUND_CODE = 'BUSINESS_CONTEXT_ITEM_NOT_FOUND';
const NOT_FOUND_MSG = 'Business context item not found';
const NOT_VERIFIABLE_CODE = 'BUSINESS_CONTEXT_ITEM_NOT_VERIFIABLE';

/** Default and max page size for verified-context listing. */
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates a Knowledge repository backed by the given DB client */
export function createKnowledgeRepository(
  db: KnowledgeRepositoryDb,
): KnowledgeRepository {
  // Shared list query, defined as a free function (no `this`) so it is safe to
  // call from any method even if the method is destructured or passed around.
  // `status` is fail-safe: it defaults to VERIFIED when the caller omits it.
  async function listByBusinessImpl(
    input: ListBusinessContextItemsInput,
  ): Promise<ActionResult<readonly BusinessContextItem[]>> {
    try {
      const limit = Math.min(
        input.limit && input.limit > 0 ? input.limit : DEFAULT_LIST_LIMIT,
        MAX_LIST_LIMIT,
      );

      // Tenant scope is always enforced; `status` is fail-safe (VERIFIED) when
      // the caller does not specify one, so an un-gated read never leaks
      // DRAFT/ARCHIVED items. businessId is never widened by the caller.
      const where: ListContextItemsWhere = {
        businessId: input.businessId,
        status: input.status ?? AI_ELIGIBLE_BUSINESS_CONTEXT_ITEM_STATUS,
      };
      if (input.category) {
        where.category = input.category;
      }

      const records = await db.businessContextItem.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
      });

      return ok(records.map(mapBusinessContextItemRecord));
    } catch {
      return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
    }
  }

  return {
    async createItem(input) {
      try {
        // New items are always unverified (DRAFT): not AI-eligible until a
        // verifier explicitly promotes them via verifyItem.
        const record = await db.businessContextItem.create({
          data: {
            businessId: input.businessId,
            category: input.category,
            key: input.key,
            value: input.value,
            status: 'DRAFT',
            sourceType: input.sourceType,
            sourceLabel: input.sourceLabel ?? null,
            sourceUrl: input.sourceUrl ?? null,
            sourceMetadata: input.sourceMetadata ?? null,
            createdByUserId: input.createdByUserId ?? null,
          },
        });
        return ok(mapBusinessContextItemRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async listVerifiedByBusiness(input) {
      // Verified-only read: delegate to the shared free function with status
      // pinned to VERIFIED so DRAFT and ARCHIVED items can never be returned
      // through this method. Uses no `this` binding.
      return listByBusinessImpl({
        ...input,
        status: AI_ELIGIBLE_BUSINESS_CONTEXT_ITEM_STATUS,
      });
    },

    async listByBusiness(input) {
      return listByBusinessImpl(input);
    },

    async findByBusinessAndId(businessId, itemId) {
      try {
        // Tenant scope is enforced by the query itself via the composite unique
        // key: a row is returned only when BOTH id and businessId match.
        const record = await db.businessContextItem.findUnique({
          where: { id_businessId: { id: itemId, businessId } },
        });
        if (!record) {
          return ok(null);
        }
        return ok(mapBusinessContextItemRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async verifyItem(input) {
      try {
        const found = await this.findByBusinessAndId(
          input.businessId,
          input.itemId,
        );
        if (!found.ok) return found;
        if (!found.data) {
          return err(NOT_FOUND_CODE, NOT_FOUND_MSG);
        }
        // Only DRAFT -> VERIFIED is allowed. ARCHIVED and already-VERIFIED items
        // are rejected, so verification provenance (verifier + timestamp) can
        // never be overwritten by a repeated verify call.
        if (found.data.status !== 'DRAFT') {
          return err(
            NOT_VERIFIABLE_CODE,
            'Only a draft business context item can be verified',
          );
        }

        // Update is also tenant-scoped at the DB level via the composite key.
        const record = await db.businessContextItem.update({
          where: {
            id_businessId: { id: input.itemId, businessId: input.businessId },
          },
          data: {
            status: 'VERIFIED',
            verifiedByUserId: input.verifiedByUserId,
            verifiedAt: new Date(),
          },
        });
        return ok(mapBusinessContextItemRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async archiveItem(input) {
      try {
        const found = await this.findByBusinessAndId(
          input.businessId,
          input.itemId,
        );
        if (!found.ok) return found;
        if (!found.data) {
          return err(NOT_FOUND_CODE, NOT_FOUND_MSG);
        }

        // Update is also tenant-scoped at the DB level via the composite key.
        const record = await db.businessContextItem.update({
          where: {
            id_businessId: { id: input.itemId, businessId: input.businessId },
          },
          data: { status: 'ARCHIVED' },
        });
        return ok(mapBusinessContextItemRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },
  };
}
