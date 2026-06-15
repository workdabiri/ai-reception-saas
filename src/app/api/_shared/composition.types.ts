// ===========================================================================
// API Shared — Composition Types
//
// Type definitions for the API dependency container.
// Used by the composition root to wire repositories and services.
// ===========================================================================

import type { IdentityRepository } from '@/domains/identity/repository';
import type { TenancyRepository } from '@/domains/tenancy/repository';
import type { AuditRepository } from '@/domains/audit/repository';
import type { CrmRepository } from '@/domains/crm/repository';
import type { ConversationRepository } from '@/domains/conversations/repository';
import type { ReplyDraftRepository } from '@/domains/reply-drafts/repository';
import type { AiConfigRepository } from '@/domains/ai-config/repository';

import type { IdentityService } from '@/domains/identity/service';
import type { TenancyService } from '@/domains/tenancy/service';
import type { AuthzService } from '@/domains/authz/service';
import type { AuditService } from '@/domains/audit/service';
import type { CrmService } from '@/domains/crm/service';
import type { ConversationService } from '@/domains/conversations/service';
import type { AiConfigService } from '@/domains/ai-config/service';

import type { IdentityRepositoryDb } from '@/domains/identity/repository';
import type { TenancyRepositoryDb } from '@/domains/tenancy/repository';
import type { AuditRepositoryDb } from '@/domains/audit/repository';
import type { CrmRepositoryDb } from '@/domains/crm/repository';
import type { ConversationRepositoryDb } from '@/domains/conversations/repository';
import type { ReplyDraftRepositoryDb } from '@/domains/reply-drafts/repository';
import type { AiConfigRepositoryDb } from '@/domains/ai-config/repository';

// ---------------------------------------------------------------------------
// Container types
// ---------------------------------------------------------------------------

/** All repositories available to API handlers */
export interface ApiRepositories {
  readonly identity: IdentityRepository;
  readonly tenancy: TenancyRepository;
  readonly audit: AuditRepository;
  readonly crm: CrmRepository;
  readonly conversations: ConversationRepository;
  readonly replyDrafts: ReplyDraftRepository;
  readonly aiConfig: AiConfigRepository;
}

/** All services available to API handlers */
export interface ApiServices {
  readonly identity: IdentityService;
  readonly tenancy: TenancyService;
  readonly authz: AuthzService;
  readonly audit: AuditService;
  readonly crm: CrmService;
  readonly conversations: ConversationService;
  readonly aiConfig: AiConfigService;
}

/** Complete API dependency container */
export interface ApiDependencies {
  readonly repositories: ApiRepositories;
  readonly services: ApiServices;
}

// ---------------------------------------------------------------------------
// Composition options
// ---------------------------------------------------------------------------

/**
 * Prisma-compatible client shape required by the composition root.
 * Combines the delegates needed by all repository DB interfaces.
 *
 * Expressed as an intersection (rather than `interface extends`) because
 * AiConfigRepositoryDb reads the `business` delegate via a `select`-based
 * `findUnique`, whose signature differs from TenancyRepositoryDb's; an
 * intersection merges the two compatible `business` shapes, while interface
 * extension would reject the non-identical property.
 */
export type PrismaCompatibleClient = IdentityRepositoryDb &
  TenancyRepositoryDb &
  AuditRepositoryDb &
  CrmRepositoryDb &
  ConversationRepositoryDb &
  ReplyDraftRepositoryDb &
  AiConfigRepositoryDb;

/** Options for creating the API dependency container */
export interface ApiCompositionOptions {
  /**
   * Prisma-compatible client to use instead of the default getPrisma().
   * Useful for tests that need to inject a mock client.
   */
  readonly prisma?: PrismaCompatibleClient;
}
