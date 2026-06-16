-- B-R6: AI generation audit log + reply-draft AI metadata (PRD-v1.1 §5)
--
-- Additive migration. Creates a tenant-scoped AI generation audit log so every
-- AI generation ATTEMPT is traceable (business, prompt version, context hash,
-- backing verified item ids, provider/model, request id, finish reason, token
-- usage, linked draft, status, timestamps). It also adds METADATA-ONLY columns
-- to reply_drafts so a generated draft can record its provenance + audit link.
--
-- PRIVACY: this stores METADATA ONLY. There is deliberately NO column for the
-- raw prompt, the raw customer message, the conversation transcript, customer
-- email/phone, the provider's raw response content, or raw source metadata.
--
-- Safe for existing data: the new table is brand new and the reply_drafts
-- additions are all NULLABLE with no backfill required. No existing column is
-- altered. RLS is enabled on the new table to match the tenant-table pattern
-- used by conversations / messages / reply_drafts / business_context_items.

-- CreateEnum
CREATE TYPE "AiGenerationStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

-- AlterTable (reply_drafts: additive, nullable AI-generation metadata)
ALTER TABLE "reply_drafts" ADD COLUMN "ai_generation_audit_log_id" UUID;
ALTER TABLE "reply_drafts" ADD COLUMN "ai_context_hash" TEXT;
ALTER TABLE "reply_drafts" ADD COLUMN "ai_finish_reason" TEXT;
ALTER TABLE "reply_drafts" ADD COLUMN "ai_generated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ai_generation_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID,
    "reply_draft_id" UUID,
    "operation" TEXT NOT NULL,
    "status" "AiGenerationStatus" NOT NULL DEFAULT 'STARTED',
    "prompt_version" TEXT,
    "context_hash" TEXT,
    "included_context_item_ids" JSONB,
    "omitted_context_item_ids" JSONB,
    "warnings" JSONB,
    "provider_id" TEXT,
    "model_id" TEXT,
    "provider_request_id" TEXT,
    "finish_reason" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "total_tokens" INTEGER,
    "prompt_char_count" INTEGER,
    "result_char_count" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_generation_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_generation_audit_logs_business_id_created_at_idx" ON "ai_generation_audit_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_generation_audit_logs_business_id_status_idx" ON "ai_generation_audit_logs"("business_id", "status");

-- CreateIndex
CREATE INDEX "ai_generation_audit_logs_business_id_conversation_id_idx" ON "ai_generation_audit_logs"("business_id", "conversation_id");

-- CreateIndex
CREATE INDEX "ai_generation_audit_logs_reply_draft_id_idx" ON "ai_generation_audit_logs"("reply_draft_id");

-- CreateUniqueConstraint (composite for tenant-safe single-row writes, consistent with Area A hardening)
ALTER TABLE "ai_generation_audit_logs" ADD CONSTRAINT "ai_generation_audit_logs_id_business_id_key" UNIQUE ("id", "business_id");

-- AddForeignKey
ALTER TABLE "ai_generation_audit_logs" ADD CONSTRAINT "ai_generation_audit_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EnableRowLevelSecurity
ALTER TABLE "ai_generation_audit_logs" ENABLE ROW LEVEL SECURITY;
