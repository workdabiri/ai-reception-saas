// ===========================================================================
// Tests — Tenant-Route Guard Consolidation (A-H4.2 static/meta assertion)
//
// Architectural invariant test. A-H4 introduced the shared backstop
// `assertBusinessRouteMatchesTenant` in `src/app/api/_shared/tenant-route-guard.ts`;
// A-H4.2 consolidated every business-scoped handler onto it. This test fails at
// review/CI time if that consolidation regresses, i.e. if a handler:
//
//   1. re-introduces a LOCAL `function assertBusinessRouteMatchesTenant`, or
//   2. resolves tenant context against a route `businessId` but does NOT import
//      and call the shared guard, or
//   3. a second definition of the guard appears anywhere under `src/`
//      (the shared module must remain the single source of truth).
//
// It is a lightweight static scan of committed source — NOT a route registry
// or middleware. It reads files; it does not execute handlers. Behavioral
// proof of the backstop lives in __tests__/api/tenant-route-backstop.test.ts.
//
// ---------------------------------------------------------------------------
// A-H4 AST hardening
// ---------------------------------------------------------------------------
// The substring/regex checks above are necessary but weak: a future edit could
// satisfy them with a comment, a string literal, or a renamed text pattern
// while the real backstop is missing. The `(AST/static hardening)` block below
// re-proves the same invariants over a real TypeScript AST
// (see ../_helpers/tenant-route-guard-ast.ts), counting only genuine
// CallExpression nodes. It additionally proves, per handler closure, that the
// `assertBusinessRouteMatchesTenant(...)` call happens AFTER tenant-context
// resolution and BEFORE the authorization gate (`requirePermission`). A final
// block exercises the analyzer against synthetic fixtures to prove it rejects
// the exact bypasses the regex form cannot see (commented-out call, missing
// call, string-literal mention, permission-before-guard ordering).
// ===========================================================================

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  analyzeHandlerSource,
  GUARD_NAME as AST_GUARD_NAME,
  SHARED_GUARD_IMPORT as AST_SHARED_GUARD_IMPORT,
} from '../_helpers/tenant-route-guard-ast';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUSINESS_HANDLERS_DIR = path.join(REPO_ROOT, 'src/app/api/businesses');
const SRC_DIR = path.join(REPO_ROOT, 'src');

/** Import specifier and identifier for the single shared backstop. */
const SHARED_GUARD_MODULE = 'src/app/api/_shared/tenant-route-guard.ts';
const SHARED_GUARD_IMPORT = '@/app/api/_shared/tenant-route-guard';
const GUARD_NAME = 'assertBusinessRouteMatchesTenant';

/** Matches a guard DEFINITION (`function` or `export function ...`). */
const GUARD_DEFINITION_RE = /function\s+assertBusinessRouteMatchesTenant\b/;
/** Matches a guard CALL site (identifier immediately followed by `(`). */
const GUARD_CALL_RE = /assertBusinessRouteMatchesTenant\s*\(/;
/**
 * Marker that a handler resolves tenant context scoped to a route `businessId`
 * (every such handler passes `source: 'route-param'` to the resolver).
 */
const ROUTE_PARAM_MARKER = 'route-param';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collects files under `dir` matching `keep`. */
function walk(dir: string, keep: (absPath: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(abs, keep));
    } else if (entry.isFile() && keep(abs)) {
      out.push(abs);
    }
  }
  return out;
}

