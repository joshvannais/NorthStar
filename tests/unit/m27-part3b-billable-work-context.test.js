'use strict';

const express = require('express');
const request = require('supertest');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/billableWorkContext');
const repository = require('../../src/customerFinancial/billableWorkContextRepository');
const { createCustomerFinancialEditableEstimateRouter } =
  require('../../src/routes/customerFinancialEditableEstimate');

const id = value => `d2700000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');

function fixtures() {
  const assignment = { id: id(6), revision: 4, digest: hash('a') };
  const execution = { id: id(7), revision: 5, digest: hash('e'), lifecycleState: 'completed' };
  const pins = Object.fromEntries(['completion','labor','materials','progress','fieldEvidence','equipment']
    .map((domain, index) => [domain, [{ id: id(20 + index), revision: 1,
      digest: hash(String(index + 1)) }]]));
  const basis = { contractVersion: 'm27-polaris-editable-estimate-v1', mode: 'paid_tenant',
    estimate: { id: id(1), customerId: id(2), opportunityId: id(3) },
    booking: { appointmentId: id(4), assignmentId: assignment.id,
      revision: assignment.revision, digest: assignment.digest },
    sourceEvidence: { receipt: { graphId: id(5) } },
    currentness: { current: true }, digest: hash('b'),
    providerCallCount: 0, receiverMutationCount: 0, browserArithmeticUsed: false };
  const link = { version: 'm23-part9-execution-link-v1', state: 'available',
    appointmentId: basis.booking.appointmentId, graphId: basis.sourceEvidence.receipt.graphId,
    customerId: basis.estimate.customerId, executionId: execution.id };
  const intelligence = { version: 'm23-operational-intelligence-v1',
    ruleVersion: 'm23-operational-review-rules-v1', authority: 'postgresql_sources',
    advisory: true, humanReviewRequired: true, capabilities: [], providerUsed: false,
    generatedAt: '2026-10-11T12:00:00.000Z', expiresAt: '2026-10-11T12:05:00.000Z',
    execution, assignment, summary: 'Completed. Review recorded work.', scope: 'Owner review.',
    confidence: { level: 'limited', basis: 'Recorded work only.' },
    uncertainty: 'Refresh before deciding.', missingInputs: [{ code: 'planned_inputs', text: 'Plans unavailable.' }],
    conflicts: [], comparisons: [], recommendations: [{ code: 'human_decision', text: 'Review.' }],
    evidence: Object.entries(pins).map(([domain, rows]) => ({ domain, visibleTotal: rows.length,
      returned: rows.length, complete: true, pins: rows, sourceSetDigest: hash('f') })),
    snapshotDigest: hash('9') };
  const sourceSnapshot = { version: 'm23-source-references-v1', execution, assignment,
    factsIncluded: false, completionInferred: false,
    ...Object.fromEntries(Object.entries(pins).map(([domain, rows]) => [domain,
      { pins: rows.map(row => ({ ...row })), count: rows.length, digest: hash('c') }])) };
  const handoff = { version: 'm23-downstream-handoffs-v1', executionId: execution.id,
    sourceSnapshot, sourceDigest: hash('h'), sourceAvailable: true,
    audience: 'tenant_owner_admin_review', consentVersion: 'm23-internal-reference-consent-v1',
    delivery: 'unavailable', consumptionAuthorized: false,
    receipts: [{ id: id(8), executionId: execution.id, action: 'prepare', mission: 27,
      audience: 'tenant_owner_admin_review', consentVersion: 'm23-internal-reference-consent-v1',
      sourceDigest: hash('h'), targetId: null, digest: hash('r'),
      createdAt: '2026-10-11T12:00:01.000Z', delivery: 'unavailable',
      consumptionAuthorized: false, financialConsequence: false,
      customerConsequence: false, status: 'prepared' }] };
  return { basis, link, intelligence, handoff };
}

test('projects one exact completed lineage and keeps capacity and every action value-free', () => {
  const f = fixtures(); const value = contract.project({ basis: f.basis,
    executionLink: f.link, intelligence: f.intelligence, handoff: f.handoff });
  expect(value).toMatchObject({ contractVersion: 'm27-billable-work-context-v1',
    state: 'available', association: { estimateId: f.basis.estimate.id,
      execution: { id: f.intelligence.execution.id, lifecycleState: 'completed' } },
    operationalRiskGuidance: { state: 'available', advisory: true,
      humanReviewRequired: true, advisoryDigest: f.intelligence.snapshotDigest },
    capacityGuidance: { available: false, value: null,
      code: 'capacity_source_unavailable', mayBookOrMutate: false },
    handoffEvidence: { factsIncluded: false, financialActionAuthorized: false,
      receipt: { mission: 27, status: 'prepared', consumptionAuthorized: false } },
    billableWork: { finalBalanceSourceCurrent: true, humanReviewRequired: true,
      reviewAuthority: 'mission27.part3c', financialActionAuthorized: false,
      invoiceAuthorized: false }, providerCallCount: 0, receiverMutationCount: 0,
    schedulingMutationCount: 0, workMutationCount: 0, browserArithmeticUsed: false });
  expect(value.capacityGuidance.missingEvidence).toEqual(contract.CAPACITY_MISSING);
  expect(value.digest).toMatch(/^[a-f0-9]{64}$/);
  expect(contract.project({ basis: f.basis, executionLink: f.link,
    intelligence: f.intelligence, handoff: f.handoff })).toEqual(value);
});

test('selects the latest equivalent current reviewed handoff receipt deterministically', () => {
  const f = fixtures();
  f.handoff.receipts.push({ ...f.handoff.receipts[0], id: id(9), digest: hash('r2'),
    createdAt: '2026-10-11T12:00:02.000Z' });
  const value = contract.project({ basis: f.basis, executionLink: f.link,
    intelligence: f.intelligence, handoff: f.handoff });
  expect(value.handoffEvidence.receipt).toMatchObject({ id: id(9), digest: hash('r2') });
});

test.each([
  ['assignment changed', f => { f.intelligence.assignment = {
    ...f.intelligence.assignment, digest: hash('x') }; }],
  ['execution reopened', f => { f.intelligence.execution.lifecycleState = 'reopened';
    f.handoff.sourceSnapshot.execution.lifecycleState = 'reopened'; }],
  ['handoff source changed', f => { f.handoff.receipts[0].status = 'source_changed'; }],
  ['handoff revoked', f => { f.handoff.receipts[0].status = 'revoked'; }],
  ['source pins changed', f => { f.handoff.sourceSnapshot.progress.pins[0].digest = hash('z'); }],
  ['execution association changed', f => { f.link.executionId = id(99); }],
])('%s returns a named result with no prior commercial or work value', (_name, change) => {
  const f = fixtures(); change(f);
  const result = contract.project({ basis: f.basis, executionLink: f.link,
    intelligence: f.intelligence, handoff: f.handoff });
  expect(result).toMatchObject({ state: 'unavailable', value: null,
    refreshRequired: true, financialActionAuthorized: false,
    providerCallCount: 0, receiverMutationCount: 0,
    schedulingMutationCount: 0, workMutationCount: 0 });
  expect(['source_authority_unavailable','source_currentness_unavailable']).toContain(result.reason);
  expect(JSON.stringify(result)).not.toMatch(/amount|customerId|executionId|sourceDigest|digest/);
});

test('repository uses only accepted reads and rechecks the commercial and execution association', async () => {
  const f = fixtures(); const pool = {}; const fenceClient = { query: jest.fn() };
  const withWorkFence = jest.fn(async (_pool, _organizationId, _executionId, action) =>
    action(fenceClient));
  const dependencies = { readBasis: jest.fn().mockResolvedValue(f.basis),
    readExecutionLink: jest.fn().mockResolvedValue(f.link),
    readOperationalIntelligence: jest.fn().mockResolvedValue(f.intelligence),
    readHandoff: jest.fn().mockResolvedValue(f.handoff), withWorkFence };
  const source = { organizationId: id(40), actorUserId: id(41),
    actorAccessRole: 'owner', authSessionId: id(42) };
  const result = await repository.read(pool, source, f.basis.estimate.id, dependencies);
  expect(result.state).toBe('available');
  expect(dependencies.readBasis).toHaveBeenCalledTimes(2);
  expect(dependencies.readExecutionLink).toHaveBeenCalledTimes(3);
  expect(dependencies.readOperationalIntelligence).toHaveBeenCalledTimes(1);
  expect(dependencies.readHandoff).toHaveBeenCalledTimes(1);
  expect(dependencies.readHandoff.mock.calls[0]).toHaveLength(2);
  expect(dependencies.readHandoff).toHaveBeenCalledWith(fenceClient,
    expect.objectContaining({ executionId: f.link.executionId }));
  expect(withWorkFence).toHaveBeenCalledWith(pool,
    source.organizationId, f.link.executionId, expect.any(Function));
});

test('repository rejects cross-snapshot joins and preserves access denials', async () => {
  const f = fixtures(); const changed = { ...f.basis, digest: hash('q') };
  const fenceClient = { query: jest.fn() };
  const dependencies = { readBasis: jest.fn().mockResolvedValueOnce(f.basis).mockResolvedValueOnce(changed),
    readExecutionLink: jest.fn().mockResolvedValue(f.link),
    readOperationalIntelligence: jest.fn().mockResolvedValue(f.intelligence),
    readHandoff: jest.fn().mockResolvedValue(f.handoff),
    withWorkFence: async (_pool, _organizationId, _executionId, action) => action(fenceClient) };
  const result = await repository.read({}, {}, f.basis.estimate.id, dependencies);
  expect(result).toMatchObject({ state: 'unavailable', value: null,
    reason: 'source_currentness_unavailable' });
  const denied = Object.assign(new Error('denied'), { status: 403 });
  await expect(repository.read({}, {}, f.basis.estimate.id, { ...dependencies,
    readBasis: jest.fn().mockResolvedValue(f.basis),
    readExecutionLink: jest.fn().mockRejectedValue(denied),
    withWorkFence: async (_pool, _organizationId, _executionId, action) =>
      action(fenceClient) })).rejects.toBe(denied);
});

test('work fence acquires Mission 23 session fences before its validation snapshot', async () => {
  const queries = []; let released;
  const client = { query: jest.fn(async (sql, values) => {
    queries.push([sql, values]);
    return { rows: [] };
  }), release: jest.fn(value => { released = value; }) };
  const value = await repository.withinWorkFence({ connect: async () => client },
    id(40), id(7), async () => 'coherent');
  expect(value).toBe('coherent');
  const authorityIndex = queries.findIndex(([sql]) =>
    sql.includes('pg_advisory_lock_shared(230004,4)'));
  const workIndex = queries.findIndex(([sql]) =>
    sql.includes('pg_advisory_lock_shared(230007'));
  const beginIndex = queries.findIndex(([sql]) => sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ');
  expect(authorityIndex).toBeGreaterThan(-1);
  expect(workIndex).toBeGreaterThan(authorityIndex);
  expect(beginIndex).toBeGreaterThan(workIndex);
  expect(queries[workIndex][1]).toEqual([`${id(40)}:${id(7)}`]);
  expect(queries.some(([sql]) => sql === 'COMMIT')).toBe(true);
  const workUnlock = queries.findIndex(([sql]) => sql.includes('pg_advisory_unlock_shared(230007'));
  const authorityUnlock = queries.findIndex(([sql]) => sql.includes('pg_advisory_unlock_shared(230004'));
  expect(workUnlock).toBeGreaterThan(beginIndex);
  expect(authorityUnlock).toBeGreaterThan(workUnlock);
  expect(released).toBe(false);
});

test('work fence rolls back and discards a connection only when cleanup fails', async () => {
  const queries = []; let released;
  const client = { query: jest.fn(async sql => {
    queries.push(sql);
    return { rows: [] };
  }), release: jest.fn(value => { released = value; }) };
  await expect(repository.withinWorkFence({ connect: async () => client },
    id(40), id(7), async () => { throw new Error('joined read failed'); }))
    .rejects.toThrow('joined read failed');
  expect(queries).toContain('ROLLBACK');
  expect(queries).not.toContain('COMMIT');
  expect(released).toBe(false);
});

test('mounted route is private, query-bounded and exposes only the server-owned read', async () => {
  const f = fixtures(); const workContextRead = jest.fn().mockResolvedValue(
    contract.project({ basis: f.basis, executionLink: f.link,
      intelligence: f.intelligence, handoff: f.handoff }));
  const app = express(); app.use((req, _res, next) => {
    req.tenantContext = { organizationId: id(40), userId: id(41) };
    req.userRole = 'owner'; req.authSession = { id: id(42) }; next();
  });
  app.use('/api/v1/customer-financial/editable-estimates',
    createCustomerFinancialEditableEstimateRouter({ poolProvider: () => ({}),
      auth: (_req, _res, next) => next(), role: (_req, _res, next) => next(),
      throttle: (_req, _res, next) => next(), workContextRead }));
  const route = `/api/v1/customer-financial/editable-estimates/${f.basis.estimate.id}/work-context`;
  const response = await request(app).get(route);
  expect(response.status).toBe(200); expect(response.headers['cache-control']).toContain('no-store');
  expect(response.body.data.state).toBe('available');
  expect(workContextRead).toHaveBeenCalledWith({}, expect.objectContaining({
    actorAccessRole: 'owner', authSessionId: id(42) }), f.basis.estimate.id);
  expect((await request(app).get(route + '?limit=1')).status).toBe(400);
});

test('ratifies the Part 3B read-only boundary, unavailable capacity and migration fence', () => {
  const root = path.resolve(__dirname, '../..');
  const architecture = fs.readFileSync(path.join(root,
    'docs/architecture/MISSION_27_PART3B_WORK_CONTEXT.md'), 'utf8');
  const migrations = fs.readdirSync(path.join(root, 'migrations'));
  const routeSource = fs.readFileSync(path.join(root,
    'src/routes/customerFinancialEditableEstimate.js'), 'utf8');
  const repositorySource = fs.readFileSync(path.join(root,
    'src/customerFinancial/billableWorkContextRepository.js'), 'utf8');
  const fence = fs.readFileSync(path.join(root,
    'migrations/265_customer_financial_billable_work_currentness_fence_v1.sql'), 'utf8');
  expect(architecture).toMatch(/Status: implementation candidate/);
  expect(architecture).toMatch(/Part 3C/);
  expect(architecture).toMatch(/capacity_source_unavailable/);
  expect(architecture).toMatch(/migration 265/i);
  expect(architecture).toMatch(/Live-money validation remains deferred/);
  expect(Math.max(...migrations.map(name => Number((name.match(/^(\d+)_/) || [])[1] || 0))))
    .toBe(270);
  expect(routeSource).toContain("router.get('/:estimateId/work-context'");
  expect(routeSource).not.toContain("router.post('/:estimateId/work-context'");
  expect(repositorySource).toContain('readOperationalIntelligence');
  expect(repositorySource).toContain('readHandoff');
  expect(repositorySource).toContain('const verifiedBasis = await readBasis');
  expect(repositorySource.indexOf('pg_advisory_lock_shared(230007'))
    .toBeLessThan(repositorySource.indexOf('BEGIN ISOLATION LEVEL REPEATABLE READ'));
  expect(repositorySource).not.toMatch(/\b(?:insert|update|delete|dispatch|providerCall)\b/i);
  for (const table of ['canonical_field_executions','canonical_completion_records',
    'canonical_labor_intervals','canonical_material_movements','canonical_progress_records',
    'canonical_field_evidence_records','canonical_equipment_events','canonical_handoff_receipts']) {
    expect(fence).toContain(`ON public.${table}`);
  }
  expect(fence).toContain('pg_advisory_xact_lock(230007');
  expect(fence).toContain('FROM public.organizations WHERE id=org FOR SHARE');
  expect(fence).not.toContain('canonical_customer_financial_billable_work_reader_fence_v1');
  expect(fence).toContain('canonical_customer_financial_billable_work_execution_fence_v1');
  expect(fence).toContain('canonical_customer_financial_billable_work_source_identity_immutable');
  expect(fence).toMatch(/canonical_billable_work_fence_execution_v1[\s\S]+EXECUTE FUNCTION public\.canonical_customer_financial_billable_work_execution_fence_v1\(\)/);
  expect(fence.match(/REVOKE ALL ON FUNCTION public\.canonical_customer_financial_billable_work_[a-z0-9_]+\(\)/g))
    .toHaveLength(2);
  const authority = fs.readFileSync(path.join(root,
    'src/customerFinancial/databaseAuthority.js'), 'utf8');
  expect(authority).not.toContain("'canonical_customer_financial_billable_work_reader_fence_v1'");
});
