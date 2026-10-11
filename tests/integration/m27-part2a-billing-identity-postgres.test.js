'use strict';

const crypto = require('node:crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const repository = require('../../src/customerFinancial/billingIdentityRepository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function customer(fixture, tenant, suffix, overrides = {}) {
  const operationId = crypto.randomUUID(); const graphId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const address = overrides.address === undefined
    ? { line1: '1 Test Way', city: 'Boston', region: 'MA', postalCode: '02108', country: 'US' }
    : overrides.address;
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
      address === null ? null : JSON.stringify(address),
      '2026-10-10T12:00:00.000Z']);
  return customerId;
}

async function authorize(fixture, source, customerId, options = {}) {
  const grantId = options.grantId || crypto.randomUUID();
  const revision = options.revision || 1;
  await fixture.ownerPool.query(
    `INSERT INTO canonical_customer_financial_billing_capability_grants_v1(
      organization_id,id,revision,actor_user_id,membership_id,customer_id,capability,
      business_purpose,policy_version,template_version,active,valid_from,expires_at,issued_at)
     VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,
      clock_timestamp()-INTERVAL '1 minute',clock_timestamp()+INTERVAL '1 hour',clock_timestamp())`,
    [source.organizationId, grantId, revision, source.actorUserId, customerId,
      repository.CAPABILITY, repository.BUSINESS_PURPOSE, repository.POLICY_VERSION,
      source.actorAccessRole === 'owner' ? 'm27.owner.v1' : 'm27.admin.v1',
      options.active === undefined ? true : options.active]);
  return { organizationId: source.organizationId, actorUserId: source.actorUserId,
    actorAccessRole: source.actorAccessRole, authSessionId: source.authSessionId,
    capabilityGrantId: grantId, capabilityGrantRevision: revision,
    businessPurpose: repository.BUSINESS_PURPOSE, policyVersion: repository.POLICY_VERSION,
    csrfToken: source.csrfToken };
}
function mutationActor(source, idempotencyKey = crypto.randomUUID()) {
  return { ...source, idempotencyKey };
}
function readActor(source) {
  const { csrfToken: _csrfToken, idempotencyKey: _idempotencyKey, ...value } = source;
  return value;
}

