'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const repository = require('../../src/customerFinancial/billingIdentityJourneyRepository');
const identity = require('../../src/customerFinancial/billingIdentityRepository');
const { createCustomerFinancialBillingIdentityRouter } =
  require('../../src/routes/customerFinancialBillingIdentity');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const address = line1 => ({ line1, line2: null, city: 'Boston', region: 'MA',
  postalCode: '02108', countryCode: 'US' });

async function customer(fixture, tenant, suffix) {
  const operationId = crypto.randomUUID(); const graphId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  await fixture.ownerPool.query(
    `INSERT INTO canonical_operations(
      id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,
      lease_owner,lease_expires_at,result_status,result_body,completed_at)
     VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
    [operationId, tenant, graphId, hash(`part2d:${suffix}`)]);
  await fixture.ownerPool.query(
    `INSERT INTO canonical_customers(
      id,organization_id,operation_id,graph_id,external_customer_id,name,email,phone,address,
      created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$10)`,
    [customerId, tenant, operationId, graphId, `synthetic-${suffix}`,
      'Synthetic mounted billing customer', 'billing@example.test', '+15550109000',
      JSON.stringify(address('1 Source Way')), '2026-10-10T12:00:00.000Z']);
  return customerId;
}
async function grant(fixture, actor, customerId, options = {}) {
  const grantId = options.grantId || crypto.randomUUID();
  const revision = options.revision || 1;
  await fixture.ownerPool.query(
    `INSERT INTO canonical_customer_financial_billing_capability_grants_v1(
      organization_id,id,revision,actor_user_id,membership_id,customer_id,capability,
      business_purpose,policy_version,template_version,active,valid_from,expires_at,issued_at)
     VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,TRUE,
      clock_timestamp()-INTERVAL '1 minute',clock_timestamp()+INTERVAL '1 hour',clock_timestamp())`,
    [actor.organizationId, grantId, revision, actor.actorUserId, customerId,
      identity.CAPABILITY, identity.BUSINESS_PURPOSE, identity.POLICY_VERSION,
      actor.actorAccessRole === 'owner' ? 'm27.owner.v1' : 'm27.admin.v1']);
  return { grantId, revision };
}
function actorSource(actor, mutation) {
  return { organizationId: actor.organizationId, actorUserId: actor.actorUserId,
    actorAccessRole: actor.actorAccessRole, authSessionId: actor.authSessionId,
    ...(mutation ? { csrfToken: actor.csrfToken } : {}) };
}
function reviewBody(current) {
  const candidate = current.review.value;
  return { billingPartyId: current.review.billingPartyId,
    originSnapshotId: current.identity.snapshotId,
    expectedSourceDigest: current.review.sourceDigest,
    expectedSourceUpdatedAt: current.review.sourceUpdatedAt,
    expectedPreviousReviewId: current.review.reviewId,
    expectedPreviousReviewDigest: current.review.reviewDigest,
    expectedPreviousSequence: current.review.sequence,
    payload: { contact: { name: candidate.name,
      email: candidate.email, phone: candidate.phone },
    serviceAddress: candidate.unclassifiedAddress,
    billingAddress: address('2 Reviewed Billing Way'),
    purchaseOrderReference: 'PO-MOUNTED-27', customerReference: 'CUSTOMER-MOUNTED-27' },
    reason: 'Review the exact synthetic mounted billing identity.' };
}

realPostgres('Mission 27 Part 2D mounted billing identity PostgreSQL acceptance', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('resolves capability only server-side and mounts the exact establish-review-read journey', async () => {
    const customerId = await customer(fixture, fixture.org, 'positive');
    await grant(fixture, fixture.actors.owner, customerId);
    const customersBefore = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_customers')).rows[0].count);
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => {
      req.tenantContext = { organizationId: fixture.org, userId: fixture.actors.owner.actorUserId };
      req.userRole = 'owner'; req.authSession = { id: fixture.actors.owner.authSessionId }; next();
    });
    app.use('/billing', createCustomerFinancialBillingIdentityRouter({
      poolProvider: () => fixture.runtimePool, auth: (_req, _res, next) => next(),
      role: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));

    const initial = await request(app).get(`/billing/${customerId}`);
    expect(initial.status).toBe(200);
    expect(initial.body.data).toMatchObject({ mode: 'paid_tenant', fictional: false,
      identity: { state: 'candidate_unreviewed', documentUseAuthorized: false },
      review: null, invoiceMutationCount: 0, paymentMutationCount: 0,
      providerCallCount: 0, customerCreationCount: 0 });
    const established = await request(app).post(`/billing/${customerId}/establish`)
      .set('X-CSRF-Token', fixture.actors.owner.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send({
        expectedSourceDigest: initial.body.data.identity.sourceDigest,
        expectedSourceUpdatedAt: initial.body.data.identity.sourceUpdatedAt,
        reason: 'Establish the exact current mounted billing identity.' });
    expect(established.status).toBe(201);
    expect(established.body.data).toMatchObject({ state: 'established_unreviewed',
      documentUseAuthorized: false });
    const pending = (await request(app).get(`/billing/${customerId}`)).body.data;
    expect(pending.review).toMatchObject({ state: 'review_required', sequence: 0,
      documentUseAuthorized: false });
    const accepted = await request(app).post(`/billing/${customerId}/reviews`)
      .set('X-CSRF-Token', fixture.actors.owner.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID()).send(reviewBody(pending));
    expect(accepted.status).toBe(201);
    expect(accepted.body.data).toMatchObject({ state: 'reviewed_current', sequence: 1,
      documentUseAuthorized: true });
    const current = (await request(app).get(`/billing/${customerId}`)).body.data;
    expect(current).toMatchObject({ review: { state: 'reviewed_current', sequence: 1,
      value: { references: { purchaseOrder: { value: 'PO-MOUNTED-27' } } } },
    history: { complete: true, total: 1, revisions: [{ sequence: 1 }] },
    invoiceMutationCount: 0, paymentMutationCount: 0, providerCallCount: 0,
    customerCreationCount: 0 });
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_customers')).rows[0].count)).toBe(customersBefore);
  }, 120000);

  test('fails value-free for absent, ambiguous, wrong-tenant, stale-session and member authority', async () => {
    const noGrantCustomer = await customer(fixture, fixture.org, 'no-grant');
    await expect(repository.current(fixture.runtimePool,
      actorSource(fixture.actors.owner, false), noGrantCustomer)).rejects.toMatchObject({ code: '42501' });

    const ambiguous = await customer(fixture, fixture.org, 'ambiguous');
    await grant(fixture, fixture.actors.admin, ambiguous);
    await grant(fixture, fixture.actors.admin, ambiguous);
    await expect(repository.current(fixture.runtimePool,
      actorSource(fixture.actors.admin, false), ambiguous)).rejects.toMatchObject({ code: '42501' });

    const foreign = await customer(fixture, fixture.otherOrg, 'foreign');
    await expect(repository.current(fixture.runtimePool,
      actorSource(fixture.actors.owner, false), foreign)).rejects.toMatchObject({ code: '42501' });
    await expect(repository.current(fixture.runtimePool,
      actorSource(fixture.actors.member, false), noGrantCustomer)).rejects.toMatchObject({
      code: 'CUSTOMER_FINANCIAL_BILLING_JOURNEY_RESTRICTED' });
    await expect(repository.current(fixture.runtimePool, {
      ...actorSource(fixture.actors.owner, false), authSessionId: crypto.randomUUID(),
    }, noGrantCustomer)).rejects.toMatchObject({ code: '42501' });
  }, 120000);

  test('keeps source correction value-free until another explicit review', async () => {
    const customerId = await customer(fixture, fixture.org, 'correction');
    await grant(fixture, fixture.actors.admin, customerId);
    const readActor = actorSource(fixture.actors.admin, false);
    const writeActor = actorSource(fixture.actors.admin, true);
    const candidate = await repository.current(fixture.runtimePool, readActor, customerId);
    await repository.establish(fixture.runtimePool, writeActor, {
      customerId, expectedSourceDigest: candidate.identity.sourceDigest,
      expectedSourceUpdatedAt: candidate.identity.sourceUpdatedAt,
      reason: 'Establish current correction-test billing evidence.',
    }, crypto.randomUUID());
    const pending = await repository.current(fixture.runtimePool, readActor, customerId);
    await repository.accept(fixture.runtimePool, writeActor,
      { customerId, ...reviewBody(pending) }, crypto.randomUUID());
    await fixture.ownerPool.query(
      `UPDATE canonical_customers SET name='Corrected private billing source',
        address=$3::jsonb,updated_at=updated_at+INTERVAL '1 second'
       WHERE organization_id=$1 AND id=$2`, [fixture.org, customerId,
        JSON.stringify(address('3 Corrected Source Way'))]);
    const changed = await repository.current(fixture.runtimePool, readActor, customerId);
    expect(changed).toMatchObject({ identity: { state: 'unavailable', current: false,
      reason: 'billing_identity_source_changed_requires_review', value: null },
    review: { state: 'correction_required', current: true, sequence: 1,
      documentUseAuthorized: false }, history: { total: 1 } });
    expect(JSON.stringify(changed.identity)).not.toContain('Corrected private billing source');
  }, 120000);

  test('installs only the scoped resolver and keeps runtime away from private tables', async () => {
    expect((await fixture.ownerPool.query(
      "SELECT filename FROM _migrations WHERE filename LIKE '263\\_%' ESCAPE '\\'"
    )).rows.map(row => row.filename)).toEqual([
      '263_customer_financial_billing_journey_v1.sql',
    ]);
    const functionPrivilege = (await fixture.ownerPool.query(
      `SELECT has_function_privilege($1,
       'public.canonical_customer_financial_billing_journey_v1_authority(uuid,uuid,text,uuid,text,boolean,uuid)',
       'EXECUTE') allowed`, [fixture.roles.runtime])).rows[0].allowed;
    expect(functionPrivilege).toBe(true);
    for (const table of ['canonical_customer_financial_billing_capability_grants_v1',
      'canonical_customer_financial_billing_parties_v1',
      'canonical_customer_financial_billing_identity_snapshots_v1',
      'canonical_customer_financial_billing_identity_reviews_v1']) {
      await expect(fixture.runtimePool.query(`SELECT * FROM ${table} LIMIT 1`))
        .rejects.toMatchObject({ code: '42501' });
    }
  }, 120000);
});
