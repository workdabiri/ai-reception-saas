-- Area C P12-B: Web-chat channel binding foundation (Channels domain)
--
-- Additive migration. Creates a tenant-scoped web-chat channel binding so a
-- public, opaque widget key can later map to exactly one business. Each binding
-- stores ONLY a keyed hash of the widget key (never the plaintext), a
-- display-safe last-4 preview, an origin allowlist, and revocation/rotation
-- provenance.
--
-- SECURITY: the plaintext widget key is NEVER stored — only `widget_key_hash`
-- (a keyed/peppered hash) is persisted; the raw key is shown once at creation/
-- rotation and never read back. Rotation is immediate (no previous-key column,
-- no grace window). `status = REVOKED` is terminal — a revoked binding never
-- resolves.
--
-- Safe for existing data: this is a brand-new table and a new enum, so no data
-- backfill is required and no existing column/table is altered. RLS is enabled
-- to match the tenant-table pattern used by conversations / messages /
-- reply_drafts / business_context_items / ai_generation_audit_logs.

-- CreateEnum
CREATE TYPE "WebChatChannelBindingStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "web_chat_channel_bindings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "status" "WebChatChannelBindingStatus" NOT NULL DEFAULT 'ACTIVE',
    "widget_key_hash" TEXT NOT NULL,
    "widget_key_last4" TEXT NOT NULL,
    "key_rotated_at" TIMESTAMP(3),
    "allowed_origins" TEXT[],
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_chat_channel_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "web_chat_channel_bindings_business_id_idx" ON "web_chat_channel_bindings"("business_id");

-- CreateIndex
CREATE INDEX "web_chat_channel_bindings_business_id_status_idx" ON "web_chat_channel_bindings"("business_id", "status");

-- CreateUniqueConstraint (composite for tenant-safe single-row writes / FK targeting, consistent with Area A hardening)
ALTER TABLE "web_chat_channel_bindings" ADD CONSTRAINT "web_chat_channel_bindings_id_business_id_key" UNIQUE ("id", "business_id");

-- CreateUniqueConstraint (a widget key hash maps to exactly one binding)
ALTER TABLE "web_chat_channel_bindings" ADD CONSTRAINT "web_chat_channel_bindings_widget_key_hash_key" UNIQUE ("widget_key_hash");

-- AddForeignKey
ALTER TABLE "web_chat_channel_bindings" ADD CONSTRAINT "web_chat_channel_bindings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EnableRowLevelSecurity
ALTER TABLE "web_chat_channel_bindings" ENABLE ROW LEVEL SECURITY;
