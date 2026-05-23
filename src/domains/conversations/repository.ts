// ===========================================================================
// Conversations Domain — Repository
//
// Prisma-backed persistence layer for conversations and messages.
// Uses injected Prisma-compatible client for testability.
// ===========================================================================

import { ok, err } from '@/lib/result';
import type { ActionResult } from '@/lib/result';
import type {
  ConversationIdentity,
  ConversationWithSummary,
  MessageIdentity,
  ConversationStatusValue,
  ChannelTypeValue,
  MessageDirectionValue,
  MessageSenderTypeValue,
  AiClassificationStatusValue,
  AiDraftStatusValue,
  CreateConversationInput,
  CreateMessageInput,
} from './types';

// ---------------------------------------------------------------------------
// Local record types (match Prisma-selected fields)
// ---------------------------------------------------------------------------

/** Raw conversation record from the database */
export interface ConversationRecord {
  id: string;
  businessId: string;
  customerId: string | null;
  channel: ChannelTypeValue;
  status: ConversationStatusValue;
  subject: string | null;
  assignedUserId: string | null;
  aiClassificationStatus: AiClassificationStatusValue;
  aiDraftStatus: AiDraftStatusValue;
  channelMetadata: unknown | null;
  metadata: unknown | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Raw conversation record with aggregated message info */
export interface ConversationRecordWithSummary extends ConversationRecord {
  _count?: { messages: number };
  messages?: { createdAt: Date }[];
}

/** Raw message record from the database */
export interface MessageRecord {
  id: string;
  conversationId: string;
  businessId: string;
  direction: MessageDirectionValue;
  senderType: MessageSenderTypeValue;
  senderUserId: string | null;
  senderCustomerId: string | null;
  content: string;
  contentType: string;
  channelMetadata: unknown | null;
  metadata: unknown | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Injected DB client interface
// ---------------------------------------------------------------------------

/** Prisma-compatible delegate interface for Conversations repository */
export interface ConversationRepositoryDb {
  conversation: {
    create(args: {
      data: {
        businessId: string;
        customerId?: string | null;
        channel?: ChannelTypeValue;
        status?: ConversationStatusValue;
        subject?: string | null;
        assignedUserId?: string | null;
        channelMetadata?: unknown;
        metadata?: unknown;
      };
    }): Promise<ConversationRecord>;
    update(args: {
      where: { id: string };
      data: Partial<{
        customerId: string | null;
        status: ConversationStatusValue;
        subject: string | null;
        assignedUserId: string | null;
        aiClassificationStatus: AiClassificationStatusValue;
        aiDraftStatus: AiDraftStatusValue;
        metadata: unknown | null;
        closedAt: Date | null;
      }>;
    }): Promise<ConversationRecord>;
    findUnique(args: {
      where: { id: string };
      include?: {
        _count?: { select: { messages: boolean } };
        messages?: { orderBy: { createdAt: 'desc' }; take: number };
      };
    }): Promise<ConversationRecordWithSummary | null>;
    findMany(args: {
      where: {
        businessId: string;
        status?: ConversationStatusValue;
        assignedUserId?: string | null;
        customerId?: string;
        channel?: ChannelTypeValue;
        id?: { gt: string };
      };
      orderBy: { createdAt: 'desc' } | { updatedAt: 'desc' };
      take: number;
      include?: {
        _count?: { select: { messages: boolean } };
        messages?: { orderBy: { createdAt: 'desc' }; take: number };
      };
    }): Promise<ConversationRecordWithSummary[]>;
  };
  message: {
    create(args: {
      data: {
        conversationId: string;
        businessId: string;
        direction: MessageDirectionValue;
        senderType: MessageSenderTypeValue;
        senderUserId?: string | null;
        senderCustomerId?: string | null;
        content: string;
        contentType?: string;
        channelMetadata?: unknown;
        metadata?: unknown;
      };
    }): Promise<MessageRecord>;
    findUnique(args: {
      where: { id: string };
    }): Promise<MessageRecord | null>;
    findMany(args: {
      where: {
        conversationId: string;
        direction?: MessageDirectionValue;
        id?: { gt: string };
      };
      orderBy: { createdAt: 'asc' };
      take: number;
    }): Promise<MessageRecord[]>;
  };
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

/** Input for listing conversations */
export interface ListConversationsRepoInput {
  businessId: string;
  status?: ConversationStatusValue;
  assignedUserId?: string;
  customerId?: string;
  channel?: ChannelTypeValue;
  limit: number;
  cursor?: string;
}

/** Input for listing messages */
export interface ListMessagesRepoInput {
  conversationId: string;
  direction?: MessageDirectionValue;
  limit: number;
  cursor?: string;
}

/** Paginated conversation list result */
export interface PaginatedConversations {
  data: readonly ConversationWithSummary[];
  nextCursor: string | null;
}

/** Paginated message list result */
export interface PaginatedMessages {
  data: readonly MessageIdentity[];
  nextCursor: string | null;
}

/** Repository boundary for Conversations persistence */
export interface ConversationRepository {
  createConversation(
    input: CreateConversationInput,
  ): Promise<ActionResult<ConversationIdentity>>;

  updateConversation(
    conversationId: string,
    input: Partial<{
      customerId: string | null;
      status: ConversationStatusValue;
      subject: string | null;
      assignedUserId: string | null;
      metadata: unknown | null;
      closedAt: Date | null;
    }>,
  ): Promise<ActionResult<ConversationIdentity>>;

