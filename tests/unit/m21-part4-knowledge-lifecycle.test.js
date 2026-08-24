'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildTombstoneDocument,
  normalizeRevisionInput,
  normalizeRollbackInput,
  normalizeTombstoneInput,
} = require('../../src/knowledge/lifecycle');
const { normalizeInitialDraft } = require('../../src/knowledge/contract');
const { buildKnowledgeDiff } = require('../../src/knowledge/workflow');
const repository = require('../../src/knowledge/repository');

const ROOT = path.resolve(__dirname, '../..');
const ORG = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const ENTRY = '33333333-3333-4333-8333-333333333333';
const VERSION = '44444444-4444-4444-8444-444444444444';
const ROLLBACK = '55555555-5555-4555-8555-555555555555';
const DIGEST = 'a'.repeat(64);
const SOURCE_DIGEST = 'b'.repeat(64);

function baseTarget(overrides = {}) {
  return {
    organizationId: ORG,
    actorUserId: ACTOR,
    entryId: ENTRY,
    expectedVersionId: VERSION,
    expectedVersionNumber: 3,
    expectedCanonicalDigest: DIGEST,
    reason: 'Correct the verified service guidance',
    ...overrides,
  };
}

function revisionInput(overrides = {}) {
  return baseTarget({
    canonicalKey: 'services.tree-removal',
    entryType: 'generated_knowledge',
    label: 'Tree removal guidance',
    sensitivity: 'internal',
    reviewRequirement: 'standard',
    origin: 'human',
    applicability: { service: 'tree-removal' },
    content: { state: 'ready', summary: 'Use the verified revision.' },
    provenance: [{
      sourceType: 'human_input',
      sourceRecordId: 'change-request-42',
      sourceVersion: '1',
      sourceDigest: SOURCE_DIGEST,
      jsonPointer: '/summary',
    }],
    ...overrides,
  });
}

describe('Mission 21 Part 4 immutable lifecycle contract', () => {
  test('normalizes an exact revision target and deterministic changed document', () => {
    const result = normalizeRevisionInput(revisionInput());
    expect(result).toMatchObject({
      organizationId: ORG,
      actorUserId: ACTOR,
      entryId: ENTRY,
      expectedVersionId: VERSION,
      expectedVersionNumber: 3,
      expectedCanonicalDigest: DIGEST,
      reason: 'Correct the verified service guidance',
    });
    expect(result.draft.canonicalDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.draft.document.content).toEqual({
      state: 'ready',
      summary: 'Use the verified revision.',
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('normalizes tombstone and exact rollback pins and rejects ambiguous targets', () => {
    expect(normalizeTombstoneInput(baseTarget())).toMatchObject({
      entryId: ENTRY,
      expectedVersionNumber: 3,
    });
    expect(normalizeRollbackInput(baseTarget({
      rollbackVersionId: ROLLBACK,
      rollbackVersionNumber: 1,
      rollbackCanonicalDigest: SOURCE_DIGEST,
    }))).toMatchObject({
      rollbackVersionId: ROLLBACK,
      rollbackVersionNumber: 1,
      rollbackCanonicalDigest: SOURCE_DIGEST,
    });
    expect(() => normalizeRollbackInput(baseTarget({
      rollbackVersionId: ROLLBACK,
      rollbackVersionNumber: 0,
      rollbackCanonicalDigest: SOURCE_DIGEST,
    }))).toThrow('rollbackVersionNumber must be a positive integer');
    expect(() => normalizeTombstoneInput(baseTarget({ reason: 'bad\u0000reason' })))
      .toThrow('reason is outside its allowed bounds');
  });

  test('builds one deterministic tombstone without copying prior content', () => {
    const entry = { canonical_key: 'policy.cancellation', entry_type: 'policy' };
    const parent = {
      applicability: { location: 'all' },
      label: 'Cancellation policy',
      review_requirement: 'high_risk',
      sensitivity: 'restricted',
    };
    const first = buildTombstoneDocument(entry, parent);
    const second = buildTombstoneDocument(entry, parent);
    expect(first).toEqual(second);
    expect(first.document).toEqual({
      applicability: { location: 'all' },
      canonicalKey: 'policy.cancellation',
      content: { state: 'tombstoned' },
      entryType: 'policy',
      label: 'Cancellation policy',
      origin: 'human',
      reviewRequirement: 'high_risk',
      schemaVersion: 1,
      sensitivity: 'restricted',
    });
    expect(first.canonicalDocument).not.toContain('prior content');
  });

  test('reserves tombstoned content for the explicit lifecycle operation', () => {
    expect(() => normalizeInitialDraft(revisionInput({
      content: { state: 'tombstoned' },
    }))).toThrow('Tombstoned content requires the explicit tombstone lifecycle operation');
    try {
      normalizeInitialDraft(revisionInput({ content: { state: 'tombstoned' } }));
      throw new Error('Expected tombstoned initial content to fail');
    } catch (error) {
      expect(error).toMatchObject({ code: 'knowledge_initial_tombstone_invalid' });
    }
  });

  test('orders later-version diff paths by UTF-8 bytes like PostgreSQL C collation', () => {
    const diff = buildKnowledgeDiff(
      { content: { 2: 'old two', 10: 'old ten', z: 'old z' } },
      { content: { 2: 'new two', 10: 'new ten', z: 'new z' } }
    );
    expect(diff.document.operations.map(operation => operation.path)).toEqual([
      '/content/10',
      '/content/2',
      '/content/z',
    ]);
  });

  test('exports lifecycle repository operations without mounting a route or provider', () => {
    expect(repository).toEqual(expect.objectContaining({
      createKnowledgeRevision: expect.any(Function),
      createKnowledgeRollback: expect.any(Function),
      createKnowledgeTombstone: expect.any(Function),
      getKnowledgeLifecycleHistory: expect.any(Function),
    }));
    const routeFiles = fs.readdirSync(path.join(ROOT, 'src/routes'))
      .filter(name => name.endsWith('.js'));
    const routeSource = routeFiles.map(name =>
      fs.readFileSync(path.join(ROOT, 'src/routes', name), 'utf8')
    ).join('\n');
    expect(routeSource).not.toMatch(
      /createKnowledgeRevision|createKnowledgeRollback|createKnowledgeTombstone|getKnowledgeLifecycleHistory/
    );
  });
});
