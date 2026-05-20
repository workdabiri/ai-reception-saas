// ===========================================================================
// Tests — Seed Data Structure Verification
//
// Verifies the seed file has the correct structure, categories, and services
// per L1-v1 source catalog / 02_PILOT_SERVICE_CATALOG.
// Does NOT execute the seed against a database — static analysis only.
// ===========================================================================

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SEED_PATH = path.resolve(__dirname, '../../prisma/seed.ts');

describe('Seed file structure', () => {
  const seedContent = fs.readFileSync(SEED_PATH, 'utf-8');

  it('seed file exists', () => {
    expect(fs.existsSync(SEED_PATH)).toBe(true);
  });

  it('uses PrismaClient', () => {
    expect(seedContent).toContain('PrismaClient');
  });

  it('uses upsert for idempotency', () => {
    // 5 category upserts + 1 service upsert in a for-loop = at least 6
    const upsertCount = (seedContent.match(/\.upsert\(/g) || []).length;
    expect(upsertCount).toBeGreaterThanOrEqual(6);
  });

  it('uses slug as unique key for upserts', () => {
    const whereSlugCount = (seedContent.match(/where:\s*\{\s*slug:/g) || []).length;
    expect(whereSlugCount).toBeGreaterThanOrEqual(6);
  });

  it('calls $disconnect in finally block', () => {
    expect(seedContent).toContain('$disconnect');
  });

  it('uses PrismaPg adapter (not raw PrismaClient())', () => {
    expect(seedContent).toContain("import { PrismaPg } from '@prisma/adapter-pg'");
    expect(seedContent).toContain('new PrismaPg(');
    expect(seedContent).toContain('PrismaClient({ adapter');
    // Must NOT have raw new PrismaClient() without adapter
    expect(seedContent).not.toMatch(/new PrismaClient\(\s*\)/);
  });

  it('checks DATABASE_URL before initialization', () => {
    expect(seedContent).toContain('DATABASE_URL');
    expect(seedContent).toContain('DATABASE_URL is required');
  });
});

// ===========================================================================
// Category taxonomy — per L1-v1 source catalog
// ===========================================================================

describe('Seed categories — L1-v1 source catalog taxonomy', () => {
  const seedContent = fs.readFileSync(SEED_PATH, 'utf-8');

  it('seeds Tax Services category', () => {
    expect(seedContent).toContain("slug: 'tax-services'");
    expect(seedContent).toContain("name: 'Tax Services'");
  });

  it('seeds Banking Services category', () => {
    expect(seedContent).toContain("slug: 'banking-services'");
    expect(seedContent).toContain("name: 'Banking Services'");
  });

  it('seeds Renewal Services category', () => {
    expect(seedContent).toContain("slug: 'renewal-services'");
    expect(seedContent).toContain("name: 'Renewal Services'");
  });

  it('seeds Tourism Services category', () => {
    expect(seedContent).toContain("slug: 'tourism-services'");
    expect(seedContent).toContain("name: 'Tourism Services'");
  });

  it('seeds License Modification Services category', () => {
    expect(seedContent).toContain("slug: 'license-modification-services'");
    expect(seedContent).toContain("name: 'License Modification Services'");
  });

  it('has 5 category upserts', () => {
    const categoryUpserts = (seedContent.match(/serviceCategory\.upsert/g) || []).length;
    expect(categoryUpserts).toBe(5);
  });
});

// ===========================================================================
// Pilot services — per 02_PILOT_SERVICE_CATALOG
// ===========================================================================

describe('Seed pilot services', () => {
  const seedContent = fs.readFileSync(SEED_PATH, 'utf-8');

  it('seeds Corporate Tax Registration (TAX-001)', () => {
    expect(seedContent).toContain("slug: 'corporate-tax-registration'");
    expect(seedContent).toContain("name: 'Corporate Tax Registration'");
    expect(seedContent).toContain("code: 'TAX-001'");
  });

  it('seeds Business Account Opening – Low Risk Activities (BNK-001)', () => {
    expect(seedContent).toContain("slug: 'business-account-opening-low-risk'");
    expect(seedContent).toContain("name: 'Business Account Opening – Low Risk Activities'");
    expect(seedContent).toContain("code: 'BNK-001'");
  });

  it('seeds Trade License Renewal (REN-004)', () => {
    expect(seedContent).toContain("slug: 'trade-license-renewal'");
    expect(seedContent).toContain("name: 'Trade License Renewal'");
    expect(seedContent).toContain("code: 'REN-004'");
  });

  it('seeds 30 Days Tourist Visa (TRV-001)', () => {
    expect(seedContent).toContain("slug: '30-days-tourist-visa'");
    expect(seedContent).toContain("name: '30 Days Tourist Visa'");
    expect(seedContent).toContain("code: 'TRV-001'");
  });

  it('seeds Change Business Name (LICMOD-002)', () => {
    expect(seedContent).toContain("slug: 'change-business-name'");
    expect(seedContent).toContain("name: 'Change Business Name'");
    expect(seedContent).toContain("code: 'LICMOD-002'");
  });

  it('all services have Farsi names (nameFA)', () => {
    const nameFACount = (seedContent.match(/nameFA:/g) || []).length;
    // 5 categories + 5 services = 10
    expect(nameFACount).toBeGreaterThanOrEqual(10);
  });

  it('all services have estimatedDays', () => {
    const estimatedDaysCount = (seedContent.match(/estimatedDays:/g) || []).length;
    expect(estimatedDaysCount).toBe(5);
  });

  it('all services explicitly set currency AED', () => {
    const aedCount = (seedContent.match(/currency:\s*'AED'/g) || []).length;
    expect(aedCount).toBe(5);
  });

  it('no pilot service uses IRR currency', () => {
    expect(seedContent).not.toContain("currency: 'IRR'");
  });
});

// ===========================================================================
// Category → Service mapping — exact PRD alignment
// ===========================================================================

describe('Pilot service → category mapping', () => {
  const seedContent = fs.readFileSync(SEED_PATH, 'utf-8');

  it('Corporate Tax Registration → Tax Services (taxServices.id)', () => {
    expect(seedContent).toContain("categoryId: taxServices.id");
  });

  it('Business Account Opening → Banking Services (bankingServices.id)', () => {
    expect(seedContent).toContain("categoryId: bankingServices.id");
  });

  it('Trade License Renewal → Renewal Services (renewalServices.id)', () => {
    expect(seedContent).toContain("categoryId: renewalServices.id");
  });

  it('30 Days Tourist Visa → Tourism Services (tourismServices.id)', () => {
    expect(seedContent).toContain("categoryId: tourismServices.id");
  });

  it('Change Business Name → License Modification Services (licenseModificationServices.id)', () => {
    expect(seedContent).toContain("categoryId: licenseModificationServices.id");
  });
});

// ===========================================================================
// Slug stability
// ===========================================================================

describe('Slug stability', () => {
  const seedContent = fs.readFileSync(SEED_PATH, 'utf-8');

  it('slugs contain only lowercase letters, numbers, and hyphens', () => {
    const slugMatches = seedContent.match(/slug:\s*'([^']+)'/g) || [];
    const slugs = slugMatches.map((m) => m.replace(/slug:\s*'/, '').replace(/'$/, ''));
    const uniqueSlugs = [...new Set(slugs)];
    for (const slug of uniqueSlugs) {
      expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    }
  });

  it('has exactly 10 unique slugs (5 categories + 5 services)', () => {
    const slugMatches = seedContent.match(/slug:\s*'([^']+)'/g) || [];
    const slugs = slugMatches.map((m) => m.replace(/slug:\s*'/, '').replace(/'$/, ''));
    const uniqueSlugs = new Set(slugs);
    expect(uniqueSlugs.size).toBe(10);
  });
});
