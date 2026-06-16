// ===========================================================================
// AI Runtime Domain — AI Provider Boundary (B-R4)
//
// The provider SEAM: an interface every AI text provider implements. Runtime
// and domain logic depend ONLY on this interface — never on a vendor client
// library — so a real provider can later be added (B-H3) behind the same
// boundary with no change to domain logic.
//
// B-R4 ships only this interface plus a deterministic fake provider
// (`createFakeAiProvider`). It introduces NO real provider, NO network
// request, NO external configuration, NO prompt construction, and NO
// customer / conversation / message access.
// ===========================================================================

import type { ActionResult } from '@/lib/result';
import type {
  AiProviderGenerateTextRequest,
  AiProviderGenerateTextResult,
} from './types';

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * An AI text-generation provider.
 *
 * Implementations MUST fail closed on an invalid request (returning an
 * ActionResult error, never throwing for expected validation failures) and
 * MUST NOT perform any tenant data access: they receive a fully-formed,
 * caller-supplied request and return generated text. A provider never sends —
 * it only returns generated text for downstream human review.
 */
export interface AiProvider {
  /** Stable identifier for the provider implementation (for audit metadata). */
  readonly providerId: string;
  /** Stable identifier for the model the provider generates with. */
  readonly modelId: string;
  /**
   * Generates text for the given request.
   *
   * Returns an ActionResult: `ok` with generated text + metadata, or an error
   * (one of `AI_PROVIDER_ERROR_CODES`) when the request is invalid.
   */
  generateText(
    request: AiProviderGenerateTextRequest,
  ): Promise<ActionResult<AiProviderGenerateTextResult>>;
}

// ---------------------------------------------------------------------------
// Provider factory type
// ---------------------------------------------------------------------------

/**
 * A factory that constructs an `AiProvider`. This documents the seam through
 * which a provider is created; B-R4 builds no vendor selection on top of it.
 */
export type AiProviderFactory = () => AiProvider;
