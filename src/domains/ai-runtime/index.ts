// ===========================================================================
// AI Runtime Domain — Public Exports
//
// Tenant-scoped AI context assembler (B-R3) + AI provider boundary and
// deterministic fake provider (B-R4).
//
// The assembler composes AI Config (policy) and Knowledge (verified context)
// into a structured, internal context object for FUTURE prompt building. The
// provider boundary defines the seam a real provider will later sit behind.
//
// No prompt construction, no real provider integration, no network request, no
// customer/conversation/message PII, no auto-send.
// ===========================================================================

export * from './types';
export * from './service';
export * from './context-assembler';
export * from './provider';
export * from './fake-provider';
