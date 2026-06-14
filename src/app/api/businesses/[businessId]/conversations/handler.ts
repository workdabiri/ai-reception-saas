// ===========================================================================
// Conversations — API Handler Module
//
// Handler builders for conversation and message operations.
// Uses dependency injection for testability.
// Context resolution must succeed before any service call.
// Authz must pass before all operations.
// All data is strictly business-scoped.
// ===========================================================================

import { z } from 'zod';
import {
  actionResultToResponse,
  actionResultToResponseWithStatus,
} from '@/app/api/_shared/action-result';
import { validateJsonBody } from '@/app/api/_shared/request';
import {
  validateRouteParams,
  getSearchParam,
  parseIntegerQueryParam,
} from '@/app/api/_shared/params';
import {
  resolveTenantRequestContext,
  type TenantRequestContext,
  type TenantRequestScope,
  type ContextResult,
} from '@/app/api/_shared/request-context';
import { apiError } from '@/app/api/_shared/responses';
import { assertBusinessRouteMatchesTenant } from '@/app/api/_shared/tenant-route-guard';
import type { ConversationService } from '@/domains/conversations/service';
import type { AuthzService } from '@/domains/authz/service';
import type { AuthzPermission } from '@/domains/authz/types';
import {
  CONVERSATION_STATUS_VALUES,
  CHANNEL_TYPE_VALUES,
  type ConversationStatusValue,
  type MessageDirectionValue,
  type ChannelTypeValue,
  type MessageSenderTypeValue,
} from '@/domains/conversations/types';

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

const businessIdParamsSchema = z.object({
  businessId: z.string().uuid(),
});

const conversationParamsSchema = z.object({
  businessId: z.string().uuid(),
  conversationId: z.string().uuid(),
});

const conversationStatusSchema = z.enum(
  CONVERSATION_STATUS_VALUES as unknown as [string, ...string[]],
);

/** API-allowed message directions (SYSTEM is internal-only) */
const API_MESSAGE_DIRECTIONS = ['INBOUND', 'OUTBOUND', 'INTERNAL'] as const;
const apiMessageDirectionSchema = z.enum(API_MESSAGE_DIRECTIONS);

const channelTypeSchema = z.enum(
  CHANNEL_TYPE_VALUES as unknown as [string, ...string[]],
);

/** UUID schema for query param validation */
const uuidSchema = z.string().uuid();

// Request body schemas

const initialMessageBodySchema = z.object({
  content: z.string().min(1).max(50000),
  direction: apiMessageDirectionSchema,
  senderCustomerId: z.string().uuid().optional(),
  contentType: z.string().max(200).optional(),
}).strict();

const createConversationBodySchema = z.object({
  customerId: z.string().uuid().optional(),
  channel: channelTypeSchema.optional(),
  subject: z.string().max(500).optional(),
  channelMetadata: z.unknown().optional(),
  metadata: z.unknown().optional(),
  initialMessage: initialMessageBodySchema.optional(),
}).strict();

const updateConversationBodySchema = z.object({
  customerId: z.string().uuid().nullable().optional(),
  subject: z.string().max(500).nullable().optional(),
  metadata: z.unknown().optional(),
}).strict().refine(
  (data) =>
    data.customerId !== undefined ||
    data.subject !== undefined ||
    data.metadata !== undefined,
  { message: 'At least one field must be provided for update' },
);

const changeStatusBodySchema = z.object({
  status: conversationStatusSchema,
}).strict();

