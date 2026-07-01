// ===========================================================================
// Tests — Channels No-Go Guard (Area C, P12-B)
//
// Static lock on the channels domain source. Makes it STRUCTURALLY HARD for a
// future change to turn the binding store into a public route, a send/delivery
// path, an AI path, or a customer-data reader, or to leak the widget key/hash/
// pepper. Mirrors the Area B B-R8 static-guard style.
//
// LOCKS:
//  §1 No send/dispatch/deliver/message-creation call-site.
//  §2 No forbidden cross-domain DB delegate (customer/conversation/message/
//     reply-draft) and no provider SDK / AI import / send-module import.
//  §3 The domain reads no env/secret at module load (process.env absent) and
//     logs nothing (no console.*), so the raw key/hash/pepper cannot be logged.
//  §4 No public route / no widget is added inside the domain.
// ===========================================================================

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CHANNELS_DIR = 'src/domains/channels';

const PROD_FILES = [
  'src/domains/channels/types.ts',
  'src/domains/channels/validation.ts',
  'src/domains/channels/repository.ts',
  'src/domains/channels/service.ts',
  'src/domains/channels/implementation.ts',
  'src/domains/channels/index.ts',
];

const SEND_CALL_RE =
  /\b(sendMessage|sendDraft|autoSend|dispatch|deliver|createMessage)\s*\(/;

const FORBIDDEN_DB_DELEGATE_RE =
  /\bdb\.(customer|customerContactMethod|conversation|message|replyDraft)\b/;

const FORBIDDEN_IMPORT_DOMAIN_RE =
  /domains\/(conversations|crm|reply-drafts|ai-runtime|ai-config|actions)/;

const FORBIDDEN_IMPORT_SEND_MODULE_RE =
  /\b(sender|deliver|delivery|dispatch|messaging|mailer|outbox|sms|smtp|webhook|whatsapp)\b/i;

const REAL_PROVIDER_SDK_RE =
  /openai|anthropic|@anthropic-ai|@google\/genai|googleapis|gemini|vertex|cohere|mistral|llama|bedrock|huggingface|replicate|groq|together-ai/i;

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), 'utf8');
}
function importPaths(src: string): string[] {
  return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('Channels no-go guard §0 — the guard is not vacuous', () => {
  it('catches a synthetic violation sample', () => {
    const violation = [
      'sendMessage(p);',
      'createMessage(p);',
      'db.conversation.findMany();',
    ].join('\n');
    expect(violation).toMatch(SEND_CALL_RE);
    expect(violation).toMatch(FORBIDDEN_DB_DELEGATE_RE);
    expect(FORBIDDEN_IMPORT_DOMAIN_RE.test('@/domains/conversations')).toBe(true);
    expect(REAL_PROVIDER_SDK_RE.test('openai')).toBe(true);
  });

  it('every locked source file exists', () => {
    for (const f of PROD_FILES) expect(fs.existsSync(path.resolve(f))).toBe(true);
  });
});

describe('Channels no-go guard §1 — no send / delivery path', () => {
  it.each(PROD_FILES)('%s has no send/dispatch/deliver/message-creation call-site', (rel) => {
    expect(read(rel)).not.toMatch(SEND_CALL_RE);
  });
});

describe('Channels no-go guard §2 — no cross-domain DB / provider / AI surface', () => {
  it.each(PROD_FILES)('%s touches no forbidden DB delegate', (rel) => {
    expect(read(rel)).not.toMatch(FORBIDDEN_DB_DELEGATE_RE);
  });

  it.each(PROD_FILES)('%s imports no forbidden domain / send-module / provider SDK', (rel) => {
    for (const imp of importPaths(read(rel))) {
      expect(imp).not.toMatch(FORBIDDEN_IMPORT_DOMAIN_RE);
      expect(imp).not.toMatch(FORBIDDEN_IMPORT_SEND_MODULE_RE);
      expect(imp).not.toMatch(REAL_PROVIDER_SDK_RE);
    }
  });

  it('the whole channels directory imports no real provider SDK', () => {
    for (const entry of fs.readdirSync(path.resolve(CHANNELS_DIR))) {
      if (!entry.endsWith('.ts')) continue;
      const src = read(path.join(CHANNELS_DIR, entry));
      for (const imp of importPaths(src)) {
        expect(imp).not.toMatch(REAL_PROVIDER_SDK_RE);
      }
    }
  });
});

describe('Channels no-go guard §3 — no env/secret read, no logging (key cannot leak)', () => {
  it.each(PROD_FILES)('%s reads no process.env (no module-load secret)', (rel) => {
    expect(read(rel)).not.toMatch(/process\.env/);
  });

  it.each(PROD_FILES)('%s logs nothing (no console.*)', (rel) => {
    expect(read(rel)).not.toMatch(/\bconsole\.\w+\s*\(/);
  });

  it.each(PROD_FILES)('%s contains no real fetch/network call', (rel) => {
    expect(read(rel)).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios|undici/);
  });
});

describe('Channels no-go guard §4 — no public route / no widget inside the domain', () => {
  it('the channels directory contains only the layered domain files', () => {
    const allowed = new Set([
      'README.md',
      'types.ts',
      'validation.ts',
      'repository.ts',
      'service.ts',
      'implementation.ts',
      'index.ts',
    ]);
    for (const entry of fs.readdirSync(path.resolve(CHANNELS_DIR), {
      withFileTypes: true,
    })) {
      if (entry.isFile()) expect(allowed.has(entry.name)).toBe(true);
    }
  });

  it.each(PROD_FILES)('%s defines no Next.js route handler export', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+(GET|POST|PATCH|DELETE|PUT)\b/);
    expect(src).not.toMatch(/NextRequest|NextResponse/);
  });
});
