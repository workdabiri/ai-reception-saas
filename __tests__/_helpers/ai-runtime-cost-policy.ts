// ===========================================================================
// Test Helper — Pure AI-Runtime Cost-Guard Policy (Area B §6, test-only)
//
// A test-only PURE decision function for the Area B §6 "token / usage cost
// guard" gate. Given a per-business cost limit and a single usage figure (token
// counts in the existing `AiProviderUsage` shape), it returns a fail-closed
// allow/deny decision through the existing `ActionResult` contract.
//
// It exists so the cost-guard DECISION CONTRACT can be proven WITHOUT a real
// provider, without spend, without persistence, and without a route caller. It
// is the stateless predicate a FUTURE caller would invoke after summing the
// business's persisted accumulated usage with this request's projected usage —
// the accumulation/persistence step is OWNER-GATED / DEFERRED (no DB counters,
// no schema) and lives outside this helper.
//
// GUARANTEES (enforced by construction):
//   - Pure & deterministic: output depends ONLY on the two arguments. Same
//     inputs -> identical result. It mutates neither argument.
//   - Fail-closed: a missing/invalid limit, a missing/invalid usage, or a usage
//     that exceeds the limit all return an `ActionResult` error (deny). A
//     "no budget configured" state is treated as DENY, never as "unlimited".
//   - Metadata-only: it reads ONLY numeric token counts. It never touches a
//     prompt, generated text, a customer/conversation/message record, or any
//     tenant content.
//   - No network. No vendor SDK. No environment / credential read. No
//     randomness. No clock. No database.
//
// SCOPE: this is a TEST helper. It introduces NO production cost taxonomy
// (`src/domains/ai-runtime/types.ts` is intentionally untouched) and approves no
// real provider, no metering, no persistence, and no route enforcement.
// Real-provider production AI-assisted go-live remains NOT YET APPROVED.
// ===========================================================================

import { ok, err, type ActionResult } from '@/lib/result';
import type { AiProviderUsage } from '@/domains/ai-runtime';

// ---------------------------------------------------------------------------
// Error codes (test-only; vendor-neutral, bounded, audit-safe `[A-Z0-9_]`)
// ---------------------------------------------------------------------------

/**
 * Fail-closed cost-policy denial codes. Each is stable, bounded, and audit-safe
 * (`[A-Z0-9_]`, no PII, no content) so a future audit `FAILED` row could record
 * it directly. They are deliberately DISJOINT from the production provider
 * validation codes (`AI_PROVIDER_ERROR_CODES`).
 */
export const AI_RUNTIME_COST_POLICY_ERROR_CODES = [
  'AI_COST_BUDGET_MISSING',
  'AI_COST_BUDGET_INVALID',
  'AI_COST_USAGE_MISSING',
  'AI_COST_USAGE_INVALID',
  'AI_COST_BUDGET_EXCEEDED',
] as const;

