'use strict';

const crypto = require('node:crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const identityRepository = require('../../src/customerFinancial/billingIdentityRepository');
const reviewRepository = require('../../src/customerFinancial/billingIdentityReviewRepository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const address = (line1 = '1 Test Way') => ({ line1, line2: null, city: 'Boston', region: 'MA',
  postalCode: '02108', countryCode: 'US' });

async function customer(fixture, tenant, suffix, overrides = {}) {
  const operationId = crypto.randomUUID(); const graphId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  await fixture.ownerPool.query(
    `INSERT INTO canonical_operations(
      id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,state,
      lease_owner,lease_expires_at,result_status,result_body,completed_at)
     VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,$5::jsonb,NOW())`,
    [operationId, tenant, graphId, hash(`part2b:${suffix}`), JSON.stringify({})]);
  await fixture.ownerPool.query(
    `INSERT INTO canonical_customers(
      id,organization_id,operation_id,graph_id,external_customer_id,name,email,phone,address,
      created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$10)`,
    [customerId, tenant, operationId, graphId, `synthetic-${suffix}`,
      overrides.name ?? 'Synthetic billing customer',
      overrides.email === undefined ? 'billing@example.test' : overrides.email,
      overrides.phone === undefined ? '+15550109000' : overrides.phone,
      JSON.stringify(overrides.address ?? address()), '2026-10-10T12:00:00.000Z']);
  return customerId;
}
async function authorize(fixture, source, customerId, options = {}) {
  const grantId = options.grantId || crypto.randomUUID(); const revision = options.revision || 1;
  await fixture.ownerPool.query(
    `INSERT INTO canonical_customer_financial_billing_capability_grants_v1(
      organization_id,id,revision,actor_user_id,membership_id,customer_id,capability,
      business_purpose,policy_version,template_version,active,valid_from,expires_at,issued_at)
     VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,
      clock_timestamp()-INTERVAL '1 minute',clock_timestamp()+INTERVAL '1 hour',clock_timestamp())`,
    [source.organizationId, grantId, revision, source.actorUserId, customerId,
      identityRepository.CAPABILITY, identityRepository.BUSINESS_PURPOSE,
      identityRepository.POLICY_VERSION,
      source.actorAccessRole === 'owner' ? 'm27.owner.v1' : 'm27.admin.v1',
      options.active === undefined ? true : options.active]);
  return { organizationId: source.organizationId, actorUserId: source.actorUserId,
    actorAccessRole: source.actorAccessRole, authSessionId: source.authSessionId,
    capabilityGrantId: grantId, capabilityGrantRevision: revision,
    businessPurpose: identityRepository.BUSINESS_PURPOSE,
    policyVersion: identityRepository.POLICY_VERSION, csrfToken: source.csrfToken };
}
const mutationActor = (source, idempotencyKey = crypto.randomUUID()) => ({ ...source, idempotencyKey });
function readActor(source) {
  const { csrfToken: _csrfToken, idempotencyKey: _idempotencyKey, ...value } = source; return value;
}
async function establish(fixture, actor, customerId) {
  const candidate = await identityRepository.candidate(fixture.runtimePool, readActor(actor), { customerId });
  return identityRepository.establish(fixture.runtimePool, mutationActor(actor), {
    customerId, expectedSourceDigest: candidate.sourceDigest,
    expectedSourceUpdatedAt: candidate.sourceUpdatedAt,
    reason: 'Establish the exact synthetic billing identity for review.',
  });
}
function reviewInput(candidate, payload, reason = 'Review the exact synthetic billing destination.') {
  return { customerId: candidate.customerId, billingPartyId: candidate.billingPartyId,
    originSnapshotId: candidate.value.originSnapshotId,
    expectedSourceDigest: candidate.sourceDigest, expectedSourceUpdatedAt: candidate.sourceUpdatedAt,
    expectedPreviousReviewId: candidate.reviewId,
    expectedPreviousReviewDigest: candidate.reviewDigest,
    expectedPreviousSequence: candidate.sequence, payload, reason };
}
function reviewPayload(overrides = {}) {
  return { contact: { name: 'Synthetic billing customer', email: 'billing@example.test',
    phone: '+15550109000', ...overrides.contact },
  serviceAddress: overrides.serviceAddress || address(),
  billingAddress: overrides.billingAddress || address('2 Billing Way'),
  purchaseOrderReference: overrides.purchaseOrderReference === undefined ? 'PO-100' : overrides.purchaseOrderReference,
  customerReference: overrides.customerReference === undefined ? 'CUSTOMER-100' : overrides.customerReference };
}

