// ===========================================================================
// CRM Domain — Validation
//
// Zod schemas for validating CRM domain inputs.
// ===========================================================================

import { z } from 'zod';
import { CUSTOMER_STATUS_VALUES, CONTACT_METHOD_TYPE_VALUES } from './types';

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid();

const displayNameSchema = z.string().trim().min(1).max(200);

const notesSchema = z.string().max(5000);

const localeSchema = z.enum(['en', 'fa', 'ar']);

// ---------------------------------------------------------------------------
// Contact value normalization
// ---------------------------------------------------------------------------

/** Normalizes an email: lowercase + trim */
const emailValueSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform((v) => v.toLowerCase());

/** Validates a phone number: basic E.164-like format */
const phoneValueSchema = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .regex(/^\+?[1-9]\d{6,14}$/, 'Phone number must be in E.164 format');

/** Generic value for non-email/non-phone contact types */
const genericValueSchema = z.string().trim().min(1).max(500);

// ---------------------------------------------------------------------------
// Enum schemas
// ---------------------------------------------------------------------------

/** Validates a customer status value */
export const customerStatusSchema = z.enum(CUSTOMER_STATUS_VALUES);

/** Validates a contact method type value */
export const contactMethodTypeSchema = z.enum(CONTACT_METHOD_TYPE_VALUES);

// ---------------------------------------------------------------------------
// Contact value schema (type-aware)
// ---------------------------------------------------------------------------

/**
 * Validates and normalizes a contact method value based on its type.
 * This is used as a refinement after parsing the full input.
 */
export function normalizeContactValue(
  type: z.infer<typeof contactMethodTypeSchema>,
  value: string,
): { success: true; value: string } | { success: false; error: string } {
  switch (type) {
    case 'EMAIL': {
      const result = emailValueSchema.safeParse(value);
      if (!result.success)
        return { success: false, error: 'Invalid email address' };
      return { success: true, value: result.data };
    }
    case 'PHONE':
    case 'WHATSAPP': {
      const result = phoneValueSchema.safeParse(value);
      if (!result.success)
        return {
          success: false,
          error: 'Invalid phone number (E.164 format required)',
        };
      return { success: true, value: result.data };
    }
    default: {
      const result = genericValueSchema.safeParse(value);
      if (!result.success)
        return { success: false, error: 'Invalid contact value' };
      return { success: true, value: result.data };
    }
  }
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/** Schema for a single contact method within customer creation */
const contactMethodInCreateSchema = z.object({
  type: contactMethodTypeSchema,
  value: z.string().trim().min(1).max(500),
  label: z.string().trim().max(100).optional(),
  isPrimary: z.boolean().optional(),
});

/** Validates input for creating a new customer */
export const createCustomerInputSchema = z.object({
  businessId: uuidSchema,
  displayName: displayNameSchema,
  locale: localeSchema.optional(),
  notes: notesSchema.optional(),
  metadata: z.unknown().optional(),
  contactMethods: z.array(contactMethodInCreateSchema).optional(),
});

/** Validates input for updating a customer */
export const updateCustomerInputSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    locale: localeSchema.nullable().optional(),
    notes: notesSchema.nullable().optional(),
    status: customerStatusSchema.optional(),
    metadata: z.unknown().nullable().optional(),
  })
  .refine(
    (data) =>
      data.displayName !== undefined ||
      data.locale !== undefined ||
      data.notes !== undefined ||
      data.status !== undefined ||
      data.metadata !== undefined,
    { message: 'At least one field must be provided for update' },
  );

/** Validates input for creating a contact method */
export const createContactMethodInputSchema = z.object({
  customerId: uuidSchema.optional(),
  businessId: uuidSchema.optional(),
  type: contactMethodTypeSchema,
  value: z.string().trim().min(1).max(500),
  label: z.string().trim().max(100).optional(),
  isPrimary: z.boolean().optional(),
});

/** Validates input for updating a contact method */
export const updateContactMethodInputSchema = z
  .object({
    label: z.string().trim().max(100).nullable().optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine(
    (data) => data.label !== undefined || data.isPrimary !== undefined,
    { message: 'At least one field must be provided for update' },
  );

/** Validates input for find-or-create by contact */
export const findOrCreateByContactInputSchema = z.object({
  businessId: uuidSchema,
  type: contactMethodTypeSchema,
  value: z.string().trim().min(1).max(500),
  displayName: displayNameSchema.optional(),
});

/** Validates customer search/list query parameters */
export const listCustomersQuerySchema = z.object({
  businessId: uuidSchema,
  status: customerStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: uuidSchema.optional(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type CreateCustomerInputValidated = z.output<
  typeof createCustomerInputSchema
>;
export type UpdateCustomerInputValidated = z.output<
  typeof updateCustomerInputSchema
>;
export type CreateContactMethodInputValidated = z.output<
  typeof createContactMethodInputSchema
>;
export type UpdateContactMethodInputValidated = z.output<
  typeof updateContactMethodInputSchema
>;
export type FindOrCreateByContactInputValidated = z.output<
  typeof findOrCreateByContactInputSchema
>;
export type ListCustomersQueryValidated = z.output<
  typeof listCustomersQuerySchema
>;
