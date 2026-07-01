// ===========================================================================
// Channels Domain — Repository
//
// Prisma-backed persistence for the web-chat channel binding (Area C, P12-B).
// Uses an injected Prisma-compatible client for testability.
//
// SECURITY:
//  - Every read/write is scoped by a server-resolved `businessId`; the
//    repository never derives tenancy from client input. Single-row reads/writes
//    use the composite unique `@@unique([id, businessId])`.
//  - `resolveActiveByKeyHash` is the ONE query not pre-scoped by a known
//    businessId (the binding IS what yields the businessId): it is hash-indexed,
//    ACTIVE-only, fails closed for REVOKED/missing, and returns ONLY the in-row
//    `{ id, businessId }` — it can never widen to another tenant.
//  - The repository receives an already-hashed key from the service; it performs
//    no crypto and never returns `widgetKeyHash` in a domain DTO.
//  - This repository reads ONLY the `web_chat_channel_bindings` table. It never
//    touches customer / conversation / message / reply-draft data and has no
//    send/delivery path.
// ===========================================================================

import { ok, err } from '@/lib/result';
import type { ActionResult } from '@/lib/result';
import type {
  WebChatChannelBinding,
  WebChatChannelBindingStatusValue,
} from './types';

// ---------------------------------------------------------------------------
// Local record type (matches Prisma-selected fields, incl. the at-rest hash)
// ---------------------------------------------------------------------------

/** Raw binding record from the database (includes the at-rest key hash). */
export interface WebChatChannelBindingRecord {
  id: string;
  businessId: string;
  label: string;
  status: WebChatChannelBindingStatusValue;
  widgetKeyHash: string;
  widgetKeyLast4: string;
  keyRotatedAt: Date | null;
  allowedOrigins: string[];
  revokedAt: Date | null;
  revokedByUserId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Injected DB client interface (narrow slice — ONLY this delegate)
// ---------------------------------------------------------------------------

/** Tenant-scoped compound unique selector (`@@unique([id, businessId])`). */
export interface WebChatChannelBindingWhereUniqueId {
  id_businessId: { id: string; businessId: string };
}

/** Unique selector by widget key hash (`@@unique([widgetKeyHash])`). */
export interface WebChatChannelBindingWhereUniqueHash {
  widgetKeyHash: string;
}

export interface WebChatChannelBindingListWhere {
  businessId: string;
}

/**
 * Prisma-compatible delegate interface for the Channels repository.
 * Exposes ONLY the `webChatChannelBinding` delegate — no customer /
 * conversation / message / reply-draft delegate is reachable from here.
 */
export interface ChannelsRepositoryDb {
  webChatChannelBinding: {
    create(args: {
      data: {
        businessId: string;
        label: string;
        status: WebChatChannelBindingStatusValue;
        widgetKeyHash: string;
        widgetKeyLast4: string;
        allowedOrigins: string[];
        createdByUserId?: string | null;
      };
    }): Promise<WebChatChannelBindingRecord>;
    findUnique(args: {
      where:
        | WebChatChannelBindingWhereUniqueId
        | WebChatChannelBindingWhereUniqueHash;
    }): Promise<WebChatChannelBindingRecord | null>;
    findMany(args: {
      where: WebChatChannelBindingListWhere;
      orderBy: { createdAt: 'desc' };
      take: number;
    }): Promise<WebChatChannelBindingRecord[]>;
    update(args: {
      where: WebChatChannelBindingWhereUniqueId;
      data:
        | {
            widgetKeyHash: string;
            widgetKeyLast4: string;
            keyRotatedAt: Date;
          }
        | {
            status: WebChatChannelBindingStatusValue;
            revokedAt: Date;
            revokedByUserId: string;
          };
    }): Promise<WebChatChannelBindingRecord>;
  };
}

// ---------------------------------------------------------------------------
// Repository inputs
// ---------------------------------------------------------------------------

/** Persistence input for creating a binding (service supplies the hash). */
export interface CreateBindingRepoInput {
  businessId: string;
  label: string;
  allowedOrigins: string[];
  widgetKeyHash: string;
  widgetKeyLast4: string;
  createdByUserId?: string | null;
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

/** Repository boundary for the web-chat channel binding store. */
export interface ChannelsRepository {
  /** Creates a binding (defaults to ACTIVE). Scoped to `businessId`. */
  createBinding(
    input: CreateBindingRepoInput,
  ): Promise<ActionResult<WebChatChannelBinding>>;

  /** Lists a business's bindings (newest first). Always scoped to `businessId`. */
  listBindings(
    businessId: string,
    limit?: number,
  ): Promise<ActionResult<readonly WebChatChannelBinding[]>>;

  /** Finds a binding by id, scoped strictly by `businessId` (else null). */
  findBindingById(
    bindingId: string,
    businessId: string,
  ): Promise<ActionResult<WebChatChannelBinding | null>>;

  /**
   * Resolves a binding by widget key hash, ACTIVE-only and FAIL-CLOSED.
   * Returns ONLY `{ id, businessId }` (never the row/hash). REVOKED/missing →
   * `ok(null)`. This is the binding → businessId trust hop for future ingest.
   */
  resolveActiveByKeyHash(
    widgetKeyHash: string,
  ): Promise<ActionResult<{ id: string; businessId: string } | null>>;

