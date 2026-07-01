// ===========================================================================
// Channels Domain — Public API
//
// Web-chat channel binding foundation (Area C, P12-B). Config/data layer only:
// it stores a tenant-scoped widget-key binding (keyed hash + origin allowlist),
// calls no provider, holds no customer/conversation/message content, and has no
// send/delivery path. This barrel is the only public entry point.
//
// @module
// ===========================================================================

export {
  WEB_CHAT_CHANNEL_BINDING_STATUS_VALUES,
  DEFAULT_WEB_CHAT_CHANNEL_BINDING_STATUS,
  isWebChatChannelBindingStatus,
  type WebChatChannelBindingStatusValue,
  type WebChatChannelBinding,
  type CreateWebChatBindingInput,
  type ListWebChatBindingsInput,
  type FindWebChatBindingInput,
  type RotateWebChatBindingKeyInput,
  type RevokeWebChatBindingInput,
  type GeneratedWidgetKey,
  type WidgetKeyGenerator,
  type WidgetKeyHasher,
  type WebChatBindingWithRawKey,
} from './types';

export {
  normalizeWebChatOrigin,
  webChatOriginSchema,
  createWebChatBindingBodySchema,
  createWebChatBindingServiceSchema,
  listWebChatBindingsSchema,
  findWebChatBindingSchema,
  rotateWebChatBindingKeySchema,
  revokeWebChatBindingSchema,
  MAX_BINDING_LABEL_LENGTH,
  MAX_ALLOWED_ORIGINS,
  MAX_ORIGIN_LENGTH,
  type CreateWebChatBindingBody,
} from './validation';

export {
  createChannelsRepository,
  mapWebChatChannelBindingRecord,
  type ChannelsRepositoryDb,
  type ChannelsRepository,
  type WebChatChannelBindingRecord,
  type WebChatChannelBindingWhereUniqueId,
  type WebChatChannelBindingWhereUniqueHash,
  type WebChatChannelBindingListWhere,
  type CreateBindingRepoInput,
} from './repository';

export {
  CHANNELS_ERROR_CODES,
  type ChannelsErrorCode,
  type ChannelsService,
} from './service';

export {
  createChannelsService,
  type ChannelsServiceDeps,
} from './implementation';
