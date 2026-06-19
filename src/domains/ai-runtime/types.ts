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

// ---------------------------------------------------------------------------
// Prompt data-minimization allowlist (B-H1)
// ---------------------------------------------------------------------------

/**
 * A single allowlisted field that MAY be rendered into AI prompt text, with its
 * render order and blank-handling. The `field` is constrained to the subset of
 * `AssembledBusinessContextItem` keys the owner-reviewed allowlist permits.
 */
export interface PromptRenderableItemField {
  readonly field: Extract<
    keyof AssembledBusinessContextItem,
    'category' | 'key' | 'value' | 'sourceType' | 'sourceLabel' | 'verifiedAt'
  >;
  /** When true the field is omitted from prompt text if absent / blank. */
  readonly omitWhenBlank: boolean;
}

/**
 * The CENTRAL, single source of truth for which verified-context item fields may
 * enter a reply-draft prompt (PRD-v1.1 §5.1; data-minimization spec
 * `docs/audits/AREA-B-pii-data-minimization-allowlist.md` §5). The prompt builder
 * renders items STRICTLY by iterating this list, so it can never reach for a
 * field that is not declared here — a field later added to the item type is
 * excluded from prompts by default (fail-closed / default-deny), and the
 * render-order is fixed for deterministic output.
 *
 * Item fields deliberately ABSENT here are FORBIDDEN from prompt text by §6 of
 * the same spec: the internal item `id`, per-item `businessId`, lifecycle
 * `status`, `sourceUrl`, raw `sourceMetadata`, `verifiedByUserId`, and
 * `createdByUserId`. The full denylist / sensitive-field + credential contract is
 * owned by the data-minimization test
 * (`__tests__/domains/ai-runtime-data-minimization.test.ts`) as its single source
 * of truth — keeping those tokens OUT of production source so they cannot trip
 * (or hollow out) the B-R7 §7 / B-R8 §1 static scope guards.
 */
export const PROMPT_RENDERABLE_ITEM_FIELDS: readonly PromptRenderableItemField[] =
  [
    { field: 'category', omitWhenBlank: false },
    { field: 'key', omitWhenBlank: false },
    { field: 'value', omitWhenBlank: false },
    { field: 'sourceType', omitWhenBlank: false },
    { field: 'sourceLabel', omitWhenBlank: true },
    { field: 'verifiedAt', omitWhenBlank: true },
  ];

/** The allowlisted prompt-renderable field NAMES, in render order. */
export const PROMPT_RENDERABLE_ITEM_FIELD_NAMES: readonly string[] =
  PROMPT_RENDERABLE_ITEM_FIELDS.map((f) => f.field);

// ===========================================================================
// AI Provider Boundary — Types (B-R4)
//
// Data shapes for the AI provider seam: the request/result payloads exchanged
// with an AI provider, defined WITHOUT binding to any vendor and WITHOUT
// building a prompt. B-R4 introduces only the boundary plus a deterministic
// fake provider; prompt construction belongs to B-R5 and is out of scope here.
//
// IMPORTANT: the `prompt` on the request is CALLER-SUPPLIED for future use.
// B-R4 never constructs it from business context, conversation content, or
// customer data — it only defines the shape of the payload.
// ===========================================================================

// ---------------------------------------------------------------------------
// Provider operations
// ---------------------------------------------------------------------------

/**
 * Supported AI provider operations.
 *
 * - REPLY_DRAFT = generate a draft reply for human review (never auto-send).
 *
 * Deliberately minimal: only the single operation the Area B draft path needs
 * is defined. Other operations stay out of scope until justified.
 */
export const AI_PROVIDER_OPERATION_VALUES = ['REPLY_DRAFT'] as const;

/** A supported AI provider operation */
export type AiProviderOperation = (typeof AI_PROVIDER_OPERATION_VALUES)[number];

