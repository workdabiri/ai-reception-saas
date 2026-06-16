// ===========================================================================
// AI Runtime Domain — AI Generation Audit Log (B-R6)
//
// The persistence boundary that makes AI generation AUDITABLE and lets a reply
// draft carry AI-generation METADATA. It answers, for every generation attempt:
// which business, which prompt version, which context fingerprint, which
// verified context item ids backed the prompt, which provider/model produced the
// result, the provider request id / finish reason / token usage, which draft was
// produced (if any), whether the attempt started / succeeded / failed, and when.
//
// This module provides three things:
//   1. PURE BUILDERS that convert already-built B-R5 / B-R4 outputs into safe,
//      metadata-only audit inputs and a draft-metadata patch.
//   2. A Prisma-backed REPOSITORY (injected DB delegate) that persists the
//      lifecycle (start → completeSuccess / completeFailure), tenant-scoped.
//   3. A SERVICE that validates + bounds + sanitizes input before persistence.
//
// GUARANTEES (enforced by construction):
//   - PRIVACY: stores METADATA ONLY. It never accepts or persists the raw
//     prompt, the raw customer message, the conversation transcript, customer
//     contact details, the provider's raw response content, or raw source
//     metadata. The builders read ONLY counts / ids / identifiers off their
//     inputs (e.g. prompt.length, text.length) — never the text itself.
//   - It builds NO prompt, assembles NO context, calls NO provider, performs NO
//     network request, reads NO env/secret, and NEVER sends.
//   - It reads NO customer / conversation / message content. It persists only
//     nullable `conversationId` / `replyDraftId` trace ids (FK-free) — never a
//     conversation/message/reply-draft row or its content.
//   - FAILS CLOSED on invalid input or a missing record (ActionResult error).
// ===========================================================================

import { z } from 'zod';
import { ok, err, type ActionResult } from '@/lib/result';
import {
  AI_PROVIDER_OPERATION_VALUES,
  AI_PROVIDER_FINISH_REASON_VALUES,
  isAiGenerationAuditStatus,
  type AiGenerationAuditLog,
  type AiGenerationAuditStatus,
  type AiProviderFinishReason,
  type AiProviderGenerateTextResult,
  type BuildReplyDraftPromptResult,
  type CompleteAiGenerationAuditFailureInput,
  type CompleteAiGenerationAuditSuccessInput,
  type DraftAiMetadata,
  type StartAiGenerationAuditInput,
} from './types';

// ---------------------------------------------------------------------------
// Bounds (defense in depth — keep the audit record small and safe)
// ---------------------------------------------------------------------------

/** Max length of a single short identifier-ish string column. */
const MAX_SHORT_TEXT = 200;
/** Max length of a single bounded + redacted warning / error message. */
const MAX_MESSAGE_TEXT = 500;
/** Max number of context item ids / warnings retained. */
const MAX_ID_ITEMS = 1_000;
const MAX_WARNING_ITEMS = 50;

// ---------------------------------------------------------------------------
// Pure builders (no DB, no clock of their own — derive metadata from inputs)
// ---------------------------------------------------------------------------

/**
 * Builds a STARTED-audit input from a B-R5 prompt-build result. Extracts ONLY
 * metadata: it records `promptCharCount` (the prompt's length) but NEVER the
 * prompt text, and copies the included/omitted item ids + warnings + the
 * non-content contextHash.
 */
export function buildStartAiGenerationAuditInput(args: {
  promptResult: BuildReplyDraftPromptResult;
  conversationId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  replyDraftId?: string | null;
}): StartAiGenerationAuditInput {
  const { promptResult } = args;
  return {
    // Derive the audited tenant + operation from the already-built B-R5 provider
    // request so the audit metadata always matches the actual request payload —
    // a caller can never record a businessId that differs from what was prompted.
    businessId: promptResult.providerRequest.businessId,
    operation: promptResult.providerRequest.operation,
    conversationId: args.conversationId ?? null,
    replyDraftId: args.replyDraftId ?? null,
    promptVersion: promptResult.promptVersion,
    contextHash: promptResult.contextHash,
    includedContextItemIds: [...promptResult.includedContextItemIds],
    omittedContextItemIds: [...promptResult.omittedContextItemIds],
    warnings: [...promptResult.warnings],
    providerId: args.providerId ?? null,
    modelId: args.modelId ?? null,
    // Length only — the raw prompt text is never carried into the audit input.
    promptCharCount: promptResult.providerRequest.prompt.length,
  };
}