function rel(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

function read(absPath: string): string {
  return fs.readFileSync(absPath, 'utf8');
}

const businessHandlerFiles = walk(
  BUSINESS_HANDLERS_DIR,
  (f) => path.basename(f) === 'handler.ts',
);

const routeParamHandlerFiles = businessHandlerFiles.filter((f) =>
  read(f).includes(ROUTE_PARAM_MARKER),
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('A-H4.2 tenant-route guard consolidation (static)', () => {
  it('discovers the business-scoped handler surface (guards against a vacuous suite)', () => {
    // The business API has well over a dozen handler modules; if the glob ever
    // finds far fewer, the scan below would pass vacuously — fail loudly first.
    expect(businessHandlerFiles.length).toBeGreaterThanOrEqual(12);
    expect(routeParamHandlerFiles.length).toBeGreaterThanOrEqual(12);
  });

  it('no business-scoped handler defines a local assertBusinessRouteMatchesTenant', () => {
    const offenders = businessHandlerFiles
      .filter((f) => GUARD_DEFINITION_RE.test(read(f)))
      .map(rel);
    expect(
      offenders,
      `These handlers define a LOCAL tenant-route guard instead of importing the ` +
        `shared one from '${SHARED_GUARD_IMPORT}':\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('every route-param tenant handler imports AND calls the shared guard', () => {
    const missingImport: string[] = [];
    const missingCall: string[] = [];

    for (const f of routeParamHandlerFiles) {
      const content = read(f);
      if (!content.includes(SHARED_GUARD_IMPORT)) missingImport.push(rel(f));
      if (!GUARD_CALL_RE.test(content)) missingCall.push(rel(f));
    }

    expect(
      missingImport,
      `These route-param tenant handlers do not import the shared guard from ` +
        `'${SHARED_GUARD_IMPORT}':\n${missingImport.join('\n')}`,
    ).toEqual([]);
    expect(
      missingCall,
      `These route-param tenant handlers never call ${GUARD_NAME}(...):\n` +
        missingCall.join('\n'),
    ).toEqual([]);
  });

  it('the shared module is the single source of truth for the guard', () => {
    const guardAbs = path.join(REPO_ROOT, SHARED_GUARD_MODULE);
    const guardSrc = read(guardAbs);
    expect(/export function\s+assertBusinessRouteMatchesTenant\b/.test(guardSrc)).toBe(
      true,
    );

    const definers = walk(SRC_DIR, (f) => f.endsWith('.ts'))
      .filter((f) => GUARD_DEFINITION_RE.test(read(f)))
      .map(rel)
      .sort();

    expect(
      definers,
      `The guard must be defined ONLY in '${SHARED_GUARD_MODULE}'. Found definitions in:\n` +
        definers.join('\n'),
    ).toEqual([SHARED_GUARD_MODULE]);
  });
});

// ---------------------------------------------------------------------------
// A-H4 AST/static hardening — over committed handler source
// ---------------------------------------------------------------------------

/** Analyze every business-scoped handler module once, with file labels. */
const handlerAnalyses = businessHandlerFiles.map((f) => ({
  file: rel(f),
  analysis: analyzeHandlerSource(read(f), rel(f)),
}));

/** Handler modules that resolve a route-`businessId`-scoped tenant context. */
const routeParamAnalyses = handlerAnalyses.filter(
  (a) => a.analysis.hasRouteParamMarker,
);

/** The authorization gate the backstop must precede. */
const PERMISSION_AST_NAME = 'requirePermission';

describe('A-H4 tenant-route guard consolidation (AST/static hardening)', () => {
  it('AST route-param detection matches the substring scan (self-calibrating, non-vacuous)', () => {
    // Derive the expected surface from the codebase itself instead of a magic
    // threshold: the AST walker must find a real `source: 'route-param'` marker
    // in EXACTLY the files the substring scan flags. Any divergence means the
    // walker has drifted from the source (parser gap, or a handler that smells
    // like route-param to one detector but not the other) — fail loudly rather
    // than pass vacuously.
    const astFiles = routeParamAnalyses.map((a) => a.file).sort();
    const substringFiles = routeParamHandlerFiles.map(rel).sort();

    expect(astFiles).toEqual(substringFiles);
    expect(astFiles.length).toBeGreaterThan(0);

    // Every route-param file must expose at least one analyzable handler
    // closure; otherwise the per-closure assertions below would be vacuous.
    const emptyFiles = routeParamAnalyses
      .filter((a) => a.analysis.routeParamHandlers.length === 0)
      .map((a) => a.file);
    expect(
      emptyFiles,
      `These files carry a route-param marker but expose no analyzable handler ` +
        `closure (the AST walker could not bind the marker to a function):\n` +
        emptyFiles.join('\n'),
    ).toEqual([]);
  });

  it('every route-param handler closure makes a REAL assertBusinessRouteMatchesTenant(...) call', () => {
    const offenders: string[] = [];
    for (const { file, analysis } of routeParamAnalyses) {
      for (const handler of analysis.routeParamHandlers) {
        if (handler.guardCallPositions.length === 0) {
          offenders.push(`${file} :: ${handler.label}`);
        }
      }
    }
    expect(
      offenders,
      `These route-param handler closures resolve a route-param tenant context ` +
        `but never call ${AST_GUARD_NAME}(...) as a real AST CallExpression ` +
        `(a comment, dead text, or string-literal mention does NOT count):\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('the guard call happens AFTER context resolution and BEFORE authz (requirePermission)', () => {
    const violations: string[] = [];
    for (const { file, analysis } of routeParamAnalyses) {
      for (const handler of analysis.routeParamHandlers) {
        if (handler.guardCallPositions.length === 0) continue; // flagged above
        const firstGuard = Math.min(...handler.guardCallPositions);

        if (firstGuard <= handler.resolvePos) {
          violations.push(
            `${file} :: ${handler.label} — guard call precedes (or shares the ` +
              `position of) the route-param context resolution`,
          );
        }

        if (handler.permissionCallPositions.length > 0) {
          const firstPermission = Math.min(...handler.permissionCallPositions);
          if (firstGuard >= firstPermission) {
            violations.push(
              `${file} :: ${handler.label} — guard call does not precede ` +
                `${PERMISSION_AST_NAME}(...)`,
            );
          }
        }
      }
    }
    expect(
      violations,
      `The backstop must fire after tenant resolution and before the ` +
        `authorization gate in the same handler path. Ordering violations:\n` +
        violations.join('\n'),
    ).toEqual([]);
  });

  it('every route-param handler module imports the shared guard (named import, AST)', () => {
    const missing = routeParamAnalyses
      .filter((a) => !a.analysis.importsSharedGuard)
      .map((a) => a.file);
    expect(
      missing,
      `These route-param handler modules do not import { ${AST_GUARD_NAME} } ` +
        `from '${AST_SHARED_GUARD_IMPORT}':\n` +
        missing.join('\n'),
    ).toEqual([]);
  });

  it('no business-scoped handler module defines a LOCAL guard (AST)', () => {
    const offenders = handlerAnalyses
      .filter((a) => a.analysis.definesLocalGuard)
      .map((a) => a.file);
    expect(
      offenders,
      `These handler modules DEFINE their own ${AST_GUARD_NAME} instead of ` +
        `importing the shared one:\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A-H4 AST analyzer — synthetic fixtures
//
// Prove the analyzer accepts a correctly-guarded handler and rejects each
// bypass the substring/regex form cannot see. These snippets are parsed by the
// AST, never executed, so undeclared references (deps, params) are irrelevant.
// ---------------------------------------------------------------------------

/** Header shared by every fixture: imports the shared guard + resolver. */
const FIXTURE_IMPORTS = `
import { assertBusinessRouteMatchesTenant } from '@/app/api/_shared/tenant-route-guard';
import { resolveTenantRequestContext } from '@/app/api/_shared/request-context';
`;

/** Correctly guarded: resolve (route-param) -> guard -> requirePermission. */
const FIXTURE_GUARDED = `${FIXTURE_IMPORTS}
export function createOkHandler(deps) {
  return async (request, params) => {
    const { businessId } = params;
    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, { businessId, source: 'route-param' });
    if (!contextResult.ok) return contextResult.response;
    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;
    const authzResult = await deps.authzService.requirePermission({ permission: 'x.read' });
    return authzResult;
  };
}
`;

/** Guarded via a module-local requirePermission(...) helper (bare identifier). */
const FIXTURE_GUARDED_HELPER_PERM = `${FIXTURE_IMPORTS}
async function requirePermission(deps, context) {
  return deps.authzService.requirePermission({ permission: 'x.read' });
}
export function createHelperHandler(deps) {
  return async (request, params) => {
    const { businessId } = params;
    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, { businessId, source: 'route-param' });
    if (!contextResult.ok) return contextResult.response;
    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;
    return requirePermission(deps, contextResult.context);
  };
}
`;

/** The guard call is COMMENTED OUT and mentioned only in a string. */
const FIXTURE_COMMENTED_GUARD = `${FIXTURE_IMPORTS}
export function createCommentedHandler(deps) {
  return async (request, params) => {
    const { businessId } = params;
    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, { businessId, source: 'route-param' });
    if (!contextResult.ok) return contextResult.response;
    // const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    // if (mismatch) return mismatch;
    const note = 'calls assertBusinessRouteMatchesTenant(contextResult.context, businessId)';
    const authzResult = await deps.authzService.requirePermission({ permission: 'x.read' });
    return authzResult || note;
  };
}
`;

/** Resolves route-param context but never calls the guard at all. */
const FIXTURE_MISSING_GUARD = `${FIXTURE_IMPORTS}
export function createMissingHandler(deps) {
  return async (request, params) => {
    const { businessId } = params;
    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, { businessId, source: 'route-param' });
    if (!contextResult.ok) return contextResult.response;
    const authzResult = await deps.authzService.requirePermission({ permission: 'x.read' });
    return authzResult;
  };
}
`;

/** Calls requirePermission BEFORE the guard (wrong order). */
const FIXTURE_PERM_BEFORE_GUARD = `${FIXTURE_IMPORTS}
export function createMisorderedHandler(deps) {
  return async (request, params) => {
    const { businessId } = params;
    const resolve = deps.resolveTenantContext ?? resolveTenantRequestContext;
    const contextResult = await resolve(request, { businessId, source: 'route-param' });
    if (!contextResult.ok) return contextResult.response;
    const authzResult = await deps.authzService.requirePermission({ permission: 'x.read' });
    const mismatch = assertBusinessRouteMatchesTenant(contextResult.context, businessId);
    if (mismatch) return mismatch;
    return authzResult;
  };
}
`;

/** Authenticated (non route-param) handler: not a backstop subject at all. */
const FIXTURE_NON_ROUTE_PARAM = `${FIXTURE_IMPORTS}
export function createListHandler(deps) {
  return async (request) => {
    const contextResult = await deps.resolveAuthenticatedContext(request);
    if (!contextResult.ok) return contextResult.response;
    return deps.tenancyService.listUserBusinesses({ userId: contextResult.context.userId });
  };
}
`;

/** Applies the SAME assertions the real-source suite applies to one fixture. */
function guardOffenders(source: string): string[] {
  const { routeParamHandlers } = analyzeHandlerSource(source, 'fixture.ts');
  return routeParamHandlers
    .filter((h) => h.guardCallPositions.length === 0)
    .map((h) => h.label);
}

function orderingOffenders(source: string): string[] {
  const { routeParamHandlers } = analyzeHandlerSource(source, 'fixture.ts');
  const out: string[] = [];
  for (const h of routeParamHandlers) {
    if (h.guardCallPositions.length === 0) continue;
    const firstGuard = Math.min(...h.guardCallPositions);
    if (firstGuard <= h.resolvePos) out.push(`${h.label}:after-resolve`);
    if (h.permissionCallPositions.length > 0) {
      const firstPermission = Math.min(...h.permissionCallPositions);
      if (firstGuard >= firstPermission) out.push(`${h.label}:before-perm`);
    }
  }
  return out;
}

describe('A-H4 AST analyzer — synthetic fixtures', () => {
  it('accepts a correctly guarded handler', () => {
    const { routeParamHandlers } = analyzeHandlerSource(FIXTURE_GUARDED);
    expect(routeParamHandlers).toHaveLength(1);
    expect(routeParamHandlers[0].guardCallPositions).toHaveLength(1);
    expect(guardOffenders(FIXTURE_GUARDED)).toEqual([]);
    expect(orderingOffenders(FIXTURE_GUARDED)).toEqual([]);
  });

  it('accepts a handler guarded ahead of a module-local requirePermission helper', () => {
    // The helper's own deps.authzService.requirePermission(...) lives in a
    // SEPARATE function and must not be attributed to the handler closure; the
    // closure's bare requirePermission(...) call is what ordering checks see.
    const { routeParamHandlers } = analyzeHandlerSource(FIXTURE_GUARDED_HELPER_PERM);
    expect(routeParamHandlers).toHaveLength(1);
    expect(routeParamHandlers[0].permissionCallPositions).toHaveLength(1);
    expect(guardOffenders(FIXTURE_GUARDED_HELPER_PERM)).toEqual([]);
    expect(orderingOffenders(FIXTURE_GUARDED_HELPER_PERM)).toEqual([]);
  });

  it('rejects a handler whose only guard "call" is a comment or string literal', () => {
    expect(guardOffenders(FIXTURE_COMMENTED_GUARD)).toEqual(['createCommentedHandler']);
  });

  it('rejects a route-param handler that never calls the guard', () => {
    expect(guardOffenders(FIXTURE_MISSING_GUARD)).toEqual(['createMissingHandler']);
  });

  it('rejects a handler that calls requirePermission before the guard', () => {
    expect(guardOffenders(FIXTURE_PERM_BEFORE_GUARD)).toEqual([]); // call exists
    expect(orderingOffenders(FIXTURE_PERM_BEFORE_GUARD)).toEqual([
      'createMisorderedHandler:before-perm',
    ]);
  });

  it('does not treat an authenticated (non route-param) handler as a subject', () => {
    const { hasRouteParamMarker, routeParamHandlers } =
      analyzeHandlerSource(FIXTURE_NON_ROUTE_PARAM);
    expect(hasRouteParamMarker).toBe(false);
    expect(routeParamHandlers).toEqual([]);
  });

  it('flags a locally-defined guard and detects the shared import', () => {
    const local = `
export function assertBusinessRouteMatchesTenant(context, businessId) {
  return null;
}
`;
    expect(analyzeHandlerSource(local).definesLocalGuard).toBe(true);
    expect(analyzeHandlerSource(FIXTURE_GUARDED).definesLocalGuard).toBe(false);
    expect(analyzeHandlerSource(FIXTURE_GUARDED).importsSharedGuard).toBe(true);
  });
});
