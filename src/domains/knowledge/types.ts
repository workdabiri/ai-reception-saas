// ===========================================================================
// Knowledge Domain — Types
//
// Domain-level type definitions for the verified business-context store
// (PRD-v1.1 §5.1, B-R2). These mirror the Prisma `BusinessContextItem` model
// but are decoupled from it.
//
// SECURITY INVARIANT: only VERIFIED items are eligible to later back AI prompt
// context. DRAFT and ARCHIVED items must never be treated as usable AI context.
// This module defines data shapes only — it assembles no prompts and depends on
// no AI provider.
// ===========================================================================

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Lifecycle / verification state of a business-context item.
 *
 * - DRAFT    = unverified; NOT eligible as AI context.
 * - VERIFIED = business-approved; the ONLY status eligible as AI context.
 * - ARCHIVED = retired; NOT eligible as AI context.
 */
export const BUSINESS_CONTEXT_ITEM_STATUS_VALUES = [
  'DRAFT',
  'VERIFIED',
  'ARCHIVED',
] as const;

/** Business-context item lifecycle / verification status */
export type BusinessContextItemStatusValue =
  (typeof BUSINESS_CONTEXT_ITEM_STATUS_VALUES)[number];

/**
 * Provenance of a business-context item's content. "Verified" provenance means
 * business-approved/entered data — NOT model-prior knowledge, inference,
 * scraped, or guessed data (§5.1).
 */
export const BUSINESS_CONTEXT_ITEM_SOURCE_TYPE_VALUES = [
  'OWNER_APPROVED',
  'OPERATOR_APPROVED',
  'SYSTEM_SEEDED',
  'IMPORT',
  'OTHER',
] as const;

/** Business-context item provenance/source type */
export type BusinessContextItemSourceTypeValue =
  (typeof BUSINESS_CONTEXT_ITEM_SOURCE_TYPE_VALUES)[number];

/** Default status for newly created items: unverified (fail-safe for AI use). */
export const DEFAULT_BUSINESS_CONTEXT_ITEM_STATUS: BusinessContextItemStatusValue =
  'DRAFT';

/** The single status eligible to back AI prompt context. */
export const AI_ELIGIBLE_BUSINESS_CONTEXT_ITEM_STATUS: BusinessContextItemStatusValue =
  'VERIFIED';

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Type guard for a valid BusinessContextItemStatus value */
export function isBusinessContextItemStatus(
  value: unknown,
): value is BusinessContextItemStatusValue {
  return (
    typeof value === 'string' &&
    (BUSINESS_CONTEXT_ITEM_STATUS_VALUES as readonly string[]).includes(value)
  );
}

/** Type guard for a valid BusinessContextItemSourceType value */
export function isBusinessContextItemSourceType(
  value: unknown,
): value is BusinessContextItemSourceTypeValue {
  return (
    typeof value === 'string' &&
    (BUSINESS_CONTEXT_ITEM_SOURCE_TYPE_VALUES as readonly string[]).includes(
      value,
    )
  );
}

// ---------------------------------------------------------------------------
// Domain entity
// ---------------------------------------------------------------------------

/**
 * Domain representation of a business-context item.
 *
 * Dates are serialized as ISO strings at the repository boundary. `value`
 * carries the business-owned fact (long text supported).
 */
export interface BusinessContextItem {
  id: string;
  businessId: string;
  category: string;
  key: string;
  value: string;
  status: BusinessContextItemStatusValue;
  sourceType: BusinessContextItemSourceTypeValue;
  sourceLabel: string | null;
  sourceUrl: string | null;
  sourceMetadata: unknown | null;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Input for creating a business-context item.
 *
 * SECURITY: `businessId` MUST be the server-resolved tenant id (from
 * `TenantRequestContext.businessId`), never a client-supplied value.
 *
 * New items are ALWAYS created as DRAFT (unverified) — there is intentionally no
 * `status` here. The only path to VERIFIED is `verifyItem`, which captures a
 * verifier, so verified items always carry verification provenance.
 */
export interface CreateBusinessContextItemInput {
  businessId: string;
  category: string;
  key: string;
  value: string;
  sourceType: BusinessContextItemSourceTypeValue;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  sourceMetadata?: unknown | null;
  createdByUserId?: string | null;
}

/**
 * Input for verifying a business-context item (DRAFT → VERIFIED).
 *
 * Capturing `verifiedByUserId` records who approved the item; the repository
 * stamps `verifiedAt` server-side. `businessId` scopes the operation.
 */
export interface VerifyBusinessContextItemInput {
  businessId: string;
  itemId: string;
  verifiedByUserId: string;
}

/**
 * Input for archiving a business-context item (any status → ARCHIVED).
 * `businessId` scopes the operation; archived items are not AI-eligible.
 */
export interface ArchiveBusinessContextItemInput {
  businessId: string;
  itemId: string;
}

/** Options for listing verified business-context items. */
export interface ListVerifiedContextItemsInput {
  businessId: string;
  /** Optional category filter (always combined with businessId + VERIFIED). */
  category?: string;
  /** Maximum number of items to return. */
  limit?: number;
}