/**
 * Builds a SUCCESS-completion input from a B-R4 provider result. Extracts ONLY
 * metadata: provider/model/request ids, finish reason, token usage, and
 * `resultCharCount` (the generated text's length) — NEVER the generated text.
 */
export function buildSuccessAiGenerationAuditInput(args: {
  auditLogId: string;
  businessId: string;
  result: AiProviderGenerateTextResult;
  replyDraftId?: string | null;
}): CompleteAiGenerationAuditSuccessInput {
  const { auditLogId, businessId, result } = args;
  return {
    auditLogId,
    businessId,
    replyDraftId: args.replyDraftId ?? null,
    providerId: result.providerId,
    modelId: result.modelId,
    providerRequestId: result.requestId ?? null,
    finishReason: result.finishReason,
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    totalTokens: result.usage.totalTokens,
    // Length only — the generated text is never carried into the audit input.
    resultCharCount: result.text.length,
  };
}

/**
 * Builds the METADATA-ONLY draft patch for an AI-generated draft. It marks the
 * draft `source = AI` and records provider/model/prompt-version, the non-content
 * contextHash, the finish reason, the generation time (from the provider's
 * clock), and the audit-log link. It carries NO draft text and NO prompt, so
 * attaching it neither sends nor changes the human-review status.
 */
