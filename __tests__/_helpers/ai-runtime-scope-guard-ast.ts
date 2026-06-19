// ===========================================================================
// Test helper — AI-Runtime Scope-Guard AST Analyzer (test-only hardening)
//
// A real TypeScript-AST static analyzer for the AI-runtime domain scope
// invariants (B-R3..B-R6, locked structurally by B-R7 / B-R8). It exists so the
// scope-guard suite can assert STRUCTURAL facts about the AI-runtime source
// instead of relying on substring/regex matching, which a future edit could
// trivially satisfy — or trip — with a comment, a string literal, or a renamed
// text pattern while the real forbidden behavior is present or absent.
//
// This module ONLY parses source text (`ts.createSourceFile`) — it NEVER
// executes the source, never type-checks, and never touches production code. It
// is consumed exclusively by tests under `__tests__/`. It is intentionally NOT a
// `*.test.ts` file so Vitest does not collect it as a suite.
//
// Both the dot form `obj.name` AND the string-literal bracket form
// `obj['name']` / obj[`name`] are resolved, so a violation cannot hide behind
// element-access syntax (e.g. `provider['generateText'](…)`, `db['customer']`,
// `process['env']`, `config['apiKey']`). A computed/numeric key (`obj[k]`,
// `parts[0]`) resolves to null and is never guessed at.
//
// Because only GENUINE AST nodes are inspected (CallExpression callees, import
// module specifiers, property/element accesses, identifiers), the following are
// NEVER mistaken for real violations:
//   - a forbidden name mentioned in a comment or a normal string literal (one
//     that is not itself a semantic element-access key);
//   - a METHOD DEFINITION / interface method signature named `generateText`
//     (only a real `…generateText(…)` / `…['generateText'](…)` CallExpression is
//     a provider call-site);
//   - the allowed `…aiGenerationAuditLog` Prisma delegate, in either access form
//     (only the forbidden customer/conversation/message/replyDraft delegates
//     count);
//   - `error.message` / `data.errorMessage` / `…replyDraftId` /
//     `audit['replyDraftId']` (the forbidden Prisma check requires a Prisma-like
//     base AND an exact delegate name).
//
// What the analyzer detects (each as real AST nodes only):
//   1. send/dispatch/deliver/createMessage-style CallExpression call-sites
//   2. real `.generateText(…)` provider call-sites
//   3. forbidden cross-domain imports (conversations/channels/actions/
//      reply-drafts/crm)
//   4. real model-provider SDK imports (openai/@anthropic-ai/…/etc.)
//   5. `process.env` reads
//   6. API-key-like identifier / property reads
//   7. forbidden Prisma delegate access (customer/conversation/message/
//      replyDraft)
// ===========================================================================

import ts from 'typescript';

// ---------------------------------------------------------------------------
// Forbidden / allowed contracts (single source of truth for the analyzer)
// ---------------------------------------------------------------------------

/** The provider method whose REAL call-site (not its definition) is forbidden. */
export const GENERATE_TEXT_METHOD = 'generateText';

/**
 * Send / dispatch / deliver / message-creation call NAMES. A genuine
 * CallExpression whose callee resolves to one of these is a send/delivery
 * call-site. Includes (at least) the names pinned by the B-R8 no-auto-send lock.
 */
export const SEND_CALL_NAMES: readonly string[] = [
  'sendMessage',
  'sendDraft',
  'autoSend',
  'dispatch',
  'deliver',
  'createMessage',
  // Defense in depth — additional delivery-shaped verbs.
  'send',
  'sendReply',
  'sendEmail',
  'sendSms',
  'deliverMessage',
  'dispatchMessage',
  'enqueueMessage',
];

/**
 * Prisma delegate names the AI runtime must NEVER read. `aiGenerationAuditLog`
 * is deliberately absent: it is the audit boundary's ALLOWED delegate.
 */
export const FORBIDDEN_PRISMA_DELEGATES: readonly string[] = [
  'customer',
  'conversation',
  'message',
  'replyDraft',
];

