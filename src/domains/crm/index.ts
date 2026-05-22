// ===========================================================================
// CRM Domain — Public API
//
// Re-exports the domain types, service interface, service factory,
// repository factory, and repository DB type.
// This module is the single entry point for CRM domain functionality.
//
// @module
// ===========================================================================

export {
  CUSTOMER_STATUS_VALUES,
  CONTACT_METHOD_TYPE_VALUES,
  type CustomerStatusValue,
  type ContactMethodTypeValue,
  type CustomerIdentity,
  type ContactMethodIdentity,
  type CustomerWithContacts,
  type CreateCustomerInput,
  type UpdateCustomerInput,
  type CreateContactMethodInput,
  type UpdateContactMethodInput,
  type FindOrCreateByContactInput,
} from './types';

export {
  customerStatusSchema,
  contactMethodTypeSchema,
  normalizeContactValue,
  createCustomerInputSchema,
  updateCustomerInputSchema,
  createContactMethodInputSchema,
  updateContactMethodInputSchema,
  findOrCreateByContactInputSchema,
  listCustomersQuerySchema,
  type CreateCustomerInputValidated,
  type UpdateCustomerInputValidated,
  type CreateContactMethodInputValidated,
  type UpdateContactMethodInputValidated,
  type FindOrCreateByContactInputValidated,
  type ListCustomersQueryValidated,
} from './validation';

export {
  createCrmRepository,
  mapCustomerRecord,
  mapContactMethodRecord,
  mapCustomerWithContacts,
  type CrmRepositoryDb,
  type CrmRepository,
  type CustomerRecord,
  type ContactMethodRecord,
  type CustomerRecordWithContacts,
  type ListCustomersRepoInput,
  type FindByContactRepoInput,
  type PaginatedCustomers,
} from './repository';

export {
  CRM_ERROR_CODES,
  type CrmErrorCode,
  type CrmService,
  type FindCustomerByIdInput,
  type ListCustomersInput,
  type ArchiveCustomerInput,
  type AddContactMethodInput,
  type UpdateContactMethodServiceInput,
  type RemoveContactMethodInput,
  type ListContactMethodsInput,
  type PaginatedCustomersResult,
} from './service';

export {
  createCrmService,
  type CrmServiceDeps,
} from './implementation';
