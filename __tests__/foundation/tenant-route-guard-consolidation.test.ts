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
// ===========================================================================

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
