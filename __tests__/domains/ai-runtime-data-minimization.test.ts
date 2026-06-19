// ===========================================================================
// Tests — AI Runtime: PII / Data-Minimization Prompt Allowlist (B-H1)
//
// Converts the owner-reviewed allowlist spec
// (docs/audits/AREA-B-pii-data-minimization-allowlist.md) into an enforced,
// centralized boundary on the prompt builder. It proves:
//
//   1. ONLY the allowlisted verified-context item fields render into prompt text
//      (category / key / value / sourceType / sourceLabel / verifiedAt), driven
//      by the central PROMPT_RENDERABLE_ITEM_FIELDS allowlist — never an ad-hoc
//      per-call field choice.
//   2. Internal / provenance fields NEVER render: internal item id,
//      verifiedByUserId, sourceMetadata, sourceUrl, per-item businessId, status,
//      createdByUserId.
//   3/4. Customer / CustomerContactMethod / Conversation / Message / ReplyDraft
//      shaped fields (displayName, notes, metadata, contact value/label, subject,
//      channelMetadata, content, draftText, originalText) NEVER render — even
//      when maliciously smuggled in as extra props on a usable item or as
//      separate malformed input objects.
//   5. The optional operator instruction stays bounded and explicitly labeled as
//      NOT verified business context.
//   6. The builder/allowlist source imports no provider SDK, makes no network
//      request, reads no env / API-key, and has no customer/conversation/message/
//      replyDraft read path.
//
// DENYLIST CONTRACT OWNERSHIP: the forbidden field names and credential tokens
// (process.env / apiKey / providerApiKey) live HERE, in the test, as their single
// source of truth — deliberately NOT in any AI-runtime production source file,
// where they would themselves trip (or hollow out) the B-R7 §7 / B-R8 §1 static
// scope guards. This mirrors the B-R8 no-auto-send lock's forbidden-field design.
//
// Synthetic data only — no real PII, no provider, no network.
// ===========================================================================

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createAiPromptBuilder,
  MAX_OPERATOR_INSTRUCTION_CHARS,
  PROMPT_RENDERABLE_ITEM_FIELDS,
  PROMPT_RENDERABLE_ITEM_FIELD_NAMES,
  type AiPromptBuilder,
  type AssembledAiContext,
  type AssembledBusinessContextItem,
} from '@/domains/ai-runtime';

// ---------------------------------------------------------------------------
// Constants / fixtures
// ---------------------------------------------------------------------------

const BIZ_A = '11111111-1111-4111-8111-111111111111';

/** The exact allowlist, mirrored here so the test pins the contract, not echoes it. */
const EXPECTED_ALLOWLIST = [
  'category',
  'key',
  'value',
  'sourceType',
  'sourceLabel',
  'verifiedAt',
] as const;

/**
 * Provenance / internal item fields that are present on the assembled item (or a
 * smuggled item-shaped object) but MUST NEVER render into prompt text (spec §6).
 */
const FORBIDDEN_ITEM_FIELDS = [
  'id',
  'businessId',
  'status',
  'sourceUrl',
  'sourceMetadata',
  'verifiedByUserId',
  'createdByUserId',
] as const;

/**
 * Customer / CustomerContactMethod / Conversation / Message / ReplyDraft field
 * names that must NEVER reach a prompt (spec §6 denylist). Field names only —
 * the actual proof is by unique sentinel VALUES below.
 */
const FORBIDDEN_FOREIGN_FIELDS = [
  'displayName', // Customer.displayName
  'notes', // Customer.notes
  'metadata', // Customer / Conversation / Message.metadata
  'value', // CustomerContactMethod.value (contact value)
  'label', // CustomerContactMethod.label
  'subject', // Conversation.subject
  'channelMetadata', // Conversation / Message.channelMetadata
  'content', // Message.content
  'draftText', // ReplyDraft.draftText
  'originalText', // ReplyDraft.originalText
] as const;

/** Secret / credential names that must never appear on any prompt path (spec §6). */
const FORBIDDEN_CREDENTIAL_NAMES = [
  'process.env',
  'apiKey',
  'providerApiKey',
] as const;

