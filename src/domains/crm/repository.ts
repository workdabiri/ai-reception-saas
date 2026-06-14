// ===========================================================================
// CRM Domain — Repository
//
// Prisma-backed persistence layer for customers and contact methods.
// Uses injected Prisma-compatible client for testability.
// ===========================================================================

import { ok, err } from '@/lib/result';
import type { ActionResult } from '@/lib/result';
import type {
  CustomerIdentity,
  ContactMethodIdentity,
  CustomerWithContacts,
  CustomerStatusValue,
  ContactMethodTypeValue,
  CreateCustomerInput,
  UpdateCustomerInput,
  CreateContactMethodInput,
  UpdateContactMethodInput,
} from './types';

// ---------------------------------------------------------------------------
// Local record types (match Prisma-selected fields)
// ---------------------------------------------------------------------------

/** Raw customer record from the database */
export interface CustomerRecord {
  id: string;
  businessId: string;
  displayName: string;
  status: CustomerStatusValue;
  locale: string | null;
  notes: string | null;
  metadata: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Raw customer record with contact methods included */
export interface CustomerRecordWithContacts extends CustomerRecord {
  contactMethods: ContactMethodRecord[];
}

/** Raw contact method record from the database */
export interface ContactMethodRecord {
  id: string;
  customerId: string;
  businessId: string;
  type: ContactMethodTypeValue;
  value: string;
  label: string | null;
  isPrimary: boolean;
  verified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Injected DB client interface
// ---------------------------------------------------------------------------

/** Prisma-compatible delegate interface for CRM repository */
export interface CrmRepositoryDb {
  customer: {
    create(args: {
      data: {
        businessId: string;
        displayName: string;
        locale?: string;
        notes?: string;
        metadata?: unknown;
      };
      include?: { contactMethods: boolean };
    }): Promise<CustomerRecordWithContacts>;
    update(args: {
      where: { id: string };
      data: Partial<{
        displayName: string;
        locale: string | null;
        notes: string | null;
        status: CustomerStatusValue;
        metadata: unknown | null;
      }>;
      include?: { contactMethods: boolean };
    }): Promise<CustomerRecordWithContacts>;
    findUnique(args: {
      where: { id: string };
      include?: { contactMethods: boolean };
    }): Promise<CustomerRecordWithContacts | null>;
    findMany(args: {
      where: {
        businessId: string;
        status?: CustomerStatusValue;
        displayName?: { contains: string; mode: 'insensitive' };
        id?: { gt: string };
      };
      orderBy: { createdAt: 'desc' } | { displayName: 'asc' };
      take: number;
      include?: { contactMethods: boolean };
    }): Promise<CustomerRecordWithContacts[]>;
  };
  customerContactMethod: {
    create(args: {
      data: {
        customerId: string;
        businessId: string;
        type: ContactMethodTypeValue;
        value: string;
        label?: string;
        isPrimary?: boolean;
      };
    }): Promise<ContactMethodRecord>;
    update(args: {
      where: { id: string };
      data: Partial<{
        label: string | null;
        isPrimary: boolean;
      }>;
    }): Promise<ContactMethodRecord>;
    delete(args: {
      where: { id: string };
    }): Promise<ContactMethodRecord>;
    findUnique(args: {
      where:
        | { id: string }
        | { businessId_type_value: { businessId: string; type: ContactMethodTypeValue; value: string } };
      include?: { customer: boolean };
    }): Promise<(ContactMethodRecord & { customer?: CustomerRecord }) | null>;
    findMany(args: {
      where: { customerId: string; businessId: string };
      orderBy: { createdAt: 'asc' };
    }): Promise<ContactMethodRecord[]>;
  };
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

/** Input for listing customers */
export interface ListCustomersRepoInput {
  businessId: string;
  status?: CustomerStatusValue;
  search?: string;
  limit: number;
  cursor?: string;
}

/** Input for finding a customer by contact method */
export interface FindByContactRepoInput {
  businessId: string;
  type: ContactMethodTypeValue;
  value: string;
}

/** Paginated customer list result */
export interface PaginatedCustomers {
  data: readonly CustomerWithContacts[];
  nextCursor: string | null;
}

/** Repository boundary for CRM persistence */
export interface CrmRepository {
  createCustomer(
    input: CreateCustomerInput,
  ): Promise<ActionResult<CustomerWithContacts>>;

  updateCustomer(
    customerId: string,
    input: UpdateCustomerInput,
  ): Promise<ActionResult<CustomerWithContacts>>;

  findCustomerById(
    customerId: string,
    businessId: string,
  ): Promise<ActionResult<CustomerWithContacts | null>>;

  listCustomers(
    input: ListCustomersRepoInput,
  ): Promise<ActionResult<PaginatedCustomers>>;

  findByContactMethod(
    input: FindByContactRepoInput,
  ): Promise<ActionResult<CustomerWithContacts | null>>;

  createContactMethod(
    input: CreateContactMethodInput & { customerId: string; businessId: string },
  ): Promise<ActionResult<ContactMethodIdentity>>;

  updateContactMethod(
    contactMethodId: string,
    input: UpdateContactMethodInput,
  ): Promise<ActionResult<ContactMethodIdentity>>;

  deleteContactMethod(
    contactMethodId: string,
  ): Promise<ActionResult<ContactMethodIdentity>>;