export function buildDraftAiMetadata(args: {
  promptResult: BuildReplyDraftPromptResult;
  result: AiProviderGenerateTextResult;
  auditLogId?: string | null;
}): DraftAiMetadata {
  const { promptResult, result } = args;
  return {
    source: 'AI',
    modelProvider: result.providerId,
    modelName: result.modelId,
    promptVersion: promptResult.promptVersion,
    aiContextHash: promptResult.contextHash,
    aiFinishReason: result.finishReason,
    aiGeneratedAt: result.createdAt,
    aiGenerationAuditLogId: args.auditLogId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Repository — raw record + injected DB delegate
// ---------------------------------------------------------------------------

/** Raw AI generation audit record from the database (dates as Date). */
export interface AiGenerationAuditLogRecord {
  id: string;
  businessId: string;
  conversationId: string | null;
  replyDraftId: string | null;
  operation: string;
  status: AiGenerationAuditStatus;
  promptVersion: string | null;
  contextHash: string | null;
  includedContextItemIds: unknown | null;
  omittedContextItemIds: unknown | null;
  warnings: unknown | null;
  providerId: string | null;
  modelId: string | null;
  providerRequestId: string | null;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  promptCharCount: number | null;
  resultCharCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Create payload (status pinned to STARTED by the repository). */
export interface AiGenerationAuditCreateData {
  businessId: string;
  conversationId: string | null;
  replyDraftId: string | null;
  operation: string;
  status: AiGenerationAuditStatus;
  promptVersion: string | null;
  contextHash: string | null;
  includedContextItemIds: string[] | null;
  omittedContextItemIds: string[] | null;
  warnings: string[] | null;
  providerId: string | null;
  modelId: string | null;
  promptCharCount: number | null;
}

/** Update payload for a SUCCEEDED completion. */
export interface AiGenerationAuditSuccessData {
  status: 'SUCCEEDED';
  completedAt: Date;
  replyDraftId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  providerRequestId?: string | null;
  finishReason?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  resultCharCount?: number | null;
}

/** Update payload for a FAILED completion. */
export interface AiGenerationAuditFailureData {
  status: 'FAILED';
  completedAt: Date;
  errorCode: string;
  errorMessage?: string | null;
  replyDraftId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
}

/**
 * Tenant-scoped compound unique selector. Matches the Prisma-generated key for
 * `@@unique([id, businessId])`, so single-row writes are scoped by BOTH id and
 * businessId at the query level — not by a guard applied after loading a row.
 */
export interface AiGenerationAuditWhereUnique {
  id_businessId: { id: string; businessId: string };
}

/**
 * Prisma-compatible delegate interface for the audit repository. Exposes ONLY
 * the `aiGenerationAuditLog` delegate — no customer / conversation / message /
 * reply-draft delegate is reachable from here.
 */
export interface AiGenerationAuditRepositoryDb {
  aiGenerationAuditLog: {
    create(args: {
      data: AiGenerationAuditCreateData;
    }): Promise<AiGenerationAuditLogRecord>;
    findUnique(args: {
      where: AiGenerationAuditWhereUnique;
    }): Promise<AiGenerationAuditLogRecord | null>;
    update(args: {
      where: AiGenerationAuditWhereUnique;
      data: AiGenerationAuditSuccessData | AiGenerationAuditFailureData;
    }): Promise<AiGenerationAuditLogRecord>;
  };
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/** Coerces an unknown JSON column into a `string[] | null`, dropping non-strings. */
function toStringArrayOrNull(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === 'string');
}

/** Narrows an unknown finish-reason string to the vendor-neutral union or null. */
function toFinishReasonOrNull(value: unknown): AiProviderFinishReason | null {
  return typeof value === 'string' &&
    (AI_PROVIDER_FINISH_REASON_VALUES as readonly string[]).includes(value)
    ? (value as AiProviderFinishReason)
    : null;
}

/** Maps a raw record to a domain AiGenerationAuditLog (dates → ISO strings). */
export function mapAiGenerationAuditLogRecord(
  record: AiGenerationAuditLogRecord,
): AiGenerationAuditLog {
  return {
    id: record.id,
    businessId: record.businessId,
    conversationId: record.conversationId,
    replyDraftId: record.replyDraftId,
    operation: record.operation as AiGenerationAuditLog['operation'],
    status: isAiGenerationAuditStatus(record.status)
      ? record.status
      : 'STARTED',
    promptVersion: record.promptVersion,
    contextHash: record.contextHash,
    includedContextItemIds: toStringArrayOrNull(record.includedContextItemIds),
    omittedContextItemIds: toStringArrayOrNull(record.omittedContextItemIds),
    warnings: toStringArrayOrNull(record.warnings),
    providerId: record.providerId,
    modelId: record.modelId,
    providerRequestId: record.providerRequestId,
    finishReason: toFinishReasonOrNull(record.finishReason),
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    totalTokens: record.totalTokens,
    promptCharCount: record.promptCharCount,
    resultCharCount: record.resultCharCount,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    startedAt: record.startedAt.toISOString(),
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Repository interface + factory
// ---------------------------------------------------------------------------

const REPO_ERROR_CODE = 'AI_AUDIT_REPOSITORY_ERROR';
const REPO_ERROR_MSG = 'AI generation audit repository operation failed';
const NOT_FOUND_CODE = 'AI_AUDIT_NOT_FOUND';
const NOT_FOUND_MSG = 'AI generation audit record not found';
const INVALID_TRANSITION_CODE = 'AI_AUDIT_INVALID_TRANSITION';
const INVALID_TRANSITION_MSG =
  'AI generation audit record is already in a terminal state';

/** Repository boundary for the AI generation audit log. */
export interface AiGenerationAuditRepository {
  /** Opens a STARTED audit record for a generation attempt. */
  start(
    input: StartAiGenerationAuditInput,
  ): Promise<ActionResult<AiGenerationAuditLog>>;
  /** Completes an attempt as SUCCEEDED (tenant-scoped by id + businessId). */
  completeSuccess(
    input: CompleteAiGenerationAuditSuccessInput,
  ): Promise<ActionResult<AiGenerationAuditLog>>;
  /** Completes an attempt as FAILED (tenant-scoped by id + businessId). */
  completeFailure(
    input: CompleteAiGenerationAuditFailureInput,
  ): Promise<ActionResult<AiGenerationAuditLog>>;
  /** Finds an audit record by id, scoped strictly by businessId. */
  findByBusinessAndId(
    businessId: string,
    auditLogId: string,
  ): Promise<ActionResult<AiGenerationAuditLog | null>>;
}

/** Creates an AI generation audit repository backed by the given DB client. */
export function createAiGenerationAuditRepository(
  db: AiGenerationAuditRepositoryDb,
): AiGenerationAuditRepository {
  return {
    async start(input) {
      try {
        const record = await db.aiGenerationAuditLog.create({
          data: {
            businessId: input.businessId,
            conversationId: input.conversationId ?? null,
            replyDraftId: input.replyDraftId ?? null,
            operation: input.operation,
            // A new attempt always opens as STARTED; the only paths to a
            // terminal state are completeSuccess / completeFailure.
            status: 'STARTED',
            promptVersion: input.promptVersion ?? null,
            contextHash: input.contextHash ?? null,
            includedContextItemIds: input.includedContextItemIds
              ? [...input.includedContextItemIds]
              : null,
            omittedContextItemIds: input.omittedContextItemIds
              ? [...input.omittedContextItemIds]
              : null,
            warnings: input.warnings ? [...input.warnings] : null,
            providerId: input.providerId ?? null,
            modelId: input.modelId ?? null,
            promptCharCount: input.promptCharCount ?? null,
          },
        });
        return ok(mapAiGenerationAuditLogRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async completeSuccess(input) {
      try {
        // Tenant-scoped existence check via the composite key: a row is found
        // only when BOTH id and businessId match.
        const existing = await db.aiGenerationAuditLog.findUnique({
          where: {
            id_businessId: {
              id: input.auditLogId,
              businessId: input.businessId,
            },
          },
        });
        if (!existing) {
          return err(NOT_FOUND_CODE, NOT_FOUND_MSG);
        }
        // An attempt may only complete ONCE: a terminal record (SUCCEEDED or
        // FAILED) is immutable, so its outcome can never be overwritten.
        if (existing.status !== 'STARTED') {
          return err(INVALID_TRANSITION_CODE, INVALID_TRANSITION_MSG);
        }
        const record = await db.aiGenerationAuditLog.update({
          where: {
            id_businessId: {
              id: input.auditLogId,
              businessId: input.businessId,
            },
          },
          data: {
            status: 'SUCCEEDED',
            completedAt: new Date(),
            replyDraftId: input.replyDraftId ?? undefined,
            providerId: input.providerId ?? undefined,
            modelId: input.modelId ?? undefined,
            providerRequestId: input.providerRequestId ?? undefined,
            finishReason: input.finishReason ?? undefined,
            promptTokens: input.promptTokens ?? undefined,
            completionTokens: input.completionTokens ?? undefined,
            totalTokens: input.totalTokens ?? undefined,
            resultCharCount: input.resultCharCount ?? undefined,
          },
        });
        return ok(mapAiGenerationAuditLogRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async completeFailure(input) {
      try {
        const existing = await db.aiGenerationAuditLog.findUnique({
          where: {
            id_businessId: {
              id: input.auditLogId,
              businessId: input.businessId,
            },
          },
        });
        if (!existing) {
          return err(NOT_FOUND_CODE, NOT_FOUND_MSG);
        }
        // An attempt may only complete ONCE: a terminal record (SUCCEEDED or
        // FAILED) is immutable, so its outcome can never be overwritten.
        if (existing.status !== 'STARTED') {
          return err(INVALID_TRANSITION_CODE, INVALID_TRANSITION_MSG);
        }
        const record = await db.aiGenerationAuditLog.update({
          where: {
            id_businessId: {
              id: input.auditLogId,
              businessId: input.businessId,
            },
          },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorCode: input.errorCode,
            errorMessage: input.errorMessage ?? undefined,
            replyDraftId: input.replyDraftId ?? undefined,
            providerId: input.providerId ?? undefined,
            modelId: input.modelId ?? undefined,
          },
        });
        return ok(mapAiGenerationAuditLogRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async findByBusinessAndId(businessId, auditLogId) {
      try {
        const record = await db.aiGenerationAuditLog.findUnique({
          where: { id_businessId: { id: auditLogId, businessId } },
        });
        if (!record) return ok(null);
        return ok(mapAiGenerationAuditLogRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Service — validation + bounding + sanitization
// ---------------------------------------------------------------------------

const INVALID_INPUT_CODE = 'AI_AUDIT_INVALID_INPUT';
const INVALID_INPUT_MSG = 'Invalid AI generation audit input';

/**
 * Bounds and REDACTS a free-text audit string (warnings / error messages)
 * before persistence. It is intentionally conservative defense-in-depth, NOT a
 * perfect sanitizer:
 *   - collapses control characters and runs of whitespace to single spaces;
 *   - redacts email-like substrings as `[redacted-email]`;
 *   - redacts phone-like substrings as `[redacted-phone]`;
 *   - truncates to `max` characters.
 * Audit free text should already be bounded operator/system advisories — this
 * keeps an accidental PII fragment out of the record rather than guaranteeing
 * the input was clean.
 */
function sanitizeAuditText(value: string, max: number): string {
  const normalized = value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-phone]');

  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

const idArraySchema = z
  .array(z.string().min(1).max(MAX_SHORT_TEXT))
  .max(MAX_ID_ITEMS)
  .optional();

const startSchema = z.object({
  businessId: z.string().uuid(),
  operation: z.enum(AI_PROVIDER_OPERATION_VALUES),
  conversationId: z.string().uuid().nullish(),
  replyDraftId: z.string().uuid().nullish(),
  promptVersion: z.string().min(1).max(MAX_SHORT_TEXT).nullish(),
  contextHash: z.string().min(1).max(MAX_SHORT_TEXT).nullish(),
  includedContextItemIds: idArraySchema,
  omittedContextItemIds: idArraySchema,
  // Warnings are bounded + redacted (in the service), not rejected, so a long
  // advisory never drops the audit. Only the array length is capped here.
  warnings: z.array(z.string()).max(MAX_WARNING_ITEMS).optional(),
  providerId: z.string().min(1).max(MAX_SHORT_TEXT).nullish(),
  modelId: z.string().min(1).max(MAX_SHORT_TEXT).nullish(),
  promptCharCount: z.number().int().nonnegative().nullish(),
});

const successSchema = z.object({
  auditLogId: z.string().uuid(),
  businessId: z.string().uuid(),
  replyDraftId: z.string().uuid().nullish(),
  providerId: z.string().min(1).max(MAX_SHORT_TEXT).nullish(),
  modelId: z.string().min(1).max(MAX_SHORT_TEXT).nullish(),
  providerRequestId: z.string().min(1).max(MAX_SHORT_TEXT).nullish(),
  finishReason: z.enum(AI_PROVIDER_FINISH_REASON_VALUES).nullish(),
  promptTokens: z.number().int().nonnegative().nullish(),
  completionTokens: z.number().int().nonnegative().nullish(),
  totalTokens: z.number().int().nonnegative().nullish(),
  resultCharCount: z.number().int().nonnegative().nullish(),
});

const failureSchema = z.object({
  auditLogId: z.string().uuid(),
  businessId: z.string().uuid(),
  errorCode: z.string().min(1).max(MAX_SHORT_TEXT),
  // errorMessage is bounded + redacted (below), not rejected, so an attempt is
  // never lost just because its message is long.
  errorMessage: z.string().nullish(),
  providerId: z.string().min(1).max(MAX_SHORT_TEXT).nullish(),
  modelId: z.string().min(1).max(MAX_SHORT_TEXT).nullish(),
  replyDraftId: z.string().uuid().nullish(),
});

/** Service boundary for recording AI generation audit lifecycle events. */
export interface AiGenerationAuditService {
  start(
    input: StartAiGenerationAuditInput,
  ): Promise<ActionResult<AiGenerationAuditLog>>;
  completeSuccess(
    input: CompleteAiGenerationAuditSuccessInput,
  ): Promise<ActionResult<AiGenerationAuditLog>>;
  completeFailure(
    input: CompleteAiGenerationAuditFailureInput,
  ): Promise<ActionResult<AiGenerationAuditLog>>;
}

/** Dependencies for the AI generation audit service. */
export interface AiGenerationAuditServiceDeps {
  readonly repository: AiGenerationAuditRepository;
}

/** Creates a validating AI generation audit service over the given repository. */
export function createAiGenerationAuditService(
  deps: AiGenerationAuditServiceDeps,
): AiGenerationAuditService {
  const { repository } = deps;

  return {
    async start(input) {
      const parsed = startSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      const data = parsed.data;
      return repository.start({
        businessId: data.businessId,
        operation: data.operation,
        conversationId: data.conversationId ?? null,
        replyDraftId: data.replyDraftId ?? null,
        promptVersion: data.promptVersion ?? null,
        contextHash: data.contextHash ?? null,
        includedContextItemIds: data.includedContextItemIds,
        omittedContextItemIds: data.omittedContextItemIds,
        // Warnings are bounded + redacted before persistence.
        warnings: data.warnings?.map((w) =>
          sanitizeAuditText(w, MAX_MESSAGE_TEXT),
        ),
        providerId: data.providerId ?? null,
        modelId: data.modelId ?? null,
        promptCharCount: data.promptCharCount ?? null,
      });
    },

    async completeSuccess(input) {
      const parsed = successSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      return repository.completeSuccess(parsed.data);
    },

    async completeFailure(input) {
      const parsed = failureSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      const data = parsed.data;
      return repository.completeFailure({
        ...data,
        // The error message is bounded + redacted before persistence.
        errorMessage:
          typeof data.errorMessage === 'string'
            ? sanitizeAuditText(data.errorMessage, MAX_MESSAGE_TEXT)
            : (data.errorMessage ?? null),
      });
    },
  };
}
