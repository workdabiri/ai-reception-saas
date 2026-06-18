// ===========================================================================
// Test helper — Tenant-Route Guard AST Analyzer (A-H4 hardening)
//
// A real TypeScript-AST static analyzer for the A-H4 route backstop. It exists
// so the consolidation suite can assert structural facts about business-scoped
// handlers instead of relying on substring/regex matching, which a future edit
// could trivially satisfy with a comment, a string literal, or a renamed text
// pattern while leaving the actual `assertBusinessRouteMatchesTenant` backstop
// missing.
//
// This module ONLY parses source text (`ts.createSourceFile`) — it never
// executes handlers, never type-checks, and never touches production code. It
// is consumed exclusively by tests under `__tests__/`. It is intentionally NOT
// a `*.test.ts` file so Vitest does not collect it as a suite.
//
// The unit of analysis is a "route-param handler closure": the innermost
// function that resolves a tenant context scoped to the route `businessId`
// (i.e. passes an object literal `{ ..., source: 'route-param' }` to its
// resolver). For each such closure the analyzer records, by real AST node
// position:
//
//   - resolvePos              where the route-param context resolution happens
//   - guardCallPositions[]    REAL CallExpressions to assertBusinessRouteMatchesTenant
//   - permissionCallPositions[]  REAL CallExpressions whose callee is requirePermission
//                                (matches both `deps.authzService.requirePermission(...)`
//                                 and a module-local `requirePermission(...)` helper)
//
// Because only genuine CallExpression nodes are counted, commented-out calls,
// dead text, and string-literal mentions of the guard name are never mistaken
// for a real guard call.
// ===========================================================================

import ts from 'typescript';

/** The single shared backstop the consolidation enforces. */
export const GUARD_NAME = 'assertBusinessRouteMatchesTenant';
/** The authorization gate the guard must precede. */
export const PERMISSION_NAME = 'requirePermission';
/** Import specifier of the shared backstop module (single source of truth). */
export const SHARED_GUARD_IMPORT = '@/app/api/_shared/tenant-route-guard';
/** The `source` value that marks a route-`businessId`-scoped resolution. */
export const ROUTE_PARAM_SOURCE = 'route-param';

/** Analysis of a single route-param handler closure. */
export interface RouteParamHandlerAnalysis {
  /** Best-effort name of the enclosing builder/closure (for failure messages). */
  readonly label: string;
  /** Source position of the route-param resolution marker. */
  readonly resolvePos: number;
  /** Source positions of REAL `assertBusinessRouteMatchesTenant(...)` calls. */
  readonly guardCallPositions: readonly number[];
  /** Source positions of REAL `requirePermission(...)` calls. */
  readonly permissionCallPositions: readonly number[];
}

/** File-level analysis of a handler module. */
export interface HandlerSourceAnalysis {
  /** True if any real `source: 'route-param'` object-literal marker is present. */
  readonly hasRouteParamMarker: boolean;
  /** True if the module imports `GUARD_NAME` from the shared guard module. */
  readonly importsSharedGuard: boolean;
  /** True if the module DEFINES its own `assertBusinessRouteMatchesTenant`. */
  readonly definesLocalGuard: boolean;
  /** One entry per route-param handler closure discovered in the module. */
  readonly routeParamHandlers: readonly RouteParamHandlerAnalysis[];
}

// ---------------------------------------------------------------------------
// AST primitives
// ---------------------------------------------------------------------------

/** Parses source text into a TS AST with parent pointers (no type-checking). */
export function parseSource(
  source: string,
  fileName = 'handler.ts',
): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
}

/** Rightmost identifier name of a call's callee, or null. */
function calleeName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isParenthesizedExpression(expr)) return calleeName(expr.expression);
  if (ts.isNonNullExpression(expr)) return calleeName(expr.expression);
  return null;
}

/** Text of a (non-computed) property name, or null. */
function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name)) return name.text;
  return null;
}

