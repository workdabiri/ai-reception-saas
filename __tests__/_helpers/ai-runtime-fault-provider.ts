// ===========================================================================
// Test Helper — Deterministic Fault-Injecting AI Provider (Area B, test-only)
//
// A test-only `AiProvider` implementation that models OPERATIONAL provider
// failures (timeout / rate-limit / unavailable / content-filtered / unknown)
// that a real provider could raise AFTER a request is otherwise well-formed.
//
// It exists so the AI runtime's fail-closed result contract and the B-R6 audit
// FAILED path can be exercised without a real provider, without spend, and
// without a network/SDK/env dependency. It complements (does not replace) the
// production `createFakeAiProvider`, which only ever SUCCEEDS or returns a
// request-VALIDATION error — it cannot simulate an operational failure.
//
// GUARANTEES (enforced by construction):
//   - Returns the operational failure through the existing `ActionResult`
//     `err(...)` contract. It NEVER throws and NEVER returns generated text.
//   - The error message is a fixed, generic, PII-free string. It NEVER reads
//     or echoes the request, the prompt, or any tenant content (the request
//     parameter is intentionally unused).
//   - No network. No vendor SDK. No env / credential read. No randomness. No
//     clock. No customer / conversation / message access. Same scenario ->
//     same (code, message) across instances and calls (fully deterministic).
//
// SCOPE: this is a TEST helper. It introduces NO production error taxonomy
// (`src/domains/ai-runtime/types.ts` is intentionally untouched) and approves
// no real provider. Real-provider production AI-assisted go-live remains
// NOT YET APPROVED.
// ===========================================================================

import { err, type ActionResult } from '@/lib/result';
import type {
  AiProvider,
  AiProviderGenerateTextRequest,
  AiProviderGenerateTextResult,
} from '@/domains/ai-runtime';

// ---------------------------------------------------------------------------
// Operational fault taxonomy (test-only; vendor-neutral)
// ---------------------------------------------------------------------------

/**
 * The vendor-neutral OPERATIONAL failure scenarios a real provider could raise
 * after accepting an otherwise well-formed request. These are distinct from the
 * production request-VALIDATION codes (`AI_PROVIDER_ERROR_CODES`).
 */
export const FAULT_SCENARIOS = [
  'timeout',
  'rate_limited',
  'unavailable',
  'content_filtered',
  'unknown',
] as const;

/** A single operational fault scenario. */
export type FaultScenario = (typeof FAULT_SCENARIOS)[number];

/** The audit/result-facing spec for an operational fault scenario. */
export interface FaultScenarioSpec {
  /** Stable, bounded, audit-safe error code: `[A-Z0-9_]`, no PII, no content. */
  readonly code: string;
  /** Fixed, generic, PII-free message — never echoes the request or prompt. */
  readonly message: string;
  /**
   * Retry posture for a future real adapter. Transient faults are retryable
   * (with backoff); a content-policy block and an unknown error fail closed and
   * are NOT retried automatically.
   */
  readonly retryable: boolean;
}

/**
 * The canonical mapping from operational scenario to its fail-closed spec.
 * Codes are vendor-neutral and audit-safe; messages carry no request content.
 */
export const FAULT_SCENARIO_SPECS: Readonly<
  Record<FaultScenario, FaultScenarioSpec>
> = {
  timeout: {
    code: 'AI_PROVIDER_TIMEOUT',
    message: 'AI provider request timed out before completion',
    retryable: true,
  },
  rate_limited: {
    code: 'AI_PROVIDER_RATE_LIMITED',
    message: 'AI provider rate limit exceeded',
    retryable: true,
  },
  unavailable: {
    code: 'AI_PROVIDER_UNAVAILABLE',
    message: 'AI provider is temporarily unavailable',
    retryable: true,
  },
  content_filtered: {
    code: 'AI_PROVIDER_CONTENT_FILTERED',
    message: 'AI provider blocked the request by content policy',
    retryable: false,
  },
  unknown: {
    code: 'AI_PROVIDER_UNKNOWN_ERROR',
    message: 'AI provider failed with an unknown error',
    retryable: false,
  },
};

/** The operational fault error codes, in scenario order. */
export const FAULT_PROVIDER_ERROR_CODES: readonly string[] = FAULT_SCENARIOS.map(
  (scenario) => FAULT_SCENARIO_SPECS[scenario].code,
);

/** Default identifiers for the fault provider (overridable via deps). */
export const DEFAULT_FAULT_PROVIDER_ID = 'fault';
export const DEFAULT_FAULT_MODEL_ID = 'fault-operational-v1';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Dependencies for the fault provider. `scenario` selects the failure. */
export interface FaultAiProviderDeps {
  readonly scenario: FaultScenario;
  readonly providerId?: string;
  readonly modelId?: string;
}

/**
 * Creates a deterministic `AiProvider` that always fails with the configured
 * operational scenario, returning a fail-closed `ActionResult` error. It never
 * throws, never returns generated text, and never reads request content.
 */
export function createFaultAiProvider(deps: FaultAiProviderDeps): AiProvider {
  const spec = FAULT_SCENARIO_SPECS[deps.scenario];
  const providerId = deps.providerId ?? DEFAULT_FAULT_PROVIDER_ID;
  const modelId = deps.modelId ?? DEFAULT_FAULT_MODEL_ID;

  return {
    providerId,
    modelId,

    async generateText(
      request: AiProviderGenerateTextRequest,
    ): Promise<ActionResult<AiProviderGenerateTextResult>> {
      // The request is intentionally NOT read — `void` documents that we accept
      // it (to satisfy the interface) but never inspect its content, so the
      // error can carry only the fixed, generic, PII-free scenario code/message.
      void request;
      // Operational failure: fail closed through the ActionResult contract.
      return err(spec.code, spec.message);
    },
  };
}