realPostgres('Mission 27 Part 2B reviewed billing identity PostgreSQL authority', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('reviews exact contacts, addresses and references without creating a customer', async () => {
    const customerId = await customer(fixture, fixture.org, 'positive');
    const owner = await authorize(fixture, fixture.actors.owner, customerId);
    const customersBefore = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_customers')).rows[0].count);
    const identity = await establish(fixture, owner, customerId);
    const candidate = await reviewRepository.candidate(fixture.runtimePool, readActor(owner), { customerId });
    expect(candidate).toMatchObject({ state: 'review_required', customerId,
      billingPartyId: identity.body.billingPartyId, reviewId: null, sequence: 0,
      reviewState: 'unreviewed', documentUseAuthorized: false,
      automaticCustomerCreationAuthorized: false,
      value: { prospectIdentity: { state: 'unavailable', value: null,
        reason: 'canonical_prospect_source_unavailable' } } });
    const key = crypto.randomUUID(); const input = reviewInput(candidate, reviewPayload());
    const accepted = await reviewRepository.accept(fixture.runtimePool, mutationActor(owner, key), input);
    expect(accepted).toMatchObject({ status: 201, replayed: false,
      body: { state: 'reviewed_current', current: true, sequence: 1,
        reviewState: 'reviewed', documentUseAuthorized: true,
        automaticCustomerCreationAuthorized: false } });
    expect(accepted.body.value).toMatchObject({
      customerIdentity: { kind: 'canonical_customer', id: customerId },
      prospectIdentity: { state: 'unavailable', value: null,
        reason: 'canonical_prospect_source_unavailable' },
      billingContact: { name: { value: 'Synthetic billing customer',
        provenance: { class: 'canonical_customer.v1' } },
      email: { value: 'billing@example.test', provenance: { class: 'canonical_customer.v1' } } },
      serviceLocation: { address: { value: address(), provenance: { class: 'canonical_customer.v1' } } },
      billingAddress: { address: { value: address('2 Billing Way'),
        provenance: { class: 'owner_admin_review.v1' } } },
      references: { purchaseOrder: { value: 'PO-100',
        provenance: { class: 'owner_admin_review.v1' } } } });
    const replay = await reviewRepository.accept(fixture.runtimePool, mutationActor(owner, key), input);
    expect(replay).toEqual({ status: 200, replayed: true, body: accepted.body });
    expect(await reviewRepository.read(fixture.runtimePool, readActor(owner), { customerId }))
      .toEqual(accepted.body);
    expect(await reviewRepository.history(fixture.runtimePool, readActor(owner), { customerId }))
      .toMatchObject({ complete: true, total: 1,
        revisions: [{ reviewId: accepted.body.reviewId, sequence: 1, previousReviewId: null }] });
    expect(Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_customers')).rows[0].count)).toBe(customersBefore);
    expect((await fixture.ownerPool.query(
      "SELECT filename FROM _migrations WHERE filename LIKE '261\_%' ESCAPE '\\'"
    )).rows.map(row => row.filename)).toEqual(['261_customer_financial_billing_identity_review_v1.sql']);
  }, 120000);

  test('never reauthorizes a superseded human-only correction during replay concurrency', async () => {
    const customerId = await customer(fixture, fixture.org, 'superseded-replay');
    const owner = await authorize(fixture, fixture.actors.owner, customerId);
    await establish(fixture, owner, customerId);
    const firstCandidate = await reviewRepository.candidate(
      fixture.runtimePool, readActor(owner), { customerId });
    const firstKey = crypto.randomUUID();
    const firstInput = reviewInput(firstCandidate,
      reviewPayload({ purchaseOrderReference: 'PO-100' }));
    const first = await reviewRepository.accept(
      fixture.runtimePool, mutationActor(owner, firstKey), firstInput);
    const correctionCandidate = await reviewRepository.candidate(
      fixture.runtimePool, readActor(owner), { customerId });
    expect(correctionCandidate).toMatchObject({ state: 'correction_required', sequence: 1,
      sourceDigest: first.body.sourceDigest, sourceUpdatedAt: first.body.sourceUpdatedAt });
    const correctionKey = crypto.randomUUID();
    const correctionInput = reviewInput(correctionCandidate,
      reviewPayload({ purchaseOrderReference: 'PO-200' }),
      'Correct only the human-reviewed purchase order reference.');

    const blocker = await fixture.ownerPool.connect();
    let replayAttempt;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${fixture.org}:billing-review-request:${owner.actorUserId}:${owner.authSessionId}:${hash(firstKey)}`,
      ]);
      let replaySettled = false;
      replayAttempt = reviewRepository.accept(
        fixture.runtimePool, mutationActor(owner, firstKey), firstInput);
      replayAttempt.then(() => { replaySettled = true; }, () => { replaySettled = true; });
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(replaySettled).toBe(false);

      const correction = await reviewRepository.accept(
        fixture.runtimePool, mutationActor(owner, correctionKey), correctionInput);
      expect(correction).toMatchObject({ status: 201,
        body: { sequence: 2, value: { references: { purchaseOrder: { value: 'PO-200' } } } } });
      await blocker.query('COMMIT');

      const obsoleteReplay = await replayAttempt;
      expect(obsoleteReplay).toMatchObject({ status: 409, replayed: true,
        body: { state: 'unavailable', current: false,
          reason: 'billing_identity_review_superseded', value: null,
          sourceDigest: null, sourceUpdatedAt: null, reviewDigest: null,
          documentUseAuthorized: false } });
      expect(JSON.stringify(obsoleteReplay)).not.toContain('PO-100');
      const current = await reviewRepository.read(
        fixture.runtimePool, readActor(owner), { customerId });
      expect(current).toMatchObject({ state: 'reviewed_current', sequence: 2,
        value: { references: { purchaseOrder: { value: 'PO-200' } } } });
      const currentReplay = await reviewRepository.accept(
        fixture.runtimePool, mutationActor(owner, correctionKey), correctionInput);
      expect(currentReplay).toMatchObject({ status: 200, replayed: true,
        body: { state: 'reviewed_current', sequence: 2,
          value: { references: { purchaseOrder: { value: 'PO-200' } } } } });
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
      if (replayAttempt) await replayAttempt.catch(() => {});
    }
  }, 120000);

  test('makes changed source value-free and appends one exact correction lineage', async () => {
    const customerId = await customer(fixture, fixture.org, 'correction');
    const admin = await authorize(fixture, fixture.actors.admin, customerId);
    await establish(fixture, admin, customerId);
    const firstCandidate = await reviewRepository.candidate(fixture.runtimePool, readActor(admin), { customerId });
    const firstKey = crypto.randomUUID(); const firstInput = reviewInput(firstCandidate, reviewPayload());
    const first = await reviewRepository.accept(fixture.runtimePool, mutationActor(admin, firstKey), firstInput);
    const stableIds = { contact: first.body.value.billingContact.id,
      service: first.body.value.serviceLocation.id, billing: first.body.value.billingAddress.id };
    await fixture.ownerPool.query(
      `UPDATE canonical_customers SET name='Corrected customer',email='corrected@example.test',
        address=$3::jsonb,updated_at=updated_at+INTERVAL '1 second'
       WHERE organization_id=$1 AND id=$2`, [fixture.org, customerId, JSON.stringify(address('3 Corrected Way'))]);
    const stale = await reviewRepository.read(fixture.runtimePool, readActor(admin), { customerId });
    expect(stale).toMatchObject({ state: 'unavailable', current: false,
      reason: 'billing_identity_review_source_changed', value: null,
      sourceDigest: null, sourceUpdatedAt: null, reviewDigest: null });
    expect(JSON.stringify(stale)).not.toContain('billing@example.test');
    expect((await reviewRepository.accept(fixture.runtimePool, mutationActor(admin, firstKey), firstInput)))
      .toMatchObject({ status: 409, replayed: true,
        body: { reason: 'billing_identity_review_source_changed', value: null } });
    const correctionCandidate = await reviewRepository.candidate(
      fixture.runtimePool, readActor(admin), { customerId });
    expect(correctionCandidate).toMatchObject({ state: 'correction_required', sequence: 1,
      reviewId: first.body.reviewId, reviewDigest: first.body.reviewDigest,
      value: { name: 'Corrected customer', email: 'corrected@example.test' } });
    const correctionInput = reviewInput(correctionCandidate, reviewPayload({
      contact: { name: 'Corrected customer', email: 'corrected@example.test' },
      serviceAddress: address('3 Corrected Way'), purchaseOrderReference: 'PO-101' }),
    'Correct the reviewed identity after the canonical source changed.');
    const second = await reviewRepository.accept(fixture.runtimePool, mutationActor(admin), correctionInput);
    expect(second).toMatchObject({ status: 201, body: { sequence: 2,
      value: { previousReviewId: first.body.reviewId,
        previousReviewDigest: first.body.reviewDigest } } });
    expect(second.body.value.billingContact.id).toBe(stableIds.contact);
    expect(second.body.value.serviceLocation.id).toBe(stableIds.service);
    expect(second.body.value.billingAddress.id).toBe(stableIds.billing);
    const lineage = await reviewRepository.history(fixture.runtimePool, readActor(admin), { customerId });
    expect(lineage).toMatchObject({ total: 2, revisions: [
      { reviewId: first.body.reviewId, sequence: 1, previousReviewId: null },
      { reviewId: second.body.reviewId, sequence: 2, previousReviewId: first.body.reviewId },
    ] });
    const conflict = await reviewRepository.accept(fixture.runtimePool, mutationActor(admin), correctionInput);
    expect(conflict).toMatchObject({ status: 409, replayed: false,
      body: { reason: 'billing_identity_review_conflict', value: null } });
  }, 120000);

  test('fails closed for missing identity, authority, malformed payload and changed key reuse', async () => {
    const customerId = await customer(fixture, fixture.org, 'boundaries');
    const secondCustomerId = await customer(fixture, fixture.org, 'boundaries-second');
    const otherCustomerId = await customer(fixture, fixture.otherOrg, 'boundaries-other');
    const owner = await authorize(fixture, fixture.actors.owner, customerId);
    const otherOwner = await authorize(fixture, fixture.actors.otherOwner, otherCustomerId);
    expect(await reviewRepository.candidate(fixture.runtimePool, readActor(owner), { customerId }))
      .toMatchObject({ state: 'unavailable', reason: 'billing_identity_not_established', value: null });
    await establish(fixture, owner, customerId);
    const candidate = await reviewRepository.candidate(fixture.runtimePool, readActor(owner), { customerId });
    expect((await fixture.ownerPool.query(
      "SELECT public.canonical_customer_financial_billing_review_v1_payload_valid('[]'::jsonb) valid"
    )).rows[0].valid).toBe(false);
    expect((await fixture.ownerPool.query(
      "SELECT public.canonical_customer_financial_billing_review_v1_payload_valid('{\"contact\":[]}'::jsonb) valid"
    )).rows[0].valid).toBe(false);
    await expect(reviewRepository.candidate(fixture.runtimePool,
      readActor({ ...owner, capabilityGrantId: crypto.randomUUID() }), { customerId }))
      .rejects.toMatchObject({ code: '42501' });
    await expect(reviewRepository.candidate(fixture.runtimePool, readActor(owner),
      { customerId: secondCustomerId })).rejects.toMatchObject({ code: '42501' });
    await expect(reviewRepository.candidate(fixture.runtimePool, readActor(otherOwner),
      { customerId })).rejects.toMatchObject({ code: '42501' });
    await expect(reviewRepository.candidate(fixture.runtimePool, {
      ...readActor(owner), actorUserId: fixture.actors.member.actorUserId,
      actorAccessRole: 'member', authSessionId: fixture.actors.member.authSessionId,
    }, { customerId })).rejects.toMatchObject({
      code: 'CUSTOMER_FINANCIAL_BILLING_REVIEW_RESTRICTED',
    });
    await expect(reviewRepository.accept(fixture.runtimePool, mutationActor(owner),
      { ...reviewInput(candidate, reviewPayload()), payload: reviewPayload({
        serviceAddress: { ...address(), countryCode: 'CA' } }) }))
      .rejects.toMatchObject({ code: 'CUSTOMER_FINANCIAL_BILLING_REVIEW_INVALID' });
    const key = crypto.randomUUID(); const input = reviewInput(candidate, reviewPayload());
    await reviewRepository.accept(fixture.runtimePool, mutationActor(owner, key), input);
    await expect(reviewRepository.accept(fixture.runtimePool, mutationActor(owner, key), {
      ...input, payload: reviewPayload({ purchaseOrderReference: 'PO-DIFFERENT' })
    })).rejects.toMatchObject({ code: '23505' });
    await authorize(fixture, fixture.actors.owner, customerId,
      { grantId: owner.capabilityGrantId, revision: 2 });
    await expect(reviewRepository.read(fixture.runtimePool, readActor(owner), { customerId }))
      .rejects.toMatchObject({ code: '42501' });
  }, 120000);

  test('serializes subscription cancellation before any reviewed identity effect', async () => {
    const customerId = await customer(fixture, fixture.org, 'cancellation');
    const owner = await authorize(fixture, fixture.actors.owner, customerId);
    await establish(fixture, owner, customerId);
    const candidate = await reviewRepository.candidate(fixture.runtimePool, readActor(owner), { customerId });
    const input = reviewInput(candidate, reviewPayload());
    const originalStatus = (await fixture.ownerPool.query(
      'SELECT status FROM subscriptions WHERE organization_id=$1', [fixture.org])).rows[0].status;
    const cancellation = await fixture.ownerPool.connect();
    try {
      await cancellation.query('BEGIN');
      await cancellation.query("UPDATE subscriptions SET status='canceled' WHERE organization_id=$1", [fixture.org]);
      let settled = false;
      const attempt = reviewRepository.accept(fixture.runtimePool, mutationActor(owner), input);
      attempt.then(() => { settled = true; }, () => { settled = true; });
      await new Promise(resolve => setTimeout(resolve, 250)); expect(settled).toBe(false);
      await cancellation.query('COMMIT');
      await expect(attempt).rejects.toMatchObject({ code: expect.stringMatching(/^(40001|42501)$/) });
    } finally {
      await cancellation.query('ROLLBACK').catch(() => {}); cancellation.release();
      await fixture.ownerPool.query('UPDATE subscriptions SET status=$2 WHERE organization_id=$1',
        [fixture.org, originalStatus]);
    }
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_customer_financial_billing_identity_reviews_v1 WHERE organization_id=$1 AND customer_id=$2',
      [fixture.org, customerId])).rows[0].count).toBe(0);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_customer_financial_billing_review_requests_v1 WHERE organization_id=$1 AND customer_id=$2',
      [fixture.org, customerId])).rows[0].count).toBe(0);
  }, 120000);

  test('preserves concurrency, immutability, runtime privacy and restart authority', async () => {
    const customerId = await customer(fixture, fixture.org, 'concurrency');
    const owner = await authorize(fixture, fixture.actors.owner, customerId);
    await establish(fixture, owner, customerId);
    const candidate = await reviewRepository.candidate(fixture.runtimePool, readActor(owner), { customerId });
    const key = crypto.randomUUID(); const input = reviewInput(candidate, reviewPayload());
    const attempts = await Promise.allSettled([
      reviewRepository.accept(fixture.runtimePool, mutationActor(owner, key), input),
      reviewRepository.accept(fixture.runtimePool, mutationActor(owner, key), input),
    ]);
    expect(attempts.filter(result => result.status === 'fulfilled')
      .some(result => result.value.status === 201)).toBe(true);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_customer_financial_billing_identity_reviews_v1 WHERE organization_id=$1 AND customer_id=$2',
      [fixture.org, customerId])).rows[0].count).toBe(1);
    for (const table of ['canonical_customer_financial_billing_identity_reviews_v1',
      'canonical_customer_financial_billing_review_requests_v1']) {
      for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) {
        expect((await fixture.ownerPool.query('SELECT has_table_privilege($1,$2,$3) allowed',
          [fixture.roles.runtime, table, privilege])).rows[0].allowed).toBe(false);
      }
    }
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_customer_financial_billing_identity_reviews_v1 SET correction_reason=correction_reason'))
      .rejects.toMatchObject({ code: '55000' });
    expect((await fixture.ownerPool.query(
      `SELECT has_function_privilege($1,
       'public.canonical_customer_financial_billing_review_v1_accept(uuid,uuid,text,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,text,timestamp with time zone,uuid,text,integer,jsonb,text)',
       'EXECUTE') allowed`, [fixture.roles.runtime])).rows[0].allowed).toBe(true);
    expect((await fixture.ownerPool.query(
      "SELECT has_function_privilege($1,'public.canonical_customer_financial_billing_review_v1_snapshot(public.canonical_customers,public.canonical_customer_financial_billing_parties_v1,public.canonical_customer_financial_billing_identity_snapshots_v1,public.canonical_customer_financial_billing_identity_reviews_v1,uuid,integer,uuid,uuid,uuid,jsonb,uuid,text,uuid,uuid,uuid,bigint,text,text,text,timestamp with time zone)','EXECUTE') allowed",
      [fixture.roles.runtime])).rows[0].allowed).toBe(false);
    await fixture.db.close(); expect(await fixture.db.initDatabase()).toBe(true);
    expect(fixture.db.readiness()).toEqual({ ready: true, failure: null });
    expect(await reviewRepository.read(fixture.runtimePool, readActor(owner), { customerId }))
      .toMatchObject({ state: 'reviewed_current', sequence: 1 });
  }, 120000);
});