const createMessageBodySchema = z.object({
  content: z.string().min(1).max(50000),
  direction: apiMessageDirectionSchema,
  senderCustomerId: z.string().uuid().optional(),
  contentType: z.string().max(200).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/** Dependencies required by the conversation handler module */
export interface ConversationHandlerDeps {
  readonly conversationService: Pick<
    ConversationService,
    | 'createConversation'
    | 'findConversationById'
    | 'listConversations'
    | 'updateConversation'
    | 'changeStatus'
    | 'createMessage'
    | 'listMessages'
  >;
  readonly authzService: Pick<AuthzService, 'requirePermission'>;
  readonly resolveTenantContext?: (
    request: Request,
    scope?: TenantRequestScope,
  ) => Promise<ContextResult<TenantRequestContext>>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function requireConversationPermission(
  deps: ConversationHandlerDeps,
  context: TenantRequestContext,
  permission: AuthzPermission,
): Promise<Response | null> {
  const authzResult = await deps.authzService.requirePermission({
    userId: context.userId,
    businessId: context.businessId,
    role: context.role,
    permission,
  });

  if (!authzResult.ok) {
    return actionResultToResponse(authzResult);
  }

  if (!authzResult.data.allowed) {
    return apiError('ACCESS_DENIED', 'Access denied', 403);
  }

  return null;
}

// Audit is handled by the domain service — not duplicated at handler level.
// See: src/domains/conversations/implementation.ts

/**
 * Derives senderType from API-allowed message direction.
 * SYSTEM direction is not allowed at the API boundary.
 */
function deriveSenderType(direction: MessageDirectionValue): MessageSenderTypeValue {
  switch (direction) {
    case 'INBOUND':
      return 'CUSTOMER';
    case 'OUTBOUND':
    case 'INTERNAL':
      return 'OPERATOR';
    default:
      return 'SYSTEM';
  }
}

// ---------------------------------------------------------------------------
// Handler builders
// ---------------------------------------------------------------------------

/**
 * GET /api/businesses/:businessId/conversations
 *
 * 1. Validate businessId param
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require conversations.read permission
 * 5. Parse query params (status, assignedUserId, customerId, channel, limit, cursor)
 * 6. Call conversationService.listConversations
 */
export function createListConversationsHandler(
  deps: ConversationHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      businessIdParamsSchema,
      'INVALID_CONVERSATION_INPUT',
      'Invalid conversation input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireConversationPermission(deps, contextResult.context, 'conversations.read');
    if (authzErr) return authzErr;

    // Parse query filters
    const statusParam = getSearchParam(request, 'status');
    let status: ConversationStatusValue | undefined;
    if (statusParam !== null) {
      const statusParsed = conversationStatusSchema.safeParse(statusParam);
      if (!statusParsed.success) {
        return apiError('INVALID_CONVERSATION_INPUT', 'Invalid status filter', 400);
      }
      status = statusParsed.data as ConversationStatusValue;
    }

    const channelParam = getSearchParam(request, 'channel');
    let channel: ChannelTypeValue | undefined;
    if (channelParam !== null) {
      const channelParsed = channelTypeSchema.safeParse(channelParam);
      if (!channelParsed.success) {
        return apiError('INVALID_CONVERSATION_INPUT', 'Invalid channel filter', 400);
      }
      channel = channelParsed.data as ChannelTypeValue;
    }

    const assignedUserIdParam = getSearchParam(request, 'assignedUserId');
    let assignedUserId: string | undefined;
    if (assignedUserIdParam !== null) {
      if (!uuidSchema.safeParse(assignedUserIdParam).success) {
        return apiError('INVALID_CONVERSATION_INPUT', 'Invalid assignedUserId filter', 400);
      }
      assignedUserId = assignedUserIdParam;
    }

    const customerIdParam = getSearchParam(request, 'customerId');
    let customerId: string | undefined;
    if (customerIdParam !== null) {
      if (!uuidSchema.safeParse(customerIdParam).success) {
        return apiError('INVALID_CONVERSATION_INPUT', 'Invalid customerId filter', 400);
      }
      customerId = customerIdParam;
    }

    const limitParam = getSearchParam(request, 'limit');
    let limit: number | undefined;
    if (limitParam !== null) {
      const parsed = parseIntegerQueryParam(limitParam);
      if (parsed === undefined || parsed < 1) {
        return apiError('INVALID_CONVERSATION_INPUT', 'Invalid limit parameter', 400);
      }
      limit = Math.min(parsed, 100);
    }

    const cursorParam = getSearchParam(request, 'cursor');
    let cursor: string | undefined;
    if (cursorParam !== null) {
      if (!uuidSchema.safeParse(cursorParam).success) {
        return apiError('INVALID_CONVERSATION_INPUT', 'Invalid cursor parameter', 400);
      }
      cursor = cursorParam;
    }

    const result = await deps.conversationService.listConversations({
      businessId,
      status,
      channel,
      assignedUserId,
      customerId,
      limit,
      cursor,
    });

    return actionResultToResponse(result);
  };
}

/**
 * POST /api/businesses/:businessId/conversations
 *
 * 1. Validate businessId param
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require conversations.reply permission
 * 5. Validate JSON body
 * 6. Call conversationService.createConversation with businessId from route
 */
export function createPostConversationHandler(
  deps: ConversationHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      businessIdParamsSchema,
      'INVALID_CONVERSATION_INPUT',
      'Invalid conversation input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireConversationPermission(deps, contextResult.context, 'conversations.reply');
    if (authzErr) return authzErr;

    const bodyResult = await validateJsonBody(
      request,
      createConversationBodySchema,
      'INVALID_CONVERSATION_INPUT',
      'Invalid conversation input',
    );
    if (!bodyResult.ok) return bodyResult.response;

    // Derive initialMessage sender fields at handler level to prevent impersonation
    let initialMessage: Parameters<typeof deps.conversationService.createConversation>[0]['initialMessage'];
    if (bodyResult.data.initialMessage) {
      const imDir = bodyResult.data.initialMessage.direction as MessageDirectionValue;
      const imSenderType = deriveSenderType(imDir);
      const imSenderUserId =
        imDir === 'OUTBOUND' || imDir === 'INTERNAL'
          ? contextResult.context.userId
          : undefined;

      // Reject senderCustomerId for OUTBOUND/INTERNAL
      if (
        bodyResult.data.initialMessage.senderCustomerId &&
        (imDir === 'OUTBOUND' || imDir === 'INTERNAL')
      ) {
        return apiError(
          'INVALID_CONVERSATION_INPUT',
          'senderCustomerId is not allowed for OUTBOUND or INTERNAL initial messages',
          400,
        );
      }

      initialMessage = {
        content: bodyResult.data.initialMessage.content,
        direction: imDir,
        senderType: imSenderType,
        senderUserId: imSenderUserId,
        senderCustomerId: bodyResult.data.initialMessage.senderCustomerId,
        contentType: bodyResult.data.initialMessage.contentType,
      };
    }

    const result = await deps.conversationService.createConversation({
      businessId,
      customerId: bodyResult.data.customerId,
      channel: bodyResult.data.channel as ChannelTypeValue | undefined,
      subject: bodyResult.data.subject,
      channelMetadata: bodyResult.data.channelMetadata,
      metadata: bodyResult.data.metadata,
      initialMessage,
      actorUserId: contextResult.context.userId,
    });

    // Audit is emitted by the domain service — not duplicated here.

    return actionResultToResponseWithStatus(result, 201);
  };
}

/**
 * GET /api/businesses/:businessId/conversations/:conversationId
 *
 * 1. Validate businessId + conversationId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require conversations.read permission
 * 5. Call conversationService.findConversationById
 * 6. Return 404 if not found
 */
export function createGetConversationByIdHandler(
  deps: ConversationHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      conversationParamsSchema,
      'INVALID_CONVERSATION_INPUT',
      'Invalid conversation input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, conversationId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireConversationPermission(deps, contextResult.context, 'conversations.read');
    if (authzErr) return authzErr;

    const findResult = await deps.conversationService.findConversationById({
      conversationId,
      businessId,
    });

    if (!findResult.ok) return actionResultToResponse(findResult);

    if (findResult.data === null) {
      return apiError('CONVERSATION_NOT_FOUND', 'Conversation not found', 404);
    }

    return actionResultToResponse(findResult);
  };
}

