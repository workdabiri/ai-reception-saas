-- CreateEnum
CREATE TYPE "ReplyDraftSource" AS ENUM ('AI', 'SYSTEM', 'OPERATOR');

-- CreateEnum
CREATE TYPE "ReplyDraftStatus" AS ENUM ('PENDING_REVIEW', 'EDITED', 'APPROVED', 'DISCARDED', 'SENT');

-- CreateTable
CREATE TABLE "reply_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "source_message_id" UUID,
    "created_by_user_id" UUID,
    "source" "ReplyDraftSource" NOT NULL DEFAULT 'SYSTEM',
    "status" "ReplyDraftStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "draft_text" TEXT NOT NULL,
    "original_text" TEXT,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "sent_message_id" UUID,
    "model_provider" TEXT,
    "model_name" TEXT,
    "prompt_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reply_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reply_drafts_business_id_status_idx" ON "reply_drafts"("business_id", "status");

-- CreateIndex
CREATE INDEX "reply_drafts_conversation_id_status_idx" ON "reply_drafts"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "reply_drafts_business_id_created_at_idx" ON "reply_drafts"("business_id", "created_at");

-- AddForeignKey
ALTER TABLE "reply_drafts" ADD CONSTRAINT "reply_drafts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reply_drafts" ADD CONSTRAINT "reply_drafts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EnableRLS
ALTER TABLE "reply_drafts" ENABLE ROW LEVEL SECURITY;