/** A fail-closed cost-policy denial code. */
export type AiRuntimeCostPolicyErrorCode =
  (typeof AI_RUNTIME_COST_POLICY_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Limit (per-business budget) shape
// ---------------------------------------------------------------------------

/**
 * A per-business cost limit (budget) for one billing/usage window.
 *
 * `maxTotalTokens` is the primary token ceiling and is REQUIRED. The optional
 * sub-ceilings narrow the decision further. The optional spend dimension is
 * expressed in SYNTHETIC cost units: `costPerToken` converts tokens to spend so
 * `maxSpend` can gate it — both must be supplied together or neither (a spend
 * ceiling without a rate, or a rate without a ceiling, is rejected as invalid).
 *
 * NOTE: the limit WINDOW (per-day / per-month / rolling) and where this object
 * is PERSISTED are OWNER-GATED / DEFERRED product decisions — this helper is a
 * stateless predicate and stores nothing. It receives an already-resolved limit
 * and an already-summed usage figure.
 */
export interface AiRuntimeCostLimit {
  /**
   * Hard ceiling on total tokens for the window. Required; finite, non-negative
   * INTEGER (tokens are whole units — a decimal fails closed).
   */
  readonly maxTotalTokens: number;
  /** Optional sub-ceiling on prompt tokens (finite, non-negative integer). */
  readonly maxPromptTokens?: number;
  /** Optional sub-ceiling on completion tokens (finite, non-negative integer). */
  readonly maxCompletionTokens?: number;
  /**
   * Optional spend ceiling, in synthetic cost units (requires costPerToken).
   * May be a non-negative decimal; `maxSpend = 0` is valid, but then usage is
   * allowed only when the evaluated spend is 0.
   */
  readonly maxSpend?: number;
  /**
   * Synthetic per-token cost used to derive spend (requires maxSpend). When
   * present it must be STRICTLY greater than 0 — a zero (or negative) rate would
   * make a configured spend guard over-permissive, so it fails closed.
   */
  readonly costPerToken?: number;
}

// ---------------------------------------------------------------------------
// Allowance (the success payload)
// ---------------------------------------------------------------------------

/**
 * The decision returned when usage is within budget. Carries ONLY derived
 * numeric metadata — no prompt, no text, no tenant content.
 */
export interface AiRuntimeCostAllowance {
  readonly allowed: true;
  readonly evaluatedPromptTokens: number;
  readonly evaluatedCompletionTokens: number;
  readonly evaluatedTotalTokens: number;
  readonly remainingTotalTokens: number;
  /** Derived spend, or null when no spend dimension is configured. */
  readonly evaluatedSpend: number | null;
  /** Remaining spend headroom, or null when no spend dimension is configured. */
  readonly remainingSpend: number | null;
}

// ---------------------------------------------------------------------------
// Validation primitives (pure)
// ---------------------------------------------------------------------------

/**
 * True only for a finite, non-negative INTEGER (rejects NaN / Infinity /
 * decimals / non-numbers). Used for TOKEN counts and TOKEN ceilings — tokens
 * are whole units, so a fractional token count cannot be trusted and fails
 * closed.
 */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** True only for a finite, non-negative number (decimals allowed). */
function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** True only for a finite number STRICTLY greater than 0. */
function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** True for a plain non-null, non-array object. */
function isObjectLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// The policy (pure, fail-closed)
// ---------------------------------------------------------------------------

/**
 * Evaluates a single usage figure against a per-business cost limit.
 *
 * Fail-closed order (most fundamental first), so one broken input yields a
 * predictable code:
 *   1. limit missing            -> AI_COST_BUDGET_MISSING
 *   2. limit values invalid     -> AI_COST_BUDGET_INVALID
 *   3. usage missing            -> AI_COST_USAGE_MISSING
 *   4. usage values invalid     -> AI_COST_USAGE_INVALID
 *   5. usage exceeds the limit  -> AI_COST_BUDGET_EXCEEDED
 * Otherwise -> ok(allowance).
 *
 * Usage AT the limit is ALLOWED (deny is strict `>`). A "no budget configured"
 * state (missing limit) is DENY, never "unlimited".
 */
export function evaluateAiRuntimeCostPolicy(
  limit: AiRuntimeCostLimit | null | undefined,
  usage: AiProviderUsage | null | undefined,
): ActionResult<AiRuntimeCostAllowance> {
  // 1. Limit must be present. No configured budget => fail closed (deny),
  //    never treated as "unlimited spend".
  if (!isObjectLike(limit)) {
    return err(
      'AI_COST_BUDGET_MISSING',
      'A per-business cost limit is required; none was configured',
    );
  }

  // 2. Limit values must be valid. TOKEN ceilings are finite, non-negative
  //    INTEGERS (decimals are rejected). SPEND fields are numeric: maxSpend may
  //    be a non-negative decimal (0 is allowed), but costPerToken — when present
  //    — must be STRICTLY > 0, since a zero (or negative) rate makes a configured
  //    spend guard over-permissive and must fail closed.
  if (!isNonNegativeInteger(limit.maxTotalTokens)) {
    return err(
      'AI_COST_BUDGET_INVALID',
      'maxTotalTokens must be a finite, non-negative integer',
    );
  }
  for (const optionalTokenCeiling of [
    limit.maxPromptTokens,
    limit.maxCompletionTokens,
  ]) {
    if (
      optionalTokenCeiling !== undefined &&
      !isNonNegativeInteger(optionalTokenCeiling)
    ) {
      return err(
        'AI_COST_BUDGET_INVALID',
        'Token ceilings must be finite, non-negative integers when present',
      );
    }
  }
  if (
    limit.maxSpend !== undefined &&
    !isNonNegativeFiniteNumber(limit.maxSpend)
  ) {
    return err(
      'AI_COST_BUDGET_INVALID',
      'maxSpend must be a finite, non-negative number when present',
    );
  }
  if (
    limit.costPerToken !== undefined &&
    !isPositiveFiniteNumber(limit.costPerToken)
  ) {
    return err(
      'AI_COST_BUDGET_INVALID',
      'costPerToken must be a finite number strictly greater than 0 when present',
    );
  }
  // The spend dimension is all-or-nothing: a ceiling needs a rate, and a rate
  // is meaningless without a ceiling.
  const hasSpendCeiling = limit.maxSpend !== undefined;
  const hasTokenRate = limit.costPerToken !== undefined;
  if (hasSpendCeiling !== hasTokenRate) {
    return err(
      'AI_COST_BUDGET_INVALID',
      'A spend limit requires both maxSpend and costPerToken',
    );
  }

  // 3. Usage must be present.
  if (!isObjectLike(usage)) {
    return err(
      'AI_COST_USAGE_MISSING',
      'A usage figure is required to evaluate the cost limit',
    );
  }

  // 4. Usage values must be valid, and the total must be internally consistent
  //    (totalTokens === promptTokens + completionTokens — the invariant the
  //    provider boundary's `AiProviderUsage` already satisfies). Inconsistent
  //    counts cannot be trusted, so they fail closed.
  const { promptTokens, completionTokens, totalTokens } = usage;
  if (
    !isNonNegativeInteger(promptTokens) ||
    !isNonNegativeInteger(completionTokens) ||
    !isNonNegativeInteger(totalTokens)
  ) {
    return err(
      'AI_COST_USAGE_INVALID',
      'Usage token counts must be finite, non-negative integers',
    );
  }
  if (totalTokens !== promptTokens + completionTokens) {
    return err(
      'AI_COST_USAGE_INVALID',
      'totalTokens must equal promptTokens + completionTokens',
    );
  }

  // 5. Enforce ceilings. Usage AT a ceiling is allowed; only strictly OVER
  //    denies. Each dimension is fail-closed on breach.
  if (totalTokens > limit.maxTotalTokens) {
    return err(
      'AI_COST_BUDGET_EXCEEDED',
      'Usage exceeds the per-business total-token limit',
    );
  }
  if (
    limit.maxPromptTokens !== undefined &&
    promptTokens > limit.maxPromptTokens
  ) {
    return err(
      'AI_COST_BUDGET_EXCEEDED',
      'Usage exceeds the per-business prompt-token limit',
    );
  }
  if (
    limit.maxCompletionTokens !== undefined &&
    completionTokens > limit.maxCompletionTokens
  ) {
    return err(
      'AI_COST_BUDGET_EXCEEDED',
      'Usage exceeds the per-business completion-token limit',
    );
  }

  let evaluatedSpend: number | null = null;
  let remainingSpend: number | null = null;
  if (limit.maxSpend !== undefined && limit.costPerToken !== undefined) {
    evaluatedSpend = totalTokens * limit.costPerToken;
    if (evaluatedSpend > limit.maxSpend) {
      return err(
        'AI_COST_BUDGET_EXCEEDED',
        'Usage exceeds the per-business spend limit',
      );
    }
    remainingSpend = limit.maxSpend - evaluatedSpend;
  }

  return ok({
    allowed: true,
    evaluatedPromptTokens: promptTokens,
    evaluatedCompletionTokens: completionTokens,
    evaluatedTotalTokens: totalTokens,
    remainingTotalTokens: limit.maxTotalTokens - totalTokens,
    evaluatedSpend,
    remainingSpend,
  });
}
