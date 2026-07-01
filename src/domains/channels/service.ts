// ===========================================================================
// Channels Domain — Service Interface
//
// Server-side boundary for the web-chat channel binding (Area C, P12-B).
// No implementation — interface definitions only.
//
// SECURITY: every method is tenant-scoped by a server-resolved `businessId`.
// Callers MUST pass `businessId` from the tenant request context — never a
// client-supplied value. The raw widget key is returned EXACTLY ONCE (on create
// and rotate) and is never persisted, re-returned, or logged. This service
// stores binding/config only: it calls no provider and has no send path.
// ===========================================================================

import type { ActionResult } from '@/lib/result';
import type {
  WebChatChannelBinding,
  WebChatBindingWithRawKey,
  CreateWebChatBindingInput,
  ListWebChatBindingsInput,
  FindWebChatBindingInput,
  RotateWebChatBindingKeyInput,
  RevokeWebChatBindingInput,
} from './types';

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/** Channels service error code constants */
export const CHANNELS_ERROR_CODES = [
  'INVALID_CHANNELS_INPUT',
  'CHANNELS_BINDING_NOT_FOUND',
  'CHANNELS_BINDING_REVOKED',
  'CHANNELS_INVALID_ORIGIN',
  'CHANNELS_KEY_GENERATION_FAILED',
  'CHANNELS_REPOSITORY_ERROR',
] as const;

/** Channels service error code type */
export type ChannelsErrorCode = (typeof CHANNELS_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/** Service boundary for web-chat channel binding operations. */
export interface ChannelsService {
  /**
   * Creates a web-chat channel binding (ACTIVE). Generates a raw widget key,
   * persists only its keyed hash + display-safe last-4, and returns the raw key
   * EXACTLY ONCE in `rawWidgetKey`.
   */
  createWebChatBinding(
    input: CreateWebChatBindingInput,
  ): Promise<ActionResult<WebChatBindingWithRawKey>>;

  /** Lists a business's bindings (read DTOs — no secret/hash material). */
  listWebChatBindings(
    input: ListWebChatBindingsInput,
  ): Promise<ActionResult<readonly WebChatChannelBinding[]>>;

  /** Fetches a single binding by id, scoped by `businessId`. */
  findWebChatBinding(
    input: FindWebChatBindingInput,
  ): Promise<ActionResult<WebChatChannelBinding>>;

  /**
   * Rotates a binding's widget key (IMMEDIATE — old key invalid at once).
   * Returns the new raw key EXACTLY ONCE in `rawWidgetKey`.
   */
  rotateWebChatBindingKey(
    input: RotateWebChatBindingKeyInput,
  ): Promise<ActionResult<WebChatBindingWithRawKey>>;

  /** Revokes a binding (ACTIVE → REVOKED, terminal). Scoped by `businessId`. */
  revokeWebChatBinding(
    input: RevokeWebChatBindingInput,
  ): Promise<ActionResult<WebChatChannelBinding>>;
}
