// ===========================================================================
// CRM Domain — Service Implementation
//
// Concrete CrmService backed by validation + injected repository.
// ===========================================================================

import { z } from 'zod';
import { err } from '@/lib/result';
import type { CrmService } from './service';
import type { CrmRepository } from './repository';
import {
  createCustomerInputSchema,
  updateCustomerInputSchema,
  createContactMethodInputSchema,
  updateContactMethodInputSchema,
  findOrCreateByContactInputSchema,
  listCustomersQuerySchema,
  normalizeContactValue,
} from './validation';

// ---------------------------------------------------------------------------
// Local validation helpers
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Dependency types
// ---------------------------------------------------------------------------

/** Dependencies for the CRM service */
export interface CrmServiceDeps {
  readonly repository: CrmRepository;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVALID_INPUT_CODE = 'INVALID_CRM_INPUT';
const INVALID_INPUT_MSG = 'Invalid CRM input';
const NOT_FOUND_CODE = 'CUSTOMER_NOT_FOUND';
const CM_NOT_FOUND_CODE = 'CONTACT_METHOD_NOT_FOUND';
const CM_EXISTS_CODE = 'CONTACT_METHOD_ALREADY_EXISTS';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates a concrete CrmService with validation and injected repository */
export function createCrmService(deps: CrmServiceDeps): CrmService {
  const { repository } = deps;

  return {
    async createCustomer(input) {
      const parsed = createCustomerInputSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }

      // Normalize contact method values if provided
      if (parsed.data.contactMethods) {
        for (const cm of parsed.data.contactMethods) {
          const normalized = normalizeContactValue(cm.type, cm.value);
          if (!normalized.success) {
            return err(INVALID_INPUT_CODE, normalized.error);
          }
          cm.value = normalized.value;
        }
      }

      const result = await repository.createCustomer(parsed.data);
      if (!result.ok) return result;

      // Create contact methods if provided
      if (parsed.data.contactMethods && parsed.data.contactMethods.length > 0) {
        for (const cm of parsed.data.contactMethods) {
          const cmResult = await repository.createContactMethod({
            customerId: result.data.id,
            businessId: parsed.data.businessId,
            type: cm.type,
            value: cm.value,
            label: cm.label,
            isPrimary: cm.isPrimary,
          });
          if (!cmResult.ok) return err(CM_EXISTS_CODE, 'Contact method already exists for this business');
        }
        // Re-fetch to include contact methods
        const refreshed = await repository.findCustomerById(
          result.data.id,
          parsed.data.businessId,
        );
        if (refreshed.ok && refreshed.data) {
          return { ok: true, data: refreshed.data };
        }
      }

      return result;
    },

    async updateCustomer(customerId, businessId, input) {
      const idResult = uuidSchema.safeParse(customerId);
      if (!idResult.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      const bizResult = uuidSchema.safeParse(businessId);
      if (!bizResult.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      const parsed = updateCustomerInputSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }

      // Verify customer belongs to business
      const existing = await repository.findCustomerById(idResult.data, bizResult.data);
      if (!existing.ok) return existing;
      if (!existing.data) {
        return err(NOT_FOUND_CODE, 'Customer not found');
      }

      return repository.updateCustomer(idResult.data, parsed.data);
    },

    async findCustomerById(input) {
      const idResult = uuidSchema.safeParse(input.customerId);
      if (!idResult.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      const bizResult = uuidSchema.safeParse(input.businessId);
      if (!bizResult.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      return repository.findCustomerById(idResult.data, bizResult.data);
    },

    async listCustomers(input) {
      const parsed = listCustomersQuerySchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      return repository.listCustomers(parsed.data);
    },

    async archiveCustomer(input) {
      const idResult = uuidSchema.safeParse(input.customerId);
      if (!idResult.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      const bizResult = uuidSchema.safeParse(input.businessId);
      if (!bizResult.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }

      // Verify customer belongs to business
      const existing = await repository.findCustomerById(idResult.data, bizResult.data);
      if (!existing.ok) return existing;
      if (!existing.data) {
        return err(NOT_FOUND_CODE, 'Customer not found');
      }

      return repository.updateCustomer(idResult.data, { status: 'ARCHIVED' });
    },

    async findOrCreateByContact(input) {
      const parsed = findOrCreateByContactInputSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }

      // Normalize contact value
      const normalized = normalizeContactValue(parsed.data.type, parsed.data.value);
      if (!normalized.success) {
        return err(INVALID_INPUT_CODE, normalized.error);
      }

      // Try to find existing customer by contact method
      const existing = await repository.findByContactMethod({
        businessId: parsed.data.businessId,
        type: parsed.data.type,
        value: normalized.value,
      });
      if (!existing.ok) return existing;
      if (existing.data) {
        return { ok: true, data: existing.data };
      }

      // Auto-create new customer
      const displayName =
        parsed.data.displayName || normalized.value;

      const createResult = await repository.createCustomer({
        businessId: parsed.data.businessId,
        displayName,
      });
      if (!createResult.ok) return createResult;

      // Add contact method
      const cmResult = await repository.createContactMethod({
        customerId: createResult.data.id,
        businessId: parsed.data.businessId,
        type: parsed.data.type,
        value: normalized.value,
        isPrimary: true,
      });
      if (!cmResult.ok) {
        return err(CM_EXISTS_CODE, 'Contact method already exists for this business');
      }

      // Re-fetch to include contact methods
      const refreshed = await repository.findCustomerById(
        createResult.data.id,
        parsed.data.businessId,
      );
      if (refreshed.ok && refreshed.data) {
        return { ok: true, data: refreshed.data };
      }

      return createResult;
    },

    async addContactMethod(input) {
      const idResult = uuidSchema.safeParse(input.customerId);
      if (!idResult.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      const bizResult = uuidSchema.safeParse(input.businessId);
      if (!bizResult.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }

      const parsed = createContactMethodInputSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }

      // Normalize contact value
      const normalized = normalizeContactValue(parsed.data.type, parsed.data.value);
      if (!normalized.success) {
        return err(INVALID_INPUT_CODE, normalized.error);
      }

      // Verify customer belongs to business
      const existing = await repository.findCustomerById(idResult.data, bizResult.data);
      if (!existing.ok) return existing;
      if (!existing.data) {
        return err(NOT_FOUND_CODE, 'Customer not found');
      }

      return repository.createContactMethod({
        customerId: idResult.data,
        businessId: bizResult.data,
        type: parsed.data.type,
        value: normalized.value,
        label: parsed.data.label,
        isPrimary: parsed.data.isPrimary,
      });
    },

    async updateContactMethod(input) {
      const idResult = uuidSchema.safeParse(input.contactMethodId);
      if (!idResult.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }

      const parsed = updateContactMethodInputSchema.safeParse(input);
      if (!parsed.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }

      // Verify contact method exists and belongs to the business
      const existing = await repository.findContactMethodById(idResult.data);
      if (!existing.ok) return existing;
      if (!existing.data || existing.data.businessId !== input.businessId) {
        return err(CM_NOT_FOUND_CODE, 'Contact method not found');
      }

      return repository.updateContactMethod(idResult.data, parsed.data);
    },

    async removeContactMethod(input) {
      const idResult = uuidSchema.safeParse(input.contactMethodId);
      if (!idResult.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }

      // Verify contact method exists and belongs to the business
      const existing = await repository.findContactMethodById(idResult.data);
      if (!existing.ok) return existing;
      if (!existing.data || existing.data.businessId !== input.businessId) {
        return err(CM_NOT_FOUND_CODE, 'Contact method not found');
      }

      return repository.deleteContactMethod(idResult.data);
    },

    async listContactMethods(input) {
      const idResult = uuidSchema.safeParse(input.customerId);
      if (!idResult.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }
      const bizResult = uuidSchema.safeParse(input.businessId);
      if (!bizResult.success) {
        return err(INVALID_INPUT_CODE, INVALID_INPUT_MSG);
      }

      // Verify customer belongs to business
      const existing = await repository.findCustomerById(idResult.data, bizResult.data);
      if (!existing.ok) return existing;
      if (!existing.data) {
        return err(NOT_FOUND_CODE, 'Customer not found');
      }

      return repository.listContactMethods(idResult.data);
    },
  };
}
