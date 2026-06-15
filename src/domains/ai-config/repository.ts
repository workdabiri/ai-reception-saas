// ===========================================================================
// AI Config Domain — Repository
//
// Reads the per-business AI mode from persistence. Uses an injected
// Prisma-compatible client for testability. Tenant scoping is the caller's
// responsibility: the businessId passed here comes from the server-side
// tenant context (see AiConfigService).
// ===========================================================================

import { ok, err } from '@/lib/result';
import type { ActionResult } from '@/lib/result';
import type { BusinessAiModeValue } from './types';

// ---------------------------------------------------------------------------
// Injected DB client interface
// ---------------------------------------------------------------------------

/**
 * Minimal Prisma-compatible client shape required to read a business AI mode.
 * Selects only `ai_mode` — no PII or unrelated business fields are read.
 */
export interface AiConfigRepositoryDb {
  business: {
    findUnique(args: {
      where: { id: string };
      select: { aiMode: true };
    }): Promise<{ aiMode: BusinessAiModeValue } | null>;
  };
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface AiConfigRepository {
  /**
   * Returns the stored AI mode for a business, or null if the business does
   * not exist. Returns an error result on a lookup failure.
   */
  findBusinessAiMode(
    businessId: string,
  ): Promise<ActionResult<BusinessAiModeValue | null>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAiConfigRepository(
  db: AiConfigRepositoryDb,
): AiConfigRepository {
  return {
    async findBusinessAiMode(businessId) {
      try {
        const record = await db.business.findUnique({
          where: { id: businessId },
          select: { aiMode: true },
        });
        return ok(record ? record.aiMode : null);
      } catch {
        return err(
          'AI_CONFIG_REPOSITORY_ERROR',
          'AI config repository operation failed',
        );
      }
    },
  };
}
