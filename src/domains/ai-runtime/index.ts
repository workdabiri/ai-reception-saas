// ===========================================================================
// AI Runtime Domain — Public Exports
//
// Tenant-scoped AI context assembler (B-R3). Composes AI Config (policy) and
// Knowledge (verified context) into a structured, internal context object for
// FUTURE prompt building. No prompt construction, no AI provider, no
// customer/conversation/message PII, no auto-send.
// ===========================================================================

export * from './types';
export * from './service';
export * from './context-assembler';