/**
 * Identifiers whose rightmost name marks a Prisma-client base — an exact
 * `db`/`prisma`/`tx`/`trx`/`client`, OR any name ending in `Db`/`Prisma`/
 * `Client` (e.g. `prismaClient`, `dbClient`, `tenantPrisma`). The forbidden
 * delegate check fires ONLY when a forbidden delegate name is accessed off such
 * a base, so `error.message` (base `error`) is never a false positive, while a
 * future `client.customer` / `prismaClient.message` access is still caught.
 */
const PRISMA_BASE_PATTERN = /^(db|prisma|tx|trx|client)$|(?:Db|Prisma|Client)$/;

/** Cross-domain import specifiers forbidden inside AI-runtime source. */
export const FORBIDDEN_DOMAIN_IMPORT_PATTERNS: readonly RegExp[] = [
  /(^|\/)domains\/conversations(\/|$)/,
  /(^|\/)domains\/channels(\/|$)/,
  /(^|\/)domains\/actions(\/|$)/,
  /(^|\/)domains\/reply-drafts(\/|$)/,
  /(^|\/)domains\/crm(\/|$)/,
];

/**
 * Real model-provider SDK package patterns, tested against the PACKAGE NAME of
 * an import specifier (so `@aws-sdk/client-s3` and `@prisma/client` are never
 * mistaken for an AI SDK). Covers at least: openai, @anthropic-ai/sdk,
 * anthropic, @google/genai, @google/generative-ai, cohere-ai, mistralai,
 * @aws-sdk/client-bedrock-runtime, replicate, groq-sdk, together-ai.
 */
export const PROVIDER_SDK_PATTERNS: readonly RegExp[] = [
  /^openai$/,
  /^@azure\/openai$/,
  /^anthropic$/,
  /^@anthropic-ai\/.+/,
  /^@google\/genai$/,
  /^@google\/generative-ai$/,
  /^@google-cloud\/vertexai$/,
  /^googleapis$/,
  /^cohere-ai$/,
  /^@cohere-ai\/.+/,
  /^mistralai$/,
  /^@mistralai\/.+/,
  /^@aws-sdk\/client-bedrock.*/,
  /^@amazon-bedrock\/.+/,
  /^replicate$/,
  /^groq-sdk$/,
  /^@groq\/.+/,
  /^together-ai$/,
  /^@huggingface\/.+/,
  /^llamaindex$/,
];

/** API-key-like identifier / property-name pattern (case-insensitive). */
export const API_KEY_PATTERN = /api[_-]?key/i;

// ---------------------------------------------------------------------------
// Finding types
// ---------------------------------------------------------------------------

/** The category of a detected scope violation. */
export type ScopeViolationKind =
  | 'send-call'
  | 'generate-text-call'
  | 'forbidden-domain-import'
  | 'provider-sdk-import'
  | 'process-env-read'
  | 'api-key-read'
  | 'forbidden-prisma-access';

/** A single detected violation, located by real AST node position. */
export interface ScopeFinding {
  readonly kind: ScopeViolationKind;
  /** Human-readable subject (call name, import specifier, `base.delegate`, …). */
  readonly detail: string;
  /** Source character offset of the offending node. */
  readonly pos: number;
  /** 1-based source line of the offending node. */
  readonly line: number;
}

/** Full scope analysis of a single source module. */
export interface AiRuntimeScopeAnalysis {
  readonly sendCalls: readonly ScopeFinding[];
  readonly generateTextCalls: readonly ScopeFinding[];
  readonly forbiddenDomainImports: readonly ScopeFinding[];
  readonly providerSdkImports: readonly ScopeFinding[];
  readonly processEnvReads: readonly ScopeFinding[];
  readonly apiKeyReads: readonly ScopeFinding[];
  readonly forbiddenPrismaAccess: readonly ScopeFinding[];
  /** Every finding above, concatenated (handy for a single "is clean" assert). */
  readonly all: readonly ScopeFinding[];
  /** Every real import/require/dynamic-import specifier (for repo-wide scans). */
  readonly importSpecifiers: readonly string[];
}

// ---------------------------------------------------------------------------
// AST primitives
// ---------------------------------------------------------------------------

/** Parses source text into a TS AST with parent pointers (no type-checking). */
export function parseSource(
  source: string,
  fileName = 'ai-runtime-source.ts',
): ts.SourceFile {
  const scriptKind = /\.tsx$/i.test(fileName)
    ? ts.ScriptKind.TSX
    : /\.jsx$/i.test(fileName)
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS;
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );
}