  /**
   * Rotates a binding's key (IMMEDIATE — old key invalid at once). Scoped by
   * `businessId`. Rejects a REVOKED binding (terminal) and a missing one.
   */
  rotateKey(
    bindingId: string,
    businessId: string,
    newKeyHash: string,
    newLast4: string,
  ): Promise<ActionResult<WebChatChannelBinding>>;

  /**
   * Revokes a binding (ACTIVE → REVOKED, terminal). Scoped by `businessId`.
   * Rejects a missing binding and an already-REVOKED one.
   */
  revokeBinding(
    bindingId: string,
    businessId: string,
    revokedByUserId: string,
  ): Promise<ActionResult<WebChatChannelBinding>>;
}

// ---------------------------------------------------------------------------
// Mapper (strips the at-rest hash — DTO never carries widgetKeyHash)
// ---------------------------------------------------------------------------

/** Maps a raw record to a domain DTO; the `widgetKeyHash` is intentionally dropped. */
export function mapWebChatChannelBindingRecord(
  record: WebChatChannelBindingRecord,
): WebChatChannelBinding {
  return {
    id: record.id,
    businessId: record.businessId,
    label: record.label,
    status: record.status,
    widgetKeyLast4: record.widgetKeyLast4,
    allowedOrigins: record.allowedOrigins,
    keyRotatedAt: record.keyRotatedAt
      ? record.keyRotatedAt.toISOString()
      : null,
    revokedAt: record.revokedAt ? record.revokedAt.toISOString() : null,
    revokedByUserId: record.revokedByUserId,
    createdByUserId: record.createdByUserId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ERROR_CODE = 'CHANNELS_REPOSITORY_ERROR';
const REPO_ERROR_MSG = 'Channels repository operation failed';
const NOT_FOUND_CODE = 'CHANNELS_BINDING_NOT_FOUND';
const NOT_FOUND_MSG = 'Web-chat channel binding not found';
const REVOKED_CODE = 'CHANNELS_BINDING_REVOKED';
const REVOKED_MSG = 'Web-chat channel binding is revoked';

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 200;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates a Channels repository backed by the given DB client. */
export function createChannelsRepository(
  db: ChannelsRepositoryDb,
): ChannelsRepository {
  return {
    async createBinding(input) {
      try {
        const record = await db.webChatChannelBinding.create({
          data: {
            businessId: input.businessId,
            label: input.label,
            status: 'ACTIVE',
            widgetKeyHash: input.widgetKeyHash,
            widgetKeyLast4: input.widgetKeyLast4,
            allowedOrigins: input.allowedOrigins,
            createdByUserId: input.createdByUserId ?? null,
          },
        });
        return ok(mapWebChatChannelBindingRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async listBindings(businessId, limit) {
      try {
        const take = Math.min(
          limit && limit > 0 ? limit : DEFAULT_LIST_LIMIT,
          MAX_LIST_LIMIT,
        );
        const records = await db.webChatChannelBinding.findMany({
          where: { businessId },
          orderBy: { createdAt: 'desc' },
          take,
        });
        return ok(records.map(mapWebChatChannelBindingRecord));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async findBindingById(bindingId, businessId) {
      try {
        // Tenant scope enforced by the composite unique: a row is returned only
        // when BOTH id and businessId match.
        const record = await db.webChatChannelBinding.findUnique({
          where: { id_businessId: { id: bindingId, businessId } },
        });
        if (!record) return ok(null);
        return ok(mapWebChatChannelBindingRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async resolveActiveByKeyHash(widgetKeyHash) {
      try {
        const record = await db.webChatChannelBinding.findUnique({
          where: { widgetKeyHash },
        });
        // Fail closed: missing OR non-ACTIVE resolves to nothing.
        if (!record || record.status !== 'ACTIVE') return ok(null);
        // Return ONLY the tenant scope yielded by the row — never the hash/row.
        return ok({ id: record.id, businessId: record.businessId });
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async rotateKey(bindingId, businessId, newKeyHash, newLast4) {
      try {
        const found = await db.webChatChannelBinding.findUnique({
          where: { id_businessId: { id: bindingId, businessId } },
        });
        if (!found) return err(NOT_FOUND_CODE, NOT_FOUND_MSG);
        // Revocation is terminal — a revoked binding cannot be rotated.
        if (found.status !== 'ACTIVE') return err(REVOKED_CODE, REVOKED_MSG);

        // Immediate rotation: replace the stored hash so the old key is invalid
        // at once. There is no previous-key column and no grace window.
        const record = await db.webChatChannelBinding.update({
          where: { id_businessId: { id: bindingId, businessId } },
          data: {
            widgetKeyHash: newKeyHash,
            widgetKeyLast4: newLast4,
            keyRotatedAt: new Date(),
          },
        });
        return ok(mapWebChatChannelBindingRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async revokeBinding(bindingId, businessId, revokedByUserId) {
      try {
        const found = await db.webChatChannelBinding.findUnique({
          where: { id_businessId: { id: bindingId, businessId } },
        });
        if (!found) return err(NOT_FOUND_CODE, NOT_FOUND_MSG);
        // Terminal: re-revoking is rejected so revocation provenance is stable.
        if (found.status !== 'ACTIVE') return err(REVOKED_CODE, REVOKED_MSG);

        const record = await db.webChatChannelBinding.update({
          where: { id_businessId: { id: bindingId, businessId } },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokedByUserId,
          },
        });
        return ok(mapWebChatChannelBindingRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },
  };
}
