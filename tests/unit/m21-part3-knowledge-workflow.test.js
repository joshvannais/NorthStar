'use strict';

const crypto = require('crypto');
const {
  approvalActionForRequirement,
  buildKnowledgeDiff,
  normalizeAttorneyReviewEvidence,
  normalizePublicationTarget,
  normalizeWorkflowTarget,
} = require('../../src/knowledge/workflow');

const ORG = 'a1000000-0000-4000-8000-000000000001';
const OWNER = 'a2000000-0000-4000-8000-000000000001';
const ENTRY = 'a3000000-0000-4000-8000-000000000001';
const VERSION = 'a4000000-0000-4000-8000-000000000001';
const EVENT = 'a5000000-0000-4000-8000-000000000001';
const PUBLICATION = 'a6000000-0000-4000-8000-000000000001';
const DIGEST = 'a'.repeat(64);

function target(overrides = {}) {
  return {
    organizationId: ORG,
    actorUserId: OWNER,
    entryId: ENTRY,
    versionId: VERSION,
    versionNumber: 1,
    canonicalDigest: DIGEST,
    expectedReviewEventId: null,
    reason: 'Submit the exact version for authorized review.',
    ...overrides,
  };
}

describe('Mission 21 Part 3 knowledge review workflow contract', () => {
  test('creates one deterministic canonical diff and digest', () => {
    const base = {
      a: 1,
      nested: { keep: 'Cafe\u0301', old: 1 },
      remove: true,
    };
    const next = {
      nested: { new: 2, keep: 'Caf\u00e9' },
      added: 'yes',
      a: 2,
    };
    const first = buildKnowledgeDiff(base, next);
    const second = buildKnowledgeDiff(
      { remove: true, nested: { old: 1, keep: 'Café' }, a: 1 },
      { a: 2, added: 'yes', nested: { keep: 'Café', new: 2 } }
    );
    expect(second).toEqual(first);
    expect(first.document).toEqual({
      operations: [
        { op: 'remove', path: '/remove' },
        { op: 'replace', path: '/a', value: 2 },
        { op: 'add', path: '/added', value: 'yes' },
        { op: 'remove', path: '/nested/old' },
        { op: 'add', path: '/nested/new', value: 2 },
      ],
      schemaVersion: 1,
    });
    expect(first.diffDigest).toBe(
      crypto.createHash('sha256').update(first.canonicalDiff, 'utf8').digest('hex')
    );
  });

  test('represents first publication review and escapes JSON pointer keys', () => {
    const initial = buildKnowledgeDiff(null, { 'a/b~c': { value: 1 } });
    expect(initial.document.operations).toEqual([
      { op: 'add', path: '', value: { 'a/b~c': { value: 1 } } },
    ]);
    const changed = buildKnowledgeDiff(
      { 'a/b~c': { value: 1 } },
      { 'a/b~c': { value: 2 } }
    );
    expect(changed.document.operations).toEqual([
      { op: 'replace', path: '/a~1b~0c/value', value: 2 },
    ]);
    expect(() => buildKnowledgeDiff({ value: 1 }, { value: 1 })).toThrow(expect.objectContaining({
      code: 'knowledge_diff_empty', status: 409,
    }));
  });

  test('normalizes exact stale-write targets without inventing defaults', () => {
    expect(normalizeWorkflowTarget(target({
      organizationId: ORG.toUpperCase(),
      canonicalDigest: DIGEST.toUpperCase(),
      expectedReviewEventId: EVENT.toUpperCase(),
      reason: '  Review the exact digest.  ',
    }))).toEqual({
      organizationId: ORG,
      actorUserId: OWNER,
      entryId: ENTRY,
      versionId: VERSION,
      versionNumber: 1,
      canonicalDigest: DIGEST,
      expectedReviewEventId: EVENT,
      reason: 'Review the exact digest.',
    });
    expect(normalizePublicationTarget(target({
      expectedReviewEventId: EVENT,
      expectedPublicationId: PUBLICATION,
      expectedPublicationNumber: 3,
    }))).toEqual(expect.objectContaining({
      expectedReviewEventId: EVENT,
      expectedPublicationId: PUBLICATION,
      expectedPublicationNumber: 3,
    }));
  });

  test.each([
    [{ canonicalDigest: 'x' }, 'knowledge_workflow_invalid_digest'],
    [{ versionNumber: 0 }, 'knowledge_workflow_invalid_version'],
    [{ versionNumber: '1' }, 'knowledge_workflow_invalid_version'],
    [{ expectedReviewEventId: 'not-a-uuid' }, 'knowledge_invalid_uuid'],
    [{ expectedReviewEventId: '' }, 'knowledge_invalid_uuid'],
    [{ reason: 'bad\u0000reason' }, 'knowledge_workflow_invalid_text'],
  ])('rejects malformed workflow target %#', (override, code) => {
    expect(() => normalizeWorkflowTarget(target(override))).toThrow(expect.objectContaining({ code }));
    try {
      normalizeWorkflowTarget(target(override));
    } catch (error) {
      expect(error.code).toBe(code);
    }
  });

  test('requires bounded digest-only attorney-review evidence', () => {
    expect(normalizeAttorneyReviewEvidence({
      reviewReference: '  counsel-matter-21  ',
      evidenceDigest: 'B'.repeat(64),
      reviewedAt: '2026-08-23T15:00:00-04:00',
    })).toEqual({
      reviewReference: 'counsel-matter-21',
      evidenceDigest: 'b'.repeat(64),
      reviewedAt: '2026-08-23T19:00:00.000Z',
    });
    expect(() => normalizeAttorneyReviewEvidence(null)).toThrow(expect.objectContaining({
      code: 'knowledge_attorney_review_required', status: 409,
    }));
    expect(() => normalizeAttorneyReviewEvidence({
      reviewReference: 'matter', evidenceDigest: DIGEST, reviewedAt: 'not-a-date',
    })).toThrow(expect.objectContaining({ code: 'knowledge_attorney_review_invalid' }));
  });

  test('uses distinct approval actions for every review class', () => {
    expect(approvalActionForRequirement('standard')).toBe('standard_approved');
    expect(approvalActionForRequirement('high_risk')).toBe('high_risk_approved');
    expect(approvalActionForRequirement('attorney_gated')).toBe('attorney_gated_approved');
    expect(() => approvalActionForRequirement('provider_approved')).toThrow(expect.objectContaining({
      code: 'knowledge_workflow_invalid_requirement', status: 409,
    }));
  });
});
