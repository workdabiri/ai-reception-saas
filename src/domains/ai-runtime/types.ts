// ===========================================================================
// AI Runtime Domain — Types
//
// Type definitions for the tenant-scoped AI context assembler (B-R3).
//
// The assembler prepares a STRUCTURED, INTERNAL context object for FUTURE AI
// prompt building. It is deliberately constrained:
//
//  - SECURITY: it is keyed strictly on the server-resolved `businessId` from
//    the tenant request context — never a client-supplied businessId.
//  - It reads ONLY VERIFIED business-context items (via the Knowledge service)
//    and preserves their provenance.
//  - It carries NO customer / conversation / message PII.
//  - It builds NO prompt string and calls NO AI provider.
//  - It fails CLOSED: a disabled business never yields an assembled context.
//
// This module defines data shapes only.
// ===========================================================================

import type { BusinessContextItemSourceTypeValue } from '@/domains/knowledge/types';

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * AI runtime / context-assembler error codes.
 *
 * - AI_CONTEXT_INVALID_TENANT_CONTEXT = no/invalid server-resolved businessId.
 * - AI_CONTEXT_INVALID_OPTIONS        = malformed optional filters.
 * - AI_CONTEXT_DISABLED               = AI is OFF for the business (fail closed).
 * - AI_CONTEXT_KNOWLEDGE_UNAVAILABLE  = verified-context load failed (fail closed).
 */
export const AI_RUNTIME_ERROR_CODES = [
  'AI_CONTEXT_INVALID_TENANT_CONTEXT',
  'AI_CONTEXT_INVALID_OPTIONS',
  'AI_CONTEXT_DISABLED',
  'AI_CONTEXT_KNOWLEDGE_UNAVAILABLE',
] as const;

/** AI runtime error code type */
export type AiRuntimeErrorCode = (typeof AI_RUNTIME_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Assembly context (server-resolved tenant scope)
// ---------------------------------------------------------------------------

/**
 * The server-resolved tenant context used to assemble AI context.
 *
 * SECURITY: callers MUST pass the server-side tenant request context
 * (`TenantRequestContext`), whose `businessId` was resolved from the
 * authenticated session — NEVER a client-supplied businessId. The assembler
 * reads `businessId` from here and nowhere else, so it cannot be tricked by
 * client input. `TenantRequestContext` structurally satisfies this shape.
 */
export interface AiContextAssemblyContext {
  readonly businessId: string;
}

// ---------------------------------------------------------------------------
// Assembly options (optional, non-scope-widening filters)
// ---------------------------------------------------------------------------

/**
 * Optional filters for context assembly.
 *
 * These NARROW the verified-context selection only; they intentionally carry
 * NO `businessId` and cannot widen tenant scope. Both are validated before use.
 */
export interface AssembleAiContextOptions {
  /** Optional category filter (combined with businessId + VERIFIED). */
  readonly category?: string;
  /** Optional cap on the number of verified items assembled. */
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Assembled output
// ---------------------------------------------------------------------------

/**
 * A single verified business-context item as projected into the assembled AI
 * context. Carries the business-owned fact plus its provenance — and nothing
 * else. There are NO customer/conversation/message fields here by construction.
 */
export interface AssembledBusinessContextItem {
  readonly id: string;
  readonly category: string;
  readonly key: string;
  readonly value: string;
  readonly sourceType: BusinessContextItemSourceTypeValue;
  readonly sourceLabel: string | null;
  readonly sourceUrl: string | null;
  readonly sourceMetadata: unknown | null;
  readonly verifiedByUserId: string | null;
  readonly verifiedAt: string | null;
}

/**
 * The structured, internal AI context object.
 *
 * It is produced ONLY for a business with AI generation explicitly enabled, so
 * `aiMode` is narrowed to `'AI_ASSISTED'` and `aiGenerationEnabled` to `true`.
 * A disabled business never produces this object (the assembler returns a
 * fail-closed error instead).
 *
 * This object is NOT a prompt. It contains no provider call, no prompt string,
 * and no customer PII — it is the safe foundation a future prompt builder
 * (B-R5) will consume.
 */
export interface AssembledAiContext {
  readonly businessId: string;
  readonly aiMode: 'AI_ASSISTED';
  readonly aiGenerationEnabled: true;
  readonly businessContextItems: readonly AssembledBusinessContextItem[];
  readonly assembledAt: string;
}
