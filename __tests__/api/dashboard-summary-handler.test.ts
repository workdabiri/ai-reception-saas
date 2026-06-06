import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createGetDashboardSummaryHandler,
  type DashboardSummaryHandlerDeps,
  type DashboardSummaryResponse,
} from '@/app/api/businesses/[businessId]/dashboard/summary/handler';
import {
  createTenantRequestContext,
  type TenantRequestContext,
  type ContextResult,
} from '@/app/api/_shared/request-context';
import { apiError } from '@/app/api/_shared/responses';
import { ok, err } from '@/lib/result';
import { API_HANDLERS_FEATURE_FLAG } from '@/app/api/_shared/feature-gate';
import {
  DEV_AUTH_CONTEXT_FEATURE_FLAG,
  DEV_AUTH_HEADERS,
} from '@/app/api/_shared/auth-context-adapter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BIZ_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_BIZ = '55555555-5555-4555-8555-555555555555';
const MEM_ID = '66666666-6666-4666-8666-666666666666';

// ---------------------------------------------------------------------------
// Mock composition (for route integration tests)
// ---------------------------------------------------------------------------

vi.mock('@/app/api/_shared/composition', () => ({
  getApiDependencies: () => ({
    repositories: {
      conversations: {
        countOpenConversations: vi.fn().mockResolvedValue(ok(10)),
        countByStatus: vi.fn().mockResolvedValue(ok(3)),
        countDraftsPendingReview: vi.fn().mockResolvedValue(ok(2)),
        countNeedingFollowUp: vi.fn().mockResolvedValue(ok(1)),
      },
      audit: {
        countDeniedEvents: vi.fn().mockResolvedValue(ok(5)),
      },
    },
    services: {
      authz: { requirePermission: vi.fn().mockResolvedValue(ok({ allowed: true })) },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

function mockDeps(): DashboardSummaryHandlerDeps & {
  conversationRepository: {
    countOpenConversations: ReturnType<typeof vi.fn>;
    countByStatus: ReturnType<typeof vi.fn>;
    countDraftsPendingReview: ReturnType<typeof vi.fn>;
    countNeedingFollowUp: ReturnType<typeof vi.fn>;
  };
  auditRepository: {
    countDeniedEvents: ReturnType<typeof vi.fn>;
  };
  authzService: {
    requirePermission: ReturnType<typeof vi.fn>;
  };
} {
  return {
    conversationRepository: {
      countOpenConversations: vi.fn().mockResolvedValue(ok(10)),
      countByStatus: vi.fn().mockResolvedValue(ok(3)),
      countDraftsPendingReview: vi.fn().mockResolvedValue(ok(2)),
      countNeedingFollowUp: vi.fn().mockResolvedValue(ok(1)),
    },
    auditRepository: {
      countDeniedEvents: vi.fn().mockResolvedValue(ok(5)),
    },
    authzService: {
      requirePermission: vi.fn().mockResolvedValue(ok({ allowed: true })),
    },
  };
}

function okTenant(opts: { userId?: string; businessId?: string; membershipId?: string; role?: Role } = {}): (r: Request) => Promise<ContextResult<TenantRequestContext>> {
  return async () => ({ ok: true as const, context: createTenantRequestContext({ requestId: null, tenant: { userId: opts.userId ?? USER_ID, businessId: opts.businessId ?? BIZ_ID, membershipId: opts.membershipId ?? MEM_ID, role: opts.role ?? 'OWNER' } }) });
}

function failCtx<T>(): (r: Request) => Promise<ContextResult<T>> {
  return async () => ({ ok: false as const, response: apiError('AUTH_CONTEXT_UNAVAILABLE', 'Auth unavailable', 501) });
}

// ---------------------------------------------------------------------------
// Feature flag save/restore
// ---------------------------------------------------------------------------

let pA: string | undefined, pD: string | undefined;
beforeEach(() => { pA = process.env[API_HANDLERS_FEATURE_FLAG]; pD = process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG]; delete process.env[API_HANDLERS_FEATURE_FLAG]; delete process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG]; });
afterEach(() => { if (pA !== undefined) process.env[API_HANDLERS_FEATURE_FLAG] = pA; else delete process.env[API_HANDLERS_FEATURE_FLAG]; if (pD !== undefined) process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG] = pD; else delete process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG]; });

const P = { businessId: BIZ_ID };
const devH = { [DEV_AUTH_HEADERS.userId]: USER_ID, [DEV_AUTH_HEADERS.businessId]: BIZ_ID, [DEV_AUTH_HEADERS.membershipId]: MEM_ID, [DEV_AUTH_HEADERS.role]: 'OWNER' };

// ===========================================================================
// Handler tests
// ===========================================================================

describe('Dashboard Summary Handler', () => {
  // -------------------------------------------------------------------------
  // Authentication & Authorization
  // -------------------------------------------------------------------------

  it('returns 501 when context fails', async () => {
    const d = mockDeps();
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: failCtx() });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(501);
    expect(d.conversationRepository.countOpenConversations).not.toHaveBeenCalled();
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
  });

  it('rejects invalid businessId', async () => {
    const d = mockDeps();
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), { businessId: 'bad' });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('INVALID_DASHBOARD_INPUT');
  });

  it('rejects businessId mismatch (cross-tenant)', async () => {
    const d = mockDeps();
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), { businessId: OTHER_BIZ });
    expect(r.status).toBe(403);
    expect(d.authzService.requirePermission).not.toHaveBeenCalled();
  });

  it('returns ACCESS_DENIED when authz denies', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(ok({ allowed: false }));
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(403);
    expect(d.conversationRepository.countOpenConversations).not.toHaveBeenCalled();
  });

  it('passes authz error through', async () => {
    const d = mockDeps();
    d.authzService.requirePermission.mockResolvedValue(err('INTERNAL_SERVER_ERROR', 'fail'));
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(500);
    expect(d.conversationRepository.countOpenConversations).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // RBAC: OWNER / ADMIN get accessAlerts; OPERATOR / VIEWER get null
  // -------------------------------------------------------------------------

  it('OWNER gets all fields including accessAlerts', async () => {
    const d = mockDeps();
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant({ role: 'OWNER' }) });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    const data: DashboardSummaryResponse = body.data;
    expect(data.openConversations).toBe(10);
    expect(data.waitingForOperator).toBe(3);
    expect(data.needsFollowUp).toBe(1);
    expect(data.draftsPendingReview).toBe(2);
    expect(data.accessAlerts).toBe(5);
    expect(typeof data.generatedAt).toBe('string');
    expect(d.auditRepository.countDeniedEvents).toHaveBeenCalled();
  });

  it('ADMIN gets accessAlerts', async () => {
    const d = mockDeps();
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant({ role: 'ADMIN' }) });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(200);
    const data = (await r.json()).data;
    expect(data.accessAlerts).toBe(5);
    expect(d.auditRepository.countDeniedEvents).toHaveBeenCalled();
  });

  it('OPERATOR gets accessAlerts: null', async () => {
    const d = mockDeps();
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant({ role: 'OPERATOR' }) });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(200);
    const data = (await r.json()).data;
    expect(data.openConversations).toBe(10);
    expect(data.accessAlerts).toBeNull();
    expect(d.auditRepository.countDeniedEvents).not.toHaveBeenCalled();
  });

  it('VIEWER gets accessAlerts: null', async () => {
    const d = mockDeps();
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant({ role: 'VIEWER' }) });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(200);
    const data = (await r.json()).data;
    expect(data.accessAlerts).toBeNull();
    expect(d.auditRepository.countDeniedEvents).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Count accuracy
  // -------------------------------------------------------------------------

  it('returns zeros when no conversations exist', async () => {
    const d = mockDeps();
    d.conversationRepository.countOpenConversations.mockResolvedValue(ok(0));
    d.conversationRepository.countByStatus.mockResolvedValue(ok(0));
    d.conversationRepository.countDraftsPendingReview.mockResolvedValue(ok(0));
    d.conversationRepository.countNeedingFollowUp.mockResolvedValue(ok(0));
    d.auditRepository.countDeniedEvents.mockResolvedValue(ok(0));
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(200);
    const data = (await r.json()).data;
    expect(data.openConversations).toBe(0);
    expect(data.waitingForOperator).toBe(0);
    expect(data.needsFollowUp).toBe(0);
    expect(data.draftsPendingReview).toBe(0);
    expect(data.accessAlerts).toBe(0);
  });

  it('passes correct status to countByStatus', async () => {
    const d = mockDeps();
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x'), P);
    expect(d.conversationRepository.countByStatus).toHaveBeenCalledWith(BIZ_ID, 'WAITING_OPERATOR');
  });

  it('passes businessId to all repo calls', async () => {
    const d = mockDeps();
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant() });
    await h(new Request('http://x'), P);
    expect(d.conversationRepository.countOpenConversations).toHaveBeenCalledWith(BIZ_ID);
    expect(d.conversationRepository.countByStatus).toHaveBeenCalledWith(BIZ_ID, expect.any(String));
    expect(d.conversationRepository.countDraftsPendingReview).toHaveBeenCalledWith(BIZ_ID);
    expect(d.conversationRepository.countNeedingFollowUp).toHaveBeenCalledWith(BIZ_ID, expect.any(Date));
  });

  // -------------------------------------------------------------------------
  // Repository errors
  // -------------------------------------------------------------------------

  it('returns error when countOpenConversations fails', async () => {
    const d = mockDeps();
    d.conversationRepository.countOpenConversations.mockResolvedValue(err('CONVERSATION_REPOSITORY_ERROR', 'DB down'));
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(500);
  });

  it('returns error when countDeniedEvents fails (OWNER)', async () => {
    const d = mockDeps();
    d.auditRepository.countDeniedEvents.mockResolvedValue(err('AUDIT_REPOSITORY_ERROR', 'DB down'));
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant({ role: 'OWNER' }) });
    const r = await h(new Request('http://x'), P);
    expect(r.status).toBe(500);
  });

  // -------------------------------------------------------------------------
  // Response contract
  // -------------------------------------------------------------------------

  it('response includes generatedAt ISO string', async () => {
    const d = mockDeps();
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), P);
    const data = (await r.json()).data;
    // Verify it's a valid ISO timestamp
    const parsed = new Date(data.generatedAt);
    expect(parsed.toISOString()).toBe(data.generatedAt);
  });

  it('response contains no PII fields', async () => {
    const d = mockDeps();
    const h = createGetDashboardSummaryHandler({ ...d, resolveTenantContext: okTenant() });
    const r = await h(new Request('http://x'), P);
    const body = JSON.stringify(await r.json());
    expect(body).not.toContain('email');
    expect(body).not.toContain('name');
    expect(body).not.toContain('content');
    expect(body).not.toContain('userId');
    expect(body).not.toContain('customerId');
  });
});

