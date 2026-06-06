// ===========================================================================
// Tests — Dashboard Aggregate Repository Methods
//
// Direct repository-level tests for the conversation and audit aggregate
// methods used by the dashboard summary endpoint.
// Validates Prisma where clauses and in-memory follow-up filter logic.
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';

import {
  createConversationRepository,
} from '../../src/domains/conversations/repository';
import type {
  ConversationRepositoryDb,
  ConversationRecordWithSummary,
} from '../../src/domains/conversations/repository';

import {
  createAuditRepository,
} from '../../src/domains/audit/repository';
import type {
  AuditRepositoryDb,
} from '../../src/domains/audit/repository';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BIZ_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-06-06T12:00:00.000Z');
const HOURS_25_AGO = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
const HOURS_23_AGO = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);
const CUTOFF_24H = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Conversation mock DB factory
// ---------------------------------------------------------------------------

function createMockConvDb(): ConversationRepositoryDb {
  return {
    conversation: {
      create: vi.fn().mockResolvedValue({} as ConversationRecordWithSummary),
      update: vi.fn().mockResolvedValue({} as ConversationRecordWithSummary),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    message: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

const noopCustomerLookup = async () => null;

// ---------------------------------------------------------------------------
// Audit mock DB factory
// ---------------------------------------------------------------------------

function createMockAuditDb(): AuditRepositoryDb {
  return {
    auditEvent: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

// ---------------------------------------------------------------------------
// Conversation record helpers (for needsFollowUp tests)
// ---------------------------------------------------------------------------

function makeConvRecord(
  overrides: Partial<ConversationRecordWithSummary> & {
    messages?: { createdAt: Date; direction: string; content: string; senderType: string }[];
  },
): ConversationRecordWithSummary {
  return {
    id: overrides.id ?? 'conv-1',
    businessId: BIZ_ID,
    customerId: null,
    channel: 'INTERNAL' as const,
    status: 'OPEN' as const,
    subject: null,
    assignedUserId: null,
    aiClassificationStatus: 'NOT_REQUESTED' as const,
    aiDraftStatus: 'NOT_REQUESTED' as const,
    channelMetadata: null,
    metadata: null,
    closedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ConversationRecordWithSummary;
}

// ===========================================================================
// Conversation Repository — Aggregate Methods
// ===========================================================================

describe('ConversationRepository — countOpenConversations', () => {
  it('calls db.conversation.count with businessId and status not RESOLVED', async () => {
    const db = createMockConvDb();
    db.conversation.count = vi.fn().mockResolvedValue(7);
    const repo = createConversationRepository(db, noopCustomerLookup);

    const result = await repo.countOpenConversations(BIZ_ID);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(7);
    expect(db.conversation.count).toHaveBeenCalledWith({
      where: { businessId: BIZ_ID, status: { not: 'RESOLVED' } },
    });
  });

  it('returns error on DB failure', async () => {
    const db = createMockConvDb();
    db.conversation.count = vi.fn().mockRejectedValue(new Error('DB down'));
    const repo = createConversationRepository(db, noopCustomerLookup);

    const result = await repo.countOpenConversations(BIZ_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONVERSATION_REPOSITORY_ERROR');
  });
});

describe('ConversationRepository — countByStatus', () => {
  it('calls db.conversation.count with exact status passed', async () => {
    const db = createMockConvDb();
    db.conversation.count = vi.fn().mockResolvedValue(3);
    const repo = createConversationRepository(db, noopCustomerLookup);

    const result = await repo.countByStatus(BIZ_ID, 'WAITING_OPERATOR');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(3);
    expect(db.conversation.count).toHaveBeenCalledWith({
      where: { businessId: BIZ_ID, status: 'WAITING_OPERATOR' },
    });
  });

  it('passes different status values correctly', async () => {
    const db = createMockConvDb();
    db.conversation.count = vi.fn().mockResolvedValue(0);
    const repo = createConversationRepository(db, noopCustomerLookup);

    await repo.countByStatus(BIZ_ID, 'ESCALATED');

    expect(db.conversation.count).toHaveBeenCalledWith({
      where: { businessId: BIZ_ID, status: 'ESCALATED' },
    });
  });
});

describe('ConversationRepository — countDraftsPendingReview', () => {
  it('calls db.conversation.count with aiDraftStatus READY and excludes RESOLVED', async () => {
    const db = createMockConvDb();
    db.conversation.count = vi.fn().mockResolvedValue(5);
    const repo = createConversationRepository(db, noopCustomerLookup);

    const result = await repo.countDraftsPendingReview(BIZ_ID);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(5);
    expect(db.conversation.count).toHaveBeenCalledWith({
      where: {
        businessId: BIZ_ID,
        aiDraftStatus: 'READY',
        NOT: { status: 'RESOLVED' },
      },
    });
  });
});

describe('ConversationRepository — countNeedingFollowUp', () => {
  it('calls db.conversation.findMany with active statuses and no take cap', async () => {
    const db = createMockConvDb();
    db.conversation.findMany = vi.fn().mockResolvedValue([]);
    const repo = createConversationRepository(db, noopCustomerLookup);

    await repo.countNeedingFollowUp(BIZ_ID, CUTOFF_24H);

    expect(db.conversation.findMany).toHaveBeenCalledWith({
      where: {
        businessId: BIZ_ID,
        status: { in: ['NEW', 'OPEN', 'ASSIGNED', 'WAITING_OPERATOR', 'ESCALATED'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    // Assert NO take cap is applied at the top level
    const callArgs = vi.mocked(db.conversation.findMany).mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('take');
  });

  it('counts inbound message older than cutoff', async () => {
    const db = createMockConvDb();
    db.conversation.findMany = vi.fn().mockResolvedValue([
      makeConvRecord({
        id: 'conv-old-inbound',
        messages: [{
          createdAt: HOURS_25_AGO,
          direction: 'INBOUND',
          content: 'Help',
          senderType: 'CUSTOMER',
        }],
      }),
    ]);
    const repo = createConversationRepository(db, noopCustomerLookup);

    const result = await repo.countNeedingFollowUp(BIZ_ID, CUTOFF_24H);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(1);
  });

  it('does NOT count inbound message newer than cutoff', async () => {
    const db = createMockConvDb();
    db.conversation.findMany = vi.fn().mockResolvedValue([
      makeConvRecord({
        id: 'conv-recent-inbound',
        messages: [{
          createdAt: HOURS_23_AGO,
          direction: 'INBOUND',
          content: 'Help',
          senderType: 'CUSTOMER',
        }],
      }),
    ]);
    const repo = createConversationRepository(db, noopCustomerLookup);

    const result = await repo.countNeedingFollowUp(BIZ_ID, CUTOFF_24H);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(0);
  });

  it('does NOT count outbound message older than cutoff', async () => {
    const db = createMockConvDb();
    db.conversation.findMany = vi.fn().mockResolvedValue([
      makeConvRecord({
        id: 'conv-old-outbound',
        messages: [{
          createdAt: HOURS_25_AGO,
          direction: 'OUTBOUND',
          content: 'Reply',
          senderType: 'OPERATOR',
        }],
      }),
    ]);
    const repo = createConversationRepository(db, noopCustomerLookup);

    const result = await repo.countNeedingFollowUp(BIZ_ID, CUTOFF_24H);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(0);
  });

  it('does NOT count conversation with no messages', async () => {
    const db = createMockConvDb();
    db.conversation.findMany = vi.fn().mockResolvedValue([
      makeConvRecord({ id: 'conv-no-msgs', messages: [] }),
    ]);
    const repo = createConversationRepository(db, noopCustomerLookup);

    const result = await repo.countNeedingFollowUp(BIZ_ID, CUTOFF_24H);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(0);
  });

  it('only considers latest message (first in desc-ordered array)', async () => {
    // Latest message is outbound (operator replied), even though an older
    // inbound message exists. Should NOT be counted.
    const db = createMockConvDb();
    db.conversation.findMany = vi.fn().mockResolvedValue([
      makeConvRecord({
        id: 'conv-latest-outbound',
        messages: [{
          // The include uses take:1 with orderBy desc, so only the latest appears
          createdAt: HOURS_23_AGO,
          direction: 'OUTBOUND',
          content: 'We replied',
          senderType: 'OPERATOR',
        }],
      }),
    ]);
    const repo = createConversationRepository(db, noopCustomerLookup);

    const result = await repo.countNeedingFollowUp(BIZ_ID, CUTOFF_24H);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(0);
  });

  it('correctly aggregates mixed conversations', async () => {
    const db = createMockConvDb();
    db.conversation.findMany = vi.fn().mockResolvedValue([
      // Should count: inbound, older than cutoff
      makeConvRecord({
        id: 'conv-1',
        messages: [{ createdAt: HOURS_25_AGO, direction: 'INBOUND', content: 'Help', senderType: 'CUSTOMER' }],
      }),
      // Should NOT count: inbound, newer than cutoff
      makeConvRecord({
        id: 'conv-2',
        messages: [{ createdAt: HOURS_23_AGO, direction: 'INBOUND', content: 'Help', senderType: 'CUSTOMER' }],
      }),
      // Should NOT count: outbound, older than cutoff
      makeConvRecord({
        id: 'conv-3',
        messages: [{ createdAt: HOURS_25_AGO, direction: 'OUTBOUND', content: 'Reply', senderType: 'OPERATOR' }],
      }),
      // Should NOT count: no messages
      makeConvRecord({ id: 'conv-4', messages: [] }),
      // Should count: inbound, older than cutoff
      makeConvRecord({
        id: 'conv-5',
        messages: [{ createdAt: HOURS_25_AGO, direction: 'INBOUND', content: 'Question', senderType: 'CUSTOMER' }],
      }),
    ]);
    const repo = createConversationRepository(db, noopCustomerLookup);

    const result = await repo.countNeedingFollowUp(BIZ_ID, CUTOFF_24H);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(2);
  });

  it('returns error on DB failure', async () => {
    const db = createMockConvDb();
    db.conversation.findMany = vi.fn().mockRejectedValue(new Error('DB down'));
    const repo = createConversationRepository(db, noopCustomerLookup);

    const result = await repo.countNeedingFollowUp(BIZ_ID, CUTOFF_24H);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONVERSATION_REPOSITORY_ERROR');
  });
});

// ===========================================================================
// Audit Repository — Aggregate Methods
// ===========================================================================

describe('AuditRepository — countDeniedEvents', () => {
  it('calls db.auditEvent.count with businessId, result DENIED, and createdAt gte since', async () => {
    const db = createMockAuditDb();
    db.auditEvent.count = vi.fn().mockResolvedValue(4);
    const repo = createAuditRepository(db);

    const since = CUTOFF_24H;
    const result = await repo.countDeniedEvents(BIZ_ID, since);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(4);
    expect(db.auditEvent.count).toHaveBeenCalledWith({
      where: {
        businessId: BIZ_ID,
        result: 'DENIED',
        createdAt: { gte: since },
      },
    });
  });

  it('returns 0 when no denied events exist', async () => {
    const db = createMockAuditDb();
    db.auditEvent.count = vi.fn().mockResolvedValue(0);
    const repo = createAuditRepository(db);

    const result = await repo.countDeniedEvents(BIZ_ID, CUTOFF_24H);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(0);
  });

  it('returns error on DB failure', async () => {
    const db = createMockAuditDb();
    db.auditEvent.count = vi.fn().mockRejectedValue(new Error('DB down'));
    const repo = createAuditRepository(db);

    const result = await repo.countDeniedEvents(BIZ_ID, CUTOFF_24H);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUDIT_REPOSITORY_ERROR');
  });
});
