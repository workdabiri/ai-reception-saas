// ===========================================================================
// Audit Domain — Repository
//
// Prisma-backed persistence layer for audit events.
// Uses injected Prisma-compatible client for testability.
// ===========================================================================

import { ok, err } from '@/lib/result';
import type { ActionResult } from '@/lib/result';
import type { JsonValue } from '@/lib/types';
import type {
  AuditEventIdentity,
  AuditActorTypeValue,
  AuditResultValue,
  CreateAuditEventInput,
} from './types';
import type { FindAuditEventByIdInput, ListAuditEventsInput } from './service';

// ---------------------------------------------------------------------------
// Local record types
// ---------------------------------------------------------------------------

/** Raw audit event record from the database */
export interface AuditEventRecord {
  id: string;
  businessId: string | null;
  actorType: AuditActorTypeValue;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: AuditResultValue;
  metadata: JsonValue | null;
  createdAt: Date;
  /** Prisma-included actorUser relation (present when loaded via list query) */
  actorUser?: { id: string; name: string; avatarUrl: string | null } | null;
}

// ---------------------------------------------------------------------------
// Injected DB client interface
// ---------------------------------------------------------------------------

/** Prisma-compatible delegate interface for audit repository */
export interface AuditRepositoryDb {
  auditEvent: {
    create(args: {
      data: {
        businessId?: string;
        actorType: AuditActorTypeValue;
        actorUserId?: string;
        action: string;
        targetType?: string;
        targetId?: string;
        result: AuditResultValue;
        metadata?: JsonValue;
      };
    }): Promise<AuditEventRecord>;
    findUnique(args: {
      where: { id: string };
    }): Promise<AuditEventRecord | null>;
    findMany(args: {
      where: Partial<{
        businessId: string;
        actorUserId: string;
        action: string;
        targetType: string;
        targetId: string;
        result: AuditResultValue;
        actorType: AuditActorTypeValue;
      }>;
      include?: { actorUser?: { select: { id: true; name: true; avatarUrl: true } } };
      orderBy: { createdAt: 'desc' };
      take: number;
    }): Promise<AuditEventRecord[]>;
  };
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

/** Repository boundary for audit persistence */
export interface AuditRepository {
  createAuditEvent(
    input: CreateAuditEventInput,
  ): Promise<ActionResult<AuditEventIdentity>>;
  findAuditEventById(
    input: FindAuditEventByIdInput,
  ): Promise<ActionResult<AuditEventIdentity | null>>;
  listAuditEvents(
    input: ListAuditEventsInput,
  ): Promise<ActionResult<readonly AuditEventIdentity[]>>;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** Maps a raw audit event record to a domain AuditEventIdentity */
export function mapAuditEventRecord(
  record: AuditEventRecord,
): AuditEventIdentity {
  const identity: AuditEventIdentity = {
    id: record.id,
    businessId: record.businessId,
    actorType: record.actorType,
    actorUserId: record.actorUserId,
    action: record.action,
    targetType: record.targetType,
    targetId: record.targetId,
    result: record.result,
    metadata: record.metadata,
    createdAt: record.createdAt.toISOString(),
  };
  if (record.actorUser) {
    identity.actorUser = {
      id: record.actorUser.id,
      name: record.actorUser.name,
      avatarUrl: record.actorUser.avatarUrl,
    };
  }
  return identity;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_AUDIT_LIMIT = 50;
const MAX_AUDIT_LIMIT = 100;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates an audit repository backed by the given DB client */
export function createAuditRepository(
  db: AuditRepositoryDb,
): AuditRepository {
  return {
    async createAuditEvent(input) {
      try {
        const record = await db.auditEvent.create({ data: input });
        return ok(mapAuditEventRecord(record));
      } catch {
        return err(
          'AUDIT_REPOSITORY_ERROR',
          'Audit repository operation failed',
        );
      }
    },

    async findAuditEventById(input) {
      try {
        const record = await db.auditEvent.findUnique({
          where: { id: input.auditEventId },
        });
        return ok(record ? mapAuditEventRecord(record) : null);
      } catch {
        return err(
          'AUDIT_REPOSITORY_ERROR',
          'Audit repository operation failed',
        );
      }
    },

    async listAuditEvents(input) {
      try {
        const where: Partial<{
          businessId: string;
          actorUserId: string;
          action: string;
          targetType: string;
          targetId: string;
          result: AuditResultValue;
          actorType: AuditActorTypeValue;
        }> = {};

        if (input.businessId !== undefined) where.businessId = input.businessId;
        if (input.actorUserId !== undefined)
          where.actorUserId = input.actorUserId;
        if (input.action !== undefined) where.action = input.action;
        if (input.targetType !== undefined)
          where.targetType = input.targetType;
        if (input.targetId !== undefined) where.targetId = input.targetId;
        if (input.result !== undefined) where.result = input.result;
        if (input.actorType !== undefined) where.actorType = input.actorType;

        const requestedLimit = input.limit ?? DEFAULT_AUDIT_LIMIT;
        const take = Math.min(requestedLimit, MAX_AUDIT_LIMIT);

        const records = await db.auditEvent.findMany({
          where,
          include: { actorUser: { select: { id: true as const, name: true as const, avatarUrl: true as const } } },
          orderBy: { createdAt: 'desc' },
          take,
        });
        return ok(records.map(mapAuditEventRecord));
      } catch {
        return err(
          'AUDIT_REPOSITORY_ERROR',
          'Audit repository operation failed',
        );
      }
    },
  };
}
