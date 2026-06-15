// ===========================================================================
// AI Runtime Domain — Service Interface
//
// Server-side boundary for the tenant-scoped AI context assembler (B-R3).
// No implementation — interface definitions only.
//
// SECURITY: `assembleAiContext` is tenant-scoped by a server-resolved
// `businessId` taken from the request context. Callers MUST pass the tenant
// request context (resolved from the authenticated session) — never a
// client-supplied businessId. The assembler treats the context as the single
// source of truth for tenancy and never reads tenancy from options/client data.
// ===========================================================================

import type { ActionResult } from '@/lib/result';
import type {
  AiContextAssemblyContext,
  AssembleAiContextOptions,
  AssembledAiContext,
} from './types';

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/** Service boundary for runtime assembly of structured AI context */
export interface AiRuntimeService {
  /**
   * Assembles a structured, internal AI context object for the business in the
   * given server-side tenant context.
   *
   * Fails CLOSED by construction:
   *  - missing/invalid server-resolved businessId -> error.
   *  - AI generation disabled for the business     -> error (no knowledge read).
   *  - verified-context load failure               -> error (no partial context).
   *
   * On success it returns ONLY a business with AI explicitly enabled, carrying
   * its VERIFIED business-context items (provenance preserved) and assembly
   * metadata. It builds no prompt, calls no provider, and includes no
   * customer/conversation/message PII.
   */
  assembleAiContext(
    context: AiContextAssemblyContext,
    options?: AssembleAiContextOptions,
  ): Promise<ActionResult<AssembledAiContext>>;
}
