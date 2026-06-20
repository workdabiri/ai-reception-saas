// ===========================================================================
// Test Helper — Pure AI-Runtime Trust-Boundary Policy (Area B, test-only)
//
// A test-only PURE classifier + fail-closed decision function that converts the
// PR #130 prompt-injection / untrusted-input strategy
// (docs/audits/AREA-B-prompt-injection-untrusted-input-strategy.md §3/§4) into
// a test-provable contract for the CURRENT APPROVED SCOPE.
//
// It classifies a prompt-input by its DECLARED PROVENANCE (its `kind`) into one
// of three trust tiers, and decides whether that input may participate in prompt
// construction:
//
//   TRUSTED       — static system/task rules; verified, tenant-scoped business
//                   context; allowlisted verified-context fields.
//   SEMI_TRUSTED  — a bounded operator instruction; verified-context free text
//                   (value / sourceLabel). May shape style/focus, but may NOT
//                   override system rules, create definitive business claims,
//                   authorize sending, expose internals, or be promoted to
//                   verified context.
//   UNTRUSTED     — customer message text, conversation transcript, public-widget
//                   / user-submitted text, imported third-party text, any
//                   externally-derived user content. DENIED in the current scope.
//
// Trust is decided by PROVENANCE, never by inspecting content — scanning content
// to decide "trustedness" is exactly the foot-gun this boundary avoids. Anything
// unknown / ambiguous / malformed is treated as UNTRUSTED and DENIED
// (default-deny / fail-closed).
//
// GUARANTEES (enforced by construction):
//   - Pure & deterministic: output depends ONLY on the argument. Same input ->
//     identical result. It mutates no argument.
//   - Fail-closed: an unclassifiable input, an explicitly untrusted input, and a
//     semi-trusted input that over-reaches are all denied through the existing
//     `ActionResult` `err(...)` contract. Nothing is allowed by default.
//   - Provenance-only: it reads ONLY a declared `kind`, an optional bounded
//     `length`, and an optional list of requested capabilities. It never reads a
//     prompt, generated text, or any customer/conversation/message content.
//   - No network. No vendor SDK. No environment / credential read. No randomness.
//     No clock. No database.
//
// SCOPE: this is a TEST helper. It introduces NO production trust taxonomy
// (`src/domains/ai-runtime/types.ts` is intentionally untouched) and approves
// nothing. The prompt-injection / untrusted-input gate remains OPEN;
// customer-message-in-prompt remains STOP / future owner-gated; real-provider
// production AI-assisted go-live remains NOT YET APPROVED.
// ===========================================================================

import { ok, err, type ActionResult } from '@/lib/result';
import { MAX_OPERATOR_INSTRUCTION_CHARS } from '@/domains/ai-runtime';

// ---------------------------------------------------------------------------
// Trust tiers
// ---------------------------------------------------------------------------

/** The TRUSTED tier — authoritative; may back definitive claims and rules. */
export const TRUSTED = 'TRUSTED';
/** The SEMI_TRUSTED tier — may shape, never authorize/override/claim. */
export const SEMI_TRUSTED = 'SEMI_TRUSTED';
/** The UNTRUSTED tier — externally-derived; denied in the current scope. */
export const UNTRUSTED = 'UNTRUSTED';

/** The three trust tiers, most-trusted first. */
export const TRUST_TIERS = [TRUSTED, SEMI_TRUSTED, UNTRUSTED] as const;

/** A single trust tier. */
export type TrustTier = (typeof TRUST_TIERS)[number];

// ---------------------------------------------------------------------------
// Input provenance kinds -> tier mapping
// ---------------------------------------------------------------------------

/**
 * The recognized prompt-input provenance kinds. Trust is decided by which of
 * these a caller declares — NOT by inspecting the content. Anything not on this
 * list is treated as UNTRUSTED (default-deny).
 */
export const TRUST_INPUT_KINDS = [
  // TRUSTED
  'STATIC_SYSTEM_RULE',
  'STATIC_TASK_RULE',
  'VERIFIED_BUSINESS_CONTEXT',
  'ALLOWLISTED_CONTEXT_FIELD',
  // SEMI_TRUSTED
  'OPERATOR_INSTRUCTION',
  'VERIFIED_CONTEXT_FREE_TEXT',
  // UNTRUSTED
  'CUSTOMER_MESSAGE',
  'CONVERSATION_TRANSCRIPT',
  'PUBLIC_WIDGET_SUBMISSION',
  'IMPORTED_THIRD_PARTY_TEXT',
  'EXTERNAL_USER_CONTENT',
] as const;

