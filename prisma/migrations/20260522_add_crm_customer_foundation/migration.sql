-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContactMethodType" AS ENUM ('EMAIL', 'PHONE', 'WHATSAPP', 'INSTAGRAM', 'TELEGRAM', 'WEBSITE_CHAT', 'CUSTOM');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "locale" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contact_methods" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "type" "ContactMethodType" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_contact_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_business_id_status_idx" ON "customers"("business_id", "status");

-- CreateIndex
CREATE INDEX "customers_business_id_created_at_idx" ON "customers"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "customers_business_id_display_name_idx" ON "customers"("business_id", "display_name");

-- CreateIndex
CREATE INDEX "customer_contact_methods_customer_id_idx" ON "customer_contact_methods"("customer_id");

-- CreateIndex
CREATE INDEX "customer_contact_methods_business_id_type_idx" ON "customer_contact_methods"("business_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "customer_contact_methods_business_id_type_value_key" ON "customer_contact_methods"("business_id", "type", "value");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_methods" ADD CONSTRAINT "customer_contact_methods_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_methods" ADD CONSTRAINT "customer_contact_methods_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
