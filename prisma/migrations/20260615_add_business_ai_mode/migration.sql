-- B-R1: Business AI mode + default-off kill switch (PRD-v1.1 §5)
--
-- Additive, backfill-safe migration. Adds a per-business AI operating mode.
-- Existing businesses default to MANUAL (Level 1 / AI generation disabled),
-- so no data backfill is required and AI remains off unless explicitly enabled.

-- CreateEnum
CREATE TYPE "BusinessAiMode" AS ENUM ('MANUAL', 'AI_ASSISTED');

-- AlterTable
ALTER TABLE "businesses"
  ADD COLUMN "ai_mode" "BusinessAiMode" NOT NULL DEFAULT 'MANUAL';