/** A recognized prompt-input provenance kind. */
export type TrustInputKind = (typeof TRUST_INPUT_KINDS)[number];

/**
 * The canonical kind -> tier mapping. Frozen so a test cannot mutate it and so
 * the classification is a fixed, reviewable contract.
 */
export const TRUST_INPUT_KIND_TIER: Readonly<Record<TrustInputKind, TrustTier>> =
  Object.freeze({
    STATIC_SYSTEM_RULE: TRUSTED,
    STATIC_TASK_RULE: TRUSTED,
    VERIFIED_BUSINESS_CONTEXT: TRUSTED,
    ALLOWLISTED_CONTEXT_FIELD: TRUSTED,
    OPERATOR_INSTRUCTION: SEMI_TRUSTED,
    VERIFIED_CONTEXT_FREE_TEXT: SEMI_TRUSTED,
    CUSTOMER_MESSAGE: UNTRUSTED,
    CONVERSATION_TRANSCRIPT: UNTRUSTED,
    PUBLIC_WIDGET_SUBMISSION: UNTRUSTED,
    IMPORTED_THIRD_PARTY_TEXT: UNTRUSTED,
    EXTERNAL_USER_CONTENT: UNTRUSTED,
  });

// ---------------------------------------------------------------------------
// Privileged capabilities (none may be exercised by a non-TRUSTED input)
// ---------------------------------------------------------------------------

/**
 * Capabilities that ONLY a TRUSTED input may exercise. A SEMI_TRUSTED input that
 * requests any of these is an over-reach and is denied; an UNTRUSTED input is
 * denied outright regardless of what it requests.
 */
export const PRIVILEGED_CAPABILITIES = [
  'OVERRIDE_SYSTEM_RULES',
  'AUTHORIZE_SEND',
  'CREATE_DEFINITIVE_CLAIM',
  'EXPOSE_INTERNALS',
  'PROMOTE_TO_VERIFIED',
] as const;

/** A capability only a TRUSTED input may exercise. */
export type PrivilegedCapability = (typeof PRIVILEGED_CAPABILITIES)[number];

// ---------------------------------------------------------------------------
// Error codes (test-only; vendor-neutral, bounded, audit-safe `[A-Z0-9_]`)
// ---------------------------------------------------------------------------

/**
 * Fail-closed trust-boundary denial codes. Each is stable, bounded, and
 * audit-safe (`[A-Z0-9_]`, no PII, no content), so a future audit `FAILED` row
 * could record it directly. They are deliberately DISJOINT from the production
 * provider / runtime / prompt-builder / audit error-code taxonomies and from the
 * other test-only helper taxonomies (cost-policy, fault-provider).
 *
 * - AI_TRUST_INPUT_UNTRUSTED       = input is an explicitly UNTRUSTED provenance
 *   (customer message, transcript, widget/user-submitted, imported, external).
 * - AI_TRUST_INPUT_UNCLASSIFIED    = input could not be positively classified
 *   (missing/unknown kind, malformed, non-object) -> default-deny as UNTRUSTED.
 * - AI_TRUST_SEMITRUSTED_OVERREACH = a SEMI_TRUSTED input requested a privileged
 *   capability or exceeded its bound.
 */
export const AI_RUNTIME_TRUST_BOUNDARY_ERROR_CODES = [
  'AI_TRUST_INPUT_UNTRUSTED',
  'AI_TRUST_INPUT_UNCLASSIFIED',
  'AI_TRUST_SEMITRUSTED_OVERREACH',
] as const;

