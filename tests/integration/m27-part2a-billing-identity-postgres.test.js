'use strict';

const crypto = require('node:crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const repository = require('../../src/customerFinancial/billingIdentityRepository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function customer(fixture, tenant, suffix, overrides = {}) {
  const operationId = crypto.randomUUID(); const graphId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  await fixture.ownerPool.query(
    `INSERT INTO canonical_operations(
      id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,
      lease_owner,lease_expires_at,result_status,result_body,completed_at)
     VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,$5::jsonb,NOW())`,
    [operationId, tenant, graphId, hash(`part2a:${suffix}`), JSON.stringify({})]);
  await fixture.ownerPool.query(
    `INSERT INTO canonical_customers(
      id,organization_id,operation_id,graph_id,external_customer_id,name,email,phone,address,
      created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$10)`,
    [customerId, tenant, operationId, graphId, `synthetic-${suffix}`,
      overrides.name ?? 'Synthetic billing customer',
      overrides.email === undefined ? 'billing@example.test' : overrides.email,
      overrides.phone === undefined ? '+15550109000' : overrides.phone,
      JSON.stringify(overrides.address === undefined
        ? { line1: '1 Test Way', city: 'Boston', region: 'MA', postalCode: '02108', country: 'US' }
        : overrides.address),
      '2026-10-10T12:00:00.000Z']);
  return customerId;
}
function mutationActor(source, idempotencyKey = crypto.randomUUID()) {
  return { organizationId: source.organizationId, actorUserId: source.actorUserId,
    actorAccessRole: source.actorAccessRole, authSessionId: source.authSessionId,
    csrfToken: source.csrfToken, idempotencyKey };
}
function readActor(source) {
  return { organizationId: source.organizationId, actorUserId: source.actorUserId,
    actorAccessRole: source.actorAccessRole, authSessionId: source.authSessionId };
}

realPostgres('Mission 27 Part 2A billing identity PostgreSQL authority', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('migrates through 260 and establishes one exact immutable unreviewed origin', async () => {
    const customerId = await customer(fixture, fixture.org, 'positive');
    const customersBefore = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_customers')).rows[0].count);
    const candidate = await repository.candidate(fixture.runtimePool, readActor(fixture.actors.owner),
      { customerId });
    expect(candidate).toMatchObject({ state: 'candidate_unreviewed', available: true,
      current: true, customerId, billingPartyId: null, snapshotId: null,
      reviewState: 'unreviewed', documentUseAuthorized: false,
      automaticCustomerCreationAuthorized: false });
    expect(candidate.value).toMatchObject({ organizationId: fixture.org, billingPartyId: null,
      customer: { id: customerId, source: { class: 'canonical_customer.v1',
        digest: candidate.sourceDigest, updatedAt: candidate.sourceUpdatedAt } },
      address: { state: 'source_candidate', sourceRole: 'unclassified_customer_address' },
      tax: { state: 'unavailable', value: null, reason: 'owner_review_required' },
      exemption: { state: 'unavailable', value: null, reason: 'owner_review_required' },
      delivery: { state: 'unavailable', value: null, reason: 'owner_review_required' } });

    const requestKey = crypto.randomUUID();
    const input = { customerId, expectedSourceDigest: candidate.sourceDigest,
      expectedSourceUpdatedAt: candidate.sourceUpdatedAt,
      reason: 'Establish the exact synthetic billing party origin.' };
    const established = await repository.establish(fixture.runtimePool,
      mutationActor(fixture.actors.owner, requestKey), input);
    expect(established).toMatchObject({ status: 201, replayed: false,
      body: { state: 'established_unreviewed', current: true, customerId,
        reviewState: 'unreviewed', documentUseAuthorized: false } });
    expect(established.body.value.billingPartyId).toBe(established.body.billingPartyId);
    expect(established.body.value.actor).toMatchObject({ userId: fixture.actors.owner.actorUserId,
      accessRole: 'owner', membershipId: fixture.actors.owner.actorUserId,
      authSessionId: fixture.actors.owner.authSessionId });

    const replay = await repository.establish(fixture.runtimePool,
      mutationActor(fixture.actors.owner, requestKey), input);
    expect(replay).toEqual({ status: 200, replayed: true, body: established.body });
    const read = await repository.read(fixture.runtimePool, readActor(fixture.actors.owner), { customerId });
    expect(read).toEqual(established.body);
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_customers')).rows[0].count)).toBe(customersBefore);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int parties FROM canonical_customer_financial_billing_parties_v1')).rows[0].parties).toBe(1);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int snapshots FROM canonical_customer_financial_billing_identity_snapshots_v1')).rows[0].snapshots).toBe(1);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int requests FROM canonical_customer_financial_billing_identity_requests_v1')).rows[0].requests).toBe(1);
    expect((await fixture.ownerPool.query(
      `SELECT array_agg(column_name ORDER BY ordinal_position) columns
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='canonical_customer_financial_billing_identity_requests_v1'`
    )).rows[0].columns).not.toContain('response_body');
    expect((await fixture.ownerPool.query(
      "SELECT filename FROM _migrations WHERE filename LIKE '260\_%' ESCAPE '\\'"
    )).rows.map(value => value.filename)).toEqual([
      '260_customer_financial_billing_identity_v1.sql']);
  }, 120000);

  test('fails closed across tenant, role, replay conflict, malformed source and source change', async () => {
    const customerId = await customer(fixture, fixture.org, 'boundaries', { email: null, phone: null });
    const otherCustomerId = await customer(fixture, fixture.otherOrg, 'other');
    const denied = await repository.candidate(fixture.runtimePool, readActor(fixture.actors.owner),
      { customerId: otherCustomerId });
    expect(denied).toMatchObject({ state: 'unavailable', available: false,
      current: null, reason: 'billing_customer_identity_unavailable', value: null,
      customerId: null, billingPartyId: null, snapshotId: null });
    await expect(repository.candidate(fixture.runtimePool, readActor(fixture.actors.viewer),
      { customerId })).rejects.toMatchObject({
      code: 'CUSTOMER_FINANCIAL_BILLING_IDENTITY_RESTRICTED' });

    const candidate = await repository.candidate(fixture.runtimePool, readActor(fixture.actors.owner),
      { customerId });
    expect(candidate.value.contact).toEqual({
      email: { state: 'unavailable', value: null, reason: 'source_value_missing' },
      phone: { state: 'unavailable', value: null, reason: 'source_value_missing' } });
    const key = crypto.randomUUID(); const input = { customerId,
      expectedSourceDigest: candidate.sourceDigest,
      expectedSourceUpdatedAt: candidate.sourceUpdatedAt,
      reason: 'Establish a second exact synthetic billing party.' };
    const original = await repository.establish(fixture.runtimePool,
      mutationActor(fixture.actors.admin, key), input);
    await expect(repository.establish(fixture.runtimePool,
      mutationActor(fixture.actors.admin, key), { ...input,
        reason: 'Conflicting reason for the same request identity.' })).rejects.toMatchObject({ code: '23505' });

    await fixture.ownerPool.query(
      "UPDATE canonical_customers SET name='Corrected synthetic customer',updated_at=updated_at+INTERVAL '1 second' WHERE organization_id=$1 AND id=$2",
      [fixture.org, customerId]);
    const stale = await repository.read(fixture.runtimePool, readActor(fixture.actors.owner), { customerId });
    expect(stale).toMatchObject({ state: 'unavailable', available: false, current: false,
      reason: 'billing_identity_source_changed_requires_review', customerId,
      value: null, sourceDigest: null, sourceUpdatedAt: null,
      documentUseAuthorized: false });
    const latestCandidate = await repository.candidate(fixture.runtimePool, readActor(fixture.actors.owner),
      { customerId });
    expect(latestCandidate).toEqual(stale);
    const exactReplay = await repository.establish(fixture.runtimePool,
      mutationActor(fixture.actors.admin, key), input);
    expect(exactReplay).toEqual({ status: 200, replayed: true, body: original.body });
    const retry = await repository.establish(fixture.runtimePool,
      mutationActor(fixture.actors.owner), { customerId,
        expectedSourceDigest: candidate.sourceDigest,
        expectedSourceUpdatedAt: candidate.sourceUpdatedAt,
        reason: 'Attempt with an obsolete customer source must fail.' });
    expect(retry).toMatchObject({ status: 409, replayed: false,
      body: { state: 'unavailable', reason: 'billing_customer_source_changed', value: null } });

    const malformedId = await customer(fixture, fixture.org, 'malformed', { address: ['invalid'] });
    const malformed = await repository.candidate(fixture.runtimePool, readActor(fixture.actors.owner),
      { customerId: malformedId });
    expect(malformed).toMatchObject({ state: 'unavailable', available: false,
      reason: 'billing_customer_source_shape_unavailable', value: null });
    const futureId = await customer(fixture, fixture.org, 'future');
    await fixture.ownerPool.query(
      "UPDATE canonical_customers SET updated_at=clock_timestamp()+INTERVAL '1 hour' WHERE organization_id=$1 AND id=$2",
      [fixture.org, futureId]);
    expect(await repository.candidate(fixture.runtimePool, readActor(fixture.actors.owner),
      { customerId: futureId })).toMatchObject({ state: 'unavailable', available: false,
      reason: 'billing_customer_source_shape_unavailable', value: null });
    const oversizedId = await customer(fixture, fixture.org, 'oversized',
      { address: { line1: 'x'.repeat(17000) } });
    expect(await repository.candidate(fixture.runtimePool, readActor(fixture.actors.owner),
      { customerId: oversizedId })).toMatchObject({ state: 'unavailable', available: false,
      reason: 'billing_customer_source_shape_unavailable', value: null });
  }, 120000);

  test('serializes concurrent establishment without duplicate identity or history', async () => {
    const customerId = await customer(fixture, fixture.org, 'concurrent');
    const candidate = await repository.candidate(fixture.runtimePool,
      readActor(fixture.actors.owner), { customerId });
    const key = crypto.randomUUID();
    const input = { customerId, expectedSourceDigest: candidate.sourceDigest,
      expectedSourceUpdatedAt: candidate.sourceUpdatedAt,
      reason: 'Establish one concurrent synthetic billing party.' };
    const attempts = await Promise.allSettled([
      repository.establish(fixture.runtimePool, mutationActor(fixture.actors.owner, key), input),
      repository.establish(fixture.runtimePool, mutationActor(fixture.actors.owner, key), input),
    ]);
    const successes = attempts.filter(result => result.status === 'fulfilled').map(result => result.value);
    const refusals = attempts.filter(result => result.status === 'rejected').map(result => result.reason);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(successes.some(result => result.status === 201)).toBe(true);
    expect(refusals.every(error => ['40001','40P01'].includes(error.code))).toBe(true);

    const replay = await repository.establish(fixture.runtimePool,
      mutationActor(fixture.actors.owner, key), input);
    expect(replay).toMatchObject({ status: 200, replayed: true,
      body: { state: 'established_unreviewed', customerId } });
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_customer_financial_billing_parties_v1 WHERE organization_id=$1 AND customer_id=$2',
      [fixture.org, customerId])).rows[0].count).toBe(1);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_customer_financial_billing_identity_snapshots_v1 WHERE organization_id=$1 AND customer_id=$2',
      [fixture.org, customerId])).rows[0].count).toBe(1);
  }, 120000);

  test('prevents direct runtime access and every rewrite of accepted history', async () => {
    const runtimeRole = fixture.roles.runtime;
    for (const table of ['canonical_customer_financial_billing_parties_v1',
      'canonical_customer_financial_billing_identity_snapshots_v1',
      'canonical_customer_financial_billing_identity_requests_v1']) {
      for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) {
        expect((await fixture.ownerPool.query(
          'SELECT has_table_privilege($1,$2,$3) allowed',[runtimeRole, table, privilege])).rows[0].allowed).toBe(false);
      }
    }
    expect((await fixture.ownerPool.query(
      `SELECT has_function_privilege($1,
       'public.canonical_customer_financial_billing_identity_v1_candidate(uuid,uuid,text,uuid,uuid)',
       'EXECUTE') allowed`,[runtimeRole])).rows[0].allowed).toBe(true);
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_customer_financial_billing_parties_v1')).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_customer_financial_billing_parties_v1 SET establishment_reason=establishment_reason')).rejects.toMatchObject({ code: '55000' });
    await expect(fixture.ownerPool.query(
      'DELETE FROM canonical_customer_financial_billing_identity_snapshots_v1')).rejects.toMatchObject({ code: '55000' });
  }, 120000);

  test('restarts cleanly with migration 260 and private runtime authority intact', async () => {
    await fixture.db.close();
    expect(await fixture.db.initDatabase()).toBe(true);
    expect(fixture.db.readiness()).toEqual({ ready: true, failure: null });
    expect((await fixture.ownerPool.query(
      "SELECT count(*)::int count FROM _migrations WHERE filename='260_customer_financial_billing_identity_v1.sql'"
    )).rows[0].count).toBe(1);
    expect((await fixture.ownerPool.query(
      `SELECT has_function_privilege($1,
       'public.canonical_customer_financial_billing_identity_v1_establish(uuid,uuid,text,uuid,text,text,uuid,text,timestamp with time zone,text)',
       'EXECUTE') allowed`,[fixture.roles.runtime])).rows[0].allowed).toBe(true);
    expect((await fixture.ownerPool.query(
      "SELECT has_table_privilege($1,'public.canonical_customer_financial_billing_identity_snapshots_v1','SELECT') allowed",
      [fixture.roles.runtime])).rows[0].allowed).toBe(false);
  }, 120000);
});