/**
 * PATCH /api/businesses/:businessId/conversations/:conversationId
 *
 * 1. Validate businessId + conversationId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require conversations.reply permission
 * 5. Validate JSON body (at least one field)
 * 6. Call conversationService.updateConversation
 */
export function createPatchConversationHandler(
  deps: ConversationHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      conversationParamsSchema,
      'INVALID_CONVERSATION_INPUT',
      'Invalid conversation input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, conversationId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireConversationPermission(deps, contextResult.context, 'conversations.reply');
    if (authzErr) return authzErr;

    const bodyResult = await validateJsonBody(
      request,
      updateConversationBodySchema,
      'INVALID_CONVERSATION_INPUT',
      'Invalid conversation input',
    );
    if (!bodyResult.ok) return bodyResult.response;

    const updateData = bodyResult.data;
    const result = await deps.conversationService.updateConversation({
      conversationId,
      businessId,
      data: {
        customerId: updateData.customerId ?? undefined,
        subject: updateData.subject,
        metadata: updateData.metadata,
      },
      actorUserId: contextResult.context.userId,
    });

    // Audit is emitted by the domain service — not duplicated here.

    return actionResultToResponse(result);
  };
}

/**
 * POST /api/businesses/:businessId/conversations/:conversationId/status
 *
 * 1. Validate businessId + conversationId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require conversations.close if toStatus=RESOLVED, else conversations.reply
 * 5. Validate JSON body
 * 6. Call conversationService.changeStatus
 */