/** A fail-closed trust-boundary denial code. */
export type AiRuntimeTrustBoundaryErrorCode =
  (typeof AI_RUNTIME_TRUST_BOUNDARY_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Input / allowance shapes
// ---------------------------------------------------------------------------

/**
 * A prompt-input candidate. Deliberately provenance-first: the decision reads a
 * declared `kind`, never the content. `requests` declares which privileged
 * capabilities the input is attempting (used for over-reach detection); `length`
 * is the candidate's character length (used to bound a SEMI_TRUSTED instruction).
 * All fields are typed `unknown` so a malformed input fails closed, never throws.
 */
export interface TrustBoundaryInput {
  readonly kind?: unknown;
  readonly requests?: unknown;
  readonly length?: unknown;
}

/** The decision returned when an input may participate. Carries no content. */
export interface TrustBoundaryAllowance {
  readonly allowed: true;
  readonly tier: TrustTier;
}

// ---------------------------------------------------------------------------
// Validation primitives (pure)
// ---------------------------------------------------------------------------

/** True for a plain non-null, non-array object. */
function isObjectLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** True only for a finite, non-negative integer. */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Resolves the trust tier of an input plus whether it was POSITIVELY classified.
 * A non-object, a missing/non-string kind, or an unknown kind all resolve to the
 * UNTRUSTED tier with `classified: false` (default-deny). A recognized kind
 * resolves to its mapped tier with `classified: true`.
 */
function resolveTier(input: unknown): {
  readonly tier: TrustTier;
  readonly classified: boolean;
} {
  if (!isObjectLike(input)) {
    return { tier: UNTRUSTED, classified: false };
  }
  const { kind } = input;
  if (typeof kind !== 'string') {
    return { tier: UNTRUSTED, classified: false };
  }
  const tier = (TRUST_INPUT_KIND_TIER as Record<string, TrustTier | undefined>)[
    kind
  ];
  if (tier === undefined) {
    return { tier: UNTRUSTED, classified: false };
  }
  return { tier, classified: true };
}

// ---------------------------------------------------------------------------
// Classifier (pure)
// ---------------------------------------------------------------------------

/**
 * Classifies a prompt-input into a trust tier by its declared provenance.
 *
 * Unknown / ambiguous / malformed input (non-object, missing/unknown `kind`)
 * defaults to UNTRUSTED — the boundary never "upgrades" trust on uncertainty.
 */
export function classifyTrustTier(input: unknown): TrustTier {
  return resolveTier(input).tier;
}

// ---------------------------------------------------------------------------
// Decision (pure, fail-closed)
// ---------------------------------------------------------------------------

/**
 * Decides whether a prompt-input may participate in prompt construction in the
 * CURRENT APPROVED SCOPE.
 *
 * Fail-closed posture:
 *   - UNTRUSTED (explicit)        -> err(AI_TRUST_INPUT_UNTRUSTED)
 *   - UNTRUSTED (unclassifiable)  -> err(AI_TRUST_INPUT_UNCLASSIFIED)
 *   - SEMI_TRUSTED over-reach     -> err(AI_TRUST_SEMITRUSTED_OVERREACH)
 *       (requests a privileged capability, or exceeds the instruction bound)
 *   - SEMI_TRUSTED within limits  -> ok(allowance)
 *   - TRUSTED                     -> ok(allowance)
 *
 * NOTE: a TRUSTED input is the authority — it may "request" privileged
 * capabilities (static system rules ARE the rules; verified business context IS
 * the basis for definitive claims), so it is never an over-reach. Only the
 * SEMI_TRUSTED and UNTRUSTED tiers are constrained. This decision approves no
 * real prompt path: untrusted content has no entry point into the production
 * prompt builder today, and this helper proves it stays denied.
 */
export function evaluateAiRuntimeTrustBoundary(
  input: unknown,
): ActionResult<TrustBoundaryAllowance> {
  const { tier, classified } = resolveTier(input);

  // UNTRUSTED is denied in the current scope. Distinguish an explicitly untrusted
  // provenance from an input we simply could not classify (both fail closed).
  if (tier === UNTRUSTED) {
    return classified
      ? err(
          'AI_TRUST_INPUT_UNTRUSTED',
          'Untrusted input may not enter prompt construction in the current scope',
        )
      : err(
          'AI_TRUST_INPUT_UNCLASSIFIED',
          'Input could not be classified and is denied by default (default-deny)',
        );
  }

  if (tier === SEMI_TRUSTED) {
    // After resolveTier returns a classified tier the input is object-like.
    const obj = input as Record<string, unknown>;

    // Bound: a semi-trusted instruction must stay within the operator-instruction
    // size budget. An oversized candidate cannot be trusted to merely "shape".
    if (obj.length !== undefined) {
      if (
        !isNonNegativeInteger(obj.length) ||
        obj.length > MAX_OPERATOR_INSTRUCTION_CHARS
      ) {
        return err(
          'AI_TRUST_SEMITRUSTED_OVERREACH',
          'Semi-trusted input exceeds the allowed bound',
        );
      }
    }

    // Over-reach: a semi-trusted input may not request any privileged capability.
    const requested = Array.isArray(obj.requests) ? obj.requests : [];
    const privileged = new Set<string>(PRIVILEGED_CAPABILITIES);
    const overreaches = requested.some(
      (r) => typeof r === 'string' && privileged.has(r),
    );
    if (overreaches) {
      return err(
        'AI_TRUST_SEMITRUSTED_OVERREACH',
        'Semi-trusted input may not override rules, authorize sending, create definitive claims, expose internals, or be promoted to verified context',
      );
    }

    return ok({ allowed: true, tier });
  }

  // TRUSTED: the authority. Allowed.
  return ok({ allowed: true, tier });
}
