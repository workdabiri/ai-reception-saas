// ===========================================================================
// Reply Drafts Domain — Public API
//
// Re-exports the domain types and repository factory.
// This module is the single entry point for Reply Drafts domain functionality.
//
// @module
// ===========================================================================

export {
  REPLY_DRAFT_SOURCE_VALUES,
  REPLY_DRAFT_STATUS_VALUES,
  REVIEWABLE_DRAFT_STATUSES,
  type ReplyDraftSourceValue,
  type ReplyDraftStatusValue,
  type ReplyDraftIdentity,
  type ReplyDraftDashboardItem,
  type CreateSystemDraftInput,
  type GenerateStubDraftResult,
} from './types';

export {
  createReplyDraftRepository,
  type ReplyDraftRepositoryDb,
  type ReplyDraftRepository,
  type ReplyDraftDashboardRecord,
  type ReplyDraftRecord,
  type DashboardDraftsResult,
} from './repository';