// Unique sentinels. Their appearance anywhere in a prompt is a data-minimization
// leak. Allowlisted (permitted) values are prefixed ALLOWED_*; everything that
// must be excluded is prefixed LEAK_*.
const ALLOWED_CATEGORY = 'ALLOWED_CATEGORY_hours';
const ALLOWED_KEY = 'ALLOWED_KEY_monday';
const ALLOWED_VALUE = 'ALLOWED_VALUE_open_9_to_5';
const ALLOWED_SOURCE_LABEL = 'ALLOWED_SOURCE_LABEL_owner_dashboard';
const ALLOWED_VERIFIED_AT = '2026-06-10T09:00:00.000Z';

const LEAK_ITEM_ID = 'LEAK_INTERNAL_ITEM_ID';
const LEAK_BUSINESS_ID = 'LEAK_PER_ITEM_BUSINESS_ID';
const LEAK_STATUS = 'LEAK_LIFECYCLE_STATUS';
const LEAK_SOURCE_URL = 'https://leak.example/LEAK_SOURCE_URL';
const LEAK_SOURCE_METADATA = 'LEAK_SOURCE_METADATA_SECRET';
const LEAK_VERIFIED_BY = 'LEAK_VERIFIED_BY_USER_ID';
const LEAK_CREATED_BY = 'LEAK_CREATED_BY_USER_ID';

const LEAK_DISPLAY_NAME = 'LEAK_CUSTOMER_DISPLAY_NAME';
const LEAK_NOTES = 'LEAK_CUSTOMER_NOTES';
const LEAK_METADATA = 'LEAK_METADATA_SECRET';
const LEAK_CONTACT_VALUE = 'LEAK_CONTACT_VALUE_email_or_phone';
const LEAK_CONTACT_LABEL = 'LEAK_CONTACT_LABEL';
const LEAK_SUBJECT = 'LEAK_CONVERSATION_SUBJECT';
const LEAK_CHANNEL_METADATA = 'LEAK_CHANNEL_METADATA';
const LEAK_MESSAGE_CONTENT = 'LEAK_MESSAGE_CONTENT';
const LEAK_DRAFT_TEXT = 'LEAK_REPLY_DRAFT_TEXT';
const LEAK_ORIGINAL_TEXT = 'LEAK_REPLY_DRAFT_ORIGINAL_TEXT';

/** All sentinels that must be ABSENT from any prompt. */
const ALL_LEAK_SENTINELS = [
  LEAK_ITEM_ID,
  LEAK_BUSINESS_ID,
  LEAK_STATUS,
  LEAK_SOURCE_URL,
  LEAK_SOURCE_METADATA,
  LEAK_VERIFIED_BY,
  LEAK_CREATED_BY,
  LEAK_DISPLAY_NAME,
  LEAK_NOTES,
  LEAK_METADATA,
  LEAK_CONTACT_VALUE,
  LEAK_CONTACT_LABEL,
  LEAK_SUBJECT,
  LEAK_CHANNEL_METADATA,
  LEAK_MESSAGE_CONTENT,
  LEAK_DRAFT_TEXT,
  LEAK_ORIGINAL_TEXT,
] as const;

/**
 * A usable verified item carrying allowlisted sentinels for the fields that MAY
 * render, plus a payload of forbidden item-fields and smuggled
 * customer/conversation/message/draft-shaped fields that must NOT render. Typed
 * loosely because we deliberately attach fields outside the item interface.
 */
function smuggledItem(): AssembledBusinessContextItem {
  const item = {
    // Allowlisted — these MAY render.
    id: LEAK_ITEM_ID, // internal id is allowlist-absent → must NOT render
    category: ALLOWED_CATEGORY,
    key: ALLOWED_KEY,
    value: ALLOWED_VALUE,
    sourceType: 'OWNER_APPROVED',
    sourceLabel: ALLOWED_SOURCE_LABEL,
    verifiedAt: ALLOWED_VERIFIED_AT,
    // Real item fields that are forbidden from prompt text.
    sourceUrl: LEAK_SOURCE_URL,
    sourceMetadata: { secret: LEAK_SOURCE_METADATA },
    verifiedByUserId: LEAK_VERIFIED_BY,
    // Per-item fields the assembler drops, smuggled back in defensively.
    businessId: LEAK_BUSINESS_ID,
    status: LEAK_STATUS,
    createdByUserId: LEAK_CREATED_BY,
    // Customer / conversation / message / draft-shaped fields smuggled onto a
    // usable item — the builder must ignore every one of them.
    displayName: LEAK_DISPLAY_NAME,
    notes: LEAK_NOTES,
    metadata: { secret: LEAK_METADATA },
    label: LEAK_CONTACT_LABEL,
    subject: LEAK_SUBJECT,
    channelMetadata: { secret: LEAK_CHANNEL_METADATA },
    content: LEAK_MESSAGE_CONTENT,
    draftText: LEAK_DRAFT_TEXT,
    originalText: LEAK_ORIGINAL_TEXT,
  };
  return item as unknown as AssembledBusinessContextItem;
}

