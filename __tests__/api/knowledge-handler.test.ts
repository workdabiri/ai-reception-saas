// ===========================================================================
// Tests — Knowledge / Business-Context API Handlers
//
// Proves the verified business-context management surface (B-R2) is:
//   - tenant-scoped (businessId from route/context only; body cannot override)
//   - verification-safe (create => DRAFT, only verify => VERIFIED)
//   - RBAC-enforced with the REAL authz catalog
//   - audited with PII-safe, content-free metadata
//   - free of any AI provider / generation / send / auto-send wiring
//
// Plain handler-level tests with injected fake deps, mirroring
// customers-handler.test.ts and the real-catalog approach of
// rbac-negative-boundary.test.ts.
// ===========================================================================

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  createListKnowledgeHandler,
  createGetKnowledgeItemHandler,
  createPostKnowledgeHandler,
  createVerifyKnowledgeHandler,
  createArchiveKnowledgeHandler,
  createKnowledgeHandlers,
  type KnowledgeHandlerDeps,
} from '@/app/api/businesses/[businessId]/knowledge/handler';
import {
  createTenantRequestContext,
  type TenantRequestContext,
} from '@/app/api/_shared/request-context';
import { createAuthzService } from '@/domains/authz/implementation';
import { ok } from '@/lib/result';
import type { BusinessContextItem } from '@/domains/knowledge/types';
import type { MembershipRoleValue } from '@/domains/tenancy/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BUSINESS_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_BUSINESS_ID = '55555555-5555-4555-8555-555555555555';
const ITEM_ID = '99999999-9999-4999-8999-999999999999';
const MEMBERSHIP_ID = '66666666-6666-4666-8666-666666666666';

// Sentinels that must NEVER appear in audit metadata (content-free invariant).
const SECRET_VALUE = 'SECRET_CONTEXT_VALUE_DO_NOT_LEAK';
const SECRET_URL = 'https://secret-source.example.com/private';
const SECRET_META = 'INTERNAL_ONLY_SOURCE_METADATA';
const SECRET_KEY = 'opening_hours_internal_key';

