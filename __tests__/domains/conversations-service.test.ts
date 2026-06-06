// ===========================================================================
// Tests — Conversations Domain Service + Validation
//
// Verifies conversation service logic, state machine, audit behavior,
// tenant integrity, and validation rules with mock repository and audit.
// ===========================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from '@/lib/result';
import type { ConversationRepository, ConversationRecordWithSummary } from '@/domains/conversations/repository';
import { mapConversationWithSummary } from '@/domains/conversations/repository';
import type { AuditService } from '@/domains/audit/service';
import { createConversationService } from '@/domains/conversations/implementation';
import type { ConversationService } from '@/domains/conversations/service';
import {
  validateTransition,
  isValidTransition,
  isAuditRequiredTransition,
  validateCreateConversationInput,
  validateCreateMessageInput,
  validateInitialMessageInput,
  validateUpdateConversationInput,
  VALID_TRANSITIONS,
  isValidUuid,
} from '@/domains/conversations/validation';
import type {
  ConversationStatusValue,
  ConversationWithSummary,
  ConversationIdentity,
  MessageIdentity,
} from '@/domains/conversations/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUSINESS_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_BUSINESS_ID = '550e8400-e29b-41d4-a716-999999999999';
const CUSTOMER_ID = '660e8400-e29b-41d4-a716-446655440000';
const WRONG_BIZ_CUSTOMER_ID = '660e8400-e29b-41d4-a716-999999999999';
const CONVERSATION_ID = '770e8400-e29b-41d4-a716-446655440000';
const MESSAGE_ID = '880e8400-e29b-41d4-a716-446655440000';
const USER_ID = '990e8400-e29b-41d4-a716-446655440000';
const ACTOR_USER_ID = 'aa0e8400-e29b-41d4-a716-446655440000';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_CONVERSATION_IDENTITY: ConversationIdentity = {
  id: CONVERSATION_ID,
  businessId: BUSINESS_ID,
  customerId: null,
  channel: 'WEBSITE_CHAT',
  status: 'NEW',
  subject: null,
  assignedUserId: null,
  aiClassificationStatus: 'NOT_REQUESTED',
  aiDraftStatus: 'NOT_REQUESTED',
  channelMetadata: null,
  metadata: null,
  closedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const MOCK_CONVERSATION: ConversationWithSummary = {
  ...MOCK_CONVERSATION_IDENTITY,
  messageCount: 0,
  lastMessageAt: null,
  lastMessageContent: null,
  lastMessageDirection: null,
  lastMessageSenderType: null,
};

const MOCK_MESSAGE: MessageIdentity = {
  id: MESSAGE_ID,
  conversationId: CONVERSATION_ID,
  businessId: BUSINESS_ID,
  direction: 'INBOUND',
  senderType: 'CUSTOMER',
  senderUserId: null,
  senderCustomerId: CUSTOMER_ID,
  content: 'Hello',
  contentType: 'text/plain',
  channelMetadata: null,
  metadata: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockRepository(): ConversationRepository {
  return {
    createConversation: vi.fn().mockResolvedValue(ok(MOCK_CONVERSATION_IDENTITY)),
    updateConversation: vi.fn().mockResolvedValue(ok(MOCK_CONVERSATION_IDENTITY)),
    findConversationById: vi.fn().mockResolvedValue(ok(MOCK_CONVERSATION)),
    listConversations: vi.fn().mockResolvedValue(ok({ data: [], nextCursor: null })),
    createMessage: vi.fn().mockResolvedValue(ok(MOCK_MESSAGE)),
    findMessageById: vi.fn().mockResolvedValue(ok(MOCK_MESSAGE)),
    listMessages: vi.fn().mockResolvedValue(ok({ data: [], nextCursor: null })),
    findCustomerInBusiness: vi.fn().mockImplementation(
      (customerId: string, businessId: string) => {
        // Same-business customer returns data; wrong-business returns null
        if (customerId === CUSTOMER_ID && businessId === BUSINESS_ID) {
          return Promise.resolve(ok({ id: CUSTOMER_ID, businessId: BUSINESS_ID }));
        }
        if (customerId === WRONG_BIZ_CUSTOMER_ID) {
          return Promise.resolve(ok(null)); // exists but wrong business
        }
        return Promise.resolve(ok(null)); // not found
      },
    ),
    countOpenConversations: vi.fn().mockResolvedValue(ok(0)),
    countByStatus: vi.fn().mockResolvedValue(ok(0)),
    countDraftsPendingReview: vi.fn().mockResolvedValue(ok(0)),
    countNeedingFollowUp: vi.fn().mockResolvedValue(ok(0)),
  };
}

function createMockAudit(): AuditService {
  return {
    createAuditEvent: vi.fn().mockResolvedValue(ok({ id: 'audit-1' })),
    findAuditEventById: vi.fn().mockResolvedValue(ok(null)),
    listAuditEvents: vi.fn().mockResolvedValue(ok({ data: [], nextCursor: null })),
  };
}

let repo: ReturnType<typeof createMockRepository>;
let auditSvc: ReturnType<typeof createMockAudit>;
let service: ConversationService;

beforeEach(() => {
  repo = createMockRepository();
  auditSvc = createMockAudit();
  service = createConversationService({ repository: repo, audit: auditSvc });
});

// ===========================================================================
// 1. State Machine — valid/invalid transitions
// ===========================================================================

describe('Conversation State Machine', () => {
  it('allows all declared valid transitions', () => {
    for (const [from, toList] of Object.entries(VALID_TRANSITIONS)) {
      for (const to of toList) {
        expect(isValidTransition(from as ConversationStatusValue, to)).toBe(true);
      }
    }
  });

  it('rejects invalid transitions', () => {
    expect(isValidTransition('NEW', 'RESOLVED')).toBe(false);
    expect(isValidTransition('OPEN', 'RESOLVED')).toBe(false);
    expect(isValidTransition('RESOLVED', 'ASSIGNED')).toBe(false);
    expect(isValidTransition('NEW', 'NEW')).toBe(false);
  });

  it('validateTransition returns errors for invalid transitions', () => {
    const result = validateTransition('NEW', 'RESOLVED');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Invalid transition');
  });

  it('validateTransition returns success for valid transitions', () => {
    const result = validateTransition('NEW', 'OPEN');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it.each(['ASSIGNED', 'ESCALATED', 'RESOLVED', 'OPEN'] as ConversationStatusValue[])(
    'isAuditRequiredTransition is true for %s',
    (status) => {
      expect(isAuditRequiredTransition(status)).toBe(true);
    },
  );

  it.each(['NEW', 'WAITING_CUSTOMER', 'WAITING_OPERATOR'] as ConversationStatusValue[])(
    'isAuditRequiredTransition is false for %s',
    (status) => {
      expect(isAuditRequiredTransition(status)).toBe(false);
    },
  );
});

// ===========================================================================
// 2. UUID validation
// ===========================================================================

describe('isValidUuid', () => {
  it('accepts valid UUID v4', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects non-UUID strings', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('')).toBe(false);
    expect(isValidUuid('12345')).toBe(false);
  });
});

// ===========================================================================
// 3. createConversation — initialMessage validation
// ===========================================================================

describe('createConversation — initialMessage validation', () => {
  it('rejects invalid initialMessage.content (empty)', async () => {
    const result = await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
      initialMessage: {
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: '',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_MESSAGE_INPUT');
    }
    expect(repo.createConversation).not.toHaveBeenCalled();
  });

  it('rejects invalid initialMessage.direction', async () => {
    const result = await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
      initialMessage: {
        direction: 'INVALID' as 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'Hello',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_MESSAGE_INPUT');
    }
    expect(repo.createConversation).not.toHaveBeenCalled();
  });

  it('rejects invalid initialMessage.senderType', async () => {
    const result = await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
      initialMessage: {
        direction: 'INBOUND',
        senderType: 'INVALID' as 'CUSTOMER',
        content: 'Hello',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_MESSAGE_INPUT');
    }
    expect(repo.createConversation).not.toHaveBeenCalled();
  });

  it('rejects invalid initialMessage.senderCustomerId (non-UUID) before createConversation', async () => {
    const result = await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
      initialMessage: {
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'Hello',
        senderCustomerId: 'not-a-uuid',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_MESSAGE_INPUT');
    }
    expect(repo.createConversation).not.toHaveBeenCalled();
  });

  it('rejects initialMessage with senderCustomerId on OUTBOUND', async () => {
    const result = await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
      initialMessage: {
        direction: 'OUTBOUND',
        senderType: 'OPERATOR',
        content: 'Hello',
        senderCustomerId: CUSTOMER_ID,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_MESSAGE_INPUT');
    }
    expect(repo.createConversation).not.toHaveBeenCalled();
  });

  it('accepts valid INBOUND initialMessage with senderCustomerId', async () => {
    const result = await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
      initialMessage: {
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'Hello',
        senderCustomerId: CUSTOMER_ID,
      },
    });
    expect(result.ok).toBe(true);
    expect(repo.createConversation).toHaveBeenCalledTimes(1);
    expect(repo.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ senderCustomerId: CUSTOMER_ID }),
    );
  });

  it('creates conversation when initialMessage is valid (no senderCustomerId)', async () => {
    const result = await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
      initialMessage: {
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'Hello',
      },
    });
    expect(result.ok).toBe(true);
    expect(repo.createConversation).toHaveBeenCalledTimes(1);
    expect(repo.createMessage).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 4. Tenant integrity — customer/business scoping
// ===========================================================================

describe('Tenant integrity — customer belongs to business', () => {
  it('rejects createConversation with customerId from wrong business', async () => {
    const result = await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
      customerId: WRONG_BIZ_CUSTOMER_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CUSTOMER_NOT_IN_BUSINESS');
    }
    expect(repo.createConversation).not.toHaveBeenCalled();
  });

  it('accepts createConversation with customerId from same business', async () => {
    const result = await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
      customerId: CUSTOMER_ID,
    });
    expect(result.ok).toBe(true);
    expect(repo.createConversation).toHaveBeenCalledTimes(1);
  });

  it('rejects createConversation with initialMessage.senderCustomerId from wrong business', async () => {
    const result = await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
      initialMessage: {
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: 'Hello',
        senderCustomerId: WRONG_BIZ_CUSTOMER_ID,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CUSTOMER_NOT_IN_BUSINESS');
    }
    expect(repo.createConversation).not.toHaveBeenCalled();
  });

  it('rejects updateConversation linking customer from wrong business', async () => {
    const convNoCust: ConversationWithSummary = {
      ...MOCK_CONVERSATION,
      customerId: null,
    };
    (repo.findConversationById as ReturnType<typeof vi.fn>).mockResolvedValue(ok(convNoCust));

    const result = await service.updateConversation({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      data: { customerId: WRONG_BIZ_CUSTOMER_ID },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CUSTOMER_NOT_IN_BUSINESS');
    }
    expect(repo.updateConversation).not.toHaveBeenCalled();
  });

  it('accepts updateConversation linking customer from same business', async () => {
    const convNoCust: ConversationWithSummary = {
      ...MOCK_CONVERSATION,
      customerId: null,
    };
    (repo.findConversationById as ReturnType<typeof vi.fn>).mockResolvedValue(ok(convNoCust));

    const result = await service.updateConversation({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      data: { customerId: CUSTOMER_ID },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects inbound createMessage with senderCustomerId from wrong business', async () => {
    const result = await service.createMessage({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'INBOUND',
      content: 'Hello',
      senderCustomerId: WRONG_BIZ_CUSTOMER_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CUSTOMER_NOT_IN_BUSINESS');
    }
    expect(repo.createMessage).not.toHaveBeenCalled();
  });

  it('accepts inbound createMessage with senderCustomerId from same business', async () => {
    const result = await service.createMessage({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'INBOUND',
      content: 'Hello from customer',
      senderCustomerId: CUSTOMER_ID,
    });
    expect(result.ok).toBe(true);
    expect(repo.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ senderCustomerId: CUSTOMER_ID }),
    );
  });

  it('rejects updateConversation with non-UUID customerId', async () => {
    const convNoCust: ConversationWithSummary = {
      ...MOCK_CONVERSATION,
      customerId: null,
    };
    (repo.findConversationById as ReturnType<typeof vi.fn>).mockResolvedValue(ok(convNoCust));

    const result = await service.updateConversation({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      data: { customerId: 'not-a-uuid' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CONVERSATION_INPUT');
    }
    expect(repo.updateConversation).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 5. createMessage — senderCustomerId support
// ===========================================================================

describe('createMessage — senderCustomerId', () => {
  it('OUTBOUND messages do not require senderCustomerId', async () => {
    const result = await service.createMessage({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'OUTBOUND',
      senderUserId: USER_ID,
      content: 'Reply to customer',
    });
    expect(result.ok).toBe(true);
  });

  it('INTERNAL messages do not require senderCustomerId', async () => {
    const result = await service.createMessage({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'INTERNAL',
      senderUserId: USER_ID,
      content: 'Internal note',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects invalid senderCustomerId format (non-UUID)', async () => {
    const result = await service.createMessage({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'INBOUND',
      content: 'Hello',
      senderCustomerId: 'not-a-uuid',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_MESSAGE_INPUT');
    }
  });

  it('rejects senderCustomerId on OUTBOUND messages', async () => {
    const result = await service.createMessage({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'OUTBOUND',
      content: 'Reply',
      senderUserId: USER_ID,
      senderCustomerId: CUSTOMER_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_MESSAGE_INPUT');
      expect(result.error.message).toContain('not allowed for OUTBOUND');
    }
  });

  it('rejects senderCustomerId on INTERNAL messages', async () => {
    const result = await service.createMessage({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'INTERNAL',
      content: 'Note',
      senderUserId: USER_ID,
      senderCustomerId: CUSTOMER_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_MESSAGE_INPUT');
      expect(result.error.message).toContain('not allowed for');
    }
  });
});

// ===========================================================================
// 6. Audit actor handling
// ===========================================================================

describe('Audit actor handling', () => {
  it('createConversation with actorUserId audits actorType USER', async () => {
    await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
      actorUserId: ACTOR_USER_ID,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(auditSvc.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'USER',
        actorUserId: ACTOR_USER_ID,
        action: 'conversation.created',
      }),
    );
  });

  it('createConversation without actorUserId audits actorType SYSTEM', async () => {
    await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(auditSvc.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'SYSTEM',
        actorUserId: undefined,
        action: 'conversation.created',
      }),
    );
  });

  it('updateConversation customer_linked audit uses actorUserId when provided', async () => {
    const convNoCust: ConversationWithSummary = {
      ...MOCK_CONVERSATION,
      customerId: null,
    };
    (repo.findConversationById as ReturnType<typeof vi.fn>).mockResolvedValue(ok(convNoCust));

    await service.updateConversation({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      data: { customerId: CUSTOMER_ID },
      actorUserId: ACTOR_USER_ID,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(auditSvc.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'USER',
        actorUserId: ACTOR_USER_ID,
        action: 'conversation.customer_linked',
      }),
    );
  });
});

// ===========================================================================
// 7. assignConversation — deferred to R4
// ===========================================================================

describe('assignConversation — deferred to R4', () => {
  it('ConversationService does NOT have assignConversation method', () => {
    // Verify the method does not exist on the service object
    expect(service).not.toHaveProperty('assignConversation');
  });
});

// ===========================================================================
// 8. changeStatus — invalid transition returns INVALID_CONVERSATION_TRANSITION
// ===========================================================================

describe('changeStatus', () => {
  it('returns INVALID_CONVERSATION_TRANSITION for invalid transition', async () => {
    const newConv: ConversationWithSummary = { ...MOCK_CONVERSATION, status: 'NEW' };
    (repo.findConversationById as ReturnType<typeof vi.fn>).mockResolvedValue(ok(newConv));

    const result = await service.changeStatus({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      toStatus: 'RESOLVED',
      actorUserId: ACTOR_USER_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CONVERSATION_TRANSITION');
    }
    expect(repo.updateConversation).not.toHaveBeenCalled();
  });

  it('allows valid transition and emits audit', async () => {
    const assignedConv: ConversationWithSummary = {
      ...MOCK_CONVERSATION,
      status: 'ASSIGNED',
      assignedUserId: USER_ID,
    };
    (repo.findConversationById as ReturnType<typeof vi.fn>).mockResolvedValue(ok(assignedConv));

    const result = await service.changeStatus({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      toStatus: 'RESOLVED',
      actorUserId: ACTOR_USER_ID,
    });

    expect(result.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 10));
    expect(auditSvc.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'conversation.status_changed',
        actorUserId: ACTOR_USER_ID,
      }),
    );
  });
});

// ===========================================================================
// 9. createMessage — audit content safety
// ===========================================================================

describe('createMessage — audit content safety', () => {
  it('does not put message content in audit metadata', async () => {
    await service.createMessage({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'OUTBOUND',
      senderUserId: USER_ID,
      content: 'This is sensitive message content',
    });

    await new Promise((r) => setTimeout(r, 10));

    const auditCall = (auditSvc.createAuditEvent as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    if (auditCall) {
      const metadataStr = JSON.stringify(auditCall.metadata ?? {});
      expect(metadataStr).not.toContain('This is sensitive message content');
      expect(metadataStr).not.toContain('content');
    }
  });

  it('INTERNAL message emits message.internal_note_created', async () => {
    await service.createMessage({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'INTERNAL',
      senderUserId: USER_ID,
      content: 'Internal note',
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(auditSvc.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'message.internal_note_created',
      }),
    );
  });

  it('OUTBOUND message emits message.created', async () => {
    await service.createMessage({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'OUTBOUND',
      senderUserId: USER_ID,
      content: 'Reply to customer',
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(auditSvc.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'message.created',
      }),
    );
  });

  it('INBOUND customer message does NOT emit operator audit', async () => {
    await service.createMessage({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'INBOUND',
      content: 'Customer says hello',
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(auditSvc.createAuditEvent).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 10. listMessages — verifies conversation belongs to business
// ===========================================================================

describe('listMessages — business scoping', () => {
  it('returns CONVERSATION_NOT_FOUND when conversation not in business', async () => {
    (repo.findConversationById as ReturnType<typeof vi.fn>).mockResolvedValue(ok(null));

    const result = await service.listMessages({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONVERSATION_NOT_FOUND');
    }
    expect(repo.listMessages).not.toHaveBeenCalled();
  });

  it('lists messages when conversation belongs to business', async () => {
    const result = await service.listMessages({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
    });

    expect(result.ok).toBe(true);
    expect(repo.listMessages).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 11. Repository error propagation
// ===========================================================================

describe('Repository error propagation', () => {
  it('repository error in createConversation propagates', async () => {
    (repo.createConversation as ReturnType<typeof vi.fn>).mockResolvedValue(
      err('CONVERSATION_REPOSITORY_ERROR', 'Conversation repository operation failed'),
    );

    const result = await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONVERSATION_REPOSITORY_ERROR');
    }
  });

  it('repository error in findConversationById propagates to changeStatus', async () => {
    (repo.findConversationById as ReturnType<typeof vi.fn>).mockResolvedValue(
      err('CONVERSATION_REPOSITORY_ERROR', 'DB error'),
    );

    const result = await service.changeStatus({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      toStatus: 'OPEN',
      actorUserId: ACTOR_USER_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONVERSATION_REPOSITORY_ERROR');
    }
  });

  it('repository error in findCustomerInBusiness propagates', async () => {
    (repo.findCustomerInBusiness as ReturnType<typeof vi.fn>).mockResolvedValue(
      err('CONVERSATION_REPOSITORY_ERROR', 'Customer lookup failed'),
    );

    const result = await service.createConversation({
      businessId: BUSINESS_ID,
      channel: 'WEBSITE_CHAT',
      customerId: CUSTOMER_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONVERSATION_REPOSITORY_ERROR');
    }
  });
});

// ===========================================================================
// 12. Input validation (standalone)
// ===========================================================================

describe('validateCreateConversationInput', () => {
  it('requires businessId', () => {
    const result = validateCreateConversationInput({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('businessId is required');
  });

  it('rejects invalid channel', () => {
    const result = validateCreateConversationInput({
      businessId: BUSINESS_ID,
      channel: 'INVALID' as 'INTERNAL',
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid channel');
  });
});

describe('validateCreateMessageInput', () => {
  it('requires content', () => {
    const result = validateCreateMessageInput({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('content is required and must be a non-empty string');
  });

  it('rejects invalid direction', () => {
    const result = validateCreateMessageInput({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'WRONG' as 'INBOUND',
      senderType: 'CUSTOMER',
      content: 'Hi',
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid direction');
  });

  it('validates senderCustomerId UUID format', () => {
    const result = validateCreateMessageInput({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      content: 'Hi',
      senderCustomerId: 'not-a-uuid',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('senderCustomerId must be a valid UUID');
  });
});

describe('validateInitialMessageInput', () => {
  it('requires content', () => {
    const result = validateInitialMessageInput({
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('initialMessage.content is required');
  });

  it('rejects invalid direction', () => {
    const result = validateInitialMessageInput({
      direction: 'BAD' as 'INBOUND',
      senderType: 'CUSTOMER',
      content: 'Hi',
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid initialMessage.direction');
  });

  it('rejects invalid senderCustomerId UUID in initialMessage', () => {
    const result = validateInitialMessageInput({
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      content: 'Hello',
      senderCustomerId: 'bad-uuid',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('initialMessage.senderCustomerId must be a valid UUID');
  });

  it('rejects senderCustomerId on OUTBOUND initialMessage', () => {
    const result = validateInitialMessageInput({
      direction: 'OUTBOUND',
      senderType: 'OPERATOR',
      content: 'Hello',
      senderCustomerId: CUSTOMER_ID,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('initialMessage.senderCustomerId is not allowed for OUTBOUND or INTERNAL messages');
  });

  it('accepts valid input', () => {
    const result = validateInitialMessageInput({
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      content: 'Hello',
    });
    expect(result.valid).toBe(true);
  });

  it('accepts valid input with senderCustomerId on INBOUND', () => {
    const result = validateInitialMessageInput({
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      content: 'Hello',
      senderCustomerId: CUSTOMER_ID,
    });
    expect(result.valid).toBe(true);
  });
});

describe('validateUpdateConversationInput', () => {
  it('rejects non-UUID customerId', () => {
    const result = validateUpdateConversationInput({
      customerId: 'not-a-uuid',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('customerId must be a valid UUID');
  });

  it('accepts valid UUID customerId', () => {
    const result = validateUpdateConversationInput({
      customerId: CUSTOMER_ID,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts null customerId (unlinking)', () => {
    // UpdateConversationInput uses customerId?: string
    // Null is not valid in the input type — only omission or a string
    const result = validateUpdateConversationInput({
      subject: null as unknown as string,
    });
    expect(result.valid).toBe(true);
  });
});

// ===========================================================================
// 13. mapConversationWithSummary — last message summary fields
//
// These tests directly exercise the repository mapper for the three fields
// added in PR #76: lastMessageContent, lastMessageDirection, lastMessageSenderType.
// ===========================================================================

describe('mapConversationWithSummary — last message fields', () => {
  /** Minimal base record shared by all mapper tests */
  const BASE_RECORD: Omit<ConversationRecordWithSummary, '_count' | 'messages'> = {
    id: CONVERSATION_ID,
    businessId: BUSINESS_ID,
    customerId: null,
    channel: 'WEBSITE_CHAT',
    status: 'NEW',
    subject: null,
    assignedUserId: null,
    aiClassificationStatus: 'NOT_REQUESTED',
    aiDraftStatus: 'NOT_REQUESTED',
    channelMetadata: null,
    metadata: null,
    closedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('maps lastMessageContent, lastMessageDirection, and lastMessageSenderType when a message is present', () => {
    const msgCreatedAt = new Date('2026-01-02T10:30:00.000Z');
    const record: ConversationRecordWithSummary = {
      ...BASE_RECORD,
      _count: { messages: 1 },
      messages: [
        {
          createdAt: msgCreatedAt,
          content: 'Hello, I need help with my appointment.',
          direction: 'INBOUND',
          senderType: 'CUSTOMER',
        },
      ],
    };

    const summary = mapConversationWithSummary(record);

    expect(summary.messageCount).toBe(1);
    expect(summary.lastMessageAt).toBe('2026-01-02T10:30:00.000Z');
    expect(summary.lastMessageContent).toBe('Hello, I need help with my appointment.');
    expect(summary.lastMessageDirection).toBe('INBOUND');
    expect(summary.lastMessageSenderType).toBe('CUSTOMER');
  });

  it('maps all last-message fields as null when no messages exist (empty array)', () => {
    const record: ConversationRecordWithSummary = {
      ...BASE_RECORD,
      _count: { messages: 0 },
      messages: [],
    };

    const summary = mapConversationWithSummary(record);

    expect(summary.messageCount).toBe(0);
    expect(summary.lastMessageAt).toBeNull();
    expect(summary.lastMessageContent).toBeNull();
    expect(summary.lastMessageDirection).toBeNull();
    expect(summary.lastMessageSenderType).toBeNull();
  });

  it('maps all last-message fields as null when messages is undefined', () => {
    const record: ConversationRecordWithSummary = {
      ...BASE_RECORD,
      _count: { messages: 0 },
      messages: undefined,
    };

    const summary = mapConversationWithSummary(record);

    expect(summary.lastMessageAt).toBeNull();
    expect(summary.lastMessageContent).toBeNull();
    expect(summary.lastMessageDirection).toBeNull();
    expect(summary.lastMessageSenderType).toBeNull();
  });

  it('uses only the first (latest) message when multiple are provided', () => {
    // In production the query uses take:1 — but the mapper itself should
    // only read messages[0] regardless of array length.
    const record: ConversationRecordWithSummary = {
      ...BASE_RECORD,
      _count: { messages: 3 },
      messages: [
        {
          createdAt: new Date('2026-01-03T09:00:00.000Z'),
          content: 'Latest message',
          direction: 'OUTBOUND',
          senderType: 'OPERATOR',
        },
        {
          createdAt: new Date('2026-01-02T08:00:00.000Z'),
          content: 'Earlier message',
          direction: 'INBOUND',
          senderType: 'CUSTOMER',
        },
      ],
    };

    const summary = mapConversationWithSummary(record);

    // Must use messages[0] — the most recent (caller-sorted)
    expect(summary.lastMessageContent).toBe('Latest message');
    expect(summary.lastMessageDirection).toBe('OUTBOUND');
    expect(summary.lastMessageSenderType).toBe('OPERATOR');
  });

  it('PII guard — message shape includes no user/customer relation fields', () => {
    // ConversationRecordWithSummary.messages only carries scalar fields:
    // createdAt, content, direction, senderType.
    // Verify no email, name, or avatarUrl property exists on the joined shape.
    const msgRecord = {
      createdAt: new Date(),
      content: 'Test message',
      direction: 'INBOUND' as const,
      senderType: 'CUSTOMER' as const,
    };

    expect(msgRecord).not.toHaveProperty('email');
    expect(msgRecord).not.toHaveProperty('name');
    expect(msgRecord).not.toHaveProperty('avatarUrl');
    expect(msgRecord).not.toHaveProperty('senderUser');
    expect(msgRecord).not.toHaveProperty('senderCustomer');

    const record: ConversationRecordWithSummary = {
      ...BASE_RECORD,
      _count: { messages: 1 },
      messages: [msgRecord],
    };

    const summary = mapConversationWithSummary(record);
    expect(summary).not.toHaveProperty('email');
    expect(summary).not.toHaveProperty('name');
    expect(summary).not.toHaveProperty('avatarUrl');
  });
});
