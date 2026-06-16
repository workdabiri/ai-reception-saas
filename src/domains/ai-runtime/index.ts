// ===========================================================================
// AI Runtime Domain — Public Exports
//
// Tenant-scoped AI context assembler (B-R3) + AI provider boundary and
// deterministic fake provider (B-R4) + provenance-aware prompt builder (B-R5) +
// AI generation audit log + draft metadata (B-R6).
//
// The assembler composes AI Config (policy) and Knowledge (verified context)
// into a structured, internal context object. The provider boundary defines the
// seam a real provider will later sit behind. The prompt builder converts an
// assembled context into a provider-ready REPLY_DRAFT request, enforcing the
// §5.1 provenance-aware refusal rules in the prompt.
//
// No real provider integration, no network request, no customer/conversation/
// message PII reads, no auto-send. Prompt construction lives here (B-R5) but
// only ever builds the request payload — it never calls a provider or sends.
// ===========================================================================

export * from './types';
export * from './service';
export * from './context-assembler';
export * from './provider';
export * from './fake-provider';
export * from './prompt-builder';
export * from './audit-log';