/**
 * The accessed property name on a property/element access, when STATICALLY
 * known: the identifier name for `obj.name`, or the string-literal /
 * no-substitution-template key for `obj['name']` / obj[`name`]. A COMPUTED key
 * (variable / expression / numeric index) yields null, so dynamic access — and
 * numeric indexing like `parts[0]` — is never guessed at.
 */
function accessedName(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const arg = node.argumentExpression;
  return ts.isStringLiteralLike(arg) ? arg.text : null;
}

/** Rightmost statically-known name of a call's callee (dot or bracket), or null. */
function calleeName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
    return accessedName(expr);
  }
  if (ts.isParenthesizedExpression(expr)) return calleeName(expr.expression);
  if (ts.isNonNullExpression(expr)) return calleeName(expr.expression);
  return null;
}

/**
 * Rightmost statically-known name of an arbitrary expression (a property base),
 * resolving both dot and string-literal bracket access, or null.
 */
function rightmostName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
    return accessedName(expr);
  }
  if (ts.isParenthesizedExpression(expr)) return rightmostName(expr.expression);
  if (ts.isNonNullExpression(expr)) return rightmostName(expr.expression);
  if (ts.isCallExpression(expr)) return rightmostName(expr.expression);
  return null;
}

/** True if `name` looks like a Prisma-client base (`db`, `prisma`, `*Db`, …). */
function isPrismaBaseName(name: string | null): boolean {
  return name !== null && PRISMA_BASE_PATTERN.test(name);
}

/** The npm PACKAGE NAME of an import specifier, or null for non-packages. */
export function packageNameOf(specifier: string): string | null {
  // Relative / absolute / the `@/…` src path alias / node: builtins are not
  // npm packages and can never be a provider SDK.
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('@/') ||
    specifier.startsWith('node:')
  ) {
    return null;
  }
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return parts[0];
}

/** True if an import specifier resolves to a real model-provider SDK package. */
export function isProviderSdkSpecifier(specifier: string): boolean {
  const pkg = packageNameOf(specifier);
  if (pkg === null) return false;
  return PROVIDER_SDK_PATTERNS.some((re) => re.test(pkg));
}

/** True if an import specifier targets a forbidden cross-domain module. */
export function isForbiddenDomainSpecifier(specifier: string): boolean {
  return FORBIDDEN_DOMAIN_IMPORT_PATTERNS.some((re) => re.test(specifier));
}

/**
 * Real import/require/dynamic-import module specifier carried by `node`, with
 * its source position — or null if `node` is not an import-bearing node.
 */
