// ===========================================================================
// Channels Domain — Service Implementation
//
// Concrete ChannelsService backed by validation + injected repository + injected
// crypto (key generator + hasher) + content-free audit.
//
// SECURITY:
//  - Generates a high-entropy raw key, hashes it via the injected hasher, and
//    persists ONLY the hash + display-safe last-4. The raw key is returned to
//    the caller EXACTLY ONCE (create/rotate) and is never persisted, logged, or
//    re-returned.
//  - Rotation is IMMEDIATE — the old key is invalid at once (no grace window).
//  - `businessId` is always the server-resolved tenant id threaded to the
//    repository; the service never trusts a client tenant decision.
//  - Audit events are content-free: business id, binding id, and coarse counts
//    only — never the raw key, the hash, the last-4, or origin values.
// ===========================================================================

import { ok, err } from '@/lib/result';
import type { ActionResult } from '@/lib/result';
import type { AuditService } from '@/domains/audit/service';
import type { ChannelsService } from './service';
import type { ChannelsRepository } from './repository';
import type {
  WebChatChannelBinding,
  WebChatBindingWithRawKey,
  WidgetKeyGenerator,
  WidgetKeyHasher,
} from './types';
import {
  createWebChatBindingServiceSchema,
  listWebChatBindingsSchema,
  findWebChatBindingSchema,
  rotateWebChatBindingKeySchema,
  revokeWebChatBindingSchema,
} from './validation';

// ---------------------------------------------------------------------------
// Dependency types
// ---------------------------------------------------------------------------

/** Dependencies for the Channels service. */
export interface ChannelsServiceDeps {
  readonly repository: ChannelsRepository;
  /** Content-free audit on create/rotate/revoke. */
  readonly audit: Pick<AuditService, 'createAuditEvent'>;
  /** Injected widget-key generator (no hardcoded crypto / module-load secret). */
  readonly keyGenerator: WidgetKeyGenerator;
  /** Injected widget-key hasher (HMAC/peppered; fail-closed default in prod). */
  readonly hasher: WidgetKeyHasher;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVALID_INPUT_CODE = 'INVALID_CHANNELS_INPUT';
const INVALID_INPUT_MSG = 'Invalid channels input';
const NOT_FOUND_CODE = 'CHANNELS_BINDING_NOT_FOUND';
const NOT_FOUND_MSG = 'Web-chat channel binding not found';
const KEYGEN_FAILED_CODE = 'CHANNELS_KEY_GENERATION_FAILED';
const KEYGEN_FAILED_MSG = 'Failed to generate or hash the widget key';

// Audit action names (content-free).
const AUDIT_CREATED = 'channel.web_chat_binding.created';
const AUDIT_ROTATED = 'channel.web_chat_binding.key_rotated';
const AUDIT_REVOKED = 'channel.web_chat_binding.revoked';
const AUDIT_TARGET = 'web_chat_channel_binding';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates a concrete ChannelsService with validation + injected deps. */
export function createChannelsService(
  deps: ChannelsServiceDeps,
): ChannelsService {
  const { repository, audit, keyGenerator, hasher } = deps;

  /**
   * Best-effort, content-free audit. A failed audit must never break the
   * operation (mirrors the project's fire-and-forget audit convention).
   */
  async function safeAudit(input: {
    businessId: string;
    action: string;
    targetId: string;
    actorUserId?: string | null;
    metadata?: Record<string, number | string | null>;
  }): Promise<void> {
    try {
      await audit.createAuditEvent({
        businessId: input.businessId,
        actorType: input.actorUserId ? 'USER' : 'SYSTEM',
        actorUserId: input.actorUserId ?? undefined,
        action: input.action,
        targetType: AUDIT_TARGET,
        targetId: input.targetId,
        result: 'SUCCESS',
        metadata: input.metadata,
      });
    } catch {
      // Swallow — auditing is best-effort and never blocks the response.
    }
  }

  /**
   * Generates a raw key + computes its keyed hash. Wrapped so a misconfigured
   * (fail-closed) hasher surfaces as a clean error, never an unhandled throw.
   */
  function mintKey():
    | { ok: true; rawKey: string; last4: string; hash: string }
    | { ok: false } {
    try {
      const { rawKey, last4 } = keyGenerator.generate();
      const hash = hasher.hash(rawKey);
      return { ok: true, rawKey, last4, hash };
    } catch {
      return { ok: false };
    }
  }

  return {
    async createWebChatBinding(
      input,
    ): Promise<ActionResult<WebChatBindingWithRawKey>> {
      const parsed = createWebChatBindingServiceSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }

      const minted = mintKey();
      if (!minted.ok) {
        return err(KEYGEN_FAILED_CODE, KEYGEN_FAILED_MSG);
      }

      const created = await repository.createBinding({
        businessId: parsed.data.businessId,
        label: parsed.data.label,
        allowedOrigins: parsed.data.allowedOrigins,
        widgetKeyHash: minted.hash,
        widgetKeyLast4: minted.last4,
        createdByUserId: parsed.data.createdByUserId ?? null,
      });
      if (!created.ok) return created;

      await safeAudit({
        businessId: created.data.businessId,
        action: AUDIT_CREATED,
        targetId: created.data.id,
        actorUserId: parsed.data.createdByUserId ?? null,
        metadata: {
          status: created.data.status,
          allowedOriginCount: created.data.allowedOrigins.length,
        },
      });

      // Raw key surfaced EXACTLY ONCE here.
      return ok({ binding: created.data, rawWidgetKey: minted.rawKey });
    },

    async listWebChatBindings(input) {
      const parsed = listWebChatBindingsSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      return repository.listBindings(parsed.data.businessId, parsed.data.limit);
    },

    async findWebChatBinding(
      input,
    ): Promise<ActionResult<WebChatChannelBinding>> {
      const parsed = findWebChatBindingSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      const found = await repository.findBindingById(
        parsed.data.bindingId,
        parsed.data.businessId,
      );
      if (!found.ok) return found;
      if (!found.data) return err(NOT_FOUND_CODE, NOT_FOUND_MSG);
      return ok(found.data);
    },

    async rotateWebChatBindingKey(
      input,
    ): Promise<ActionResult<WebChatBindingWithRawKey>> {
      const parsed = rotateWebChatBindingKeySchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }

      const minted = mintKey();
      if (!minted.ok) {
        return err(KEYGEN_FAILED_CODE, KEYGEN_FAILED_MSG);
      }

      const rotated = await repository.rotateKey(
        parsed.data.bindingId,
        parsed.data.businessId,
        minted.hash,
        minted.last4,
      );
      if (!rotated.ok) return rotated;

      await safeAudit({
        businessId: rotated.data.businessId,
        action: AUDIT_ROTATED,
        targetId: rotated.data.id,
        metadata: { status: rotated.data.status },
      });

      // New raw key surfaced EXACTLY ONCE here.
      return ok({ binding: rotated.data, rawWidgetKey: minted.rawKey });
    },

    async revokeWebChatBinding(
      input,
    ): Promise<ActionResult<WebChatChannelBinding>> {
      const parsed = revokeWebChatBindingSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }

      const revoked = await repository.revokeBinding(
        parsed.data.bindingId,
        parsed.data.businessId,
        parsed.data.revokedByUserId,
      );
      if (!revoked.ok) return revoked;

      await safeAudit({
        businessId: revoked.data.businessId,
        action: AUDIT_REVOKED,
        targetId: revoked.data.id,
        actorUserId: parsed.data.revokedByUserId,
        metadata: { status: revoked.data.status },
      });

      return ok(revoked.data);
    },
  };
}
