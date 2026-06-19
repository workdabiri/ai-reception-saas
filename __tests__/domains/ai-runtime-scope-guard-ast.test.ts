// ===========================================================================
// Tests — AI-Runtime Scope Guard (AST static hardening, test-only)
//
// PURPOSE
//   B-R7 §7 and B-R8 §1 already pin the AI-runtime "no send / no real provider /
//   no PII read" scope, but they do so with substring/regex scans. A regex check
//   is weak in two directions: a future edit could SATISFY it with a comment or
//   string literal while the real forbidden behavior is present, or it could
//   trip on a benign mention (a `generateText` method DEFINITION, `error.message`,
//   the allowed `aiGenerationAuditLog` delegate).
//
//   This suite re-proves the same invariants over a REAL TypeScript AST
//   (see ../_helpers/ai-runtime-scope-guard-ast.ts), counting only genuine AST
//   nodes — CallExpression callees, import module specifiers, property accesses,
//   identifiers. It is additive hardening; it changes NO production code and does
//   NOT touch the B-R7 / B-R8 suites.
//
// WHAT IT LOCKS (real AST nodes only, never comments/strings):
//   §1  The 8 AI-runtime production files have no send/dispatch/deliver/
//       createMessage call-site.
//   §2  …no real `.generateText(…)` provider call-site (a method DEFINITION /
//       interface signature named `generateText` is NOT a call-site).
//   §3  …no forbidden cross-domain import (conversations/channels/actions/
//       reply-drafts/crm).
//   §4  …no `process.env` read and no API-key-like identifier/property read.
//   §5  …no forbidden Prisma delegate access (customer/conversation/message/
//       replyDraft); the `aiGenerationAuditLog` delegate stays allowed.
//   §6  No file anywhere under `src/**` imports a real model-provider SDK.
//   §7  Synthetic fixtures prove the analyzer FLAGS real violations yet IGNORES
//       comments, strings, and method definitions.
//
// SCOPE: TEST-ONLY. This suite introduces no production source, no provider SDK,
// no network/env/API-key usage, and no route wiring. The B-R7/B-R8 suites are
// left byte-for-byte unchanged (proven by `git diff` in the PR validation).
// ===========================================================================

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  analyzeAiRuntimeSource,
  collectImportSpecifiers,
  isProviderSdkSpecifier,
  isForbiddenDomainSpecifier,
  packageNameOf,
  SEND_CALL_NAMES,
  FORBIDDEN_PRISMA_DELEGATES,
  type ScopeFinding,
} from '../_helpers/ai-runtime-scope-guard-ast';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AI_RUNTIME_DIR = path.join(REPO_ROOT, 'src/domains/ai-runtime');
const SRC_DIR = path.join(REPO_ROOT, 'src');

/** The 8 production AI-runtime modules under lock (parity with B-R7/B-R8). */
const PROD_FILES = [
  'src/domains/ai-runtime/types.ts',
  'src/domains/ai-runtime/service.ts',
  'src/domains/ai-runtime/context-assembler.ts',
  'src/domains/ai-runtime/provider.ts',
  'src/domains/ai-runtime/fake-provider.ts',
  'src/domains/ai-runtime/prompt-builder.ts',
  'src/domains/ai-runtime/audit-log.ts',
  'src/domains/ai-runtime/index.ts',
];

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relPath), 'utf8');
}

