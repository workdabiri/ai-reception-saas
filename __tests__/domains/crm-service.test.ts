// ===========================================================================
// Tests — CRM Service
//
// Verifies CRM service logic with mock repository.
// ===========================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from '@/lib/result';
import type { CrmRepository } from '@/domains/crm/repository';
import { createCrmService } from '@/domains/crm/implementation';
import type { CrmService } from '@/domains/crm/service';

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------

const BUSINESS_ID = '550e8400-e29b-41d4-a716-446655440000';
const CUSTOMER_ID = '660e8400-e29b-41d4-a716-446655440000';
const CONTACT_ID = '770e8400-e29b-41d4-a716-446655440000';
const OTHER_BIZ_ID = '880e8400-e29b-41d4-a716-446655440000';

const MOCK_CUSTOMER = {
  id: CUSTOMER_ID,
  businessId: BUSINESS_ID,
  displayName: 'Test Customer',
  status: 'ACTIVE' as const,
  locale: null,
  notes: null,
  metadata: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  contactMethods: [],
};

const MOCK_CONTACT = {
  id: CONTACT_ID,
  customerId: CUSTOMER_ID,
  businessId: BUSINESS_ID,
  type: 'EMAIL' as const,
  value: 'test@test.com',
  label: null,
  isPrimary: true,
  verified: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function createMockRepository(): CrmRepository {
  return {
    createCustomer: vi.fn().mockResolvedValue(ok(MOCK_CUSTOMER)),
    updateCustomer: vi.fn().mockResolvedValue(ok(MOCK_CUSTOMER)),
    findCustomerById: vi.fn().mockResolvedValue(ok(MOCK_CUSTOMER)),
    listCustomers: vi.fn().mockResolvedValue(ok({ data: [MOCK_CUSTOMER], nextCursor: null })),
    findByContactMethod: vi.fn().mockResolvedValue(ok(null)),
    createContactMethod: vi.fn().mockResolvedValue(ok(MOCK_CONTACT)),
    updateContactMethod: vi.fn().mockResolvedValue(ok(MOCK_CONTACT)),
    deleteContactMethod: vi.fn().mockResolvedValue(ok(MOCK_CONTACT)),
    findContactMethodById: vi.fn().mockResolvedValue(ok(MOCK_CONTACT)),
    listContactMethods: vi.fn().mockResolvedValue(ok([MOCK_CONTACT])),
  };
}

let mockRepo: ReturnType<typeof createMockRepository>;
let service: CrmService;

beforeEach(() => {
  mockRepo = createMockRepository();
  service = createCrmService({ repository: mockRepo });
});

// ---------------------------------------------------------------------------
// createCustomer
// ---------------------------------------------------------------------------

describe('CrmService.createCustomer', () => {
  it('creates customer with valid input', async () => {
    const result = await service.createCustomer({
      businessId: BUSINESS_ID,
      displayName: 'John Doe',
    });
    expect(result.ok).toBe(true);
    expect(mockRepo.createCustomer).toHaveBeenCalledOnce();
  });

  it('rejects invalid businessId', async () => {
    const result = await service.createCustomer({
      businessId: 'bad-uuid',
      displayName: 'John',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CRM_INPUT');
    }
  });

  it('rejects empty displayName', async () => {
    const result = await service.createCustomer({
      businessId: BUSINESS_ID,
      displayName: '',
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateCustomer
// ---------------------------------------------------------------------------

describe('CrmService.updateCustomer', () => {
  it('updates customer with valid input', async () => {
    const result = await service.updateCustomer(CUSTOMER_ID, BUSINESS_ID, {
      displayName: 'Updated Name',
    });
    expect(result.ok).toBe(true);
    expect(mockRepo.updateCustomer).toHaveBeenCalledOnce();
  });

  it('rejects if customer not found', async () => {
    vi.mocked(mockRepo.findCustomerById).mockResolvedValueOnce(ok(null));
    const result = await service.updateCustomer(CUSTOMER_ID, BUSINESS_ID, {
      displayName: 'Test',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CUSTOMER_NOT_FOUND');
    }
  });

  it('rejects empty update', async () => {
    const result = await service.updateCustomer(CUSTOMER_ID, BUSINESS_ID, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CRM_INPUT');
    }
  });

  it('rejects invalid customerId', async () => {
    const result = await service.updateCustomer('bad', BUSINESS_ID, {
      displayName: 'Test',
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findCustomerById
// ---------------------------------------------------------------------------

describe('CrmService.findCustomerById', () => {
  it('returns customer when found', async () => {
    const result = await service.findCustomerById({
      customerId: CUSTOMER_ID,
      businessId: BUSINESS_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.id).toBe(CUSTOMER_ID);
    }
  });

  it('returns null when not found', async () => {
    vi.mocked(mockRepo.findCustomerById).mockResolvedValueOnce(ok(null));
    const result = await service.findCustomerById({
      customerId: CUSTOMER_ID,
      businessId: BUSINESS_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeNull();
    }
  });

  it('rejects invalid UUID', async () => {
    const result = await service.findCustomerById({
      customerId: 'bad',
      businessId: BUSINESS_ID,
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listCustomers
// ---------------------------------------------------------------------------

describe('CrmService.listCustomers', () => {
  it('lists customers with default limit', async () => {
    const result = await service.listCustomers({
      businessId: BUSINESS_ID,
    });
    expect(result.ok).toBe(true);
  });

  it('lists with search filter', async () => {
    const result = await service.listCustomers({
      businessId: BUSINESS_ID,
      search: 'john',
      status: 'ACTIVE',
    });
    expect(result.ok).toBe(true);
    expect(mockRepo.listCustomers).toHaveBeenCalledOnce();
  });

  it('rejects invalid businessId', async () => {
    const result = await service.listCustomers({
      businessId: 'bad',
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// archiveCustomer
// ---------------------------------------------------------------------------

describe('CrmService.archiveCustomer', () => {
  it('archives existing customer', async () => {
    const result = await service.archiveCustomer({
      customerId: CUSTOMER_ID,
      businessId: BUSINESS_ID,
    });
    expect(result.ok).toBe(true);
    expect(mockRepo.updateCustomer).toHaveBeenCalledWith(
      CUSTOMER_ID,
      { status: 'ARCHIVED' },
    );
  });

  it('rejects if customer not found', async () => {
    vi.mocked(mockRepo.findCustomerById).mockResolvedValueOnce(ok(null));
    const result = await service.archiveCustomer({
      customerId: CUSTOMER_ID,
      businessId: BUSINESS_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CUSTOMER_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// findOrCreateByContact
// ---------------------------------------------------------------------------

describe('CrmService.findOrCreateByContact', () => {
  it('returns existing customer when contact method matches', async () => {
    vi.mocked(mockRepo.findByContactMethod).mockResolvedValueOnce(
      ok({ ...MOCK_CUSTOMER, contactMethods: [MOCK_CONTACT] }),
    );
    const result = await service.findOrCreateByContact({
      businessId: BUSINESS_ID,
      type: 'EMAIL',
      value: 'test@test.com',
    });
    expect(result.ok).toBe(true);
    expect(mockRepo.createCustomer).not.toHaveBeenCalled();
  });

  it('creates new customer when no contact method match', async () => {
    vi.mocked(mockRepo.findByContactMethod).mockResolvedValueOnce(ok(null));
    const result = await service.findOrCreateByContact({
      businessId: BUSINESS_ID,
      type: 'EMAIL',
      value: 'new@test.com',
    });
    expect(result.ok).toBe(true);
    expect(mockRepo.createCustomer).toHaveBeenCalledOnce();
    expect(mockRepo.createContactMethod).toHaveBeenCalledOnce();
  });

  it('uses displayName when provided', async () => {
    vi.mocked(mockRepo.findByContactMethod).mockResolvedValueOnce(ok(null));
    await service.findOrCreateByContact({
      businessId: BUSINESS_ID,
      type: 'EMAIL',
      value: 'new@test.com',
      displayName: 'Custom Name',
    });
    expect(mockRepo.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Custom Name' }),
    );
  });

  it('normalizes email in identity resolution', async () => {
    vi.mocked(mockRepo.findByContactMethod).mockResolvedValueOnce(ok(null));
    await service.findOrCreateByContact({
      businessId: BUSINESS_ID,
      type: 'EMAIL',
      value: 'TEST@Example.COM',
    });
    expect(mockRepo.findByContactMethod).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'test@example.com' }),
    );
  });

  it('rejects invalid input', async () => {
    const result = await service.findOrCreateByContact({
      businessId: 'bad',
      type: 'EMAIL',
      value: 'test@test.com',
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addContactMethod
// ---------------------------------------------------------------------------

describe('CrmService.addContactMethod', () => {
  it('adds contact method to existing customer', async () => {
    const result = await service.addContactMethod({
      customerId: CUSTOMER_ID,
      businessId: BUSINESS_ID,
      type: 'PHONE',
      value: '+14155552671',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects if customer not found', async () => {
    vi.mocked(mockRepo.findCustomerById).mockResolvedValueOnce(ok(null));
    const result = await service.addContactMethod({
      customerId: CUSTOMER_ID,
      businessId: BUSINESS_ID,
      type: 'EMAIL',
      value: 'test@test.com',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CUSTOMER_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// removeContactMethod
// ---------------------------------------------------------------------------

describe('CrmService.removeContactMethod', () => {
  it('removes existing contact method', async () => {
    const result = await service.removeContactMethod({
      contactMethodId: CONTACT_ID,
      businessId: BUSINESS_ID,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects if contact method not found', async () => {
    vi.mocked(mockRepo.findContactMethodById).mockResolvedValueOnce(ok(null));
    const result = await service.removeContactMethod({
      contactMethodId: CONTACT_ID,
      businessId: BUSINESS_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONTACT_METHOD_NOT_FOUND');
    }
  });

  it('rejects if contact method belongs to different business', async () => {
    vi.mocked(mockRepo.findContactMethodById).mockResolvedValueOnce(
      ok({ ...MOCK_CONTACT, businessId: OTHER_BIZ_ID }),
    );
    const result = await service.removeContactMethod({
      contactMethodId: CONTACT_ID,
      businessId: BUSINESS_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONTACT_METHOD_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe('CRM tenant isolation', () => {
  it('updateCustomer verifies business ownership', async () => {
    vi.mocked(mockRepo.findCustomerById).mockResolvedValueOnce(ok(null));
    const result = await service.updateCustomer(CUSTOMER_ID, OTHER_BIZ_ID, {
      displayName: 'Hacked',
    });
    expect(result.ok).toBe(false);
  });

  it('archiveCustomer verifies business ownership', async () => {
    vi.mocked(mockRepo.findCustomerById).mockResolvedValueOnce(ok(null));
    const result = await service.archiveCustomer({
      customerId: CUSTOMER_ID,
      businessId: OTHER_BIZ_ID,
    });
    expect(result.ok).toBe(false);
  });

  it('removeContactMethod verifies business ownership', async () => {
    vi.mocked(mockRepo.findContactMethodById).mockResolvedValueOnce(
      ok({ ...MOCK_CONTACT, businessId: OTHER_BIZ_ID }),
    );
    const result = await service.removeContactMethod({
      contactMethodId: CONTACT_ID,
      businessId: BUSINESS_ID,
    });
    expect(result.ok).toBe(false);
  });
});
