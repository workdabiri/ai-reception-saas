-- B-R2: Verified business-context store + provenance (PRD-v1.1 §5.1)
--
-- Additive migration. Creates a tenant-scoped business-context store where each
-- item carries a verification status and provenance, so that ONLY VERIFIED,
-- business-approved context may later be eligible for AI prompt usage. DRAFT
-- and ARCHIVED items are never usable AI context.
--
-- Safe for existing data: this is a brand-new table, so no data backfill is
-- required and no existing column/table is altered. RLS is enabled to match the
-- tenant-table pattern used by conversations / messages / reply_drafts.

-- CreateEnum
CREATE TYPE "BusinessContextItemStatus" AS ENUM ('DRAFT', 'VERIFIED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BusinessContextItemSourceType" AS ENUM ('OWNER_APPROVED', 'OPERATOR_APPROVED', 'SYSTEM_SEEDED', 'IMPORT', 'OTHER');

-- CreateTable
CREATE TABLE "business_context_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "status" "BusinessContextItemStatus" NOT NULL DEFAULT 'DRAFT',
    "source_type" "BusinessContextItemSourceType" NOT NULL,
    "source_label" TEXT,
    "source_url" TEXT,
    "source_metadata" JSONB,
    "verified_by_user_id" UUID,
    "verified_at" TIMESTAMP(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_context_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_context_items_business_id_idx" ON "business_context_items"("business_id");

-- CreateIndex
CREATE INDEX "business_context_items_business_id_status_idx" ON "business_context_items"("business_id", "status");

-- CreateIndex
CREATE INDEX "business_context_items_business_id_category_idx" ON "business_context_items"("business_id", "category");

-- CreateUniqueConstraint (composite for tenant-safe FK targeting, consistent with Area A hardening)
ALTER TABLE "business_context_items" ADD CONSTRAINT "business_context_items_id_business_id_key" UNIQUE ("id", "business_id");

-- AddForeignKey
ALTER TABLE "business_context_items" ADD CONSTRAINT "business_context_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EnableRowLevelSecurity
ALTER TABLE "business_context_items" ENABLE ROW LEVEL SECURITY;
