-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('NEW', 'OPEN', 'ASSIGNED', 'WAITING_CUSTOMER', 'WAITING_OPERATOR', 'ESCALATED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'SYSTEM', 'INTERNAL');

-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('CUSTOMER', 'OPERATOR', 'SYSTEM', 'AI_RECEPTIONIST');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('INTERNAL', 'WEBSITE_CHAT');

-- CreateEnum
CREATE TYPE "AiClassificationStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "AiDraftStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'READY', 'APPROVED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "customer_id" UUID,
    "channel" "ChannelType" NOT NULL DEFAULT 'INTERNAL',
    "status" "ConversationStatus" NOT NULL DEFAULT 'NEW',
    "subject" TEXT,
    "assigned_user_id" UUID,
    "ai_classification_status" "AiClassificationStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "ai_draft_status" "AiDraftStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "channel_metadata" JSONB,
    "metadata" JSONB,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "sender_type" "MessageSenderType" NOT NULL,
    "sender_user_id" UUID,
    "sender_customer_id" UUID,
    "content" TEXT NOT NULL,
    "content_type" TEXT NOT NULL DEFAULT 'text/plain',
    "channel_metadata" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_business_id_status_idx" ON "conversations"("business_id", "status");

-- CreateIndex
CREATE INDEX "conversations_business_id_created_at_idx" ON "conversations"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "conversations_business_id_assigned_user_id_idx" ON "conversations"("business_id", "assigned_user_id");

-- CreateIndex
CREATE INDEX "conversations_customer_id_idx" ON "conversations"("customer_id");

-- CreateIndex
CREATE INDEX "conversations_business_id_channel_idx" ON "conversations"("business_id", "channel");

-- CreateUniqueConstraint (composite for tenant-safe FK from messages)
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_id_business_id_key" UNIQUE ("id", "business_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_business_id_created_at_idx" ON "messages"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_sender_user_id_idx" ON "messages"("sender_user_id");

-- CreateIndex
CREATE INDEX "messages_sender_customer_id_idx" ON "messages"("sender_customer_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (composite: enforce message.business_id == conversation.business_id)
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_business_id_fkey" FOREIGN KEY ("conversation_id", "business_id") REFERENCES "conversations"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_customer_id_fkey" FOREIGN KEY ("sender_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- EnableRowLevelSecurity
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