function importSpecifierOf(
  node: ts.Node,
  sf: ts.SourceFile,
): { specifier: string; pos: number } | null {
  if (
    ts.isImportDeclaration(node) &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return { specifier: node.moduleSpecifier.text, pos: node.getStart(sf) };
  }
  if (
    ts.isExportDeclaration(node) &&
    node.moduleSpecifier &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return { specifier: node.moduleSpecifier.text, pos: node.getStart(sf) };
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    ts.isStringLiteralLike(node.moduleReference.expression)
  ) {
    return {
      specifier: node.moduleReference.expression.text,
      pos: node.getStart(sf),
    };
  }
  if (ts.isCallExpression(node) && node.arguments.length >= 1) {
    const isRequire =
      ts.isIdentifier(node.expression) && node.expression.text === 'require';
    const isDynamicImport =
      node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const arg = node.arguments[0];
    if ((isRequire || isDynamicImport) && ts.isStringLiteralLike(arg)) {
      return { specifier: arg.text, pos: node.getStart(sf) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public analysis
// ---------------------------------------------------------------------------

/** Collects every real import/require/dynamic-import specifier in `source`. */
export function collectImportSpecifiers(
  source: string,
  fileName = 'module.ts',
): string[] {
  const sf = parseSource(source, fileName);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    const imp = importSpecifierOf(node, sf);
    if (imp) out.push(imp.specifier);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Analyzes a single module's source text for AI-runtime scope violations. */
export function analyzeAiRuntimeSource(
  source: string,
  fileName = 'ai-runtime-source.ts',
): AiRuntimeScopeAnalysis {
  const sf = parseSource(source, fileName);

  const sendCalls: ScopeFinding[] = [];
  const generateTextCalls: ScopeFinding[] = [];
  const forbiddenDomainImports: ScopeFinding[] = [];
  const providerSdkImports: ScopeFinding[] = [];
  const processEnvReads: ScopeFinding[] = [];
  const apiKeyReads: ScopeFinding[] = [];
  const forbiddenPrismaAccess: ScopeFinding[] = [];
  const importSpecifiers: string[] = [];

  const finding = (
    kind: ScopeViolationKind,
    detail: string,
    pos: number,
  ): ScopeFinding => ({
    kind,
    detail,
    pos,
    line: sf.getLineAndCharacterOfPosition(pos).line + 1,
  });

  const visit = (node: ts.Node): void => {
    // (3,4) Imports — classify the real module specifier.
    const imp = importSpecifierOf(node, sf);
    if (imp) {
      importSpecifiers.push(imp.specifier);
      if (isForbiddenDomainSpecifier(imp.specifier)) {
        forbiddenDomainImports.push(
          finding('forbidden-domain-import', imp.specifier, imp.pos),
        );
      }
      if (isProviderSdkSpecifier(imp.specifier)) {
        providerSdkImports.push(
          finding('provider-sdk-import', imp.specifier, imp.pos),
        );
      }
    }

    // (1,2) Calls — send/delivery call-sites and real provider call-sites.
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name !== null) {
        if (SEND_CALL_NAMES.includes(name)) {
          sendCalls.push(finding('send-call', name, node.getStart(sf)));
        }
        if (name === GENERATE_TEXT_METHOD) {
          generateTextCalls.push(
            finding('generate-text-call', name, node.getStart(sf)),
          );
        }
      }
    }

    // (5,6,7) Property / element access — dot form `obj.name` OR string-literal
    // bracket form `obj['name']` / obj[`name`]. A computed/numeric key resolves
    // to null and is ignored, so only semantic access keys are inspected.
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const propName = accessedName(node);
      if (propName !== null) {
        const baseName = rightmostName(node.expression);
        // (5) process.env / process['env'] / process["env"].
        if (propName === 'env' && baseName === 'process') {
          processEnvReads.push(
            finding('process-env-read', 'process.env', node.getStart(sf)),
          );
        }
        // (7) Forbidden Prisma delegate access (exact name + Prisma-like base).
        // `aiGenerationAuditLog` is not in the set, and `error.message` /
        // `audit.replyDraftId` fail the exact-name or Prisma-base check.
        if (
          FORBIDDEN_PRISMA_DELEGATES.includes(propName) &&
          isPrismaBaseName(baseName)
        ) {
          forbiddenPrismaAccess.push(
            finding(
              'forbidden-prisma-access',
              `${baseName}.${propName}`,
              node.getStart(sf),
            ),
          );
        }
        // (6) API-key-like STRING-LITERAL element-access key only here
        // (e.g. `config['apiKey']`, `process.env['OPENAI_API_KEY']`). The dot and
        // identifier forms are covered by the Identifier walk below, so handling
        // only the bracket-key form here avoids double-counting one access.
        if (
          ts.isElementAccessExpression(node) &&
          API_KEY_PATTERN.test(propName)
        ) {
          apiKeyReads.push(finding('api-key-read', propName, node.getStart(sf)));
        }
      }
    }

    // (6) API-key-like identifier reads (real identifier nodes only; string
    // literals and comments are not Identifier nodes and never count). Covers a
    // binding `apiKey`, a reference, and the `.name` of `config.apiKey`.
    if (ts.isIdentifier(node) && API_KEY_PATTERN.test(node.text)) {
      apiKeyReads.push(finding('api-key-read', node.text, node.getStart(sf)));
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  const all = [
    ...sendCalls,
    ...generateTextCalls,
    ...forbiddenDomainImports,
    ...providerSdkImports,
    ...processEnvReads,
    ...apiKeyReads,
    ...forbiddenPrismaAccess,
  ];

  return {
    sendCalls,
    generateTextCalls,
    forbiddenDomainImports,
    providerSdkImports,
    processEnvReads,
    apiKeyReads,
    forbiddenPrismaAccess,
    all,
    importSpecifiers,
  };
}
