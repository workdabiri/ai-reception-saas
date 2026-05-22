// ===========================================================================
// CRM Domain — Service Interface
//
// Pure service boundary for customer and contact method operations.
// No implementation — interface definitions only.
// ===========================================================================

import type { ActionResult } from '@/lib/result';
import type {
  ContactMethodIdentity,
  CustomerWithContacts,
  CreateCustomerInput,
  UpdateCustomerInput,
  CreateContactMethodInput,
  FindOrCreateByContactInput,
  CustomerStatusValue,
} from './types';

// ---------------------------------------------------------------------------
// Service-specific input types
// ---------------------------------------------------------------------------

/** Input for finding a customer by ID */
export interface FindCustomerByIdInput {
  readonly customerId: string;
  readonly businessId: string;
}

/** Input for listing customers */
export interface ListCustomersInput {
  readonly businessId: string;
  readonly status?: CustomerStatusValue;
  readonly search?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

/** Input for archiving a customer */
export interface ArchiveCustomerInput {
  readonly customerId: string;
  readonly businessId: string;
}

/** Input for adding a contact method */
export interface AddContactMethodInput {
  readonly customerId: string;
  readonly businessId: string;
  readonly type: CreateContactMethodInput['type'];
  readonly value: string;
  readonly label?: string;
  readonly isPrimary?: boolean;
}

/** Input for updating a contact method */
export interface UpdateContactMethodServiceInput {
  readonly contactMethodId: string;
  readonly businessId: string;
  readonly label?: string | null;
  readonly isPrimary?: boolean;
}

/** Input for removing a contact method */
export interface RemoveContactMethodInput {
  readonly contactMethodId: string;
  readonly businessId: string;
}

/** Input for listing contact methods */
export interface ListContactMethodsInput {
  readonly customerId: string;
  readonly businessId: string;
}

/** Paginated customer list result */
export interface PaginatedCustomersResult {
  data: readonly CustomerWithContacts[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/** CRM service error code constants */
export const CRM_ERROR_CODES = [
  'CUSTOMER_NOT_FOUND',
  'CONTACT_METHOD_NOT_FOUND',
  'CONTACT_METHOD_ALREADY_EXISTS',
  'INVALID_CRM_INPUT',
  'CRM_REPOSITORY_ERROR',
] as const;

/** CRM service error code type */
export type CrmErrorCode = (typeof CRM_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/** Service boundary for CRM (customer + contact method) operations */
export interface CrmService {
  createCustomer(
    input: CreateCustomerInput,
  ): Promise<ActionResult<CustomerWithContacts>>;

  updateCustomer(
    customerId: string,
    businessId: string,
    input: UpdateCustomerInput,
  ): Promise<ActionResult<CustomerWithContacts>>;

  findCustomerById(
    input: FindCustomerByIdInput,
  ): Promise<ActionResult<CustomerWithContacts | null>>;

  listCustomers(
    input: ListCustomersInput,
  ): Promise<ActionResult<PaginatedCustomersResult>>;

  archiveCustomer(
    input: ArchiveCustomerInput,
  ): Promise<ActionResult<CustomerWithContacts>>;

  findOrCreateByContact(
    input: FindOrCreateByContactInput,
  ): Promise<ActionResult<CustomerWithContacts>>;

  addContactMethod(
    input: AddContactMethodInput,
  ): Promise<ActionResult<ContactMethodIdentity>>;

  updateContactMethod(
    input: UpdateContactMethodServiceInput,
  ): Promise<ActionResult<ContactMethodIdentity>>;

  removeContactMethod(
    input: RemoveContactMethodInput,
  ): Promise<ActionResult<ContactMethodIdentity>>;

  listContactMethods(
    input: ListContactMethodsInput,
  ): Promise<ActionResult<readonly ContactMethodIdentity[]>>;
}
