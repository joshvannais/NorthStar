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
const DEMO_ORIGIN = 'http://northstar.test';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const address = line1 => ({ line1, line2: null, city: 'Boston', region: 'MA',
  postalCode: '02108', countryCode: 'US' });

function cookie(response) { return response.headers['set-cookie'][0].split(';')[0]; }
function tokenHash(savedCookie) {
  const token = decodeURIComponent(savedCookie.slice(savedCookie.indexOf('=') + 1));
  return hash(token);
}
function demoAction(app, savedCookie, customerId, action, details, expectedRevision) {
  return request(app).post(`/api/demo/customer-financial/billing-identities/${customerId}/actions`)
    .set('Host', 'northstar.test').set('Origin', DEMO_ORIGIN)
    .set('Sec-Fetch-Site', 'same-origin').set('Cookie', savedCookie)
    .set('Idempotency-Key', crypto.randomUUID())
    .set('X-NorthStar-Demo-Intent', 'billing-identity-review')
    .send({ action, details, expectedRevision });
}
function demoReviewDetails(current, purchaseOrderReference) {
  const candidate = current.review.value;
  return { billingPartyId: current.review.billingPartyId,
    originSnapshotId: current.identity.snapshotId,
    expectedSourceDigest: current.review.sourceDigest,
    expectedSourceUpdatedAt: current.review.sourceUpdatedAt,
    expectedPreviousReviewId: current.review.reviewId,
    expectedPreviousReviewDigest: current.review.reviewDigest,
    expectedPreviousSequence: current.review.sequence,
    payload: { contact: { name: candidate.name, email: candidate.email, phone: candidate.phone },
      serviceAddress: candidate.serviceAddress,
      billingAddress: { ...candidate.serviceAddress, line1: '27 Fictional Billing Way' },
      purchaseOrderReference, customerReference: 'DEMO-CUSTOMER-27' },
    reason: 'Confirm this exact fictional billing identity for review-only evidence.' };
}
async function demoProtectedCounts(pool) {
  return (await pool.query(`SELECT
    (SELECT count(*)::int FROM canonical_customers) customers,
    (SELECT count(*)::int FROM canonical_customer_financial_billing_parties_v1) billing_parties,
    (SELECT count(*)::int FROM canonical_customer_financial_billing_identity_snapshots_v1) billing_snapshots,
    (SELECT count(*)::int FROM canonical_customer_financial_billing_identity_reviews_v1) billing_reviews,
    (SELECT count(*)::int FROM canonical_schedule_assignments) schedules,
    (SELECT count(*)::int FROM canonical_estimate_decisions) estimate_decisions`)).rows[0];
}

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

  test('persists the real mounted fictional demo lifecycle, restart and reset while denying unknown operations', async () => {
    const protectedBefore = await demoProtectedCounts(fixture.ownerPool);
    const workspace = await request(fixture.app).get('/api/demo/command-center')
      .set('Host', 'northstar.test');
    expect(workspace.status).toBe(200);
    const savedCookie = cookie(workspace);
    const customerId = workspace.body.data.graphs[0].ids.customer;
    const root = `/api/demo/customer-financial/billing-identities/${customerId}`;

    const initial = await request(fixture.app).get(root).set('Host', 'northstar.test')
      .set('Cookie', savedCookie);
    expect(initial.status).toBe(200);
    expect(initial.body.data).toMatchObject({ mode: 'isolated_fictional_demo',
      fictional: true, accountFree: true, resettable: true, demoWorkspaceRevision: 1,
      identity: { state: 'candidate_unreviewed', documentUseAuthorized: false },
      invoiceMutationCount: 0, paymentMutationCount: 0, providerCallCount: 0,
      customerCreationCount: 0 });

    const established = await demoAction(fixture.app, savedCookie, customerId, 'establish', {
      expectedSourceDigest: initial.body.data.identity.sourceDigest,
      expectedSourceUpdatedAt: initial.body.data.identity.sourceUpdatedAt,
      reason: 'Begin this exact fictional billing identity review.' }, 1);
    expect(established.status).toBe(201);
    expect(established.body.data).toMatchObject({ demoWorkspaceRevision: 2,
      identity: { state: 'established_unreviewed' },
      review: { state: 'review_required', sequence: 0, documentUseAuthorized: false } });

    const firstReview = await demoAction(fixture.app, savedCookie, customerId, 'review',
      demoReviewDetails(established.body.data, 'PO-FICTIONAL-ONE'), 2);
    expect(firstReview.status).toBe(201);
    expect(firstReview.body.data).toMatchObject({ demoWorkspaceRevision: 3,
      review: { state: 'reviewed_current', sequence: 1, documentUseAuthorized: true,
        value: { payload: { purchaseOrderReference: 'PO-FICTIONAL-ONE' } } },
      history: { total: 1 } });

    await fixture.db.close();
    expect(await fixture.db.initDatabase()).toBe(true);
    const restarted = await request(fixture.app).get(root).set('Host', 'northstar.test')
      .set('Cookie', savedCookie);
    expect(restarted.status).toBe(200);
    expect(restarted.body.data).toMatchObject({ demoWorkspaceRevision: 3,
      review: { state: 'reviewed_current', sequence: 1,
        value: { payload: { purchaseOrderReference: 'PO-FICTIONAL-ONE' } } } });

    const corrected = await demoAction(fixture.app, savedCookie, customerId, 'correct_source', {
      expectedSourceDigest: restarted.body.data.identity.sourceDigest,
      reason: 'Simulate one explicit fictional customer source correction.' }, 3);
    expect(corrected.status).toBe(201);
    expect(corrected.body.data).toMatchObject({ demoWorkspaceRevision: 4,
      identity: { state: 'unavailable', reason: 'billing_identity_source_changed_requires_review',
        documentUseAuthorized: false, value: null },
      review: { state: 'correction_required', sequence: 1, documentUseAuthorized: false } });

    const secondReview = await demoAction(fixture.app, savedCookie, customerId, 'review',
      demoReviewDetails(corrected.body.data, 'PO-FICTIONAL-TWO'), 4);
    expect(secondReview.status).toBe(201);
    expect(secondReview.body.data).toMatchObject({ demoWorkspaceRevision: 5,
      review: { state: 'reviewed_current', sequence: 2, documentUseAuthorized: true,
        value: { payload: { purchaseOrderReference: 'PO-FICTIONAL-TWO' } } },
      history: { total: 2, revisions: [{ sequence: 1 }, { sequence: 2 }] } });

    const invalid = await demoAction(fixture.app, savedCookie, customerId, 'unknown_operation', {}, 5);
    expect(invalid.status).toBe(400);
    const session = (await fixture.ownerPool.query(
      'SELECT id FROM demo_command_center_sessions WHERE token_hash=$1',
      [tokenHash(savedCookie)])).rows[0];
    await expect(fixture.ownerPool.query(
      `INSERT INTO demo_command_center_mutations(
        session_id,idempotency_hash,operation,request_digest,response_revision,response_digest)
       VALUES($1,$2,'unknown_action',$3,6,$4)`,
      [session.id, 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]))
      .rejects.toMatchObject({ code: '23514', constraint: 'demo_command_center_mutations_operation_check' });

    const reset = await request(fixture.app).post('/api/demo/command-center/reset')
      .set('Host', 'northstar.test').set('Origin', DEMO_ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin').set('Cookie', savedCookie)
      .set('Idempotency-Key', crypto.randomUUID()).set('X-NorthStar-Demo-Intent', 'reset')
      .send({ expectedRevision: 5 });
    expect(reset.status).toBe(200);
    const resetWorkspace = await request(fixture.app).get('/api/demo/command-center')
      .set('Host', 'northstar.test').set('Cookie', savedCookie);
    expect(resetWorkspace.status).toBe(200);
    const resetCustomerId = resetWorkspace.body.data.graphs[0].ids.customer;
    expect(resetCustomerId).not.toBe(customerId);
    const afterReset = await request(fixture.app)
      .get(`/api/demo/customer-financial/billing-identities/${resetCustomerId}`)
      .set('Host', 'northstar.test')
      .set('Cookie', savedCookie);
    expect(afterReset.status).toBe(200);
    expect(afterReset.body.data).toMatchObject({ demoWorkspaceRevision: 6,
      identity: { state: 'candidate_unreviewed' }, review: null, history: { total: 0 } });

    const operations = (await fixture.ownerPool.query(
      `SELECT mutation.operation FROM demo_command_center_mutations mutation
       JOIN demo_command_center_sessions session ON session.id=mutation.session_id
       WHERE session.token_hash=$1 ORDER BY mutation.created_at`, [tokenHash(savedCookie)]
    )).rows.map(row => row.operation);
    expect(operations).toEqual(['billing_identity','billing_identity','billing_identity',
      'billing_identity','reset']);
    expect(await demoProtectedCounts(fixture.ownerPool)).toEqual(protectedBefore);
  }, 120000);

  test('mounts a resettable fictional invoice preview without paid, provider, or money effects', async () => {
    const before=await demoProtectedCounts(fixture.ownerPool);
    const workspaceResponse=await request(fixture.app).get('/api/demo/command-center').set('Host','northstar.test');
    expect(workspaceResponse.status).toBe(200);const savedCookie=cookie(workspaceResponse);
    const estimateId=workspaceResponse.body.data.graphs[0].ids.estimate;
    const route=`/api/demo/customer-financial/invoice-drafts/${estimateId}/preview`;
    const first=await request(fixture.app).get(route).set('Host','northstar.test').set('Cookie',savedCookie);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({contractVersion:'m27-invoice-draft-preview-v1',state:'current',
      mode:'demo',fictional:true,sourceCurrent:true,taxAuthorityCurrent:false,amountDueCurrent:false,
      invoiceAuthorized:false,receivableAuthorized:false,issueAuthorized:false,providerCallCount:0,
      receiverMutationCount:0,documentPreview:{state:'review_required',fictional:true,
        issuedDocument:false,pdf:{state:'unavailable',value:null}},
      reconciliation:{amountDue:{state:'unavailable',value:null},browserArithmeticUsed:false}});
    expect(first.body.data.documentPreview.label).toContain('Fictional');
    expect(first.body.data.previewDigest).toMatch(/^[0-9a-f]{64}$/);
    const again=await request(fixture.app).get(route).set('Host','northstar.test').set('Cookie',savedCookie);
    expect(again.status).toBe(200);expect(again.body.data.previewDigest).toBe(first.body.data.previewDigest);
    const acceptanceRoute=`/api/demo/customer-financial/invoice-drafts/${estimateId}/part5-acceptance`;
    const acceptance=await request(fixture.app).get(acceptanceRoute)
      .set('Host','northstar.test').set('Cookie',savedCookie);
    expect(acceptance.status).toBe(200);
    expect(acceptance.body.data).toMatchObject({contractVersion:'m27-invoice-part5-preview-bundle-v1',
      preview:{contractVersion:'m27-invoice-draft-preview-v1',state:'current',mode:'demo',fictional:true},
      acceptance:{contractVersion:'m27-invoice-part5-acceptance-v1',
      state:'unavailable',reason:'invoice_issue_authority_unavailable',mode:'demo',fictional:true,
      exactCurrentnessRevalidated:true,approvalAuthorized:false,issueAuthorized:false,
      correctionAuthorized:false,providerCallCount:0,receiverMutationCount:0}});
    expect(acceptance.body.data.acceptance.lifecycle.axes).toHaveLength(7);
    expect(acceptance.body.data.acceptance.postIssueCorrection.records).toHaveLength(4);
    expect(acceptance.body.data.acceptance.previewWitness).toEqual({
      contractVersion:'m27-invoice-part5-preview-witness-v1',mode:'demo',
      draftRevision:acceptance.body.data.preview.draftIdentity.revision,
      draftDigest:acceptance.body.data.preview.draftIdentity.draftDigest,
      previewDigest:acceptance.body.data.preview.previewDigest});
    const acceptanceAgain=await request(fixture.app).get(acceptanceRoute)
      .set('Host','northstar.test').set('Cookie',savedCookie);
    expect(acceptanceAgain.body).toEqual(acceptance.body);
    const documentRoute=`/api/demo/customer-financial/invoice-drafts/${estimateId}/document`;
    const document=await request(fixture.app).get(documentRoute)
      .set('Host','northstar.test').set('Cookie',savedCookie);
    const documentAgain=await request(fixture.app).get(documentRoute)
      .set('Host','northstar.test').set('Cookie',savedCookie);
    expect(document.status).toBe(200);expect(documentAgain.body).toEqual(document.body);
    expect(document.headers['cache-control']).toBe('no-store');
    expect(document.body.data).toMatchObject({contractVersion:'m27-customer-invoice-document-v1',
      state:'unavailable',reason:'issued_invoice_unavailable',mode:'demo',fictional:true,value:null,
      exactCurrentnessRevalidated:true,issuedDocumentCurrent:false,
      customerSafeProjectionCurrent:false,htmlRenderingAuthorized:false,pdfRenderingAuthorized:false,
      downloadAuthorized:false,publicAccessAuthorized:false,deliveryAuthorized:false,
      privateFieldValuesExposed:false,thirdPartyContentIncluded:false,
      providerCallCount:0,receiverMutationCount:0,
      formats:{html:{state:'unavailable',value:null},pdf:{state:'unavailable',value:null}}});
    expect(JSON.stringify(document.body.data)).not.toMatch(
      /customerId|workId|minorUnits|currency|documentNumber|dueDate|invoiceDigest|receiptId|staff|margin|cost/);
    expect((await request(fixture.app).post(documentRoute)
      .set('Host','northstar.test').set('Cookie',savedCookie).send({confirmed:true})).status).toBe(404);
    const denied=await request(fixture.app).get('/api/demo/customer-financial/invoice-drafts/'+
      crypto.randomUUID()+'/preview').set('Host','northstar.test').set('Cookie',savedCookie);
    expect(denied.status).toBe(404);expect(JSON.stringify(denied.body)).not.toMatch(/minorUnits|customerPrice/);
    const documentDenied=await request(fixture.app).get('/api/demo/customer-financial/invoice-drafts/'+
      crypto.randomUUID()+'/document').set('Host','northstar.test').set('Cookie',savedCookie);
    expect(documentDenied.status).toBe(404);
    expect(JSON.stringify(documentDenied.body)).not.toMatch(/minorUnits|customerPrice|invoiceDigest|receiptId/);
    expect(await demoProtectedCounts(fixture.ownerPool)).toEqual(before);
  },120000);

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