function makeItem(
  overrides: Partial<BusinessContextItem> = {},
): BusinessContextItem {
  return {
    id: ITEM_ID,
    businessId: BUSINESS_ID,
    category: 'hours',
    key: SECRET_KEY,
    value: SECRET_VALUE,
    status: 'DRAFT',
    sourceType: 'OWNER_APPROVED',
    sourceLabel: 'Owner intake form',
    sourceUrl: SECRET_URL,
    sourceMetadata: { note: SECRET_META },
    verifiedByUserId: null,
    verifiedAt: null,
    createdByUserId: USER_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const DRAFT_ITEM = makeItem({ status: 'DRAFT' });
const VERIFIED_ITEM = makeItem({
  status: 'VERIFIED',
  verifiedByUserId: USER_ID,
  verifiedAt: '2026-01-02T00:00:00.000Z',
});
const ARCHIVED_ITEM = makeItem({ status: 'ARCHIVED' });

// ---------------------------------------------------------------------------
// Tenant context + deps helpers
// ---------------------------------------------------------------------------

function tenantContextFor(
  role: MembershipRoleValue,
  businessId: string = BUSINESS_ID,
): TenantRequestContext {
  return createTenantRequestContext({
    tenant: { userId: USER_ID, businessId, membershipId: MEMBERSHIP_ID, role },
  });
}

const resolveAsOwner: KnowledgeHandlerDeps['resolveTenantContext'] = () =>
  Promise.resolve({ ok: true, context: tenantContextFor('OWNER') });

function resolveAs(
  role: MembershipRoleValue,
  businessId: string = BUSINESS_ID,
): KnowledgeHandlerDeps['resolveTenantContext'] {
  return () =>
    Promise.resolve({ ok: true, context: tenantContextFor(role, businessId) });
}

/** Deps with a permissive mocked authz (happy-path). */
function makeDeps(
  overrides?: Partial<KnowledgeHandlerDeps>,
): KnowledgeHandlerDeps {
  return {
    knowledgeService: {
      createItem: vi.fn().mockResolvedValue(ok(DRAFT_ITEM)),
      listVerifiedItems: vi.fn().mockResolvedValue(ok([VERIFIED_ITEM])),
      listItems: vi.fn().mockResolvedValue(ok([DRAFT_ITEM])),
      findItem: vi.fn().mockResolvedValue(ok(DRAFT_ITEM)),
      verifyItem: vi.fn().mockResolvedValue(ok(VERIFIED_ITEM)),
      archiveItem: vi.fn().mockResolvedValue(ok(ARCHIVED_ITEM)),
    },
    authzService: {
      requirePermission: vi.fn().mockResolvedValue(ok({ allowed: true })),
    },
    auditService: {
      createAuditEvent: vi.fn().mockResolvedValue(ok({ id: 'audit-1' })),
    },
    resolveTenantContext: resolveAsOwner,
    ...overrides,
  };
}

/** Deps wired with the REAL authz catalog for a given role. */
function realAuthzDeps(role: MembershipRoleValue): KnowledgeHandlerDeps {
  return makeDeps({
    authzService: createAuthzService(),
    resolveTenantContext: resolveAs(role),
  });
}

function makeRequest(body?: unknown): Request {
  return new Request('http://localhost/test', {
    method: 'POST',
    ...(body !== undefined
      ? {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }
      : {}),
  });
}

async function bodyOf(r: Response): Promise<{ ok: boolean; data?: unknown; error?: { code: string } }> {
  return r.json();
}

const VALID_CREATE_BODY = {
  category: 'hours',
  key: 'opening_hours',
  value: 'Mon-Fri 9-5',
  sourceType: 'OWNER_APPROVED' as const,
};

// ===========================================================================
// 1. GET /knowledge — verified-only listing
// ===========================================================================

describe('GET /knowledge — verified-only listing', () => {
  it('returns VERIFIED-only items via knowledgeService.listVerifiedItems', async () => {
    const deps = makeDeps();
    const r = await createListKnowledgeHandler(deps)(
      new Request('http://x/api'),
      { businessId: BUSINESS_ID },
    );

    expect(r.status).toBe(200);
    const body = await bodyOf(r);
    expect(body.ok).toBe(true);
    const items = body.data as BusinessContextItem[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.status).toBe('VERIFIED');
    }
    // Calls the verified-only domain method, scoped to the route business.
    expect(deps.knowledgeService.listVerifiedItems).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS_ID }),
    );
  });

  it('forwards the optional category filter', async () => {
    const deps = makeDeps();
    await createListKnowledgeHandler(deps)(
      new Request('http://x/api?category=hours'),
      { businessId: BUSINESS_ID },
    );
    expect(deps.knowledgeService.listVerifiedItems).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS_ID, category: 'hours' }),
    );
  });
});

// ===========================================================================
// 1b. GET /knowledge?status=... — status-filtered visibility + RBAC
// ===========================================================================