realPostgres('Mission 27 Part 2A billing identity PostgreSQL authority', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('requires and persists exact minimized operation capability evidence', async () => {
    const customerId = await customer(fixture, fixture.org, 'positive');
    const owner = await authorize(fixture, fixture.actors.owner, customerId);
    const customersBefore = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_customers')).rows[0].count);
    const candidate = await repository.candidate(fixture.runtimePool, readActor(owner), { customerId });
    expect(candidate).toMatchObject({ state: 'candidate_unreviewed', available: true,
      current: true, customerId, billingPartyId: null, snapshotId: null,
      reviewState: 'unreviewed', documentUseAuthorized: false,
      automaticCustomerCreationAuthorized: false });
    expect(candidate.value.actor).toEqual({ userId: owner.actorUserId, accessRole: 'owner',
      membershipId: owner.actorUserId, authSessionId: owner.authSessionId,
      capability: repository.CAPABILITY, capabilityGrantId: owner.capabilityGrantId,
      capabilityGrantRevision: 1, businessPurpose: repository.BUSINESS_PURPOSE,
      policyVersion: repository.POLICY_VERSION });

    const requestKey = crypto.randomUUID();
    const input = { customerId, expectedSourceDigest: candidate.sourceDigest,
      expectedSourceUpdatedAt: candidate.sourceUpdatedAt,
      reason: 'Establish the exact synthetic billing party origin.' };
    const established = await repository.establish(fixture.runtimePool,
      mutationActor(owner, requestKey), input);
    expect(established).toMatchObject({ status: 201, replayed: false,
      body: { state: 'established_unreviewed', current: true, customerId,
        reviewState: 'unreviewed', documentUseAuthorized: false } });
    const replay = await repository.establish(fixture.runtimePool,
      mutationActor(owner, requestKey), input);
    expect(replay).toEqual({ status: 200, replayed: true, body: established.body });
    expect(await repository.read(fixture.runtimePool, readActor(owner), { customerId })).toEqual(established.body);

    const proof = (await fixture.ownerPool.query(
      `SELECT party.capability_grant_id party_grant,party.capability_grant_revision party_revision,
        party.business_purpose party_purpose,party.policy_version party_policy,
        snapshot.capability_grant_id snapshot_grant,request.capability_grant_id request_grant,
        request.response_status,snapshot.snapshot->'actor' snapshot_actor
       FROM canonical_customer_financial_billing_parties_v1 party
       JOIN canonical_customer_financial_billing_identity_snapshots_v1 snapshot
        ON snapshot.organization_id=party.organization_id AND snapshot.billing_party_id=party.id
       JOIN canonical_customer_financial_billing_identity_requests_v1 request
        ON request.organization_id=party.organization_id AND request.billing_party_id=party.id
       WHERE party.organization_id=$1 AND party.customer_id=$2`, [fixture.org, customerId])).rows[0];
    expect(proof).toMatchObject({ party_grant: owner.capabilityGrantId, party_revision: '1',
      party_purpose: repository.BUSINESS_PURPOSE, party_policy: repository.POLICY_VERSION,
      snapshot_grant: owner.capabilityGrantId, request_grant: owner.capabilityGrantId,
      response_status: 201 });
    expect(proof.snapshot_actor).not.toHaveProperty('csrfToken');
    expect(proof.snapshot_actor).not.toHaveProperty('idempotencyKey');
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_customers')).rows[0].count)).toBe(customersBefore);
    expect((await fixture.ownerPool.query(
      "SELECT filename FROM _migrations WHERE filename LIKE '260\_%' ESCAPE '\\'"
    )).rows.map(value => value.filename)).toEqual(['260_customer_financial_billing_identity_v1.sql']);
  }, 120000);

  test('fails closed for missing, stale, mismatched, cross-tenant and malformed authority', async () => {
    const customerId = await customer(fixture, fixture.org, 'authority');
    const secondCustomerId = await customer(fixture, fixture.org, 'authority-second');
    const otherCustomerId = await customer(fixture, fixture.otherOrg, 'authority-other');
    const owner = await authorize(fixture, fixture.actors.owner, customerId);
    await expect(repository.candidate(fixture.runtimePool,
      readActor({ ...owner, capabilityGrantId: crypto.randomUUID() }), { customerId }
    )).rejects.toMatchObject({ code: '42501' });
    await expect(repository.candidate(fixture.runtimePool, readActor(owner),
      { customerId: secondCustomerId })).rejects.toMatchObject({ code: '42501' });
    await expect(repository.candidate(fixture.runtimePool, readActor(owner),
      { customerId: otherCustomerId })).rejects.toMatchObject({ code: '42501' });
    await expect(repository.candidate(fixture.runtimePool, {
      organizationId: owner.organizationId, actorUserId: owner.actorUserId,
      actorAccessRole: owner.actorAccessRole, authSessionId: owner.authSessionId,
    }, { customerId })).rejects.toMatchObject({
      code: 'CUSTOMER_FINANCIAL_BILLING_IDENTITY_RESTRICTED' });
    await expect(repository.candidate(fixture.runtimePool, readActor({
      ...owner, businessPurpose: 'billing_identity.unspecified' }), { customerId }
    )).rejects.toMatchObject({ code: 'CUSTOMER_FINANCIAL_BILLING_IDENTITY_RESTRICTED' });

    await authorize(fixture, fixture.actors.owner, customerId,
      { grantId: owner.capabilityGrantId, revision: 2 });
    await expect(repository.read(fixture.runtimePool, readActor(owner), { customerId }
    )).rejects.toMatchObject({ code: '42501' });
    const currentOwner = { ...owner, capabilityGrantRevision: 2 };
    expect((await repository.candidate(fixture.runtimePool, readActor(currentOwner), { customerId })).state)
      .toBe('candidate_unreviewed');

    const viewer = { ...fixture.actors.viewer, capabilityGrantId: crypto.randomUUID(),
      capabilityGrantRevision: 1, businessPurpose: repository.BUSINESS_PURPOSE,
      policyVersion: repository.POLICY_VERSION };
    await expect(repository.candidate(fixture.runtimePool, readActor(viewer), { customerId }
    )).rejects.toMatchObject({ code: 'CUSTOMER_FINANCIAL_BILLING_IDENTITY_RESTRICTED' });
  }, 120000);

  test('consumes every accepted request key and conflicts on changed customer reuse', async () => {
    const customerId = await customer(fixture, fixture.org, 'existing-receipt');
    const otherCustomerId = await customer(fixture, fixture.org, 'existing-receipt-other');
    const admin = await authorize(fixture, fixture.actors.admin, customerId);
    const owner = await authorize(fixture, fixture.actors.owner, customerId);
    const otherOwner = await authorize(fixture, fixture.actors.owner, otherCustomerId);
    const candidate = await repository.candidate(fixture.runtimePool, readActor(admin), { customerId });
    const input = { customerId, expectedSourceDigest: candidate.sourceDigest,
      expectedSourceUpdatedAt: candidate.sourceUpdatedAt,
      reason: 'Create the accepted billing identity before receipt reuse.' };
    expect((await repository.establish(fixture.runtimePool, mutationActor(admin), input)).status).toBe(201);

    const key = crypto.randomUUID();
    const existing = await repository.establish(fixture.runtimePool, mutationActor(owner, key), input);
    expect(existing).toMatchObject({ status: 200, replayed: false,
      body: { state: 'established_unreviewed', customerId } });
    expect((await repository.establish(fixture.runtimePool, mutationActor(owner, key), input)))
      .toEqual({ status: 200, replayed: true, body: existing.body });
    const otherCandidate = await repository.candidate(fixture.runtimePool, readActor(otherOwner),
      { customerId: otherCustomerId });
    await expect(repository.establish(fixture.runtimePool, mutationActor(otherOwner, key), {
      customerId: otherCustomerId, expectedSourceDigest: otherCandidate.sourceDigest,
      expectedSourceUpdatedAt: otherCandidate.sourceUpdatedAt,
      reason: 'Changed customer reuse must conflict with the accepted receipt.',
    })).rejects.toMatchObject({ code: '23505' });
    expect((await fixture.ownerPool.query(
      'SELECT response_status FROM canonical_customer_financial_billing_identity_requests_v1 WHERE organization_id=$1 AND actor_user_id=$2 ORDER BY created_at',
      [fixture.org, owner.actorUserId])).rows.map(row => row.response_status)).toContain(200);
  }, 120000);

  test('replay re-evaluates current source and never exposes stale private values', async () => {
    const customerId = await customer(fixture, fixture.org, 'replay-currentness');
    const admin = await authorize(fixture, fixture.actors.admin, customerId);
    const candidate = await repository.candidate(fixture.runtimePool, readActor(admin), { customerId });
    const key = crypto.randomUUID(); const input = { customerId,
      expectedSourceDigest: candidate.sourceDigest,
      expectedSourceUpdatedAt: candidate.sourceUpdatedAt,
      reason: 'Persist source evidence before the canonical customer changes.' };
    const original = await repository.establish(fixture.runtimePool, mutationActor(admin, key), input);
    expect(original.body.value.name.value).toBe('Synthetic billing customer');
    await fixture.ownerPool.query(
      `UPDATE canonical_customers SET name='Private corrected value',email='private@changed.test',
        address='{"line1":"Private change"}',updated_at=updated_at+INTERVAL '1 second'
       WHERE organization_id=$1 AND id=$2`, [fixture.org, customerId]);
    const replay = await repository.establish(fixture.runtimePool, mutationActor(admin, key), input);
    expect(replay).toMatchObject({ status: 409, replayed: true,
      body: { state: 'unavailable', current: false,
        reason: 'billing_identity_source_changed_requires_review', value: null,
        sourceDigest: null, sourceUpdatedAt: null } });
    expect(JSON.stringify(replay)).not.toContain('Private corrected value');
    expect(JSON.stringify(replay)).not.toContain('private@changed.test');
    expect(JSON.stringify(replay)).not.toContain('Synthetic billing customer');
    expect(await repository.read(fixture.runtimePool, readActor(admin), { customerId })).toMatchObject({
      state: 'unavailable', current: false,
      reason: 'billing_identity_source_changed_requires_review', value: null });
    expect(await repository.establish(fixture.runtimePool, mutationActor(admin), input)).toMatchObject({
      status: 409, replayed: false,
      body: { state: 'unavailable', reason: 'billing_customer_source_changed', value: null } });
  }, 120000);

  test('keeps missing and malformed canonical source shapes value-free', async () => {
    const missingId = await customer(fixture, fixture.org, 'missing-contact',
      { email: null, phone: null, address: null });
    const missingActor = await authorize(fixture, fixture.actors.owner, missingId);
    const missing = await repository.candidate(fixture.runtimePool, readActor(missingActor),
      { customerId: missingId });
    expect(missing.value).toMatchObject({
      address: { state: 'unavailable', value: null, reason: 'source_value_missing' },
      contact: {
        email: { state: 'unavailable', value: null, reason: 'source_value_missing' },
        phone: { state: 'unavailable', value: null, reason: 'source_value_missing' },
      },
    });
    for (const [suffix, overrides] of [
      ['malformed-address', { address: ['invalid'] }],
      ['oversized-address', { address: { line1: 'x'.repeat(17000) } }],
    ]) {
      const customerId = await customer(fixture, fixture.org, suffix, overrides);
      const actor = await authorize(fixture, fixture.actors.owner, customerId);
      expect(await repository.candidate(fixture.runtimePool, readActor(actor), { customerId }))
        .toMatchObject({ state: 'unavailable', available: false,
          reason: 'billing_customer_source_shape_unavailable', value: null });
    }
    const futureId = await customer(fixture, fixture.org, 'future-source');
    const futureActor = await authorize(fixture, fixture.actors.owner, futureId);
    await fixture.ownerPool.query(
      "UPDATE canonical_customers SET updated_at=clock_timestamp()+INTERVAL '1 hour' WHERE organization_id=$1 AND id=$2",
      [fixture.org, futureId]);
    expect(await repository.candidate(fixture.runtimePool, readActor(futureActor), { customerId: futureId }))
      .toMatchObject({ state: 'unavailable', available: false,
        reason: 'billing_customer_source_shape_unavailable', value: null });
  }, 120000);

  test('serializes cancellation at effect time and rolls back identity creation', async () => {
    const customerId = await customer(fixture, fixture.org, 'cancellation-race');
    const owner = await authorize(fixture, fixture.actors.owner, customerId);
    const candidate = await repository.candidate(fixture.runtimePool, readActor(owner), { customerId });
    const input = { customerId, expectedSourceDigest: candidate.sourceDigest,
      expectedSourceUpdatedAt: candidate.sourceUpdatedAt,
      reason: 'Cancellation must win before any durable identity effect.' };
    const originalStatus = (await fixture.ownerPool.query(
      'SELECT status FROM subscriptions WHERE organization_id=$1', [fixture.org])).rows[0].status;
    const cancellation = await fixture.ownerPool.connect();
    try {
      await cancellation.query('BEGIN');
      await cancellation.query("UPDATE subscriptions SET status='canceled' WHERE organization_id=$1", [fixture.org]);
      let settled = false;
      const attempt = repository.establish(fixture.runtimePool, mutationActor(owner), input);
      attempt.then(() => { settled = true; }, () => { settled = true; });
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(settled).toBe(false);
      await cancellation.query('COMMIT');
      await expect(attempt).rejects.toMatchObject({ code: expect.stringMatching(/^(40001|42501)$/) });
    } finally {
      await cancellation.query('ROLLBACK').catch(() => {}); cancellation.release();
      await fixture.ownerPool.query('UPDATE subscriptions SET status=$2 WHERE organization_id=$1',
        [fixture.org, originalStatus]);
    }
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_customer_financial_billing_parties_v1 WHERE organization_id=$1 AND customer_id=$2',
      [fixture.org, customerId])).rows[0].count).toBe(0);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_customer_financial_billing_identity_requests_v1 WHERE organization_id=$1 AND customer_id=$2',
      [fixture.org, customerId])).rows[0].count).toBe(0);
  }, 120000);

  test('preserves concurrency, privacy, immutability and restart authority', async () => {
    const customerId = await customer(fixture, fixture.org, 'concurrent');
    const owner = await authorize(fixture, fixture.actors.owner, customerId);
    const candidate = await repository.candidate(fixture.runtimePool, readActor(owner), { customerId });
    const key = crypto.randomUUID(); const input = { customerId,
      expectedSourceDigest: candidate.sourceDigest,
      expectedSourceUpdatedAt: candidate.sourceUpdatedAt,
      reason: 'Establish one concurrent synthetic billing party.' };
    const attempts = await Promise.allSettled([
      repository.establish(fixture.runtimePool, mutationActor(owner, key), input),
      repository.establish(fixture.runtimePool, mutationActor(owner, key), input),
    ]);
    const successes = attempts.filter(result => result.status === 'fulfilled').map(result => result.value);
    const refusals = attempts.filter(result => result.status === 'rejected').map(result => result.reason);
    expect(successes.some(result => result.status === 201)).toBe(true);
    expect(refusals.every(error => ['40001','40P01'].includes(error.code))).toBe(true);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_customer_financial_billing_parties_v1 WHERE organization_id=$1 AND customer_id=$2',
      [fixture.org, customerId])).rows[0].count).toBe(1);

    for (const table of ['canonical_customer_financial_billing_capability_grants_v1',
      'canonical_customer_financial_billing_parties_v1',
      'canonical_customer_financial_billing_identity_snapshots_v1',
      'canonical_customer_financial_billing_identity_requests_v1']) {
      for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) {
        expect((await fixture.ownerPool.query(
          'SELECT has_table_privilege($1,$2,$3) allowed', [fixture.roles.runtime, table, privilege]
        )).rows[0].allowed).toBe(false);
      }
    }
    await expect(fixture.ownerPool.query(
      'DELETE FROM canonical_customer_financial_billing_capability_grants_v1')).rejects.toMatchObject({ code: '55000' });
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_customer_financial_billing_parties_v1 SET establishment_reason=establishment_reason')).rejects.toMatchObject({ code: '55000' });

    await fixture.db.close();
    expect(await fixture.db.initDatabase()).toBe(true);
    expect(fixture.db.readiness()).toEqual({ ready: true, failure: null });
    expect((await fixture.ownerPool.query(
      `SELECT has_function_privilege($1,
       'public.canonical_customer_financial_billing_identity_v1_establish(uuid,uuid,text,uuid,uuid,bigint,text,text,text,text,uuid,text,timestamp with time zone,text)',
       'EXECUTE') allowed`, [fixture.roles.runtime])).rows[0].allowed).toBe(true);
    expect((await fixture.ownerPool.query(
      "SELECT has_table_privilege($1,'public.canonical_customer_financial_billing_capability_grants_v1','SELECT') allowed",
      [fixture.roles.runtime])).rows[0].allowed).toBe(false);
  }, 120000);
});