export function createChangeConversationStatusHandler(
  deps: ConversationHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      conversationParamsSchema,
      'INVALID_CONVERSATION_INPUT',
      'Invalid conversation input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, conversationId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const bodyResult = await validateJsonBody(
      request,
      changeStatusBodySchema,
      'INVALID_CONVERSATION_INPUT',
      'Invalid conversation input',
    );
    if (!bodyResult.ok) return bodyResult.response;

    const toStatus = bodyResult.data.status as ConversationStatusValue;

    // Permission routing: RESOLVED requires conversations.close
    const requiredPermission: AuthzPermission =
      toStatus === 'RESOLVED' ? 'conversations.close' : 'conversations.reply';

    const authzErr = await requireConversationPermission(deps, contextResult.context, requiredPermission);
    if (authzErr) return authzErr;

    const result = await deps.conversationService.changeStatus({
      conversationId,
      businessId,
      toStatus,
      actorUserId: contextResult.context.userId,
    });

    // Domain service handles audit for audit-required transitions.
    // Handler does NOT double-emit.

    return actionResultToResponse(result);
  };
}

/**
 * GET /api/businesses/:businessId/conversations/:conversationId/messages
 *
 * 1. Validate businessId + conversationId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require messages.read permission
 * 5. Parse query params (direction, limit, cursor)
 * 6. Call conversationService.listMessages
 */
export function createListMessagesHandler(
  deps: ConversationHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      conversationParamsSchema,
      'INVALID_MESSAGE_INPUT',
      'Invalid message input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, conversationId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireConversationPermission(deps, contextResult.context, 'messages.read');
    if (authzErr) return authzErr;

    const directionParam = getSearchParam(request, 'direction');
    let direction: MessageDirectionValue | undefined;
    if (directionParam !== null) {
      const directionParsed = apiMessageDirectionSchema.safeParse(directionParam);
      if (!directionParsed.success) {
        return apiError('INVALID_MESSAGE_INPUT', 'Invalid direction filter', 400);
      }
      direction = directionParsed.data as MessageDirectionValue;
    }

    const limitParam = getSearchParam(request, 'limit');
    let limit: number | undefined;
    if (limitParam !== null) {
      const parsed = parseIntegerQueryParam(limitParam);
      if (parsed === undefined || parsed < 1) {
        return apiError('INVALID_MESSAGE_INPUT', 'Invalid limit parameter', 400);
      }
      limit = Math.min(parsed, 100);
    }

    const cursorParam = getSearchParam(request, 'cursor');
    let cursor: string | undefined;
    if (cursorParam !== null) {
      if (!uuidSchema.safeParse(cursorParam).success) {
        return apiError('INVALID_MESSAGE_INPUT', 'Invalid cursor parameter', 400);
      }
      cursor = cursorParam;
    }

    const result = await deps.conversationService.listMessages({
      conversationId,
      businessId,
      direction,
      limit,
      cursor,
    });

    return actionResultToResponse(result);
  };
}