describe('GET /knowledge?status=... — status-filtered visibility', () => {
  it('no status still returns VERIFIED-only via listVerifiedItems (knowledge.read)', async () => {
    const deps = makeDeps();
    const r = await createListKnowledgeHandler(deps)(new Request('http://x/api'), {
      businessId: BUSINESS_ID,
    });
    expect(r.status).toBe(200);
    expect(deps.knowledgeService.listVerifiedItems).toHaveBeenCalledTimes(1);
    expect(deps.knowledgeService.listItems).not.toHaveBeenCalled();
  });

  it('status=VERIFIED uses listItems with VERIFIED and requires knowledge.read', async () => {
    const deps = realAuthzDeps('VIEWER'); // VIEWER has knowledge.read only
    const r = await createListKnowledgeHandler(deps)(
      new Request('http://x/api?status=VERIFIED'),
      { businessId: BUSINESS_ID },
    );
    expect(r.status).toBe(200);
    expect(deps.knowledgeService.listItems).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS_ID, status: 'VERIFIED' }),
    );
  });

  it('status=DRAFT requires knowledge.verify (OWNER allowed)', async () => {
    const deps = realAuthzDeps('OWNER');
    const r = await createListKnowledgeHandler(deps)(
      new Request('http://x/api?status=DRAFT'),
      { businessId: BUSINESS_ID },
    );
    expect(r.status).toBe(200);
    expect(deps.knowledgeService.listItems).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS_ID, status: 'DRAFT' }),
    );
  });

  it('status=ARCHIVED requires knowledge.archive (ADMIN allowed)', async () => {
    const deps = realAuthzDeps('ADMIN');
    const r = await createListKnowledgeHandler(deps)(
      new Request('http://x/api?status=ARCHIVED'),
      { businessId: BUSINESS_ID },
    );
    expect(r.status).toBe(200);
    expect(deps.knowledgeService.listItems).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS_ID, status: 'ARCHIVED' }),
    );
  });

  it('OPERATOR cannot list DRAFT or ARCHIVED (403, no service call)', async () => {
    for (const status of ['DRAFT', 'ARCHIVED'] as const) {
      const deps = realAuthzDeps('OPERATOR');
      const r = await createListKnowledgeHandler(deps)(
        new Request(`http://x/api?status=${status}`),
        { businessId: BUSINESS_ID },
      );
      expect(r.status).toBe(403);
      expect((await bodyOf(r)).error?.code).toBe('ACCESS_DENIED');
      expect(deps.knowledgeService.listItems).not.toHaveBeenCalled();
    }
  });

  it('VIEWER cannot list DRAFT or ARCHIVED (403, no service call)', async () => {
    for (const status of ['DRAFT', 'ARCHIVED'] as const) {
      const deps = realAuthzDeps('VIEWER');
      const r = await createListKnowledgeHandler(deps)(
        new Request(`http://x/api?status=${status}`),
        { businessId: BUSINESS_ID },
      );
      expect(r.status).toBe(403);
      expect((await bodyOf(r)).error?.code).toBe('ACCESS_DENIED');
      expect(deps.knowledgeService.listItems).not.toHaveBeenCalled();
    }
  });

  it('an invalid status query returns 400 before any tenant/authz/service work', async () => {
    const deps = makeDeps();
    const r = await createListKnowledgeHandler(deps)(
      new Request('http://x/api?status=PUBLISHED'),
      { businessId: BUSINESS_ID },
    );
    expect(r.status).toBe(400);
    expect((await bodyOf(r)).error?.code).toBe('INVALID_KNOWLEDGE_INPUT');
    expect(deps.knowledgeService.listItems).not.toHaveBeenCalled();
    expect(deps.knowledgeService.listVerifiedItems).not.toHaveBeenCalled();
    expect(deps.authzService.requirePermission).not.toHaveBeenCalled();
  });

  it('route/tenant mismatch returns 403 and does not call the service', async () => {
    const deps = makeDeps(); // context resolves to BUSINESS_ID
    const r = await createListKnowledgeHandler(deps)(
      new Request('http://x/api?status=DRAFT'),
      { businessId: OTHER_BUSINESS_ID },
    );
    expect(r.status).toBe(403);
    expect((await bodyOf(r)).error?.code).toBe('TENANT_ACCESS_DENIED');
    expect(deps.knowledgeService.listItems).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 1c. GET /knowledge/:itemId — single-item read (knowledge.verify gated)
// ===========================================================================

describe('GET /knowledge/:itemId — single-item read', () => {
  it('returns the item and requires knowledge.verify (OWNER/ADMIN allowed)', async () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const deps = realAuthzDeps(role);
      const r = await createGetKnowledgeItemHandler(deps)(new Request('http://x'), {
        businessId: BUSINESS_ID,
        itemId: ITEM_ID,
      });
      expect(r.status).toBe(200);
      expect(deps.knowledgeService.findItem).toHaveBeenCalledWith({
        businessId: BUSINESS_ID,
        itemId: ITEM_ID,
      });
    }
  });

  it('OPERATOR and VIEWER are denied (403, no service call)', async () => {
    for (const role of ['OPERATOR', 'VIEWER'] as const) {
      const deps = realAuthzDeps(role);
      const r = await createGetKnowledgeItemHandler(deps)(new Request('http://x'), {
        businessId: BUSINESS_ID,
        itemId: ITEM_ID,
      });
      expect(r.status).toBe(403);
      expect((await bodyOf(r)).error?.code).toBe('ACCESS_DENIED');
      expect(deps.knowledgeService.findItem).not.toHaveBeenCalled();
    }
  });

  it('route/tenant mismatch returns 403 and does not call the service', async () => {
    const deps = makeDeps();
    const r = await createGetKnowledgeItemHandler(deps)(new Request('http://x'), {
      businessId: OTHER_BUSINESS_ID,
      itemId: ITEM_ID,
    });
    expect(r.status).toBe(403);
    expect((await bodyOf(r)).error?.code).toBe('TENANT_ACCESS_DENIED');
    expect(deps.knowledgeService.findItem).not.toHaveBeenCalled();
  });

  it('a non-UUID itemId returns 400', async () => {
    const deps = makeDeps();
    const r = await createGetKnowledgeItemHandler(deps)(new Request('http://x'), {
      businessId: BUSINESS_ID,
      itemId: 'not-a-uuid',
    });
    expect(r.status).toBe(400);
    expect(deps.knowledgeService.findItem).not.toHaveBeenCalled();
  });

  it('a not-found item surfaces 404 from the domain', async () => {
    const deps = makeDeps({
      knowledgeService: {
        createItem: vi.fn().mockResolvedValue(ok(DRAFT_ITEM)),
        listVerifiedItems: vi.fn().mockResolvedValue(ok([VERIFIED_ITEM])),
        listItems: vi.fn().mockResolvedValue(ok([DRAFT_ITEM])),
        findItem: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'BUSINESS_CONTEXT_ITEM_NOT_FOUND',
            message: 'Business context item not found',
          },
        }),
        verifyItem: vi.fn().mockResolvedValue(ok(VERIFIED_ITEM)),
        archiveItem: vi.fn().mockResolvedValue(ok(ARCHIVED_ITEM)),
      },
    });
    const r = await createGetKnowledgeItemHandler(deps)(new Request('http://x'), {
      businessId: BUSINESS_ID,
      itemId: ITEM_ID,
    });
    expect(r.status).toBe(404);
    expect((await bodyOf(r)).error?.code).toBe('BUSINESS_CONTEXT_ITEM_NOT_FOUND');
  });
});

