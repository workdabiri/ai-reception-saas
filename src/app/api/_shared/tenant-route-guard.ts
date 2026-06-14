// ===========================================================================
// API Shared — Tenant/Route Alignment Backstop (A-H4)
//
// Centralized defense-in-depth guard for business-scoped API handlers.
//
// Every tenant-scoped route resolves its TenantRequestContext from the route
// `businessId` (scope source 'route-param'), so a correctly resolved context's
// businessId already equals the route param. This guard is the *backstop*: it
// fails closed if a handler ever operates on a route for Business B while
// holding a context resolved for Business A — e.g. a future handler that
// resolves context from the `x-business-id` header, a mis-wired resolver, or a
// test/dev adapter that returns a context for the wrong business.
//
// It does NOT replace tenant resolution or RBAC; it sits between them in the
// canonical handler sequence:
//
//   validate route params
//     -> resolve tenant context (route-param scope)
//     -> assertBusinessRouteMatchesTenant   <-- this backstop
//     -> requirePermission
//     -> domain service / repository call
//
// On mismatch it returns the existing tenant-denial envelope
// (TENANT_ACCESS_DENIED, 403) — identical to the per-handler checks it
// consolidates, so HTTP/error conventions are preserved. Not RLS, not a
// policy engine.
// ===========================================================================

import { apiError } from './responses';
import type { TenantRequestContext } from './request-context';

/**
 * Asserts that the route `businessId` matches the resolved tenant context's
 * businessId.
 *
 * Returns `null` when aligned (the caller may proceed) and a
 * `TENANT_ACCESS_DENIED` (403) `Response` on mismatch — fail closed before any
 * permission check or domain call.
 *
 * This is the shared backstop for A-H4. New business-scoped handlers should
 * call it immediately after resolving tenant context and before any permission
 * check or domain call, so tenant/route misalignment fails closed regardless
 * of per-handler discipline.
 *
 * @param context - The resolved, DB-validated tenant request context.
 * @param businessId - The `businessId` taken from the route path param.
 */
export function assertBusinessRouteMatchesTenant(
  context: TenantRequestContext,
  businessId: string,
): Response | null {
  if (businessId !== context.businessId) {
    return apiError('TENANT_ACCESS_DENIED', 'Tenant access denied', 403);
  }
  return null;
}