/**
 * True if `node` is an object literal carrying `source: '<ROUTE_PARAM_SOURCE>'`
 * as a real string-literal property assignment — the marker that a handler
 * resolves a tenant context scoped to the route `businessId`.
 */
function isRouteParamMarker(node: ts.Node): node is ts.ObjectLiteralExpression {
  if (!ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some(
    (p) =>
      ts.isPropertyAssignment(p) &&
      propertyNameText(p.name) === 'source' &&
      ts.isStringLiteralLike(p.initializer) &&
      p.initializer.text === ROUTE_PARAM_SOURCE,
  );
}

/** Innermost function-like declaration enclosing `node`, or null. */
function enclosingFunction(node: ts.Node): ts.Node | null {
  let cur = node.parent as ts.Node | undefined;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      return cur;
    }
    cur = cur.parent;
  }
  return null;
}

/** Best-effort human label for a function node (nearest named ancestor). */
function functionLabel(fn: ts.Node): string {
  let cur: ts.Node | undefined = fn;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) {
      return cur.name.text;
    }
    cur = cur.parent;
  }
  return `anonymous@${fn.pos}`;
}

/**
 * True if `node` DEFINES a binding named `GUARD_NAME` (function declaration or a
 * const/let bound to a function/arrow expression). Used to detect a forbidden
 * local re-definition of the shared backstop.
 */
function definesLocalGuard(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node) && node.name?.text === GUARD_NAME) {
    return true;
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === GUARD_NAME &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer))
  ) {
    return true;
  }
  return false;
}

/** True if `node` is `import { ... GUARD_NAME ... } from '<shared guard>'`. */
function importsSharedGuard(node: ts.Node): boolean {
  if (!ts.isImportDeclaration(node)) return false;
  if (!ts.isStringLiteral(node.moduleSpecifier)) return false;
  if (node.moduleSpecifier.text !== SHARED_GUARD_IMPORT) return false;
  const bindings = node.importClause?.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) {
    return bindings.elements.some((el) => el.name.text === GUARD_NAME);
  }
  return false;
}

/**
 * Collects REAL guard and permission call positions within a function node.
 * Walks the function's descendants; only genuine CallExpression nodes count,
 * so comments and string literals are excluded by construction.
 */
function collectCalls(
  fn: ts.Node,
  sf: ts.SourceFile,
): { guard: number[]; permission: number[] } {
  const guard: number[] = [];
  const permission: number[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n.expression);
      if (name === GUARD_NAME) guard.push(n.getStart(sf));
      else if (name === PERMISSION_NAME) permission.push(n.getStart(sf));
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn, visit);
  return { guard, permission };
}

// ---------------------------------------------------------------------------
// Public analysis
// ---------------------------------------------------------------------------

/** Analyzes a single handler module's source text. */
export function analyzeHandlerSource(
  source: string,
  fileName = 'handler.ts',
): HandlerSourceAnalysis {
  const sf = parseSource(source, fileName);

  let hasRouteParamMarker = false;
  let importsGuard = false;
  let localGuard = false;
  // Innermost function -> resolve marker position (first marker wins).
  const handlerNodes = new Map<ts.Node, number>();

  const visit = (node: ts.Node): void => {
    if (importsSharedGuard(node)) importsGuard = true;
    if (definesLocalGuard(node)) localGuard = true;
    if (isRouteParamMarker(node)) {
      hasRouteParamMarker = true;
      const fn = enclosingFunction(node);
      if (fn && !handlerNodes.has(fn)) {
        handlerNodes.set(fn, node.getStart(sf));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const routeParamHandlers: RouteParamHandlerAnalysis[] = [];
  for (const [fn, resolvePos] of handlerNodes) {
    const { guard, permission } = collectCalls(fn, sf);
    routeParamHandlers.push({
      label: functionLabel(fn),
      resolvePos,
      guardCallPositions: guard,
      permissionCallPositions: permission,
    });
  }

  return {
    hasRouteParamMarker,
    importsSharedGuard: importsGuard,
    definesLocalGuard: localGuard,
    routeParamHandlers,
  };
}