function rel(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

/** Recursively collects files under `dir` matching `keep` (skips node_modules). */
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

/** Renders findings as `file:line kind -> detail` lines for failure messages. */
function fmt(file: string, findings: readonly ScopeFinding[]): string[] {
  return findings.map((f) => `${file}:${f.line} ${f.kind} -> ${f.detail}`);
}

/** Analyze each production file once, with a stable label. */
const analyses = PROD_FILES.map((file) => ({
  file,
  analysis: analyzeAiRuntimeSource(read(file), file),
}));

// ===========================================================================
// §0 — Surface discovery (guards against a vacuous suite)
// ===========================================================================

describe('AI-runtime scope guard §0 — surface is real and fully covered', () => {
  it('the 8 production files exist and are non-empty', () => {
    for (const file of PROD_FILES) {
      expect(fs.existsSync(path.resolve(REPO_ROOT, file)), file).toBe(true);
      expect(read(file).length).toBeGreaterThan(0);
    }
  });

  it('every *.ts module in the AI-runtime dir is under guard (no new file escapes)', () => {
    // If a 9th AI-runtime module is ever added, this fails until it is added to
    // PROD_FILES — so a future module cannot silently dodge the scope guard.
    const present = fs
      .readdirSync(AI_RUNTIME_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.ts'))
      .map((e) => `src/domains/ai-runtime/${e.name}`)
      .sort();
    expect(present).toEqual([...PROD_FILES].sort());
  });
});

// ===========================================================================
// §1 — No send / dispatch / deliver / createMessage call-site
// ===========================================================================

describe('AI-runtime scope guard §1 — no send/delivery call-site', () => {
  it.each(analyses)(
    '$file has no send/dispatch/deliver/createMessage call-site',
    ({ file, analysis }) => {
      expect(fmt(file, analysis.sendCalls)).toEqual([]);
    },
  );
});

// ===========================================================================
// §2 — No real .generateText(...) provider call-site
// ===========================================================================

describe('AI-runtime scope guard §2 — no real provider call-site', () => {
  it.each(analyses)(
    '$file makes no real .generateText(...) call (definitions are allowed)',
    ({ file, analysis }) => {
      expect(fmt(file, analysis.generateTextCalls)).toEqual([]);
    },
  );

  it('the provider seam still DEFINES generateText (interface + fake), not calls it', () => {
    // Sanity: the method genuinely exists as a definition/signature; the guard
    // above must be passing because there is no CALL-SITE, not because the
    // method vanished.
    expect(read('src/domains/ai-runtime/provider.ts')).toContain(
      'generateText(',
    );
    expect(read('src/domains/ai-runtime/fake-provider.ts')).toContain(
      'async generateText(',
    );
  });
});

// ===========================================================================
// §3 — No forbidden cross-domain import
// ===========================================================================

describe('AI-runtime scope guard §3 — no forbidden domain import', () => {
  it.each(analyses)(
    '$file imports no conversations/channels/actions/reply-drafts/crm domain',
    ({ file, analysis }) => {
      expect(fmt(file, analysis.forbiddenDomainImports)).toEqual([]);
    },
  );
});

// ===========================================================================
// §4 — No env / API-key read
// ===========================================================================

describe('AI-runtime scope guard §4 — no env / API-key read', () => {
  it.each(analyses)('$file reads no process.env', ({ file, analysis }) => {
    expect(fmt(file, analysis.processEnvReads)).toEqual([]);
  });

  it.each(analyses)(
    '$file has no API-key-like identifier/property read',
    ({ file, analysis }) => {
      expect(fmt(file, analysis.apiKeyReads)).toEqual([]);
    },
  );
});

// ===========================================================================
// §5 — No forbidden Prisma delegate access
// ===========================================================================

describe('AI-runtime scope guard §5 — no forbidden Prisma access', () => {
  it.each(analyses)(
    '$file reads no customer/conversation/message/replyDraft delegate',
    ({ file, analysis }) => {
      expect(fmt(file, analysis.forbiddenPrismaAccess)).toEqual([]);
    },
  );

  it('the audit boundary still uses the ALLOWED aiGenerationAuditLog delegate', () => {
    // Proof the §5 guard passes because the forbidden delegates are absent — not
    // because the audit repository stopped touching Prisma entirely.
    const audit = analyzeAiRuntimeSource(
      read('src/domains/ai-runtime/audit-log.ts'),
      'audit-log.ts',
    );
    expect(read('src/domains/ai-runtime/audit-log.ts')).toContain(
      'db.aiGenerationAuditLog',
    );
    expect(audit.forbiddenPrismaAccess).toEqual([]);
  });
});

// ===========================================================================
// §6 — No real model-provider SDK import anywhere under src/**
// ===========================================================================

const srcFiles = walk(SRC_DIR, (f) => /\.(ts|tsx)$/.test(f));

describe('AI-runtime scope guard §6 — no provider SDK import (repo-wide)', () => {
  it('the src/** sweep is non-trivial and reaches into the domains', () => {
    expect(srcFiles.length).toBeGreaterThanOrEqual(50);
    const relFiles = srcFiles.map(rel);
    expect(relFiles).toContain('src/domains/ai-runtime/provider.ts');
  });

  it('no file under src/** imports a real model-provider SDK', () => {
    const offenders: string[] = [];
    for (const abs of srcFiles) {
      const sdk = collectImportSpecifiers(read(rel(abs)), rel(abs)).filter(
        isProviderSdkSpecifier,
      );
      if (sdk.length > 0) {
        offenders.push(`${rel(abs)} :: ${sdk.join(', ')}`);
      }
    }
    expect(
      offenders,
      `These src files import a real model-provider SDK (none is integrated or ` +
        `authorized):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

// ===========================================================================
// §7 — Analyzer self-proof on synthetic fixtures
//
// Parsed by the AST, NEVER executed, so undeclared references are irrelevant.
// ===========================================================================

/** A kitchen-sink of REAL violations the analyzer must flag. */
const FIXTURE_REAL_VIOLATIONS = `
import OpenAI from 'openai';
import { createMessage } from '@/domains/conversations';
import { repo } from '@/domains/reply-drafts/repository';

export async function leak(deps, provider, db) {
  const key = process.env.OPENAI_API_KEY;
  const apiKey = deps.apiKey;
  const gen = await provider.generateText({ prompt: 'x' });
  await sendMessage({ text: gen.text });
  await deps.channel.dispatch(gen);
  const rows = await db.customer.findMany();
  const conv = await db.conversation.findUnique({ where: {} });
  const msg = await db.message.create({ data: {} });
  const draft = await db.replyDraft.update({ where: {}, data: {} });
  return { key, apiKey, gen, rows, conv, msg, draft, repo, createMessage };
}
`;

/** Forbidden names appear ONLY in comments, strings, defs, and allowed forms. */
const FIXTURE_IGNORED = `
// import OpenAI from 'openai';
// process.env.OPENAI_API_KEY apiKey sendMessage(x) dispatch(y) db.customer.findMany()
import { createAiPromptBuilder } from '@/domains/ai-runtime';
import { createKnowledgeService } from '@/domains/knowledge';
import { createAiConfigService } from '@/domains/ai-config';
import S3 from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

const note = 'we never call sendMessage() / dispatch() / db.customer here';
const docs = "process.env.OPENAI_API_KEY apiKey openai @anthropic-ai/sdk";

interface Provider {
  generateText(request: unknown): Promise<string>; // signature, not a call
}

const provider = {
  async generateText(request) {                     // definition, not a call
    return 'ok:' + String(request);
  },
};

export async function safe(db, validated, audit) {
  const row = await db.aiGenerationAuditLog.findUnique({ where: {} }); // allowed
  const errMsg = validated.error.message;            // non-Prisma base
  const draftId = audit.replyDraftId;                // replyDraftId !== replyDraft
  const convId = audit.conversationId;               // conversationId !== conversation
  return { row, errMsg, draftId, convId };
}
`;

/** Only DEFINES generateText (signature + method); no call-site. */
const FIXTURE_GENERATE_DEF_ONLY = `
interface P { generateText(req: unknown): Promise<string>; }
function make() {
  return { providerId: 'fake', async generateText(request) { return String(request); } };
}
const label = 'provider.generateText(req) only inside this string';
`;

/** A REAL provider call-site. */
const FIXTURE_GENERATE_CALL = `
async function run(provider) {
  return provider.generateText({ prompt: 'x' });
}
`;

/** Only the ALLOWED Prisma delegate plus near-miss names. */
const FIXTURE_PRISMA_ALLOWED = `
async function ok(db, validated, audit) {
  await db.aiGenerationAuditLog.create({ data: {} });
  const m = validated.error.message;
  const id = audit.replyDraftId;
  return { m, id };
}
`;

/** A REAL forbidden Prisma delegate access. */
const FIXTURE_PRISMA_FORBIDDEN = `
async function bad(db) {
  return db.customer.findUnique({ where: {} });
}
`;

/** Forbidden delegate access via client / prismaClient / dbClient bases. */
const FIXTURE_PRISMA_CLIENT_BASES = `
async function clientBases(client, prismaClient, dbClient) {
  await client.customer.findMany();
  await client['conversation'].findUnique({ where: {} });
  await prismaClient.message.create({ data: {} });
  await dbClient['replyDraft'].update({ where: {}, data: {} });
}
`;

/** Client-ish bases touching ONLY the allowed delegate / near-miss names. */
const FIXTURE_PRISMA_CLIENT_ALLOWED = `
async function clientAllowed(client, prismaClient, audit) {
  await client.aiGenerationAuditLog.create({ data: {} });
  await prismaClient['aiGenerationAuditLog'].findUnique({ where: {} });
  const id = audit['replyDraftId'];
  return id;
}
`;

/** Code that WOULD crash/exit if executed — proves the analyzer only parses. */
const FIXTURE_NEVER_EXECUTED = `
throw new Error('this fixture must never be executed by the analyzer');
const leaked = process.env.SECRET_API_KEY;
export {};
`;

/** REAL violations written entirely with string-literal bracket / element access. */
const FIXTURE_BRACKET_VIOLATIONS = `
export async function leakBracket(provider, deps, senders, db, config, payload) {
  provider['generateText']({ prompt: 'x' });
  deps.channel['dispatch'](payload);
  senders['sendMessage'](payload);
  db['customer'].findMany();
  db["conversation"].findUnique({ where: {} });
  db['message'].create({ data: {} });
  db["replyDraft"].update({ where: {}, data: {} });
  const a = process['env'].OPENAI_API_KEY;
  const b = process.env['OPENAI_API_KEY'];
  const c = process["env"]["OPENAI_API_KEY"];
  const d = config['apiKey'];
  return { a, b, c, d };
}
`;

/** Allowed bracket forms + a benign string that merely MENTIONS bracket access. */
const FIXTURE_BRACKET_ALLOWED = `
async function okBracket(db, audit, validated) {
  await db['aiGenerationAuditLog'].create({ data: {} });
  const id = audit['replyDraftId'];
  const m = validated.error['message'];
  const text = "provider['generateText'](...) db['customer'] process['env'] config['apiKey']";
  return { id, m, text };
}
`;

const details = (list: readonly ScopeFinding[]): string[] =>
  list.map((f) => f.detail);

describe('AI-runtime scope guard §7 — analyzer flags real violations', () => {
  const a = analyzeAiRuntimeSource(FIXTURE_REAL_VIOLATIONS, 'fixture.ts');

  it('flags a real model-provider SDK import', () => {
    expect(details(a.providerSdkImports)).toContain('openai');
  });

  it('flags forbidden cross-domain imports (incl. a subpath)', () => {
    expect(details(a.forbiddenDomainImports)).toEqual(
      expect.arrayContaining([
        '@/domains/conversations',
        '@/domains/reply-drafts/repository',
      ]),
    );
  });

  it('flags a process.env read and the API-key-like identifiers', () => {
    expect(a.processEnvReads.length).toBeGreaterThanOrEqual(1);
    // `OPENAI_API_KEY` (property) and `apiKey` (binding + property) all qualify.
    expect(details(a.apiKeyReads)).toEqual(
      expect.arrayContaining(['OPENAI_API_KEY', 'apiKey']),
    );
  });

  it('flags a real .generateText(...) call-site', () => {
    expect(details(a.generateTextCalls)).toEqual(['generateText']);
  });

  it('flags send/dispatch call-sites', () => {
    expect(details(a.sendCalls)).toEqual(
      expect.arrayContaining(['sendMessage', 'dispatch']),
    );
  });

  it('flags every forbidden Prisma delegate access', () => {
    expect(details(a.forbiddenPrismaAccess).sort()).toEqual(
      ['db.conversation', 'db.customer', 'db.message', 'db.replyDraft'].sort(),
    );
  });
});

describe('AI-runtime scope guard §7 — analyzer ignores comments/strings/defs', () => {
  it('finds NOTHING when forbidden names live only in comments/strings/defs/allowed forms', () => {
    const a = analyzeAiRuntimeSource(FIXTURE_IGNORED, 'fixture.ts');
    expect(fmt('fixture.ts', a.all)).toEqual([]);
  });

  it('a generateText DEFINITION/signature is not a call-site, but a call IS', () => {
    expect(
      analyzeAiRuntimeSource(FIXTURE_GENERATE_DEF_ONLY, 'fixture.ts')
        .generateTextCalls,
    ).toEqual([]);
    expect(
      details(
        analyzeAiRuntimeSource(FIXTURE_GENERATE_CALL, 'fixture.ts')
          .generateTextCalls,
      ),
    ).toEqual(['generateText']);
  });

  it('the allowed aiGenerationAuditLog delegate is not confused with a forbidden one', () => {
    expect(
      analyzeAiRuntimeSource(FIXTURE_PRISMA_ALLOWED, 'fixture.ts')
        .forbiddenPrismaAccess,
    ).toEqual([]);
    expect(
      details(
        analyzeAiRuntimeSource(FIXTURE_PRISMA_FORBIDDEN, 'fixture.ts')
          .forbiddenPrismaAccess,
      ),
    ).toEqual(['db.customer']);
  });

  it('only PARSES — a throw/exit fixture is analyzed without being executed', () => {
    const a = analyzeAiRuntimeSource(FIXTURE_NEVER_EXECUTED, 'fixture.ts');
    // If the source had executed, the throw would have aborted this test. It did
    // not — and the analyzer still saw the env read as a real AST node.
    expect(a.processEnvReads.length).toBeGreaterThanOrEqual(1);
    expect(details(a.apiKeyReads)).toContain('SECRET_API_KEY');
  });
});

describe('AI-runtime scope guard §7 — string-literal bracket / element access', () => {
  const a = analyzeAiRuntimeSource(FIXTURE_BRACKET_VIOLATIONS, 'fixture.ts');

  it("flags a bracket provider call provider['generateText'](...)", () => {
    expect(details(a.generateTextCalls)).toEqual(['generateText']);
  });

  it("flags bracket send/dispatch calls obj['sendMessage'](...) / obj['dispatch'](...)", () => {
    expect(details(a.sendCalls)).toEqual(
      expect.arrayContaining(['dispatch', 'sendMessage']),
    );
  });

  it('flags every bracket Prisma delegate access (single- and double-quoted)', () => {
    expect(details(a.forbiddenPrismaAccess).sort()).toEqual(
      ['db.conversation', 'db.customer', 'db.message', 'db.replyDraft'].sort(),
    );
  });

  it("flags process['env'] / process.env['KEY'] / process[\"env\"][\"KEY\"]", () => {
    // process['env'], process.env[...], and process["env"][...] each carry an
    // inner env access node — three real env reads in total.
    expect(a.processEnvReads.length).toBeGreaterThanOrEqual(3);
  });

  it("flags bracket-key API-key reads config['apiKey'] / process.env['OPENAI_API_KEY']", () => {
    expect(details(a.apiKeyReads)).toEqual(
      expect.arrayContaining(['OPENAI_API_KEY', 'apiKey']),
    );
  });

  it('ignores allowed bracket forms and a benign string that mentions bracket access', () => {
    // db['aiGenerationAuditLog'] (allowed), audit['replyDraftId'] (near-miss),
    // validated.error['message'] (non-Prisma base), and a plain string literal
    // that merely contains bracket-access text must all be clean.
    const allowed = analyzeAiRuntimeSource(FIXTURE_BRACKET_ALLOWED, 'fixture.ts');
    expect(fmt('fixture.ts', allowed.all)).toEqual([]);
  });
});

describe('AI-runtime scope guard §7 — Prisma client-base coverage', () => {
  it('flags forbidden delegate access on client / prismaClient / *Client bases', () => {
    const a = analyzeAiRuntimeSource(FIXTURE_PRISMA_CLIENT_BASES, 'fixture.ts');
    expect(details(a.forbiddenPrismaAccess).sort()).toEqual(
      [
        'client.conversation',
        'client.customer',
        'dbClient.replyDraft',
        'prismaClient.message',
      ].sort(),
    );
  });

  it('does not flag a client-ish base touching the allowed delegate / near-miss names', () => {
    // The broadened base must not over-match: it is still the forbidden DELEGATE
    // NAME (not merely the base) that triggers a finding.
    const a = analyzeAiRuntimeSource(FIXTURE_PRISMA_CLIENT_ALLOWED, 'fixture.ts');
    expect(a.forbiddenPrismaAccess).toEqual([]);
  });
});

// ===========================================================================
// §8 — Detector coverage (the contracts include at least the required names)
// ===========================================================================

describe('AI-runtime scope guard §8 — detector coverage', () => {
  it('recognizes every required provider-SDK package (and rejects look-alikes)', () => {
    for (const name of [
      'openai',
      '@anthropic-ai/sdk',
      'anthropic',
      '@google/genai',
      '@google/generative-ai',
      'cohere-ai',
      'mistralai',
      '@aws-sdk/client-bedrock-runtime',
      'replicate',
      'groq-sdk',
      'together-ai',
    ]) {
      expect(isProviderSdkSpecifier(name), name).toBe(true);
      // A subpath import of the same SDK is still flagged.
      expect(isProviderSdkSpecifier(`${name}/dist/index.js`), name).toBe(true);
    }
    // Non-AI packages and the src path alias must NOT be flagged.
    for (const name of [
      '@aws-sdk/client-s3',
      '@prisma/client',
      'next',
      'zod',
      '@/domains/conversations',
      './local',
      'node:fs',
    ]) {
      expect(isProviderSdkSpecifier(name), name).toBe(false);
    }
  });

  it('recognizes every required forbidden domain (and allows AI-runtime deps)', () => {
    for (const spec of [
      '@/domains/conversations',
      '@/domains/channels',
      '@/domains/actions',
      '@/domains/reply-drafts',
      '@/domains/crm',
      '@/domains/reply-drafts/repository',
    ]) {
      expect(isForbiddenDomainSpecifier(spec), spec).toBe(true);
    }
    for (const spec of [
      '@/domains/ai-config/service',
      '@/domains/knowledge/types',
      '@/domains/ai-runtime',
      '@/lib/result',
      'zod',
    ]) {
      expect(isForbiddenDomainSpecifier(spec), spec).toBe(false);
    }
  });

  it('the send-call and Prisma-delegate contracts include the required names', () => {
    for (const name of [
      'sendMessage',
      'sendDraft',
      'autoSend',
      'dispatch',
      'deliver',
      'createMessage',
    ]) {
      expect(SEND_CALL_NAMES).toContain(name);
    }
    expect([...FORBIDDEN_PRISMA_DELEGATES].sort()).toEqual(
      ['conversation', 'customer', 'message', 'replyDraft'].sort(),
    );
  });

  it('packageNameOf normalizes scoped, bare, aliased, and relative specifiers', () => {
    expect(packageNameOf('openai/resources')).toBe('openai');
    expect(packageNameOf('@anthropic-ai/sdk/index')).toBe('@anthropic-ai/sdk');
    expect(packageNameOf('@/domains/conversations')).toBeNull();
    expect(packageNameOf('./relative')).toBeNull();
    expect(packageNameOf('node:path')).toBeNull();
  });
});
