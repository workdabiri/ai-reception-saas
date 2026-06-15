// ===========================================================================
// AI Config Domain — Types
//
// Per-business AI operating mode (PRD-v1.1 §5) and resolved AI policy.
// This is the B-R1 safety gate: AI generation is OFF by default and every
// AI path must fail closed unless a business is explicitly AI_ASSISTED.
// ===========================================================================

/**
 * Allowed business AI mode values.
 *
 * - MANUAL      = Level 1 (default). AI generation disabled.
 * - AI_ASSISTED = Level 2. AI-assisted drafts; explicit per-business opt-in.
 *
 * Level 3 / Auto Pilot is future-only and intentionally NOT represented here.
 */
export const BUSINESS_AI_MODE_VALUES = ['MANUAL', 'AI_ASSISTED'] as const;

/** Business AI operating mode */
export type BusinessAiModeValue = (typeof BUSINESS_AI_MODE_VALUES)[number];

/**
 * Default AI mode. Businesses are Level 1 (Manual) unless explicitly enabled.
 * This is the default-off invariant: missing/unknown state resolves here.
 */
export const DEFAULT_BUSINESS_AI_MODE: BusinessAiModeValue = 'MANUAL';

/**
 * Resolved AI policy for a single business.
 *
 * `aiGenerationEnabled` is the single source of truth every AI path checks.
 * It is true ONLY when the business is explicitly AI_ASSISTED; every other
 * state (Manual, missing business, invalid mode, lookup error) is false.
 */
export interface AiPolicy {
  readonly businessId: string;
  readonly aiMode: BusinessAiModeValue;
  readonly aiGenerationEnabled: boolean;
}

/** Type guard for a valid BusinessAiMode value */
export function isBusinessAiMode(value: unknown): value is BusinessAiModeValue {
  return (
    typeof value === 'string' &&
    (BUSINESS_AI_MODE_VALUES as readonly string[]).includes(value)
  );
}