/**
 * POST /api/businesses/:businessId/conversations/:conversationId/messages
 *
 * 1. Validate businessId + conversationId params
 * 2. Resolve tenant context
 * 3. Check businessId matches tenant
 * 4. Require messages.create permission
 * 5. Validate JSON body
 * 6. Derive senderType and senderUserId from direction
 * 7. Call conversationService.createMessage
 */
export function createPostMessageHandler(
  deps: ConversationHandlerDeps,
): (request: Request, params: unknown) => Promise<Response> {
  return async (request: Request, params: unknown): Promise<Response> => {
    const paramsResult = validateRouteParams(
      params,
      conversationParamsSchema,
      'INVALID_MESSAGE_INPUT',
      'Invalid message input',
    );
    if (!paramsResult.ok) return paramsResult.response;

    const { businessId, conversationId } = paramsResult.data;

    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, {
      businessId,
      source: 'route-param',
    });
    if (!contextResult.ok) return contextResult.response;

    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;

    const authzErr = await requireConversationPermission(deps, contextResult.context, 'messages.create');
    if (authzErr) return authzErr;

    const bodyResult = await validateJsonBody(
      request,
      createMessageBodySchema,
      'INVALID_MESSAGE_INPUT',
      'Invalid message input',
    );
    if (!bodyResult.ok) return bodyResult.response;

    const direction = bodyResult.data.direction as MessageDirectionValue;

    // Derive senderUserId: for OUTBOUND/INTERNAL, use the authenticated user
    const senderUserId =
      direction === 'OUTBOUND' || direction === 'INTERNAL'
        ? contextResult.context.userId
        : undefined;

    // senderCustomerId validation: only allowed for INBOUND
    if (
      bodyResult.data.senderCustomerId &&
      (direction === 'OUTBOUND' || direction === 'INTERNAL')
    ) {
      return apiError(
        'INVALID_MESSAGE_INPUT',
        'senderCustomerId is not allowed for OUTBOUND or INTERNAL messages',
        400,
      );
    }

    const result = await deps.conversationService.createMessage({
      conversationId,
      businessId,
      content: bodyResult.data.content,
      direction,
      senderUserId,
      senderCustomerId: bodyResult.data.senderCustomerId,
      contentType: bodyResult.data.contentType,
    });

    // Audit is emitted by the domain service — not duplicated here.

    return actionResultToResponseWithStatus(result, 201);
  };
}

// ---------------------------------------------------------------------------
// Combined handler factory
// ---------------------------------------------------------------------------

/** Creates all conversation and message handlers */
export function createConversationHandlers(deps: ConversationHandlerDeps): {
  LIST_CONVERSATIONS: (request: Request, params: unknown) => Promise<Response>;
  CREATE_CONVERSATION: (request: Request, params: unknown) => Promise<Response>;
  GET_CONVERSATION: (request: Request, params: unknown) => Promise<Response>;
  PATCH_CONVERSATION: (request: Request, params: unknown) => Promise<Response>;
  CHANGE_STATUS: (request: Request, params: unknown) => Promise<Response>;
  LIST_MESSAGES: (request: Request, params: unknown) => Promise<Response>;
  CREATE_MESSAGE: (request: Request, params: unknown) => Promise<Response>;
} {
  return {
    LIST_CONVERSATIONS: createListConversationsHandler(deps),
    CREATE_CONVERSATION: createPostConversationHandler(deps),
    GET_CONVERSATION: createGetConversationByIdHandler(deps),
    PATCH_CONVERSATION: createPatchConversationHandler(deps),
    CHANGE_STATUS: createChangeConversationStatusHandler(deps),
    LIST_MESSAGES: createListMessagesHandler(deps),
    CREATE_MESSAGE: createPostMessageHandler(deps),
  };
}
