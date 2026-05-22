// ===========================================================================
// Tests — CRM Domain Types and Validation
//
// Verifies enum values, domain type shapes, and Zod validation schemas.
// ===========================================================================

import { describe, it, expect } from 'vitest';

import {
  CUSTOMER_STATUS_VALUES,
  CONTACT_METHOD_TYPE_VALUES,
} from '@/domains/crm/types';

import {
  customerStatusSchema,
  contactMethodTypeSchema,
  normalizeContactValue,
  createCustomerInputSchema,
  updateCustomerInputSchema,
  createContactMethodInputSchema,
  updateContactMethodInputSchema,
  findOrCreateByContactInputSchema,
  listCustomersQuerySchema,
} from '@/domains/crm/validation';

// ---------------------------------------------------------------------------
// Enum values
// ---------------------------------------------------------------------------

describe('CRM enum values', () => {
  it('CustomerStatus has ACTIVE and ARCHIVED', () => {
    expect(CUSTOMER_STATUS_VALUES).toEqual(['ACTIVE', 'ARCHIVED']);
  });

  it('ContactMethodType has all expected values', () => {
    expect(CONTACT_METHOD_TYPE_VALUES).toEqual([
      'EMAIL',
      'PHONE',
      'WHATSAPP',
      'INSTAGRAM',
      'TELEGRAM',
      'WEBSITE_CHAT',
      'CUSTOM',
    ]);
  });

  it('customerStatusSchema validates known values', () => {
    expect(customerStatusSchema.parse('ACTIVE')).toBe('ACTIVE');
    expect(customerStatusSchema.parse('ARCHIVED')).toBe('ARCHIVED');
    expect(() => customerStatusSchema.parse('DELETED')).toThrow();
    expect(() => customerStatusSchema.parse('')).toThrow();
  });

  it('contactMethodTypeSchema validates known values', () => {
    expect(contactMethodTypeSchema.parse('EMAIL')).toBe('EMAIL');
    expect(contactMethodTypeSchema.parse('PHONE')).toBe('PHONE');
    expect(contactMethodTypeSchema.parse('WHATSAPP')).toBe('WHATSAPP');
    expect(contactMethodTypeSchema.parse('WEBSITE_CHAT')).toBe('WEBSITE_CHAT');
    expect(() => contactMethodTypeSchema.parse('FAX')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Contact value normalization
// ---------------------------------------------------------------------------

describe('normalizeContactValue', () => {
  it('normalizes email to lowercase', () => {
    const result = normalizeContactValue('EMAIL', 'Test@Example.COM');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe('test@example.com');
    }
  });

  it('rejects invalid email', () => {
    const result = normalizeContactValue('EMAIL', 'not-an-email');
    expect(result.success).toBe(false);
  });

  it('accepts valid E.164 phone', () => {
    const result = normalizeContactValue('PHONE', '+14155552671');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe('+14155552671');
    }
  });

  it('rejects invalid phone number', () => {
    const result = normalizeContactValue('PHONE', 'abc');
    expect(result.success).toBe(false);
  });

  it('applies phone validation for WHATSAPP type', () => {
    const result = normalizeContactValue('WHATSAPP', '+989121234567');
    expect(result.success).toBe(true);
  });

  it('accepts generic value for WEBSITE_CHAT', () => {
    const result = normalizeContactValue('WEBSITE_CHAT', 'visitor-session-abc123');
    expect(result.success).toBe(true);
  });

  it('accepts generic value for CUSTOM', () => {
    const result = normalizeContactValue('CUSTOM', 'custom-id-123');
    expect(result.success).toBe(true);
  });

  it('rejects empty generic value', () => {
    const result = normalizeContactValue('INSTAGRAM', '');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createCustomerInputSchema
// ---------------------------------------------------------------------------

describe('createCustomerInputSchema', () => {
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

  it('accepts valid input with all fields', () => {
    const result = createCustomerInputSchema.safeParse({
      businessId: VALID_UUID,
      displayName: 'John Doe',
      locale: 'en',
      notes: 'VIP customer',
      contactMethods: [
        { type: 'EMAIL', value: 'john@test.com' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal input (businessId + displayName only)', () => {
    const result = createCustomerInputSchema.safeParse({
      businessId: VALID_UUID,
      displayName: 'Jane',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing displayName', () => {
    const result = createCustomerInputSchema.safeParse({
      businessId: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty displayName', () => {
    const result = createCustomerInputSchema.safeParse({
      businessId: VALID_UUID,
      displayName: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects displayName over 200 chars', () => {
    const result = createCustomerInputSchema.safeParse({
      businessId: VALID_UUID,
      displayName: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('trims displayName', () => {
    const result = createCustomerInputSchema.safeParse({
      businessId: VALID_UUID,
      displayName: '  John  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe('John');
    }
  });

  it('rejects invalid businessId', () => {
    const result = createCustomerInputSchema.safeParse({
      businessId: 'not-a-uuid',
      displayName: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects notes over 5000 chars', () => {
    const result = createCustomerInputSchema.safeParse({
      businessId: VALID_UUID,
      displayName: 'Test',
      notes: 'x'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid locale', () => {
    const result = createCustomerInputSchema.safeParse({
      businessId: VALID_UUID,
      displayName: 'Test',
      locale: 'de',
    });
    expect(result.success).toBe(false);
  });

  it('accepts supported locales', () => {
    for (const loc of ['en', 'fa', 'ar']) {
      const result = createCustomerInputSchema.safeParse({
        businessId: VALID_UUID,
        displayName: 'Test',
        locale: loc,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// updateCustomerInputSchema
// ---------------------------------------------------------------------------

describe('updateCustomerInputSchema', () => {
  it('accepts partial update with displayName', () => {
    const result = updateCustomerInputSchema.safeParse({
      displayName: 'Updated Name',
    });
    expect(result.success).toBe(true);
  });

  it('accepts partial update with status', () => {
    const result = updateCustomerInputSchema.safeParse({
      status: 'ARCHIVED',
    });
    expect(result.success).toBe(true);
  });

  it('accepts nullable notes', () => {
    const result = updateCustomerInputSchema.safeParse({
      notes: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty update (no fields)', () => {
    const result = updateCustomerInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = updateCustomerInputSchema.safeParse({
      status: 'DELETED',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createContactMethodInputSchema
// ---------------------------------------------------------------------------

describe('createContactMethodInputSchema', () => {
  it('accepts valid email contact method', () => {
    const result = createContactMethodInputSchema.safeParse({
      type: 'EMAIL',
      value: 'test@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid phone contact method with label', () => {
    const result = createContactMethodInputSchema.safeParse({
      type: 'PHONE',
      value: '+14155552671',
      label: 'Work phone',
      isPrimary: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty value', () => {
    const result = createContactMethodInputSchema.safeParse({
      type: 'EMAIL',
      value: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown type', () => {
    const result = createContactMethodInputSchema.safeParse({
      type: 'FAX',
      value: '12345',
    });
    expect(result.success).toBe(false);
  });

  it('rejects label over 100 chars', () => {
    const result = createContactMethodInputSchema.safeParse({
      type: 'EMAIL',
      value: 'test@test.com',
      label: 'x'.repeat(101),
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateContactMethodInputSchema
// ---------------------------------------------------------------------------

describe('updateContactMethodInputSchema', () => {
  it('accepts label update', () => {
    const result = updateContactMethodInputSchema.safeParse({
      label: 'New label',
    });
    expect(result.success).toBe(true);
  });

  it('accepts isPrimary update', () => {
    const result = updateContactMethodInputSchema.safeParse({
      isPrimary: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts nullable label', () => {
    const result = updateContactMethodInputSchema.safeParse({
      label: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty update', () => {
    const result = updateContactMethodInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findOrCreateByContactInputSchema
// ---------------------------------------------------------------------------

describe('findOrCreateByContactInputSchema', () => {
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

  it('accepts valid input', () => {
    const result = findOrCreateByContactInputSchema.safeParse({
      businessId: VALID_UUID,
      type: 'EMAIL',
      value: 'test@test.com',
    });
    expect(result.success).toBe(true);
  });

  it('accepts with optional displayName', () => {
    const result = findOrCreateByContactInputSchema.safeParse({
      businessId: VALID_UUID,
      type: 'PHONE',
      value: '+14155552671',
      displayName: 'John Doe',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing businessId', () => {
    const result = findOrCreateByContactInputSchema.safeParse({
      type: 'EMAIL',
      value: 'test@test.com',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listCustomersQuerySchema
// ---------------------------------------------------------------------------

describe('listCustomersQuerySchema', () => {
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

  it('accepts minimal query', () => {
    const result = listCustomersQuerySchema.safeParse({
      businessId: VALID_UUID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it('accepts query with all params', () => {
    const result = listCustomersQuerySchema.safeParse({
      businessId: VALID_UUID,
      status: 'ACTIVE',
      search: 'john',
      limit: 50,
      cursor: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it('rejects limit over 100', () => {
    const result = listCustomersQuerySchema.safeParse({
      businessId: VALID_UUID,
      limit: 101,
    });
    expect(result.success).toBe(false);
  });

  it('rejects limit under 1', () => {
    const result = listCustomersQuerySchema.safeParse({
      businessId: VALID_UUID,
      limit: 0,
    });
    expect(result.success).toBe(false);
  });

  it('coerces string limit to number', () => {
    const result = listCustomersQuerySchema.safeParse({
      businessId: VALID_UUID,
      limit: '25',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });
});
