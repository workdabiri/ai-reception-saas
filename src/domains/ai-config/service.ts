// ===========================================================================
// AI Config Domain — Service Interface
//
// Server-side resolver for per-business AI policy (B-R1).
// No implementation — interface definitions only.
// ===========================================================================

import type { ActionResult } from '@/lib/result';
import type { AiPolicy } from './types';

// ---------------------------------------------------------------------------
// Resolution context
// ---------------------------------------------------------------------------

/**
 * The server-resolved tenant context used to resolve AI policy.
 *
 * SECURITY: callers MUST pass the server-side tenant request context
 * (`TenantRequestContext`), whose `businessId` was resolved from the
 * authenticated session — NEVER a client-supplied businessId. The resolver
 * reads `businessId` from here and nowhere else, so it cannot be tricked by
 * client input. `TenantRequestContext` structurally satisfies this shape.
 */
export interface AiModeResolutionContext {
  readonly businessId: string;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/** Resolves the AI policy (mode + enablement) for the current business */
export interface AiConfigService {
  /**
   * Resolves the AI policy for the business in the given server-side context.
   *
   * Fails CLOSED by construction: it always returns a policy, and
   * `aiGenerationEnabled` is true only when the business is explicitly
   * AI_ASSISTED. Missing business, invalid/unknown mode, missing context, or
   * a lookup error all resolve to a disabled (Manual) policy.
   */
  resolveAiPolicy(
    context: AiModeResolutionContext,
  ): Promise<ActionResult<AiPolicy>>;
}
