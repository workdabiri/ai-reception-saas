// ===========================================================================
// Prisma Seed — Service Catalog Pilot Data
//
// Seeds 5 categories and 5 pilot services per L1-v1 source catalog.
// Uses upsert with slug as key for idempotency.
//
// Uses Prisma 7 driver adapter pattern (PrismaPg) — matches src/lib/prisma.ts.
// Cannot import from @/ paths since seed runs via `npx tsx` outside Next.js.
//
// Category taxonomy: 02_PILOT_SERVICE_CATALOG / 11_FULL_SERVICE_CATALOG_REFERENCE
// ===========================================================================

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run seed.');
}

const adapter = new PrismaPg(databaseUrl);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding service catalog...');

  // -------------------------------------------------------------------------
  // Categories — aligned with L1-v1 source catalog taxonomy
  // -------------------------------------------------------------------------

  const taxServices = await prisma.serviceCategory.upsert({
    where: { slug: 'tax-services' },
    update: {},
    create: {
      name: 'Tax Services',
      nameFA: 'خدمات مالیاتی',
      slug: 'tax-services',
      description: 'Tax registration, filings, and compliance services',
      sortOrder: 1,
    },
  });

  const bankingServices = await prisma.serviceCategory.upsert({
    where: { slug: 'banking-services' },
    update: {},
    create: {
      name: 'Banking Services',
      nameFA: 'خدمات بانکی',
      slug: 'banking-services',
      description: 'Business bank account opening and banking services',
      sortOrder: 2,
    },
  });

  const renewalServices = await prisma.serviceCategory.upsert({
    where: { slug: 'renewal-services' },
    update: {},
    create: {
      name: 'Renewal Services',
      nameFA: 'خدمات تمدید',
      slug: 'renewal-services',
      description: 'License, permit, and registration renewal services',
      sortOrder: 3,
    },
  });

  const tourismServices = await prisma.serviceCategory.upsert({
    where: { slug: 'tourism-services' },
    update: {},
    create: {
      name: 'Tourism Services',
      nameFA: 'خدمات گردشگری',
      slug: 'tourism-services',
      description: 'Visa applications and tourism-related services',
      sortOrder: 4,
    },
  });

  const licenseModificationServices = await prisma.serviceCategory.upsert({
    where: { slug: 'license-modification-services' },
    update: {},
    create: {
      name: 'License Modification Services',
      nameFA: 'خدمات تغییر مجوز',
      slug: 'license-modification-services',
      description: 'Business license amendments, name changes, and modifications',
      sortOrder: 5,
    },
  });

  console.log(
    `  ✅ Categories: ${taxServices.id}, ${bankingServices.id}, ${renewalServices.id}, ${tourismServices.id}, ${licenseModificationServices.id}`,
  );

  // -------------------------------------------------------------------------
  // Pilot Services — codes from 11_FULL_SERVICE_CATALOG_REFERENCE
  // -------------------------------------------------------------------------

  const services = [
    {
      slug: 'corporate-tax-registration',
      code: 'TAX-001',
      name: 'Corporate Tax Registration',
      nameFA: 'ثبت مالیاتی شرکت',
      description: 'Register your company for corporate tax obligations',
      descriptionFA: 'ثبت شرکت شما برای تعهدات مالیاتی شرکتی',
      categoryId: taxServices.id,
      estimatedDays: 14,
      currency: 'AED',
      sortOrder: 1,
    },
    {
      slug: 'business-account-opening-low-risk',
      code: 'BNK-001',
      name: 'Business Account Opening – Low Risk Activities',
      nameFA: 'افتتاح حساب تجاری – فعالیت‌های کم‌ریسک',
      description: 'Open a business bank account for low-risk activity company profiles',
      descriptionFA: 'افتتاح حساب بانکی تجاری برای شرکت‌های با فعالیت‌های کم‌ریسک',
      categoryId: bankingServices.id,
      estimatedDays: 7,
      currency: 'AED',
      sortOrder: 1,
    },
    {
      slug: 'trade-license-renewal',
      code: 'REN-004',
      name: 'Trade License Renewal',
      nameFA: 'تمدید جواز کسب',
      description: 'Renew your existing trade license before expiration',
      descriptionFA: 'تمدید جواز کسب موجود شما قبل از انقضا',
      categoryId: renewalServices.id,
      estimatedDays: 10,
      currency: 'AED',
      sortOrder: 1,
    },
    {
      slug: '30-days-tourist-visa',
      code: 'TRV-001',
      name: '30 Days Tourist Visa',
      nameFA: 'ویزای توریستی ۳۰ روزه',
      description: 'Apply for a 30-day tourist visa',
      descriptionFA: 'درخواست ویزای توریستی ۳۰ روزه',
      categoryId: tourismServices.id,
      estimatedDays: 5,
      currency: 'AED',
      sortOrder: 1,
    },
    {
      slug: 'change-business-name',
      code: 'LICMOD-002',
      name: 'Change Business Name',
      nameFA: 'تغییر نام کسب‌وکار',
      description: 'Officially change your registered business name',
      descriptionFA: 'تغییر رسمی نام ثبت‌شده کسب‌وکار شما',
      categoryId: licenseModificationServices.id,
      estimatedDays: 21,
      currency: 'AED',
      sortOrder: 1,
    },
  ];

  for (const svc of services) {
    await prisma.service.upsert({
      where: { slug: svc.slug },
      update: {},
      create: svc,
    });
  }

  console.log(`  ✅ Services: ${services.length} pilot services seeded`);
  console.log('🌱 Seed complete.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
