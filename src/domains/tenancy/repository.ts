// ===========================================================================
// Tenancy Domain — Repository
//
// Prisma-backed persistence layer for businesses and memberships.
// Uses injected Prisma-compatible client for testability.
// ===========================================================================

import { ok, err } from '@/lib/result';
import type { ActionResult } from '@/lib/result';
import type {
  BusinessIdentity,
  BusinessMembershipIdentity,
  BusinessStatusValue,
  MembershipRoleValue,
  MembershipStatusValue,
  TenantContext,
  CreateBusinessInput,
  UpdateBusinessInput,
  CreateMembershipInput,
  UpdateMembershipRoleInput,
  UpdateMembershipStatusInput,
  ResolveTenantContextInput,
} from './types';
import type {
  FindBusinessByIdInput,
  FindBusinessBySlugInput,
  ListUserBusinessesInput,
  FindMembershipInput,
  FindMembershipByIdInput,
  ListBusinessMembershipsInput,
  RemoveMembershipInput,
} from './service';

// ---------------------------------------------------------------------------
// Local record types
// ---------------------------------------------------------------------------

export interface BusinessRecord {
  id: string;
  name: string;
  slug: string;
  status: BusinessStatusValue;
  timezone: string;
  locale: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BusinessMembershipRecord {
  id: string;
  businessId: string;
  userId: string;
  role: MembershipRoleValue;
  status: MembershipStatusValue;
  invitedByUserId: string | null;
  joinedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Prisma-included user relation (present when loaded via list query) */
  user?: { id: string; name: string; avatarUrl: string | null };
}

// ---------------------------------------------------------------------------
// Injected DB client interface
// ---------------------------------------------------------------------------

export interface TenancyRepositoryDb {
  business: {
    create(args: { data: { name: string; slug: string; createdByUserId: string; timezone?: string; locale?: string } }): Promise<BusinessRecord>;
    update(args: { where: { id: string }; data: Partial<{ name: string; slug: string; status: BusinessStatusValue; timezone: string; locale: string }> }): Promise<BusinessRecord>;
    findUnique(args: { where: { id: string } | { slug: string } }): Promise<BusinessRecord | null>;
    findMany(args: { where: { memberships: { some: { userId: string; status?: MembershipStatusValue } } }; orderBy: { createdAt: 'desc' } }): Promise<BusinessRecord[]>;
  };
  businessMembership: {
    create(args: { data: { businessId: string; userId: string; role?: MembershipRoleValue; status?: MembershipStatusValue; invitedByUserId?: string } }): Promise<BusinessMembershipRecord>;
    update(args: { where: { id: string }; data: Partial<{ role: MembershipRoleValue; status: MembershipStatusValue; joinedAt: Date }> }): Promise<BusinessMembershipRecord>;
    findUnique(args: { where: { id: string } | { userId_businessId: { userId: string; businessId: string } } }): Promise<BusinessMembershipRecord | null>;
    findMany(args: { where: { businessId: string; status?: { not: MembershipStatusValue } }; include?: { user?: { select: { id: true; name: true; avatarUrl: true } } }; orderBy: { createdAt: 'desc' } }): Promise<BusinessMembershipRecord[]>;
    findFirst(args: { where: { userId: string; businessId: string; status: MembershipStatusValue } }): Promise<BusinessMembershipRecord | null>;
  };
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface TenancyRepository {
  createBusiness(input: CreateBusinessInput): Promise<ActionResult<BusinessIdentity>>;
  updateBusiness(input: UpdateBusinessInput): Promise<ActionResult<BusinessIdentity>>;
  findBusinessById(input: FindBusinessByIdInput): Promise<ActionResult<BusinessIdentity | null>>;
  findBusinessBySlug(input: FindBusinessBySlugInput): Promise<ActionResult<BusinessIdentity | null>>;
  listUserBusinesses(input: ListUserBusinessesInput): Promise<ActionResult<readonly BusinessIdentity[]>>;
  createMembership(input: CreateMembershipInput): Promise<ActionResult<BusinessMembershipIdentity>>;
  findMembership(input: FindMembershipInput): Promise<ActionResult<BusinessMembershipIdentity | null>>;
  findMembershipById(input: FindMembershipByIdInput): Promise<ActionResult<BusinessMembershipIdentity | null>>;
  listBusinessMemberships(input: ListBusinessMembershipsInput): Promise<ActionResult<readonly BusinessMembershipIdentity[]>>;
  updateMembershipRole(input: UpdateMembershipRoleInput): Promise<ActionResult<BusinessMembershipIdentity>>;
  updateMembershipStatus(input: UpdateMembershipStatusInput): Promise<ActionResult<BusinessMembershipIdentity>>;
  removeMembership(input: RemoveMembershipInput): Promise<ActionResult<BusinessMembershipIdentity>>;
  resolveTenantContext(input: ResolveTenantContextInput): Promise<ActionResult<TenantContext>>;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function mapBusinessRecord(record: BusinessRecord): BusinessIdentity {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    status: record.status,
    timezone: record.timezone,
    locale: record.locale,
    createdByUserId: record.createdByUserId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function mapBusinessMembershipRecord(record: BusinessMembershipRecord): BusinessMembershipIdentity {
  const identity: BusinessMembershipIdentity = {
    id: record.id,
    businessId: record.businessId,
    userId: record.userId,
    role: record.role,
    status: record.status,
    invitedByUserId: record.invitedByUserId,
    joinedAt: record.joinedAt ? record.joinedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
  if (record.user) {
    identity.user = {
      id: record.user.id,
      name: record.user.name,
      avatarUrl: record.user.avatarUrl,
    };
  }
  return identity;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTenancyRepository(db: TenancyRepositoryDb): TenancyRepository {
  return {
    async createBusiness(input) {
      try {
        const record = await db.business.create({
          data: { name: input.name, slug: input.slug, createdByUserId: input.createdByUserId, timezone: input.timezone, locale: input.locale },
        });
        return ok(mapBusinessRecord(record));
      } catch {
        return err('TENANCY_REPOSITORY_ERROR', 'Tenancy repository operation failed');
      }
    },

    async updateBusiness(input) {
      try {
        const data: Partial<{ name: string; slug: string; status: BusinessStatusValue; timezone: string; locale: string }> = {};
        if (input.name !== undefined) data.name = input.name;
        if (input.slug !== undefined) data.slug = input.slug;
        if (input.status !== undefined) data.status = input.status;
        if (input.timezone !== undefined) data.timezone = input.timezone;
        if (input.locale !== undefined) data.locale = input.locale;
        const record = await db.business.update({ where: { id: input.businessId }, data });
        return ok(mapBusinessRecord(record));
      } catch {
        return err('TENANCY_REPOSITORY_ERROR', 'Tenancy repository operation failed');
      }
    },

    async findBusinessById(input) {
      try {
        const record = await db.business.findUnique({ where: { id: input.businessId } });
        return ok(record ? mapBusinessRecord(record) : null);
      } catch {
        return err('TENANCY_REPOSITORY_ERROR', 'Tenancy repository operation failed');
      }
    },

    async findBusinessBySlug(input) {
      try {
        const record = await db.business.findUnique({ where: { slug: input.slug } });
        return ok(record ? mapBusinessRecord(record) : null);
      } catch {
        return err('TENANCY_REPOSITORY_ERROR', 'Tenancy repository operation failed');
      }
    },

    async listUserBusinesses(input) {
      try {
        const membershipFilter: { userId: string; status?: MembershipStatusValue } = { userId: input.userId };
        if (!input.includeInactive) {
          membershipFilter.status = 'ACTIVE';
        }
        const records = await db.business.findMany({
          where: { memberships: { some: membershipFilter } },
          orderBy: { createdAt: 'desc' },
        });
        return ok(records.map(mapBusinessRecord));
      } catch {
        return err('TENANCY_REPOSITORY_ERROR', 'Tenancy repository operation failed');
      }
    },

    async createMembership(input) {
      try {
        const record = await db.businessMembership.create({ data: input });
        return ok(mapBusinessMembershipRecord(record));
      } catch {
        return err('TENANCY_REPOSITORY_ERROR', 'Tenancy repository operation failed');
      }
    },

    async findMembership(input) {
      try {
        const record = await db.businessMembership.findUnique({
          where: { userId_businessId: { userId: input.userId, businessId: input.businessId } },
        });
        return ok(record ? mapBusinessMembershipRecord(record) : null);
      } catch {
        return err('TENANCY_REPOSITORY_ERROR', 'Tenancy repository operation failed');
      }
    },

    async findMembershipById(input) {
      try {
        const record = await db.businessMembership.findUnique({ where: { id: input.membershipId } });
        return ok(record ? mapBusinessMembershipRecord(record) : null);
      } catch {
        return err('TENANCY_REPOSITORY_ERROR', 'Tenancy repository operation failed');
      }
    },

    async listBusinessMemberships(input) {
      try {
        const where: { businessId: string; status?: { not: MembershipStatusValue } } = { businessId: input.businessId };
        if (!input.includeRemoved) {
          where.status = { not: 'REMOVED' };
        }
        const records = await db.businessMembership.findMany({ where, include: { user: { select: { id: true as const, name: true as const, avatarUrl: true as const } } }, orderBy: { createdAt: 'desc' } });
        return ok(records.map(mapBusinessMembershipRecord));
      } catch {
        return err('TENANCY_REPOSITORY_ERROR', 'Tenancy repository operation failed');
      }
    },

    async updateMembershipRole(input) {
      try {
        const record = await db.businessMembership.update({ where: { id: input.membershipId }, data: { role: input.role } });
        return ok(mapBusinessMembershipRecord(record));
      } catch {
        return err('TENANCY_REPOSITORY_ERROR', 'Tenancy repository operation failed');
      }
    },

    async updateMembershipStatus(input) {
      try {
        const data: Partial<{ status: MembershipStatusValue; joinedAt: Date }> = { status: input.status };
        if (input.joinedAt) {
          data.joinedAt = new Date(input.joinedAt);
        }
        const record = await db.businessMembership.update({ where: { id: input.membershipId }, data });
        return ok(mapBusinessMembershipRecord(record));
      } catch {
        return err('TENANCY_REPOSITORY_ERROR', 'Tenancy repository operation failed');
      }
    },

    async removeMembership(input) {
      try {
        const record = await db.businessMembership.update({ where: { id: input.membershipId }, data: { status: 'REMOVED' } });
        return ok(mapBusinessMembershipRecord(record));
      } catch {
        return err('TENANCY_REPOSITORY_ERROR', 'Tenancy repository operation failed');
      }
    },

    async resolveTenantContext(input) {
      try {
        const membership = await db.businessMembership.findFirst({
          where: { userId: input.userId, businessId: input.businessId, status: 'ACTIVE' },
        });
        if (!membership) {
          return err('TENANT_ACCESS_DENIED', 'Tenant access denied');
        }
        return ok<TenantContext>({
          businessId: input.businessId,
          userId: input.userId,
          membershipId: membership.id,
          role: membership.role,
        });
      } catch {
        return err('TENANCY_REPOSITORY_ERROR', 'Tenancy repository operation failed');
      }
    },
  };
}