  findContactMethodById(
    contactMethodId: string,
  ): Promise<ActionResult<(ContactMethodIdentity & { customer?: CustomerIdentity }) | null>>;

  listContactMethods(
    customerId: string,
    businessId: string,
  ): Promise<ActionResult<readonly ContactMethodIdentity[]>>;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** Maps a raw customer record to a domain CustomerIdentity */
export function mapCustomerRecord(record: CustomerRecord): CustomerIdentity {
  return {
    id: record.id,
    businessId: record.businessId,
    displayName: record.displayName,
    status: record.status,
    locale: record.locale,
    notes: record.notes,
    metadata: record.metadata,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Maps a raw contact method record to a domain ContactMethodIdentity */
export function mapContactMethodRecord(
  record: ContactMethodRecord,
): ContactMethodIdentity {
  return {
    id: record.id,
    customerId: record.customerId,
    businessId: record.businessId,
    type: record.type,
    value: record.value,
    label: record.label,
    isPrimary: record.isPrimary,
    verified: record.verified,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Maps a raw customer record with contacts to a domain CustomerWithContacts */
export function mapCustomerWithContacts(
  record: CustomerRecordWithContacts,
): CustomerWithContacts {
  return {
    ...mapCustomerRecord(record),
    contactMethods: record.contactMethods.map(mapContactMethodRecord),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const REPO_ERROR_CODE = 'CRM_REPOSITORY_ERROR';
const REPO_ERROR_MSG = 'CRM repository operation failed';

/** Creates a CRM repository backed by the given DB client */
export function createCrmRepository(db: CrmRepositoryDb): CrmRepository {
  return {
    async createCustomer(input) {
      try {
        const record = await db.customer.create({
          data: {
            businessId: input.businessId,
            displayName: input.displayName,
            locale: input.locale,
            notes: input.notes,
            metadata: input.metadata,
          },
          include: { contactMethods: true },
        });
        return ok(mapCustomerWithContacts(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async updateCustomer(customerId, input) {
      try {
        const record = await db.customer.update({
          where: { id: customerId },
          data: input,
          include: { contactMethods: true },
        });
        return ok(mapCustomerWithContacts(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async findCustomerById(customerId, businessId) {
      try {
        const record = await db.customer.findUnique({
          where: { id: customerId },
          include: { contactMethods: true },
        });
        if (!record || record.businessId !== businessId) {
          return ok(null);
        }
        return ok(mapCustomerWithContacts(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async listCustomers(input) {
      try {
        const where: {
          businessId: string;
          status?: CustomerStatusValue;
          displayName?: { contains: string; mode: 'insensitive' };
          id?: { gt: string };
        } = { businessId: input.businessId };

        if (input.status) {
          where.status = input.status;
        }
        if (input.search) {
          where.displayName = { contains: input.search, mode: 'insensitive' };
        }
        if (input.cursor) {
          where.id = { gt: input.cursor };
        }

        const records = await db.customer.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: input.limit + 1,
          include: { contactMethods: true },
        });

        const hasMore = records.length > input.limit;
        const data = hasMore ? records.slice(0, input.limit) : records;
        const nextCursor = hasMore ? data[data.length - 1].id : null;

        return ok({
          data: data.map(mapCustomerWithContacts),
          nextCursor,
        });
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async findByContactMethod(input) {
      try {
        const contactRecord = await db.customerContactMethod.findUnique({
          where: {
            businessId_type_value: {
              businessId: input.businessId,
              type: input.type,
              value: input.value,
            },
          },
          include: { customer: true },
        });
        if (!contactRecord || !contactRecord.customer) {
          return ok(null);
        }
        // Fetch the full customer with all contact methods
        const customer = await db.customer.findUnique({
          where: { id: contactRecord.customer.id },
          include: { contactMethods: true },
        });
        if (!customer) {
          return ok(null);
        }
        return ok(mapCustomerWithContacts(customer));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async createContactMethod(input) {
      try {
        const record = await db.customerContactMethod.create({
          data: {
            customerId: input.customerId,
            businessId: input.businessId,
            type: input.type,
            value: input.value,
            label: input.label,
            isPrimary: input.isPrimary,
          },
        });
        return ok(mapContactMethodRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async updateContactMethod(contactMethodId, input) {
      try {
        const record = await db.customerContactMethod.update({
          where: { id: contactMethodId },
          data: input,
        });
        return ok(mapContactMethodRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async deleteContactMethod(contactMethodId) {
      try {
        const record = await db.customerContactMethod.delete({
          where: { id: contactMethodId },
        });
        return ok(mapContactMethodRecord(record));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async findContactMethodById(contactMethodId) {
      try {
        const record = await db.customerContactMethod.findUnique({
          where: { id: contactMethodId },
          include: { customer: true },
        });
        if (!record) {
          return ok(null);
        }
        const mapped = mapContactMethodRecord(record);
        if (record.customer) {
          return ok({
            ...mapped,
            customer: mapCustomerRecord(record.customer),
          });
        }
        return ok(mapped);
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },

    async listContactMethods(customerId, businessId) {
      try {
        const records = await db.customerContactMethod.findMany({
          where: { customerId, businessId },
          orderBy: { createdAt: 'asc' },
        });
        return ok(records.map(mapContactMethodRecord));
      } catch {
        return err(REPO_ERROR_CODE, REPO_ERROR_MSG);
      }
    },
  };
}
