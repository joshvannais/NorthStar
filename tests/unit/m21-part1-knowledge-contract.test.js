'use strict';

const crypto = require('crypto');
const {
  KnowledgeContractError,
  canonicalObject,
  canonicalStringify,
  normalizeInitialDraft,
} = require('../../src/knowledge/contract');

const ORG = '91000000-0000-4000-8000-000000000001';
const OWNER = '92000000-0000-4000-8000-000000000001';
const SOURCE_DIGEST = crypto.createHash('sha256').update('source-v1').digest('hex');

function draft(overrides = {}) {
  return {
    organizationId: ORG,
    actorUserId: OWNER,
    canonicalKey: 'services.roof-replacement.customer-faq',
    entryType: 'faq',
    label: 'Roof replacement scheduling',
    sensitivity: 'public',
    reviewRequirement: 'standard',
    origin: 'authoritative_source',
    applicability: { serviceIds: ['roof-replacement'], locations: ['hq'] },
    content: {
      answer: 'A verified scheduler confirms the available appointment window.',
      question: 'When can my roof replacement be scheduled?',
    },
    reason: 'Create the first authority-backed draft.',
    provenance: [{
      sourceType: 'business_profile',
      sourceRecordId: 'canonical-business-profile',
      sourceVersion: '7',
      sourceDigest: SOURCE_DIGEST,
      jsonPointer: '/scheduling',
    }],
    ...overrides,
  };
}

describe('Mission 21 Part 1 knowledge contract', () => {
  test('produces the same canonical UTF-8 document and digest regardless of input key order', () => {
    const first = normalizeInitialDraft(draft());
    const second = normalizeInitialDraft(draft({
      applicability: { locations: ['hq'], serviceIds: ['roof-replacement'] },
      content: {
        question: 'When can my roof replacement be scheduled?',
        answer: 'A verified scheduler confirms the available appointment window.',
      },
    }));
    expect(second.canonicalDocument).toBe(first.canonicalDocument);
    expect(second.canonicalDigest).toBe(first.canonicalDigest);
    expect(first.canonicalDigest).toBe(
      crypto.createHash('sha256').update(first.canonicalDocument, 'utf8').digest('hex')
    );
    expect(Object.keys(first.document)).toEqual([
      'applicability', 'canonicalKey', 'content', 'entryType', 'label', 'origin',
      'reviewRequirement', 'schemaVersion', 'sensitivity',
    ]);
  });

  test('includes security and applicability metadata in the authoritative digest', () => {
    const baseline = normalizeInitialDraft(draft());
    expect(normalizeInitialDraft(draft({ sensitivity: 'restricted' })).canonicalDigest)
      .not.toBe(baseline.canonicalDigest);
    expect(normalizeInitialDraft(draft({ applicability: { locations: ['branch-2'] } })).canonicalDigest)
      .not.toBe(baseline.canonicalDigest);
  });

  test.each([
    [{ canonicalKey: 'Services.Bad' }, 'knowledge_invalid_key'],
    [{ entryType: 'tool_authorization' }, 'knowledge_invalid_enum'],
    [{ sensitivity: '' }, 'knowledge_invalid_enum'],
    [{ reviewRequirement: null }, 'knowledge_invalid_enum'],
    [{ origin: '' }, 'knowledge_invalid_enum'],
    [{ applicability: null }, 'knowledge_invalid_object'],
    [{ label: 'Hidden\u202Elabel' }, 'knowledge_invalid_text'],
    [{ reason: 'Bad\u0000reason' }, 'knowledge_invalid_text'],
    [{ provenance: [] }, 'knowledge_invalid_provenance'],
    [{ provenance: [{ sourceType: 'human_input', sourceRecordId: 'actor', sourceVersion: '1', sourceDigest: 'x' }] }, 'knowledge_invalid_digest'],
    [{ content: { amount: Number.POSITIVE_INFINITY } }, 'knowledge_invalid_number'],
  ])('rejects invalid authority input %#', (override, code) => {
    expect(() => normalizeInitialDraft(draft(override))).toThrow(KnowledgeContractError);
    try {
      normalizeInitialDraft(draft(override));
    } catch (error) {
      expect(error.code).toBe(code);
    }
  });

  test('rejects prototype keys, non-JSON values, duplicate provenance, excessive depth and size', () => {
    const prototypeKey = JSON.parse('{"__proto__":{"admin":true}}');
    expect(() => normalizeInitialDraft(draft({ content: prototypeKey })))
      .toThrow(expect.objectContaining({ code: 'knowledge_invalid_key' }));
    expect(() => normalizeInitialDraft(draft({ content: { unsafe: new Date() } })))
      .toThrow(expect.objectContaining({ code: 'knowledge_invalid_value' }));
    const link = draft().provenance[0];
    expect(() => normalizeInitialDraft(draft({ provenance: [link, { ...link }] })))
      .toThrow(expect.objectContaining({ code: 'knowledge_duplicate_provenance' }));
    let nested = {};
    for (let index = 0; index < 18; index += 1) nested = { nested };
    expect(() => normalizeInitialDraft(draft({ content: nested })))
      .toThrow(expect.objectContaining({ code: 'knowledge_document_too_deep' }));
    expect(() => normalizeInitialDraft(draft({ content: { value: 'x'.repeat(16385) } })))
      .toThrow(expect.objectContaining({ code: 'knowledge_string_too_large' }));
  });

  test('normalizes Unicode deterministically without accepting colliding normalized keys', () => {
    expect(canonicalObject({ value: 'Cafe\u0301' }, 'content', 1024))
      .toEqual({ value: 'Café' });
    const collision = { '\u00e9': 1, 'e\u0301': 2 };
    expect(() => canonicalObject(collision, 'content', 1024))
      .toThrow(expect.objectContaining({ code: 'knowledge_duplicate_key' }));
  });

  test('uses PostgreSQL-compatible UTF-8 key order and non-exponential number bytes', () => {
    const canonical = canonicalObject({
      '\ufffd': 2,
      '\ud83d\ude00': 1,
      10: 'ten',
      2: 'two',
      tiny: 1e-7,
      huge: 1e21,
    }, 'content', 4096);
    expect(canonicalStringify(canonical)).toBe(
      '{"10":"ten","2":"two","huge":1000000000000000000000,"tiny":0.0000001,"�":2,"😀":1}'
    );
  });

  test.each([
    ['null character', `bad\u0000value`],
    ['unpaired surrogate', String.fromCharCode(0xd800)],
  ])('rejects %s before PostgreSQL JSONB ingestion', (_label, value) => {
    expect(() => normalizeInitialDraft(draft({ content: { value } })))
      .toThrow(expect.objectContaining({ code: 'knowledge_invalid_string' }));
  });
});
