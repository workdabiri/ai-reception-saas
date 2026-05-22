// ===========================================================================
// CRM Domain — Types
//
// Domain-level type definitions for customers and contact methods.
// These types mirror the Prisma schema but are decoupled from it.
// ===========================================================================

/** Allowed customer status values */
export const CUSTOMER_STATUS_VALUES = ['ACTIVE', 'ARCHIVED'] as const;

/** Customer lifecycle status */
export type CustomerStatusValue = (typeof CUSTOMER_STATUS_VALUES)[number];

/** Allowed contact method type values */
export const CONTACT_METHOD_TYPE_VALUES = [
  'EMAIL',
  'PHONE',
  'WHATSAPP',
  'INSTAGRAM',
  'TELEGRAM',
  'WEBSITE_CHAT',
  'CUSTOM',
] as const;

/** Contact method type */
export type ContactMethodTypeValue =
  (typeof CONTACT_METHOD_TYPE_VALUES)[number];

/** Domain representation of a customer */
export interface CustomerIdentity {
  id: string;
  businessId: string;
  displayName: string;
  status: CustomerStatusValue;
  locale: string | null;
  notes: string | null;
  metadata: unknown | null;
  createdAt: string;
  updatedAt: string;
}

/** Domain representation of a customer contact method */
export interface ContactMethodIdentity {
  id: string;
  customerId: string;
  businessId: string;
  type: ContactMethodTypeValue;
  value: string;
  label: string | null;
  isPrimary: boolean;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Customer with contact methods included */
export interface CustomerWithContacts extends CustomerIdentity {
  contactMethods: readonly ContactMethodIdentity[];
}

/** Input for creating a new customer */
export interface CreateCustomerInput {
  businessId: string;
  displayName: string;
  locale?: string;
  notes?: string;
  metadata?: unknown;
  contactMethods?: readonly CreateContactMethodInput[];
}

/** Input for updating an existing customer */
export interface UpdateCustomerInput {
  displayName?: string;
  locale?: string | null;
  notes?: string | null;
  status?: CustomerStatusValue;
  metadata?: unknown | null;
}

/** Input for creating a contact method */
export interface CreateContactMethodInput {
  customerId?: string;
  businessId?: string;
  type: ContactMethodTypeValue;
  value: string;
  label?: string;
  isPrimary?: boolean;
}

/** Input for updating a contact method */
export interface UpdateContactMethodInput {
  label?: string | null;
  isPrimary?: boolean;
}

/** Input for identity resolution: find or create customer by contact */
export interface FindOrCreateByContactInput {
  businessId: string;
  type: ContactMethodTypeValue;
  value: string;
  displayName?: string;
}