// ===========================================================================
// Route gate tests
// ===========================================================================

describe('Route gate — disabled', () => {
  it('GET dashboard/summary returns 501', async () => {
    const { GET } = await import('@/app/api/businesses/[businessId]/dashboard/summary/route');
    const r = await GET(new Request('http://x'), { params: Promise.resolve({ businessId: BIZ_ID }) });
    expect(r.status).toBe(501);
    expect((await r.json()).error.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('Route gate — enabled no dev auth', () => {
  it('GET dashboard/summary returns AUTH_CONTEXT_UNAVAILABLE', async () => {
    process.env[API_HANDLERS_FEATURE_FLAG] = 'true';
    const { GET } = await import('@/app/api/businesses/[businessId]/dashboard/summary/route');
    const r = await GET(new Request('http://x'), { params: Promise.resolve({ businessId: BIZ_ID }) });
    expect(r.status).toBe(501);
    expect((await r.json()).error.code).toBe('AUTH_CONTEXT_UNAVAILABLE');
  });
});

describe('Route gate — enabled with dev auth', () => {
  it('GET dashboard/summary returns 200', async () => {
    process.env[API_HANDLERS_FEATURE_FLAG] = 'true';
    process.env[DEV_AUTH_CONTEXT_FEATURE_FLAG] = 'true';
    const { GET } = await import('@/app/api/businesses/[businessId]/dashboard/summary/route');
    const r = await GET(new Request('http://x', { headers: devH }), { params: Promise.resolve({ businessId: BIZ_ID }) });
    expect(r.status).toBe(200);
  });
});

// ===========================================================================
// Scope guards
// ===========================================================================

const ROOT = path.resolve(__dirname, '../..');
const FORBID_ROUTE = ['getPrisma', 'PrismaClient', 'repository', 'middleware', 'clerk', 'next-auth', 'supabase', 'jwt', 'cookie'];
// Dashboard handler imports repository type interfaces (not implementations),
// so 'repository' is omitted from the handler's forbidden list.
const FORBID_HANDLER = ['getPrisma', 'PrismaClient', 'middleware', 'clerk', 'next-auth', 'supabase', 'jwt', 'cookie', 'getApiDependencies'];

describe('Scope guards', () => {
  it('dashboard/summary/route.ts is clean', () => {
    const c = fs.readFileSync(path.join(ROOT, 'src/app/api/businesses/[businessId]/dashboard/summary/route.ts'), 'utf-8');
    for (const f of FORBID_ROUTE) expect(c).not.toContain(f);
  });
  it('dashboard/summary/handler.ts is clean', () => {
    const c = fs.readFileSync(path.join(ROOT, 'src/app/api/businesses/[businessId]/dashboard/summary/handler.ts'), 'utf-8');
    for (const f of FORBID_HANDLER) expect(c).not.toContain(f);
  });
});
