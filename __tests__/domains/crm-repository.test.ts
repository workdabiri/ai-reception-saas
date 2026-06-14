// ===========================================================================
// Tests — CRM Repository
//
// Direct repository-level tests for the CRM persistence boundary.
// Focused on the contact-method listing query: A-H3 defense-in-depth requires
// the Prisma where clause to scope by BOTH customerId and businessId.
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';

import { createCrmRepository } from '../../src/domains/crm/repository';
import type {
  CrmRepositoryDb,
  ContactMethodRecord,
} from '../../src/domains/crm/repository';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUSINESS_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_BIZ_ID = '880e8400-e29b-41d4-a716-446655440000';
const CUSTOMER_ID = '660e8400-e29b-41d4-a716-446655440000';
const CONTACT_ID = '770e8400-e29b-41d4-a716-446655440000';
const NOW = new Date('2026-06-06T12:00:00.000Z');

const CONTACT_RECORD: ContactMethodRecord = {
  id: CONTACT_ID,
  customerId: CUSTOMER_ID,
  businessId: BUSINESS_ID,
  type: 'EMAIL',
  value: 'test@test.com',
  label: null,
  isPrimary: true,
  verified: false,
  createdAt: NOW,
  updatedAt: NOW,
};

// ---------------------------------------------------------------------------
// Mock DB factory
// ---------------------------------------------------------------------------

function createMockDb(): CrmRepositoryDb {
  return {
    customer: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    customerContactMethod: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([CONTACT_RECORD]),
    },
  } as unknown as CrmRepositoryDb;
}

// ---------------------------------------------------------------------------
// listContactMethods
// ---------------------------------------------------------------------------

describe('CrmRepository.listContactMethods', () => {
  it('filters the query by BOTH customerId and businessId', async () => {
    const db = createMockDb();
    const repo = createCrmRepository(db);

    const result = await repo.listContactMethods(CUSTOMER_ID, BUSINESS_ID);

    expect(result.ok).toBe(true);
    expect(db.customerContactMethod.findMany).toHaveBeenCalledWith({
      where: { customerId: CUSTOMER_ID, businessId: BUSINESS_ID },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('maps records to domain contact-method identities', async () => {
    const db = createMockDb();
    const repo = createCrmRepository(db);

    const result = await repo.listContactMethods(CUSTOMER_ID, BUSINESS_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        {
          id: CONTACT_ID,
          customerId: CUSTOMER_ID,
          businessId: BUSINESS_ID,
          type: 'EMAIL',
          value: 'test@test.com',
          label: null,
          isPrimary: true,
          verified: false,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
      ]);
    }
  });

  it('scopes by the passed businessId (foreign business yields no rows)', async () => {
    const db = createMockDb();
    // Real Prisma would return [] for a non-owning business; assert the scope
    // value reaches the query so the DB can enforce it.
    vi.mocked(db.customerContactMethod.findMany).mockResolvedValueOnce([]);
    const repo = createCrmRepository(db);

    const result = await repo.listContactMethods(CUSTOMER_ID, OTHER_BIZ_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
    expect(db.customerContactMethod.findMany).toHaveBeenCalledWith({
      where: { customerId: CUSTOMER_ID, businessId: OTHER_BIZ_ID },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('returns a repository error when the query throws', async () => {
    const db = createMockDb();
    vi.mocked(db.customerContactMethod.findMany).mockRejectedValueOnce(
      new Error('db down'),
    );
    const repo = createCrmRepository(db);

    const result = await repo.listContactMethods(CUSTOMER_ID, BUSINESS_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CRM_REPOSITORY_ERROR');
    }
  });
});