  findConversationById(
    conversationId: string,
    businessId: string,
  ): Promise<ActionResult<ConversationWithSummary | null>>;

  listConversations(
    input: ListConversationsRepoInput,
  ): Promise<ActionResult<PaginatedConversations>>;

  createMessage(
    input: CreateMessageInput,
  ): Promise<ActionResult<MessageIdentity>>;

  findMessageById(
    messageId: string,
    businessId: string,
  ): Promise<ActionResult<MessageIdentity | null>>;

  listMessages(
    input: ListMessagesRepoInput,
  ): Promise<ActionResult<PaginatedMessages>>;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** Maps a raw conversation record to a domain ConversationIdentity */
export function mapConversationRecord(
  record: ConversationRecord,
): ConversationIdentity {
  return {
    id: record.id,
    businessId: record.businessId,
    customerId: record.customerId,
    channel: record.channel,
    status: record.status,
    subject: record.subject,
    assignedUserId: record.assignedUserId,
    aiClassificationStatus: record.aiClassificationStatus,
    aiDraftStatus: record.aiDraftStatus,
    channelMetadata: record.channelMetadata,
    metadata: record.metadata,
    closedAt: record.closedAt ? record.closedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Maps a raw conversation record with summary to a ConversationWithSummary */
export function mapConversationWithSummary(
  record: ConversationRecordWithSummary,
): ConversationWithSummary {
  const messageCount = record._count?.messages ?? 0;
  const lastMessage = record.messages?.[0];
  return {
    ...mapConversationRecord(record),
    messageCount,
    lastMessageAt: lastMessage
      ? lastMessage.createdAt.toISOString()
      : null,
  };
}

/** Maps a raw message record to a domain MessageIdentity */
export function mapMessageRecord(record: MessageRecord): MessageIdentity {
  return {
    id: record.id,
    conversationId: record.conversationId,
    businessId: record.businessId,
    direction: record.direction,
    senderType: record.senderType,
    senderUserId: record.senderUserId,
    senderCustomerId: record.senderCustomerId,
    content: record.content,
    contentType: record.contentType,
    channelMetadata: record.channelMetadata,
    metadata: record.metadata,
    createdAt: record.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const REPO_ERROR_CODE = 'CONVERSATION_REPOSITORY_ERROR';
const REPO_ERROR_MSG = 'Conversation repository operation failed';

/** Creates a Conversations repository backed by the given DB client */
export function createConversationRepository(
  db: ConversationRepositoryDb,
): ConversationRepository {
  return {
    async createConversation(input) {
      try {
        const record = await db.conversation.create({
          data: {
            businessId: input.businessId,
            customerId: input.customerId ?? null,
            channel: input.channel,
            subject: input.subject,
            channelMetadata: input.channelMetadata,
            metadata: input.metadata,
          },
        });
        return ok(mapConversationRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async updateConversation(conversationId, data) {
      try {
        const record = await db.conversation.update({
          where: { id: conversationId },
          data,
        });
        return ok(mapConversationRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async findConversationById(conversationId, businessId) {
      try {
        const record = await db.conversation.findUnique({
          where: { id: conversationId },
          include: {
            _count: { select: { messages: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        });
        if (!record || record.businessId !== businessId) {
          return ok(null);
        }
        return ok(mapConversationWithSummary(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async listConversations(input) {
      try {
        const where: {
          businessId: string;
          status?: ConversationStatusValue;
          assignedUserId?: string | null;
          customerId?: string;
          channel?: ChannelTypeValue;
          id?: { gt: string };
        } = { businessId: input.businessId };

        if (input.status) where.status = input.status;
        if (input.assignedUserId) where.assignedUserId = input.assignedUserId;
        if (input.customerId) where.customerId = input.customerId;
        if (input.channel) where.channel = input.channel;
        if (input.cursor) where.id = { gt: input.cursor };

        const records = await db.conversation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: input.limit + 1,
          include: {
            _count: { select: { messages: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        });

        const hasMore = records.length > input.limit;
        const data = hasMore ? records.slice(0, input.limit) : records;
        const nextCursor = hasMore ? data[data.length - 1].id : null;

        return ok({
          data: data.map(mapConversationWithSummary),
          nextCursor,
        });
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async createMessage(input) {
      try {
        const record = await db.message.create({
          data: {
            conversationId: input.conversationId,
            businessId: input.businessId,
            direction: input.direction,
            senderType: input.senderType,
            senderUserId: input.senderUserId ?? null,
            senderCustomerId: input.senderCustomerId ?? null,
            content: input.content,
            contentType: input.contentType ?? 'text/plain',
            channelMetadata: input.channelMetadata,
            metadata: input.metadata,
          },
        });
        return ok(mapMessageRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async findMessageById(messageId, businessId) {
      try {
        const record = await db.message.findUnique({
          where: { id: messageId },
        });
        if (!record || record.businessId !== businessId) {
          return ok(null);
        }
        return ok(mapMessageRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async listMessages(input) {
      try {
        const where: {
          conversationId: string;
          direction?: MessageDirectionValue;
          id?: { gt: string };
        } = { conversationId: input.conversationId };

        if (input.direction) where.direction = input.direction;
        if (input.cursor) where.id = { gt: input.cursor };

        const records = await db.message.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          take: input.limit + 1,
        });

        const hasMore = records.length > input.limit;
        const data = hasMore ? records.slice(0, input.limit) : records;
        const nextCursor = hasMore ? data[data.length - 1].id : null;

        return ok({
          data: data.map(mapMessageRecord),
          nextCursor,
        });
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },
  };
}
