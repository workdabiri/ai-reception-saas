// ===========================================================================
// AI Config Domain — Service Implementation
//
// Concrete AiConfigService backed by the injected repository.
//
// FAIL-CLOSED CONTRACT: this resolver always returns an ok(AiPolicy) and
// never surfaces an error to the caller. Every abnormal condition — missing
// server context, missing business, invalid/unknown mode, or a repository
// error — resolves to a DISABLED (Manual) policy. AI generation is enabled
// ONLY when the business is explicitly AI_ASSISTED. This is the B-R1 gate:
// AI is off by default and stays off unless deliberately turned on.
// ===========================================================================

import { ok } from '@/lib/result';
import type { AiConfigService, AiModeResolutionContext } from './service';
import type { AiConfigRepository } from './repository';
import {
  DEFAULT_BUSINESS_AI_MODE,
  isBusinessAiMode,
  type AiPolicy,
  type BusinessAiModeValue,
} from './types';

// ---------------------------------------------------------------------------
// Dependency types
// ---------------------------------------------------------------------------

/** Dependencies for the AI config service */
export interface AiConfigServiceDeps {
  readonly repository: AiConfigRepository;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a fail-closed (AI disabled) policy. */
function disabledPolicy(
  businessId: string,
  aiMode: BusinessAiModeValue = DEFAULT_BUSINESS_AI_MODE,
): AiPolicy {
  return { businessId, aiMode, aiGenerationEnabled: false };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAiConfigService(
  deps: AiConfigServiceDeps,
): AiConfigService {
  const { repository } = deps;

  return {
    async resolveAiPolicy(context: AiModeResolutionContext) {
      // Fail closed: no/invalid server-side tenant context -> AI disabled.
      // Only the server-resolved businessId is ever consulted; there is no
      // parameter through which a client could influence resolution.
      const businessId = context?.businessId;
      if (typeof businessId !== 'string' || businessId.length === 0) {
        return ok(disabledPolicy(''));
      }

      const result = await repository.findBusinessAiMode(businessId);

      // Fail closed on lookup error.
      if (!result.ok) {
        return ok(disabledPolicy(businessId));
      }

      const rawMode = result.data;

      // Fail closed on missing business or unknown/invalid mode.
      if (rawMode === null || !isBusinessAiMode(rawMode)) {
        return ok(disabledPolicy(businessId));
      }

      // The only enabled state: explicit AI_ASSISTED opt-in.
      const aiGenerationEnabled = rawMode === 'AI_ASSISTED';
      return ok({ businessId, aiMode: rawMode, aiGenerationEnabled });
    },
  };
}
