-- AlterTable
ALTER TABLE "reply_drafts" ADD COLUMN "sent_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "reply_drafts" ADD COLUMN "sent_by_user_id" UUID;
