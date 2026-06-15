// ===========================================================================
// Knowledge Domain — Service Interface
//
// Server-side boundary for the verified business-context store (B-R2).
// No implementation — interface definitions only.
//
// SECURITY: every method is tenant-scoped by a server-resolved `businessId`.
// Callers MUST pass `businessId` from `TenantRequestContext` (resolved from the
// authenticated session) — never a client-supplied businessId. The service
// treats `businessId` as an authorization-bearing input and never as data the
// client can freely choose.
// ===========================================================================

import type { ActionResult } from '@/lib/result';
import type {
  BusinessContextItem,
  CreateBusinessContextItemInput,
  VerifyBusinessContextItemInput,
  ArchiveBusinessContextItemInput,
  ListVerifiedContextItemsInput,
} from './types';

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/** Knowledge service error code constants */
export const KNOWLEDGE_ERROR_CODES = [
  'INVALID_KNOWLEDGE_INPUT',
  'BUSINESS_CONTEXT_ITEM_NOT_FOUND',
  'BUSINESS_CONTEXT_ITEM_NOT_VERIFIABLE',
  'KNOWLEDGE_REPOSITORY_ERROR',
] as const;

/** Knowledge service error code type */
export type KnowledgeErrorCode = (typeof KNOWLEDGE_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/** Service boundary for verified business-context operations */
export interface KnowledgeService {
  /**
   * Creates a business-context item. New items default to DRAFT (unverified)
   * and are therefore NOT eligible as AI context until explicitly verified.
   */
  createItem(
    input: CreateBusinessContextItemInput,
  ): Promise<ActionResult<BusinessContextItem>>;

  /**
   * Lists VERIFIED business-context items for the given business.
   * Always scoped to `businessId` AND `status: VERIFIED`.
   */
  listVerifiedItems(
    input: ListVerifiedContextItemsInput,
  ): Promise<ActionResult<readonly BusinessContextItem[]>>;

  /**
   * Verifies an item (DRAFT → VERIFIED), recording who approved it.
   * Scoped by `businessId`; rejects items from other businesses.
   */
  verifyItem(
    input: VerifyBusinessContextItemInput,
  ): Promise<ActionResult<BusinessContextItem>>;

  /**
   * Archives an item (any status → ARCHIVED), removing it from AI eligibility.
   * Scoped by `businessId`; rejects items from other businesses.
   */
  archiveItem(
    input: ArchiveBusinessContextItemInput,
  ): Promise<ActionResult<BusinessContextItem>>;
}