/** A separate, malformed customer-contact-shaped object (no usable item fields). */
const CONTACT_SHAPED = {
  type: 'EMAIL',
  value: LEAK_CONTACT_VALUE,
  label: LEAK_CONTACT_LABEL,
} as unknown as AssembledBusinessContextItem;

function context(items: unknown[]): AssembledAiContext {
  return {
    businessId: BIZ_A,
    aiMode: 'AI_ASSISTED',
    aiGenerationEnabled: true,
    businessContextItems: items as never,
    assembledAt: '2026-06-16T08:30:00.000Z',
  };
}

function makeBuilder(): AiPromptBuilder {
  return createAiPromptBuilder();
}

function buildPrompt(items: unknown[], instruction?: string): string {
  const res = makeBuilder().buildReplyDraftPrompt({
    context: context(items),
    instruction,
  });
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}`);
  return res.data.providerRequest.prompt;
}

// ---------------------------------------------------------------------------
// Source-scan helpers (over production files only)
// ---------------------------------------------------------------------------

const PROMPT_BUILDER_FILE = 'src/domains/ai-runtime/prompt-builder.ts';
const TYPES_FILE = 'src/domains/ai-runtime/types.ts';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), 'utf8');
}

function importPaths(src: string): string[] {
  return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

// ===========================================================================
// §0 — The allowlist is the central contract
// ===========================================================================

describe('B-H1 §0 — central allowlist contract', () => {
  it('PROMPT_RENDERABLE_ITEM_FIELD_NAMES is exactly the spec §5 allowlist, in order', () => {
    expect([...PROMPT_RENDERABLE_ITEM_FIELD_NAMES]).toEqual([
      ...EXPECTED_ALLOWLIST,
    ]);
  });

  it('the allowlist descriptors agree with the field-name list and mark optionals', () => {
    expect(PROMPT_RENDERABLE_ITEM_FIELDS.map((f) => f.field)).toEqual([
      ...EXPECTED_ALLOWLIST,
    ]);
    const optional = PROMPT_RENDERABLE_ITEM_FIELDS.filter(
      (f) => f.omitWhenBlank,
    ).map((f) => f.field);
    expect(optional.sort()).toEqual(['sourceLabel', 'verifiedAt'].sort());
  });

  it('no forbidden / foreign / credential name is on the allowlist', () => {
    const allow = new Set<string>(PROMPT_RENDERABLE_ITEM_FIELD_NAMES);
    for (const name of [
      ...FORBIDDEN_ITEM_FIELDS,
      ...FORBIDDEN_FOREIGN_FIELDS.filter((n) => n !== 'value'), // 'value' IS allowed for business context
      ...FORBIDDEN_CREDENTIAL_NAMES,
    ]) {
      expect(allow.has(name)).toBe(false);
    }
  });

  it('the prompt builder renders items from the central allowlist (not ad-hoc fields)', () => {
    const src = read(PROMPT_BUILDER_FILE);
    expect(src).toContain('PROMPT_RENDERABLE_ITEM_FIELDS');
    // The old hand-written field list must be gone (no inline `- category:` literal).
    expect(src).not.toMatch(/`- category: \$\{item\.category\}`/);
  });
});

// ===========================================================================
// §1 — Only allowlisted fields render
// ===========================================================================

describe('B-H1 §1 — only allowlisted item fields render', () => {
  it('renders every allowlisted field value for a full item', () => {
    const prompt = buildPrompt([smuggledItem()]);
    expect(prompt).toContain(`- category: ${ALLOWED_CATEGORY}`);
    expect(prompt).toContain(`  key: ${ALLOWED_KEY}`);
    expect(prompt).toContain(`  value: ${ALLOWED_VALUE}`);
    expect(prompt).toContain('  sourceType: OWNER_APPROVED');
    expect(prompt).toContain(`  sourceLabel: ${ALLOWED_SOURCE_LABEL}`);
    expect(prompt).toContain(`  verifiedAt: ${ALLOWED_VERIFIED_AT}`);
  });

  it('every rendered item field label is on the allowlist (no extra field leaks)', () => {
    const prompt = buildPrompt([smuggledItem()]);
    // Item lines look like `- <field>: …` or `  <field>: …` inside the context
    // block. Collect each rendered field NAME and prove it is allowlisted.
    const allow = new Set<string>(PROMPT_RENDERABLE_ITEM_FIELD_NAMES);
    const rendered = [...prompt.matchAll(/^(?:- |\s{2})([a-zA-Z]+): /gm)].map(
      (m) => m[1],
    );
    expect(rendered.length).toBeGreaterThan(0);
    for (const field of rendered) {
      expect(allow.has(field), `unexpected rendered field "${field}"`).toBe(
        true,
      );
    }
  });

  it('omits an optional provenance field when it is blank / absent', () => {
    const prompt = buildPrompt([
      {
        id: 'ok',
        category: ALLOWED_CATEGORY,
        key: ALLOWED_KEY,
        value: ALLOWED_VALUE,
        sourceType: 'OWNER_APPROVED',
        sourceLabel: null,
        verifiedAt: null,
      },
    ]);
    expect(prompt).not.toContain('sourceLabel:');
    expect(prompt).not.toContain('verifiedAt:');
    // Required fields still render.
    expect(prompt).toContain(`- category: ${ALLOWED_CATEGORY}`);
  });
});

// ===========================================================================
// §2 — Internal / provenance fields never render
// ===========================================================================

describe('B-H1 §2 — internal / provenance fields never render', () => {
  it('never renders id / verifiedByUserId / sourceMetadata / sourceUrl / businessId / status / createdByUserId values', () => {
    const prompt = buildPrompt([smuggledItem()]);
    for (const leak of [
      LEAK_ITEM_ID,
      LEAK_VERIFIED_BY,
      LEAK_SOURCE_METADATA,
      LEAK_SOURCE_URL,
      LEAK_BUSINESS_ID,
      LEAK_STATUS,
      LEAK_CREATED_BY,
    ]) {
      expect(prompt).not.toContain(leak);
    }
  });

  it('never renders the forbidden item-field NAMES as item labels', () => {
    const prompt = buildPrompt([smuggledItem()]);
    for (const name of FORBIDDEN_ITEM_FIELDS) {
      // A rendered item label is `- <field>:` or `  <field>:` at a line start;
      // anchoring avoids matching the same substring inside prose.
      expect(prompt).not.toMatch(new RegExp(`^(?:- |\\s{2})${name}:`, 'm'));
    }
    // The internal id never appears as an `id:` line either.
    expect(prompt).not.toMatch(/^\s*id:/m);
  });
});

// ===========================================================================
// §3 / §4 — Customer/conversation/message/reply-draft content never renders
// ===========================================================================

describe('B-H1 §3/§4 — foreign customer/PII fields never render', () => {
  it('ignores customer/conversation/message/draft fields smuggled onto a usable item', () => {
    const prompt = buildPrompt([smuggledItem()]);
    for (const leak of [
      LEAK_DISPLAY_NAME,
      LEAK_NOTES,
      LEAK_METADATA,
      LEAK_CONTACT_LABEL,
      LEAK_SUBJECT,
      LEAK_CHANNEL_METADATA,
      LEAK_MESSAGE_CONTENT,
      LEAK_DRAFT_TEXT,
      LEAK_ORIGINAL_TEXT,
    ]) {
      expect(prompt).not.toContain(leak);
    }
  });

  it('drops separate malformed customer/contact-shaped objects (no field renders)', () => {
    const prompt = buildPrompt([smuggledItem(), CONTACT_SHAPED]);
    // The contact value/label never render (the object is dropped as malformed).
    expect(prompt).not.toContain(LEAK_CONTACT_VALUE);
    expect(prompt).not.toContain(LEAK_CONTACT_LABEL);
  });

  it('Message.content / Conversation.subject / ReplyDraft.draftText|originalText are absent', () => {
    const prompt = buildPrompt([smuggledItem(), CONTACT_SHAPED]);
    expect(prompt).not.toContain(LEAK_MESSAGE_CONTENT);
    expect(prompt).not.toContain(LEAK_SUBJECT);
    expect(prompt).not.toContain(LEAK_DRAFT_TEXT);
    expect(prompt).not.toContain(LEAK_ORIGINAL_TEXT);
  });

  it('NO leak sentinel of any kind appears in the prompt', () => {
    const prompt = buildPrompt([smuggledItem(), CONTACT_SHAPED]);
    for (const leak of ALL_LEAK_SENTINELS) {
      expect(prompt).not.toContain(leak);
    }
    // ...while the allowlisted business value DID render (positive control).
    expect(prompt).toContain(ALLOWED_VALUE);
  });
});

// ===========================================================================
// §5 — Operator instruction is bounded & labeled as not verified context
// ===========================================================================

describe('B-H1 §5 — operator instruction stays bounded and labeled', () => {
  it('renders the instruction under a NOT-verified-context label', () => {
    const prompt = buildPrompt([smuggledItem()], 'Keep it short and apologetic.');
    expect(prompt).toContain('[OPERATOR INSTRUCTION]');
    expect(prompt).toContain('Keep it short and apologetic.');
    expect(prompt.toLowerCase()).toContain('not verified business context');
  });

  it('rejects an oversized operator instruction (fails closed)', () => {
    const res = makeBuilder().buildReplyDraftPrompt({
      context: context([smuggledItem()]),
      instruction: 'a'.repeat(MAX_OPERATOR_INSTRUCTION_CHARS + 1),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('AI_PROMPT_INVALID_INSTRUCTION');
  });

  it('a smuggled PII instruction is still bounded and never promoted to verified context', () => {
    const prompt = buildPrompt([smuggledItem()], `note ${LEAK_MESSAGE_CONTENT}`);
    // The operator's own text renders (it is operator-supplied), but it is
    // labeled as NOT verified — and it never appears inside the verified block.
    const verifiedBlock = prompt.slice(
      prompt.indexOf('[VERIFIED BUSINESS CONTEXT]'),
      prompt.indexOf('[OPERATOR INSTRUCTION]'),
    );
    expect(verifiedBlock).not.toContain(LEAK_MESSAGE_CONTENT);
  });
});

// ===========================================================================
// §6 — Source has no SDK / network / env / API-key / PII read path
// ===========================================================================

describe('B-H1 §6 — builder/allowlist source stays within scope', () => {
  it.each([PROMPT_BUILDER_FILE, TYPES_FILE])(
    '%s imports no real model-provider SDK',
    (rel) => {
      expect(read(rel)).not.toMatch(
        /openai|anthropic|@anthropic-ai|@google|googleapis|gemini|vertex|cohere|mistral|llama|bedrock/i,
      );
    },
  );

  it.each([PROMPT_BUILDER_FILE, TYPES_FILE])(
    '%s makes no network request',
    (rel) => {
      expect(read(rel)).not.toMatch(
        /\bfetch\b|XMLHttpRequest|node:http\b|node:https\b|http\.request|https\.request|axios|undici/i,
      );
    },
  );

  it.each([PROMPT_BUILDER_FILE, TYPES_FILE])(
    '%s reads no env / API-key path',
    (rel) => {
      const src = read(rel);
      expect(src).not.toMatch(/process\.env/);
      expect(src).not.toMatch(/api[_-]?key/i);
    },
  );

  it.each([PROMPT_BUILDER_FILE, TYPES_FILE])(
    '%s has no customer/conversation/message/reply-draft read path',
    (rel) => {
      const src = read(rel);
      expect(src).not.toMatch(
        /\b(db|prisma)\.(customer|conversation|message|replyDraft)\b/,
      );
      for (const imp of importPaths(src)) {
        expect(imp).not.toMatch(/domains\/(crm|conversations|reply-drafts)/);
      }
    },
  );

  it('the prompt builder imports only allowlisted modules', () => {
    const allowed = new Set(['zod', '@/lib/result', './types']);
    for (const imp of importPaths(read(PROMPT_BUILDER_FILE))) {
      expect(allowed.has(imp)).toBe(true);
    }
  });
});
