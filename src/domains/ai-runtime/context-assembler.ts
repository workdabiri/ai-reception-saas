// ===========================================================================
// AI Runtime Domain — Tenant-Scoped AI Context Assembler (B-R3)
//
// Concrete AiRuntimeService that assembles a structured, internal AI context
// object from the SERVER-RESOLVED tenant context. It composes two existing
// domain services and adds no data access of its own:
//
//   - AI Config  (policy / aiMode / kill switch) -> resolveAiPolicy
//   - Knowledge  (VERIFIED business context)      -> listVerifiedItems
//
// FAIL-CLOSED CONTRACT:
//   1. No/invalid server businessId          -> AI_CONTEXT_INVALID_TENANT_CONTEXT
//   2. Invalid optional filters              -> AI_CONTEXT_INVALID_OPTIONS
//   3. AI generation disabled                -> AI_CONTEXT_DISABLED (no knowledge read)
//   4. Verified-context load failure         -> AI_CONTEXT_KNOWLEDGE_UNAVAILABLE
//
// SCOPE GUARDS (enforced by construction):
//   - Tenancy is read ONLY from `context.businessId`; options carry no
//     businessId and cannot widen scope.
//   - Only VERIFIED business-context items are read (Knowledge service pins
//     status:VERIFIED + businessId); provenance is preserved.
//   - No customer / conversation / message / reply-draft access.
//   - No prompt string is built and no AI provider is called.
// ===========================================================================

import { z } from 'zod';
import { ok, err } from '@/lib/result';
import type { AiConfigService } from '@/domains/ai-config/service';
import type { KnowledgeService } from '@/domains/knowledge/service';
import type { BusinessContextItem } from '@/domains/knowledge/types';
import type { AiRuntimeService } from './service';
import type {
  AiContextAssemblyContext,
  AssembleAiContextOptions,
  AssembledAiContext,
  AssembledBusinessContextItem,
} from './types';

// ---------------------------------------------------------------------------
// Dependency types
// ---------------------------------------------------------------------------

/**
 * Dependencies for the AI runtime service.
 *
 * The assembler depends only on other domain SERVICES (not repositories), so it
 * inherits their tenant-scoping and verified-only guarantees and introduces no
 * new persistence surface. `now` is injectable for deterministic tests.
 */
export interface AiRuntimeServiceDeps {
  readonly aiConfig: AiConfigService;
  readonly knowledge: KnowledgeService;
  /** Clock for `assembledAt`. Defaults to wall-clock; overridable in tests. */
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVALID_CONTEXT_CODE = 'AI_CONTEXT_INVALID_TENANT_CONTEXT';
const INVALID_CONTEXT_MSG = 'A valid server-resolved tenant context is required';
const INVALID_OPTIONS_CODE = 'AI_CONTEXT_INVALID_OPTIONS';
const INVALID_OPTIONS_MSG = 'Invalid AI context assembly options';
const DISABLED_CODE = 'AI_CONTEXT_DISABLED';
const DISABLED_MSG = 'AI generation is disabled for this business';
const KNOWLEDGE_UNAVAILABLE_CODE = 'AI_CONTEXT_KNOWLEDGE_UNAVAILABLE';
const KNOWLEDGE_UNAVAILABLE_MSG = 'Verified business context could not be loaded';

const MAX_SHORT_TEXT_LENGTH = 500;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Tenant-context schema. The server-resolved `businessId` MUST be a UUID before
 * any policy or knowledge call — a non-UUID is treated as an invalid tenant
 * context, not a lookup miss.
 */
const contextSchema = z.object({
  businessId: z.string().uuid(),
});

/**
 * Options schema. Validates the optional NARROWING filters only — it carries no
 * businessId, so it can never widen tenant scope. `.strict()` rejects unknown
 * keys (including a smuggled `businessId`) rather than silently stripping them.
 */
const optionsSchema = z
  .object({
    category: z.string().trim().min(1).max(MAX_SHORT_TEXT_LENGTH).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Mapping (verified item -> safe, provenance-preserving projection)
// ---------------------------------------------------------------------------

/**
 * Projects a verified business-context item into the assembled shape.
 *
 * Deliberately copies ONLY business-owned content + provenance fields. There is
 * no customer/conversation/message field to copy — the Knowledge item carries
 * none — so customer PII cannot leak through this projection.
 */
function toAssembledItem(
  item: BusinessContextItem,
): AssembledBusinessContextItem {
  return {
    id: item.id,
    category: item.category,
    key: item.key,
    value: item.value,
    sourceType: item.sourceType,
    sourceLabel: item.sourceLabel,
    sourceUrl: item.sourceUrl,
    sourceMetadata: item.sourceMetadata,
    verifiedByUserId: item.verifiedByUserId,
    verifiedAt: item.verifiedAt,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the tenant-scoped AI context assembler service.
 */
export function createAiRuntimeService(
  deps: AiRuntimeServiceDeps,
): AiRuntimeService {
  const { aiConfig, knowledge } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async assembleAiContext(
      context: AiContextAssemblyContext,
      options?: AssembleAiContextOptions,
    ) {
      // 1. Tenant scope: only the server-resolved businessId is ever consulted,
      //    and it must be a valid UUID before any policy or knowledge call.
      const parsedContext = contextSchema.safeParse(context ?? {});
      if (!parsedContext.success) {
        return err(INVALID_CONTEXT_CODE, INVALID_CONTEXT_MSG);
      }
      const { businessId } = parsedContext.data;

      // 2. Validate optional, non-scope-widening filters. Unknown keys
      //    (e.g. a smuggled businessId) are rejected, not stripped.
      const parsedOptions = optionsSchema.safeParse(options ?? {});
      if (!parsedOptions.success) {
        return err(INVALID_OPTIONS_CODE, INVALID_OPTIONS_MSG);
      }

      // 3. Resolve AI policy. The resolver itself fails closed and never trusts
      //    client input; we pass ONLY the server-resolved businessId. Assemble
      //    only when the policy is fully consistent: explicitly AI_ASSISTED AND
      //    generation enabled. Any error, disabled, or inconsistent state fails
      //    closed and never reads knowledge.
      const policyResult = await aiConfig.resolveAiPolicy({ businessId });
      if (
        !policyResult.ok ||
        policyResult.data.aiGenerationEnabled !== true ||
        policyResult.data.aiMode !== 'AI_ASSISTED'
      ) {
        return err(DISABLED_CODE, DISABLED_MSG);
      }

      // 4. Load VERIFIED business context, scoped strictly to this business.
      //    The Knowledge service pins businessId + status:VERIFIED; the filters
      //    below only narrow, never widen.
      const knowledgeResult = await knowledge.listVerifiedItems({
        businessId,
        category: parsedOptions.data.category,
        limit: parsedOptions.data.limit,
      });

      // Fail closed: never assemble a partial/uncertain context.
      if (!knowledgeResult.ok) {
        return err(KNOWLEDGE_UNAVAILABLE_CODE, KNOWLEDGE_UNAVAILABLE_MSG);
      }

      // 5. Build the structured, internal context object (no prompt, no PII).
      const assembled: AssembledAiContext = {
        businessId,
        aiMode: policyResult.data.aiMode,
        aiGenerationEnabled: true,
        businessContextItems: knowledgeResult.data.map(toAssembledItem),
        assembledAt: now().toISOString(),
      };

      return ok(assembled);
    },
  };
}