/** Type guard for a supported provider operation */
export function isAiProviderOperation(
  value: unknown,
): value is AiProviderOperation {
  return (
    typeof value === 'string' &&
    (AI_PROVIDER_OPERATION_VALUES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Finish reasons
// ---------------------------------------------------------------------------

/**
 * Why a generation stopped. Kept small and vendor-neutral; a real provider
 * adapter maps its own reasons onto these.
 */
export const AI_PROVIDER_FINISH_REASON_VALUES = [
  'STOP',
  'LENGTH',
  'CONTENT_FILTER',
] as const;

/** Vendor-neutral finish reason */
export type AiProviderFinishReason =
  (typeof AI_PROVIDER_FINISH_REASON_VALUES)[number];

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * Provider request-validation error codes. A provider FAILS CLOSED on any
 * invalid request: it returns one of these and never performs generation.
 */
export const AI_PROVIDER_ERROR_CODES = [
  'AI_PROVIDER_INVALID_REQUEST',
  'AI_PROVIDER_UNSUPPORTED_OPERATION',
  'AI_PROVIDER_INVALID_BUSINESS_ID',
  'AI_PROVIDER_INVALID_PROMPT',
  'AI_PROVIDER_PROMPT_TOO_LARGE',
] as const;

/** AI provider error code */
export type AiProviderErrorCode = (typeof AI_PROVIDER_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * A request to generate text from an AI provider.
 *
 * SECURITY / SCOPE:
 *  - `businessId` is the SERVER-RESOLVED tenant id; a provider treats it as
 *    opaque tenancy metadata and performs no tenant data access of its own.
 *  - `prompt` is CALLER-SUPPLIED. B-R4 does NOT build it from business context,
 *    conversation content, or customer data — that is B-R5's responsibility.
 *  - `contextHash` is an optional opaque fingerprint of assembled context (for
 *    traceability / caching); it carries no content.
 *  - `metadata` is optional, small, string-keyed and string-valued, and opaque
 *    to the provider boundary.
 */
export interface AiProviderGenerateTextRequest {
  readonly operation: AiProviderOperation;
  readonly businessId: string;
  readonly prompt: string;
  readonly contextHash?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** Token usage for a generation. Counts only — never content. */
export interface AiProviderUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/**
 * The result of a successful generation.
 *
 * `providerId` / `modelId` identify the producing provider/model for audit
 * metadata (consumed later by B-R6). `createdAt` is an ISO timestamp from the
 * provider's clock. `requestId` is an optional provider-side correlation id.
 */
export interface AiProviderGenerateTextResult {
  readonly text: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly finishReason: AiProviderFinishReason;
  readonly usage: AiProviderUsage;
  readonly createdAt: string;
  readonly requestId?: string;
}

// ===========================================================================
// Provenance-Aware Prompt Builder — Types (B-R5)
//
// Data shapes for converting an already-assembled, tenant-scoped AI context
// (B-R3) into a provider-ready request (B-R4 shape) for FUTURE reply-draft
// generation. The builder is PURE and PROVENANCE-AWARE:
//
//  - it consumes ONLY an `AssembledAiContext` (never a raw client businessId,
//    never customer/conversation/message PII);
//  - it injects ONLY verified business context as the basis for definitive
//    claims and instructs the model to hedge / defer / ask-for-confirmation /
//    refuse when verified context is missing (PRD-v1.1 §5.1);
//  - it preserves the human-review boundary, never auto-sends, and never calls
//    a provider — it only builds the request payload.
// ===========================================================================

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * Prompt-builder error codes. The builder FAILS CLOSED on any invalid input:
 * it returns one of these and never produces a provider request.
 *
 * - AI_PROMPT_INVALID_CONTEXT     = missing/inconsistent assembled context
 *   (no/invalid businessId, AI not enabled, malformed items).
 * - AI_PROMPT_INVALID_INSTRUCTION = optional operator instruction present but
 *   not a non-empty, bounded string.
 * - AI_PROMPT_CONTEXT_TOO_LARGE   = the built prompt exceeds the size budget.
 */
export const AI_PROMPT_BUILDER_ERROR_CODES = [
  'AI_PROMPT_INVALID_CONTEXT',
  'AI_PROMPT_INVALID_INSTRUCTION',
  'AI_PROMPT_CONTEXT_TOO_LARGE',
] as const;

/** Prompt-builder error code */
export type AiPromptBuilderErrorCode =
  (typeof AI_PROMPT_BUILDER_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Input for building a reply-draft prompt.
 *
 * SCOPE: `context` MUST be the structured object produced by the B-R3
 * assembler. The builder takes tenancy and verified content ONLY from here —
 * never a raw client businessId, and never customer/conversation/message data.
 *
 * `instruction` is an OPTIONAL, operator-supplied steering note (e.g. "keep it
 * short and apologetic"). It is operator guidance, NOT verified context and NOT
 * customer PII; it can never promote an unverified fact to a definitive claim.
 */
export interface BuildReplyDraftPromptInput {
  readonly context: AssembledAiContext;
  readonly instruction?: string;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * The result of building a reply-draft prompt.
 *
 *  - `promptVersion` identifies the prompt-template version (recorded later by
 *    B-R6 on the generated draft).
 *  - `providerRequest` is the B-R4 request payload (operation REPLY_DRAFT) ready
 *    to hand to a provider — the builder NEVER sends it.
 *  - `contextHash` is a deterministic, dependency-free fingerprint of the
 *    verified context that backed the prompt (carries no raw content).
 *  - `includedContextItemIds` / `omittedContextItemIds` track which verified
 *    items backed the prompt (internal audit only — these ids are NOT exposed
 *    in the prompt text).
 *  - `warnings` carries non-fatal advisories (e.g. zero verified context).
 */
export interface BuildReplyDraftPromptResult {
  readonly promptVersion: string;
  readonly providerRequest: AiProviderGenerateTextRequest;
  readonly contextHash: string;
  readonly includedContextItemIds: readonly string[];
  readonly omittedContextItemIds: readonly string[];
  readonly warnings: readonly string[];
}

// ===========================================================================
// AI Generation Audit Log — Types (B-R6)
//
// Data shapes for the persistence boundary that makes AI generation auditable
// and lets a reply draft carry AI-generation metadata. B-R6 introduces ONLY the
// audit/metadata seam — it builds no prompt, assembles no context, calls no
// provider, sends nothing, and reads no customer/conversation/message content.
//
// PRIVACY INVARIANT: the audit log stores METADATA ONLY. It NEVER stores the raw
// prompt, the raw customer message, the conversation transcript, customer
// contact details, the provider's raw response content, or raw source metadata.
// Only counts, stable identifiers, the non-content contextHash, verified item
// ids, and a bounded + redacted error code+message are recorded.
// ===========================================================================

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a single AI generation attempt.
 *
 * - STARTED   = an attempt was opened (independent of any provider call).
 * - SUCCEEDED = the attempt produced a result (metadata only — never content).
 * - FAILED    = the attempt failed; a bounded + redacted error is recorded.
 */
export const AI_GENERATION_AUDIT_STATUS_VALUES = [
  'STARTED',
  'SUCCEEDED',
  'FAILED',
] as const;

/** AI generation audit lifecycle status */
export type AiGenerationAuditStatus =
  (typeof AI_GENERATION_AUDIT_STATUS_VALUES)[number];

/** Type guard for a valid AI generation audit status */
export function isAiGenerationAuditStatus(
  value: unknown,
): value is AiGenerationAuditStatus {
  return (
    typeof value === 'string' &&
    (AI_GENERATION_AUDIT_STATUS_VALUES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * AI generation audit error codes. The service/repository FAIL CLOSED on invalid
 * input or a missing record, returning one of these (never throwing).
 */
export const AI_GENERATION_AUDIT_ERROR_CODES = [
  'AI_AUDIT_INVALID_INPUT',
  'AI_AUDIT_NOT_FOUND',
  'AI_AUDIT_INVALID_TRANSITION',
  'AI_AUDIT_REPOSITORY_ERROR',
] as const;

/** AI generation audit error code */
export type AiGenerationAuditErrorCode =
  (typeof AI_GENERATION_AUDIT_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Domain entity
// ---------------------------------------------------------------------------

/**
 * Domain representation of an AI generation audit record.
 *
 * Dates are serialized as ISO strings at the repository boundary. By
 * construction there is NO field for raw prompt / response / customer content:
 * only metadata, counts, identifiers, and the non-content contextHash.
 */
export interface AiGenerationAuditLog {
  readonly id: string;
  readonly businessId: string;
  readonly conversationId: string | null;
  readonly replyDraftId: string | null;
  readonly operation: AiProviderOperation;
  readonly status: AiGenerationAuditStatus;
  readonly promptVersion: string | null;
  readonly contextHash: string | null;
  readonly includedContextItemIds: readonly string[] | null;
  readonly omittedContextItemIds: readonly string[] | null;
  readonly warnings: readonly string[] | null;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly providerRequestId: string | null;
  readonly finishReason: AiProviderFinishReason | null;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly promptCharCount: number | null;
  readonly resultCharCount: number | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Input to OPEN an audit record for a generation attempt (status STARTED).
 *
 * SECURITY: `businessId` MUST be the server-resolved tenant id. All fields are
 * metadata derived from the B-R5 prompt-build result — never raw content. There
 * is intentionally no field for prompt text (only `promptCharCount`).
 */
export interface StartAiGenerationAuditInput {
  readonly businessId: string;
  readonly operation: AiProviderOperation;
  readonly conversationId?: string | null;
  readonly replyDraftId?: string | null;
  readonly promptVersion?: string | null;
  readonly contextHash?: string | null;
  readonly includedContextItemIds?: readonly string[];
  readonly omittedContextItemIds?: readonly string[];
  readonly warnings?: readonly string[];
  readonly providerId?: string | null;
  readonly modelId?: string | null;
  readonly promptCharCount?: number | null;
}

/**
 * Input to COMPLETE an audit record as SUCCEEDED.
 *
 * Carries provider/result METADATA only (ids, finish reason, token usage, a
 * result character count, and the linked draft). There is intentionally no field
 * for the generated text (only `resultCharCount`).
 */
export interface CompleteAiGenerationAuditSuccessInput {
  readonly auditLogId: string;
  readonly businessId: string;
  readonly replyDraftId?: string | null;
  readonly providerId?: string | null;
  readonly modelId?: string | null;
  readonly providerRequestId?: string | null;
  readonly finishReason?: AiProviderFinishReason | null;
  readonly promptTokens?: number | null;
  readonly completionTokens?: number | null;
  readonly totalTokens?: number | null;
  readonly resultCharCount?: number | null;
}

/**
 * Input to COMPLETE an audit record as FAILED.
 *
 * `errorCode` is required; `errorMessage` is optional and is bounded + redacted
 * before persistence (email/phone-like substrings redacted, whitespace/control
 * characters collapsed, then truncated) so an over-long or content-bearing
 * message can never bloat or leak through the audit record.
 */
export interface CompleteAiGenerationAuditFailureInput {
  readonly auditLogId: string;
  readonly businessId: string;
  readonly errorCode: string;
  readonly errorMessage?: string | null;
  readonly providerId?: string | null;
  readonly modelId?: string | null;
  readonly replyDraftId?: string | null;
}

// ---------------------------------------------------------------------------
// Draft AI metadata
// ---------------------------------------------------------------------------

/**
 * The METADATA-ONLY patch attached to a reply draft when it is AI-generated.
 *
 * It marks the draft `source = AI` and records provider/model/prompt-version,
 * the non-content contextHash, the finish reason, when it was generated, and a
 * link to the audit record. It carries NO draft text and NO prompt — attaching
 * it never changes the human-review status and never sends.
 */
export interface DraftAiMetadata {
  readonly source: 'AI';
  readonly modelProvider: string;
  readonly modelName: string;
  readonly promptVersion: string;
  readonly aiContextHash: string;
  readonly aiFinishReason: AiProviderFinishReason;
  readonly aiGeneratedAt: string;
  readonly aiGenerationAuditLogId: string | null;
}
