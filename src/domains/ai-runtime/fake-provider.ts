// ===========================================================================
// AI Runtime Domain — Deterministic Fake AI Provider (B-R4)
//
// A self-contained `AiProvider` implementation that is fully DETERMINISTIC. It
// exists so the AI runtime is testable without a live model and without spend,
// and so every later test stays reproducible.
//
// GUARANTEES (enforced by construction):
//   - No network request. No vendor client library. No external configuration.
//   - Uses no randomness. Reads nothing global.
//   - Same request -> same output (text, usage, requestId). `createdAt` is
//     deterministic when a clock is injected.
//   - The response does NOT echo the prompt: it carries only a deterministic,
//     non-content identifier (a hash of the request) instead of request
//     content. That identifier provides NO security guarantees and must not be
//     relied on to protect secrets.
//   - Fails CLOSED on invalid input, returning an ActionResult error.
//
// It builds NO prompt and performs NO tenant data access: it receives a
// caller-supplied request and returns a stable placeholder response.
// ===========================================================================

import { z } from 'zod';
import { ok, err, type ActionResult } from '@/lib/result';
import type { AiProvider } from './provider';
import {
  isAiProviderOperation,
  type AiProviderGenerateTextRequest,
  type AiProviderGenerateTextResult,
  type AiProviderUsage,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default provider identifier for the fake provider (overridable via deps). */
export const DEFAULT_FAKE_PROVIDER_ID = 'fake';

/** Default model identifier for the fake provider (overridable via deps). */
export const DEFAULT_FAKE_MODEL_ID = 'fake-deterministic-v1';

/**
 * Maximum accepted prompt length (characters). A larger prompt fails closed
 * with AI_PROVIDER_PROMPT_TOO_LARGE rather than being silently processed.
 */
export const FAKE_AI_PROVIDER_MAX_PROMPT_CHARS = 100_000;

/** Stable prefix of the fake response. The hash (not the prompt) follows it. */
export const FAKE_AI_PROVIDER_RESPONSE_PREFIX = 'FAKE_AI_PROVIDER_RESPONSE';

const INVALID_REQUEST_CODE = 'AI_PROVIDER_INVALID_REQUEST';
const INVALID_REQUEST_MSG = 'A valid generation request is required';
const UNSUPPORTED_OPERATION_CODE = 'AI_PROVIDER_UNSUPPORTED_OPERATION';
const UNSUPPORTED_OPERATION_MSG = 'Unsupported AI provider operation';
const INVALID_BUSINESS_ID_CODE = 'AI_PROVIDER_INVALID_BUSINESS_ID';
const INVALID_BUSINESS_ID_MSG =
  'A valid server-resolved businessId is required';
const INVALID_PROMPT_CODE = 'AI_PROVIDER_INVALID_PROMPT';
const INVALID_PROMPT_MSG = 'A non-empty, non-whitespace prompt is required';
const PROMPT_TOO_LARGE_CODE = 'AI_PROVIDER_PROMPT_TOO_LARGE';
const PROMPT_TOO_LARGE_MSG = 'Prompt exceeds the maximum accepted length';

/** Upper bound for the optional context fingerprint. */
const MAX_CONTEXT_HASH_CHARS = 256;

/** Metadata bounds — the boundary advertises a SMALL bag; enforce it. */
export const MAX_METADATA_KEYS = 50;
export const MAX_METADATA_KEY_CHARS = 128;
export const MAX_METADATA_VALUE_CHARS = 1000;

/** Deterministic chars-per-token divisor for the fake usage estimate. */
const CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies for the fake provider. All optional.
 *
 * `now` is the injectable clock — inject a fixed clock in tests for a
 * deterministic `createdAt`. `providerId` / `modelId` override the defaults.
 */
export interface FakeAiProviderDeps {
  readonly now?: () => Date;
  readonly providerId?: string;
  readonly modelId?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const businessIdSchema = z.string().uuid();

/**
 * Validates the optional metadata bag against explicit size bounds. Accepts
 * ONLY a PLAIN object (an object literal or `Object.create(null)`) whose keys
 * and string values are within the configured limits; everything else
 * (non-object, array, Date / class instance, non-string value, blank/oversized
 * key, oversized value, too many keys) is rejected so the bag stays small.
 */
function isValidMetadata(metadata: unknown): metadata is Record<string, string> {
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    return false;
  }
  // Plain objects only: object literals (Object.prototype) or null-prototype
  // bags. Reject Date, class instances, and other exotic objects.
  const proto = Object.getPrototypeOf(metadata);
  if (proto !== Object.prototype && proto !== null) {
    return false;
  }
  const entries = Object.entries(metadata as Record<string, unknown>);
  if (entries.length > MAX_METADATA_KEYS) {
    return false;
  }
  for (const [key, value] of entries) {
    // Reject blank (empty or whitespace-only) keys; still cap the raw length.
    if (key.trim().length === 0 || key.length > MAX_METADATA_KEY_CHARS) {
      return false;
    }
    if (typeof value !== 'string' || value.length > MAX_METADATA_VALUE_CHARS) {
      return false;
    }
  }
  return true;
}

/** A fully-validated request (narrowed from the public input shape). */
interface ValidatedRequest {
  readonly operation: AiProviderGenerateTextRequest['operation'];
  readonly businessId: string;
  readonly prompt: string;
  readonly contextHash?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Validates a generation request, failing closed with a precise error code.
 * Checks run most-fundamental-first so a single broken field yields a
 * predictable code.
 */
function validateRequest(
  request: AiProviderGenerateTextRequest,
): ActionResult<ValidatedRequest> {
  if (request === null || typeof request !== 'object') {
    return err(INVALID_REQUEST_CODE, INVALID_REQUEST_MSG);
  }

  const { operation, businessId, prompt, contextHash, metadata } = request;

  if (!isAiProviderOperation(operation)) {
    return err(UNSUPPORTED_OPERATION_CODE, UNSUPPORTED_OPERATION_MSG);
  }

  // Empty and non-UUID businessId are both invalid tenant scope.
  if (!businessIdSchema.safeParse(businessId).success) {
    return err(INVALID_BUSINESS_ID_CODE, INVALID_BUSINESS_ID_MSG);
  }

  // A blank (empty or whitespace-only) prompt is invalid. The original prompt
  // content is preserved for hashing/generation — we never trim it.
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return err(INVALID_PROMPT_CODE, INVALID_PROMPT_MSG);
  }

  if (prompt.length > FAKE_AI_PROVIDER_MAX_PROMPT_CHARS) {
    return err(PROMPT_TOO_LARGE_CODE, PROMPT_TOO_LARGE_MSG);
  }

  if (contextHash !== undefined) {
    // Reject empty / whitespace-only fingerprints; still cap the raw length.
    if (
      typeof contextHash !== 'string' ||
      contextHash.trim().length === 0 ||
      contextHash.length > MAX_CONTEXT_HASH_CHARS
    ) {
      return err(INVALID_REQUEST_CODE, INVALID_REQUEST_MSG);
    }
  }

  if (metadata !== undefined && !isValidMetadata(metadata)) {
    return err(INVALID_REQUEST_CODE, INVALID_REQUEST_MSG);
  }

  return ok({ operation, businessId, prompt, contextHash, metadata });
}

// ---------------------------------------------------------------------------
// Deterministic helpers (pure: no clock, no randomness, no external state)
// ---------------------------------------------------------------------------

/**
 * A small, dependency-free, deterministic string hash. Two independently
 * seeded FNV-1a-style passes are widened to a fixed 16-char hex digest.
 *
 * This produces a DETERMINISTIC NON-CONTENT IDENTIFIER, not a secure hash. Its
 * only job is to make the fake response stable while not echoing the prompt.
 * It provides NO security guarantees and must not be relied on to protect
 * secrets. The same input always yields the same digest; it uses no
 * randomness, clock, or external state.
 */
function stableHashHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xc2b2ae35;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${hex1}${hex2}`;
}

/**
 * Builds an order-stable canonical key over the request inputs. metadata keys
 * are sorted so the digest is independent of property insertion order.
 */
function canonicalRequestKey(request: ValidatedRequest): string {
  const metadata = request.metadata ?? {};
  const metaPairs = Object.keys(metadata)
    .sort()
    .map((key) => `${key}=${metadata[key]}`)
    .join('&');
  return [
    `op:${request.operation}`,
    `biz:${request.businessId}`,
    `ctx:${request.contextHash ?? ''}`,
    `meta:${metaPairs}`,
    `prompt:${request.prompt}`,
  ].join('|');
}

/**
 * Deterministic, content-free token estimate (a fixed chars-per-token
 * heuristic — NOT a real tokenizer). Reveals only length, never content.
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the deterministic fake AI provider.
 *
 * The returned provider implements `AiProvider` and can be swapped for a real
 * provider with no change to domain logic.
 */
export function createFakeAiProvider(
  deps: FakeAiProviderDeps = {},
): AiProvider {
  const providerId = deps.providerId ?? DEFAULT_FAKE_PROVIDER_ID;
  const modelId = deps.modelId ?? DEFAULT_FAKE_MODEL_ID;
  const now = deps.now ?? (() => new Date());

  return {
    providerId,
    modelId,

    async generateText(request) {
      const validated = validateRequest(request);
      if (!validated.ok) {
        return err(validated.error.code, validated.error.message);
      }

      const req = validated.data;
      const digest = stableHashHex(canonicalRequestKey(req));

      // The response carries ONLY a deterministic, non-content digest instead
      // of the prompt text or any request content. (Not a security boundary.)
      const text = `[${FAKE_AI_PROVIDER_RESPONSE_PREFIX}:${digest}]`;

      const promptTokens = estimateTokens(req.prompt);
      const completionTokens = estimateTokens(text);
      const usage: AiProviderUsage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };

      const result: AiProviderGenerateTextResult = {
        text,
        providerId,
        modelId,
        finishReason: 'STOP',
        usage,
        createdAt: now().toISOString(),
        // Deterministic correlation id: a function of the request only, so the
        // same input always yields the same id (the fake's determinism
        // contract). A real provider supplies its own per-call id.
        requestId: `fake-${digest}`,
      };

      return ok(result);
    },
  };
}