// ===========================================================================
// 2. POST /knowledge — create DRAFT
// ===========================================================================

describe('POST /knowledge — create DRAFT', () => {
  it('creates a DRAFT item (never VERIFIED) scoped to the route business', async () => {
    const deps = makeDeps();
    const r = await createPostKnowledgeHandler(deps)(
      makeRequest(VALID_CREATE_BODY),
      { businessId: BUSINESS_ID },
    );

    expect(r.status).toBe(201);
    const body = await bodyOf(r);
    const created = body.data as BusinessContextItem;
    expect(created.status).toBe('DRAFT');
    expect(created.status).not.toBe('VERIFIED');

    // businessId + creator come from context; status is NEVER client-chosen.
    const callArg = (deps.knowledgeService.createItem as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(callArg.businessId).toBe(BUSINESS_ID);
    expect(callArg.createdByUserId).toBe(USER_ID);
    expect(callArg).not.toHaveProperty('status');
    expect(callArg).not.toHaveProperty('verifiedByUserId');
    expect(callArg).not.toHaveProperty('verifiedAt');
  });

  it('rejects a body that smuggles businessId (cannot override route tenant)', async () => {
    const deps = makeDeps();
    const r = await createPostKnowledgeHandler(deps)(
      makeRequest({ ...VALID_CREATE_BODY, businessId: OTHER_BUSINESS_ID }),
      { businessId: BUSINESS_ID },
    );

    expect(r.status).toBe(400);
    expect((await bodyOf(r)).error?.code).toBe('INVALID_KNOWLEDGE_INPUT');
    expect(deps.knowledgeService.createItem).not.toHaveBeenCalled();
  });

  it('rejects a body that smuggles status (no client-chosen verification)', async () => {
    const deps = makeDeps();
    const r = await createPostKnowledgeHandler(deps)(
      makeRequest({ ...VALID_CREATE_BODY, status: 'VERIFIED' }),
      { businessId: BUSINESS_ID },
    );
    expect(r.status).toBe(400);
    expect(deps.knowledgeService.createItem).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 3. POST /knowledge/:itemId/verify
// ===========================================================================

describe('POST /knowledge/:itemId/verify', () => {
  it('verifies a DRAFT item and records verifiedByUserId from auth context', async () => {
    const deps = makeDeps();
    const r = await createVerifyKnowledgeHandler(deps)(makeRequest(), {
      businessId: BUSINESS_ID,
      itemId: ITEM_ID,
    });

    expect(r.status).toBe(200);
    const verified = (await bodyOf(r)).data as BusinessContextItem;
    expect(verified.status).toBe('VERIFIED');

    expect(deps.knowledgeService.verifyItem).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      itemId: ITEM_ID,
      verifiedByUserId: USER_ID,
    });
  });
});

// ===========================================================================
// 4. POST /knowledge/:itemId/archive
// ===========================================================================

describe('POST /knowledge/:itemId/archive', () => {
  it('archives the item, scoped to the route business', async () => {
    const deps = makeDeps();
    const r = await createArchiveKnowledgeHandler(deps)(makeRequest(), {
      businessId: BUSINESS_ID,
      itemId: ITEM_ID,
    });

    expect(r.status).toBe(200);
    const archived = (await bodyOf(r)).data as BusinessContextItem;
    expect(archived.status).toBe('ARCHIVED');
    expect(deps.knowledgeService.archiveItem).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      itemId: ITEM_ID,
    });
  });
});

// ===========================================================================
// 5. Tenant route / context mismatch
// ===========================================================================

describe('tenant route/context mismatch', () => {
  it('GET on a route business that does not match the tenant context → 403, no service call', async () => {
    const deps = makeDeps(); // context resolves to BUSINESS_ID
    const r = await createListKnowledgeHandler(deps)(new Request('http://x'), {
      businessId: OTHER_BUSINESS_ID,
    });
    expect(r.status).toBe(403);
    expect((await bodyOf(r)).error?.code).toBe('TENANT_ACCESS_DENIED');
    expect(deps.knowledgeService.listVerifiedItems).not.toHaveBeenCalled();
  });

  it('POST create on a mismatched route business → 403, no mutation', async () => {
    const deps = makeDeps();
    const r = await createPostKnowledgeHandler(deps)(
      makeRequest(VALID_CREATE_BODY),
      { businessId: OTHER_BUSINESS_ID },
    );
    expect(r.status).toBe(403);
    expect((await bodyOf(r)).error?.code).toBe('TENANT_ACCESS_DENIED');
    expect(deps.knowledgeService.createItem).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 6. RBAC enforcement with the REAL authz catalog
// ===========================================================================

describe('RBAC enforcement (real catalog)', () => {
  it('VIEWER can read but cannot create', async () => {
    const readDeps = realAuthzDeps('VIEWER');
    const readRes = await createListKnowledgeHandler(readDeps)(
      new Request('http://x'),
      { businessId: BUSINESS_ID },
    );
    expect(readRes.status).toBe(200);

    const createDeps = realAuthzDeps('VIEWER');
    const createRes = await createPostKnowledgeHandler(createDeps)(
      makeRequest(VALID_CREATE_BODY),
      { businessId: BUSINESS_ID },
    );
    expect(createRes.status).toBe(403);
    expect((await bodyOf(createRes)).error?.code).toBe('ACCESS_DENIED');
    expect(createDeps.knowledgeService.createItem).not.toHaveBeenCalled();
  });

  it('OPERATOR can create but cannot verify or archive', async () => {
    const createDeps = realAuthzDeps('OPERATOR');
    const createRes = await createPostKnowledgeHandler(createDeps)(
      makeRequest(VALID_CREATE_BODY),
      { businessId: BUSINESS_ID },
    );
    expect(createRes.status).toBe(201);

    const verifyDeps = realAuthzDeps('OPERATOR');
    const verifyRes = await createVerifyKnowledgeHandler(verifyDeps)(
      makeRequest(),
      { businessId: BUSINESS_ID, itemId: ITEM_ID },
    );
    expect(verifyRes.status).toBe(403);
    expect((await bodyOf(verifyRes)).error?.code).toBe('ACCESS_DENIED');
    expect(verifyDeps.knowledgeService.verifyItem).not.toHaveBeenCalled();

    const archiveDeps = realAuthzDeps('OPERATOR');
    const archiveRes = await createArchiveKnowledgeHandler(archiveDeps)(
      makeRequest(),
      { businessId: BUSINESS_ID, itemId: ITEM_ID },
    );
    expect(archiveRes.status).toBe(403);
    expect(archiveDeps.knowledgeService.archiveItem).not.toHaveBeenCalled();
  });

  it('OWNER and ADMIN can verify', async () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const deps = realAuthzDeps(role);
      const r = await createVerifyKnowledgeHandler(deps)(makeRequest(), {
        businessId: BUSINESS_ID,
        itemId: ITEM_ID,
      });
      expect(r.status).toBe(200);
      expect(deps.knowledgeService.verifyItem).toHaveBeenCalled();
    }
  });
});

// ===========================================================================
// 7. Audit is metadata-only and content-free
// ===========================================================================

describe('audit metadata is PII-safe / content-free', () => {
  const ALLOWED_KEYS = ['itemId', 'status', 'category', 'sourceType'];

  async function captureAuditMetadata(
    run: (deps: KnowledgeHandlerDeps) => Promise<unknown>,
    action: string,
  ): Promise<Record<string, unknown>> {
    const deps = makeDeps();
    await run(deps);
    const createAuditEvent = deps.auditService.createAuditEvent as ReturnType<
      typeof vi.fn
    >;
    expect(createAuditEvent).toHaveBeenCalledTimes(1);
    const event = createAuditEvent.mock.calls[0][0];
    expect(event.action).toBe(action);
    expect(event.targetType).toBe('business_context_item');
    expect(event.result).toBe('SUCCESS');
    return event.metadata as Record<string, unknown>;
  }

  function assertNoSecrets(metadata: Record<string, unknown>): void {
    for (const key of Object.keys(metadata)) {
      expect(ALLOWED_KEYS).toContain(key);
    }
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain(SECRET_VALUE);
    expect(serialized).not.toContain(SECRET_URL);
    expect(serialized).not.toContain(SECRET_META);
    expect(serialized).not.toContain(SECRET_KEY);
  }

  it('create emits only allowed, content-free metadata', async () => {
    const metadata = await captureAuditMetadata(
      (deps) =>
        createPostKnowledgeHandler(deps)(makeRequest(VALID_CREATE_BODY), {
          businessId: BUSINESS_ID,
        }),
      'knowledge.create',
    );
    assertNoSecrets(metadata);
  });

  it('verify emits only allowed, content-free metadata', async () => {
    const metadata = await captureAuditMetadata(
      (deps) =>
        createVerifyKnowledgeHandler(deps)(makeRequest(), {
          businessId: BUSINESS_ID,
          itemId: ITEM_ID,
        }),
      'knowledge.verify',
    );
    assertNoSecrets(metadata);
  });

  it('archive emits only allowed, content-free metadata', async () => {
    const metadata = await captureAuditMetadata(
      (deps) =>
        createArchiveKnowledgeHandler(deps)(makeRequest(), {
          businessId: BUSINESS_ID,
          itemId: ITEM_ID,
        }),
      'knowledge.archive',
    );
    assertNoSecrets(metadata);
  });

  it('a failed audit write does not break the mutation response', async () => {
    const deps = makeDeps({
      auditService: {
        createAuditEvent: vi
          .fn()
          .mockRejectedValue(new Error('audit sink down')),
      },
    });
    const r = await createPostKnowledgeHandler(deps)(
      makeRequest(VALID_CREATE_BODY),
      { businessId: BUSINESS_ID },
    );
    expect(r.status).toBe(201);
  });
});

// ===========================================================================
// 8. Scope guard — no AI provider / generation / send wiring
// ===========================================================================

describe('scope guard — knowledge API introduces no AI/send wiring', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const FILES = [
    'src/app/api/businesses/[businessId]/knowledge/handler.ts',
    'src/app/api/businesses/[businessId]/knowledge/route.ts',
    'src/app/api/businesses/[businessId]/knowledge/[itemId]/route.ts',
    'src/app/api/businesses/[businessId]/knowledge/[itemId]/verify/route.ts',
    'src/app/api/businesses/[businessId]/knowledge/[itemId]/archive/route.ts',
  ];

  // Forbidden tokens chosen to avoid matching the files' own prose comments.
  const FORBIDDEN = [
    'process.env',
    'generatetext',
    'aigenerationauditlog',
    'ai_generation_audit',
    'sendmessage',
    'createmessage',
    'autosend',
    'dispatch',
    'openai',
    'anthropic',
    'cohere',
    'mistralai',
    'bedrock',
    'fetch(',
  ];

  it.each(FILES)('%s contains no provider/generation/send token', (file) => {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf-8').toLowerCase();
    for (const token of FORBIDDEN) {
      expect(content).not.toContain(token);
    }
  });
});

// ===========================================================================
// 9. Combined factory smoke
// ===========================================================================

describe('createKnowledgeHandlers factory', () => {
  it('exposes LIST/GET_ITEM/CREATE/VERIFY/ARCHIVE callables', () => {
    const handlers = createKnowledgeHandlers(makeDeps());
    expect(typeof handlers.LIST).toBe('function');
    expect(typeof handlers.GET_ITEM).toBe('function');
    expect(typeof handlers.CREATE).toBe('function');
    expect(typeof handlers.VERIFY).toBe('function');
    expect(typeof handlers.ARCHIVE).toBe('function');
  });
});
