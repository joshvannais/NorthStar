'use strict';

const { normalizeCompletionAction, normalizeCompletionRead, VERSION } = require('../../src/completion/contract');
const { mutateCompletion, readCompletion } = require('../../src/completion/repository');

const IDS = Object.freeze({
  organization: 'a1000000-0000-4000-8000-000000000001',
  actor: 'a2000000-0000-4000-8000-000000000001',
  session: 'a3000000-0000-4000-8000-000000000001',
  execution: 'a4000000-0000-4000-8000-000000000001',
  evidenceA: 'a5000000-0000-4000-8000-000000000001',
  evidenceB: 'a5000000-0000-4000-8000-000000000002',
});
const digest = character => character.repeat(64);
const pin = (id = IDS.evidenceA, revision = 1, value = 'd') => ({ id, revision, digest: digest(value) });

function common(action, fields = {}) {
  return {
    organizationId: IDS.organization,
    actorUserId: IDS.actor,
    actorAccessRole: 'owner',
    authSessionId: IDS.session,
    executionId: IDS.execution,
    idempotencyKey: `completion-${action}-key-0001`,
    body: {
      action,
      expectedExecutionRevision: 3,
      expectedExecutionDigest: digest('a'),
      expectedAssignmentRevision: 4,
      expectedAssignmentDigest: digest('b'),
      reason: 'Explicit completion authority decision.',
      ...fields,
    },
  };
}

function proposal() {
  return common('propose_completion', {
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    gateRequirements: {
      checklists: [pin(IDS.evidenceB, 2, 'e'), pin(IDS.evidenceA, 1, 'd')],
      inspections: [],
      files: [],
    },
  });
}

describe('Mission 23 Part 8 strict completion contract', () => {
  test('normalizes and deterministically orders explicit evidence gate pins', () => {
    const result = normalizeCompletionAction(proposal());
    expect(result.contractVersion).toBe(VERSION);
    expect(result.gateRequirements.checklists.map(item => item.id)).toEqual([
      IDS.evidenceA, IDS.evidenceB,
    ]);
    expect(result.proposal).toBeNull();
  });

  test.each([
    ['approve_completion', { proposal: pin() }],
    ['withdraw_completion', { proposal: pin() }],
    ['cancel_execution', { proposal: null }],
    ['reopen_execution', { completion: pin(), nextAction: 'Return to the field and inspect the repair.' }],
    ['resume_reopened', { reopening: pin() }],
    ['correct_completion', { record: pin(), annotation: { note: 'Corrected annotation.', nextAction: null } }],
  ])('accepts the exact %s command shape', (action, fields) => {
    expect(normalizeCompletionAction(common(action, fields)).action).toBe(action);
  });

  test.each(['percentComplete', 'customerAcceptance', 'invoice', 'payment', 'profit',
    'professionalConclusion', 'scheduleState', 'contactCustomer'])('rejects extra inferred authority %s', key => {
    const value = proposal();
    value.body[key] = true;
    expect(() => normalizeCompletionAction(value)).toThrow();
  });

  test('requires every source and target precondition without truthy coercion', () => {
    for (const key of ['expectedExecutionRevision', 'expectedExecutionDigest',
      'expectedAssignmentRevision', 'expectedAssignmentDigest']) {
      const missing = proposal(); delete missing.body[key];
      expect(() => normalizeCompletionAction(missing)).toThrow();
      const nullable = proposal(); nullable.body[key] = null;
      expect(() => normalizeCompletionAction(nullable)).toThrow();
    }
    const approval = common('approve_completion', { proposal: pin() });
    approval.body.proposal.revision = 0;
    expect(() => normalizeCompletionAction(approval)).toThrow();
  });

  test.each(['<b>done</b>', 'https://example.test', 'safe\u202Etext', 'e\u0301', 'a\u200Bb'])
  ('rejects unsafe or non-canonical decision text %s', reason => {
    const value = proposal(); value.body.reason = reason;
    expect(() => normalizeCompletionAction(value)).toThrow();
  });

  test('rejects duplicate evidence pins, invalid expiry, query authority and unknown actions', () => {
    const duplicate = proposal(); duplicate.body.gateRequirements.checklists = [pin(), pin()];
    expect(() => normalizeCompletionAction(duplicate)).toThrow();
    const expired = proposal(); expired.body.expiresAt = 'not-an-instant';
    expect(() => normalizeCompletionAction(expired)).toThrow();
    const unknown = proposal(); unknown.body.action = 'infer_completion';
    expect(() => normalizeCompletionAction(unknown)).toThrow();
    expect(normalizeCompletionRead(IDS.execution, {})).toBe(IDS.execution);
    expect(() => normalizeCompletionRead(IDS.execution, { actor: IDS.actor })).toThrow();
  });
});

function fakePool(databaseValue) {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (String(sql).includes('canonical_completion_mutate')) return { rows: [{ result: databaseValue }] };
      if (String(sql).includes('canonical_completion_read')) return { rows: [{ result: databaseValue }] };
      return { rows: [{}] };
    },
    release() {},
  };
  return { queries, connect: async () => client };
}

describe('Mission 23 Part 8 repository transaction boundary', () => {
  test('takes both authority locks before a serializable mutation and returns exact replay state', async () => {
    const databaseValue = { status: 200, body: { success: true }, replayed: true };
    const pool = fakePool(databaseValue);
    const normalized = normalizeCompletionAction(proposal());
    const result = await mutateCompletion(pool, {
      ...normalized, csrfToken: 'csrf-token', requestCorrelationId: 'part8-unit',
    });
    expect(result).toEqual({ status: 200, body: { success: true }, replayed: true });
    const statements = pool.queries.map(item => String(item.sql));
    expect(statements.findIndex(sql => sql.includes('pg_advisory_lock_shared(230004,4)')))
      .toBeLessThan(statements.findIndex(sql => sql.includes('BEGIN ISOLATION LEVEL SERIALIZABLE')));
    expect(statements.findIndex(sql => sql.includes('pg_advisory_lock(230007')))
      .toBeLessThan(statements.findIndex(sql => sql.includes('BEGIN ISOLATION LEVEL SERIALIZABLE')));
    const mutation = pool.queries.find(item => String(item.sql).includes('canonical_completion_mutate'));
    expect(mutation.values[6]).toBe('propose_completion');
    expect(mutation.values[11].gateRequirements.checklists).toHaveLength(2);
  });

  test('uses a repeatable-read shared work lock for bounded reads', async () => {
    const pool = fakePool({ success: true, data: { records: [] } });
    const result = await readCompletion(pool, {
      organizationId: IDS.organization, actorUserId: IDS.actor, actorAccessRole: 'owner',
      authSessionId: IDS.session, executionId: IDS.execution,
    });
    expect(result.status).toBe(200);
    const statements = pool.queries.map(item => String(item.sql));
    expect(statements).toContain('BEGIN ISOLATION LEVEL REPEATABLE READ');
    expect(statements.some(sql => sql.includes('pg_advisory_lock_shared(230007'))).toBe(true);
  });
});
