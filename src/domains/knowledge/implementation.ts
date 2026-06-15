// ===========================================================================
// Knowledge Domain — Service Implementation
//
// Concrete KnowledgeService backed by validation + injected repository.
//
// The service validates and normalizes input, then delegates to the repository.
// Tenant scoping is enforced by always threading the server-resolved
// `businessId` through to the repository; the service never trusts a
// client-supplied tenant decision. It assembles no prompts and depends on no
// AI provider.
// ===========================================================================

import { z } from 'zod';
import { err } from '@/lib/result';
import type { KnowledgeService } from './service';
import type { KnowledgeRepository } from './repository';
import { BUSINESS_CONTEXT_ITEM_SOURCE_TYPE_VALUES } from './types';

// ---------------------------------------------------------------------------
// Dependency types
// ---------------------------------------------------------------------------

/** Dependencies for the Knowledge service */
export interface KnowledgeServiceDeps {
  readonly repository: KnowledgeRepository;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVALID_INPUT_CODE = 'INVALID_KNOWLEDGE_INPUT';
const INVALID_INPUT_MSG = 'Invalid knowledge input';

/** Upper bound on a single context value (long text supported, but bounded). */
const MAX_VALUE_LENGTH = 20_000;
const MAX_SHORT_TEXT_LENGTH = 500;

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createItemSchema = z.object({
  businessId: z.string().uuid(),
  category: z.string().trim().min(1).max(MAX_SHORT_TEXT_LENGTH),
  key: z.string().trim().min(1).max(MAX_SHORT_TEXT_LENGTH),
  value: z.string().min(1).max(MAX_VALUE_LENGTH),
  sourceType: z.enum(BUSINESS_CONTEXT_ITEM_SOURCE_TYPE_VALUES),
  sourceLabel: z.string().trim().max(MAX_SHORT_TEXT_LENGTH).nullish(),
  sourceUrl: z.string().trim().url().max(MAX_SHORT_TEXT_LENGTH).nullish(),
  sourceMetadata: z.unknown().nullish(),
  createdByUserId: z.string().uuid().nullish(),
});

const listVerifiedSchema = z.object({
  businessId: z.string().uuid(),
  category: z.string().trim().min(1).max(MAX_SHORT_TEXT_LENGTH).optional(),
  limit: z.number().int().positive().optional(),
});

const verifyItemSchema = z.object({
  businessId: z.string().uuid(),
  itemId: z.string().uuid(),
  verifiedByUserId: z.string().uuid(),
});

const archiveItemSchema = z.object({
  businessId: z.string().uuid(),
  itemId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates a concrete KnowledgeService with validation and injected repository */
export function createKnowledgeService(
  deps: KnowledgeServiceDeps,
): KnowledgeService {
  const { repository } = deps;

  return {
    async createItem(input) {
      const parsed = createItemSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      return repository.createItem(parsed.data);
    },

    async listVerifiedItems(input) {
      const parsed = listVerifiedSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      // The repository always pins status:VERIFIED + businessId; this passes
      // only the validated scope through.
      return repository.listVerifiedByBusiness(parsed.data);
    },

    async verifyItem(input) {
      const parsed = verifyItemSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      return repository.verifyItem(parsed.data);
    },

    async archiveItem(input) {
      const parsed = archiveItemSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      return repository.archiveItem(parsed.data);
    },
  };
}
