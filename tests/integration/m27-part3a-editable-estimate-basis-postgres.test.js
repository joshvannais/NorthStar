'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const commercial = require('../../src/estimating/commercialContract');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');
const { fixture: pricingFixture } = require('../helpers/m24-pricing-input');
const { issueEditableEstimateGrant } =
  require('../../src/customerFinancial/estimateCapabilityGrantIssuer');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const priceRoot = '/api/v1/forecast/price-history';

realPostgres('Mission 27 Part 3A current commercial editable basis', () => {
  let f; let estimate; let route; let actor; let reviewId;
  beforeAll(async () => {
    f = await createEstimateReviewFixture(); actor = f.actors.owner;
    estimate = f.estimateGraphs[0].ids.estimate;
    route = `/api/v1/customer-financial/editable-estimates/${estimate}/basis`;
  }, 120000);
  afterAll(async () => { if (f) await f.cleanup(); }, 120000);

  async function createCurrentCommercialLineage() {
    const estimateRoute = `/api/v1/canonical/estimates/${estimate}`;
    const get = suffix => request(f.app).get(estimateRoute + suffix).set(actor.session.headers);
    const post = (suffix, body) => request(f.app).post(estimateRoute + suffix)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(body);
    expect((await request(f.app).post(`${priceRoot}/ordered-snapshots`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({})).status).toBe(201);
    expect((await request(f.app).post(`${priceRoot}/ordered-anchor/activate`)
      .set(actor.session.headers).send({})).status).toBe(200);
    let review = (await get('/review')).body.data;
    expect((await post('/pricing-plans', { action: 'save', expectedRevision: 0,
      expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: pricingFixture(review.pricingPlans.serviceKey), currency: review.currency,
      reason: 'Synthetic Part 3A pricing source', confirmed: true,
      confirmationVersion: review.pricingPlans.contract,
      evidenceDigest: review.pricingPlans.sources.digest })).status).toBe(201);
    review = (await get('/review')).body.data;
    const terms = review.commercialTerms; const inputs = commercialFixture().value;
    inputs.version = terms.contract;
    inputs.jobApplicability = { serviceOperation: 'fence_installation', propertyUse: 'residential',
      workContext: 'new_construction', customerExemption: 'none',
      evidenceRef: { serviceOperation: 'Reviewed scope', propertyUse: 'Recorded property',
        workContext: 'Reviewed scope', customerExemption: 'Customer statement' } };
    inputs.transactionDate = terms.sources.asOfDate; inputs.taxGroups = [group(['installation'])];
    inputs.taxGroups[0].source.serviceKey = terms.sources.serviceKey;
    Object.assign(inputs.taxGroups[0].source, { legalEffectiveOn: inputs.taxGroups[0].source.effectiveOn,
      legalEndsOn: null, reviewedOn: terms.sources.asOfDate,
      reviewValidThrough: terms.sources.asOfDate });
    delete inputs.taxGroups[0].source.effectiveOn; delete inputs.taxGroups[0].source.endsOn;
    expect((await post('/commercial-terms', { action: 'save', expectedRevision: 0,
      expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: terms.decisionBasis.revision,
      expectedDecisionDigest: terms.decisionBasis.digest, inputs, currency: review.currency,
      reason: 'Synthetic Part 3A current commercial terms', confirmed: true,
      confirmationVersion: terms.contract, evidenceDigest: terms.sources.digest })).status).toBe(201);
    review = (await get('/review')).body.data;
    expect((await post('/commercial-approvals', {
      termsPin: commercial.pin(review.commercialTerms.current),
      evidenceDigest: review.commercialTerms.sources.digest,
      expectedDecisionRevision: review.commercialTerms.decisionBasis.revision,
      expectedDecisionDigest: review.commercialTerms.decisionBasis.digest,
      scopeSummary: 'Install the recorded cedar fence and complete reviewed work.',
      reason: 'Synthetic Part 3A approved commercial scope', confirmed: true,
      confirmationVersion: review.commercialTerms.contract,
      exceptions: { policyReason: '', policyUnknownAcknowledged: true,
        ownerRecordedTaxAcknowledged: true } })).status).toBe(201);
    const issued = await post('/customer-estimate-versions', {
      reason: 'Synthetic Part 3A issued customer estimate', confirmed: true,
      confirmationVersion: 'customer-estimate-issue-v1' });
    expect(issued.status).toBe(201);
    const link = await post('/customer-estimate-links', { versionId: issued.body.data.receipt.id,
      expiresInDays: 14, confirmed: true,
      confirmationVersion: 'customer-estimate-delivery-v1' });
    expect(link.status).toBe(201);
    const token = decodeURIComponent(link.body.data.urlPath.split('/').pop());
    expect((await request(f.app).post(`/api/public/customer-estimates/${token}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', crypto.randomUUID()).send({ customerName: 'Taylor Customer',
        confirmed: true, confirmationVersion: 'customer-estimate-accept-v1' })).status).toBe(201);
    const appointment = f.estimateGraphs[0].ids.appointment;
    const before = (await f.ownerPool.query(
      'SELECT revision,rtrim(canonical_digest) digest,appointment_status FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2',
      [f.org, appointment])).rows[0];
    const preview = await request(f.app)
      .post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
      .set(actor.session.headers).send({ expectedRevision: Number(before.revision),
        expectedDigest: before.digest, expectedTimeZone: 'UTC', action: 'schedule',
        target: { kind: 'unassigned', id: null }, scheduledStart: '2029-06-12T13:00:00.000Z',
        scheduledEnd: '2029-06-12T14:00:00.000Z', appointmentStatus: before.appointment_status,
        reason: 'Match Part 3A synthetic accepted estimate to appointment' });
    expect(preview.status).toBe(201);
    const schedule = await request(f.app)
      .post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({
        previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
        reason: 'Match Part 3A synthetic accepted estimate to appointment' });
    expect(schedule.status).toBe(200);
    const approvalId = (await f.ownerPool.query(
      'SELECT id FROM canonical_schedule_human_approvals WHERE organization_id=$1 AND appointment_id=$2 ORDER BY approved_at DESC LIMIT 1',
      [f.org, appointment])).rows[0].id;
    const booking = await request(f.app).post('/api/v1/forecast/booking-reviews/first')
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({
        approvalId, reason: 'Human reviewed the Part 3A accepted and scheduled work.' });
    expect(booking.status).toBe(201); reviewId = booking.body.data.reviewId;
  }

  test('real mounted route is capability-gated, current, value-free on stale evidence, and restart-safe', async () => {
    await createCurrentCommercialLineage();
    expect((await request(f.app).get(route).set(actor.session.headers)).status).toBe(403);
    const grantSource = { organizationId: f.org,
      actorUserId: actor.actorUserId, membershipId: actor.actorUserId,
      actorAccessRole: actor.actorAccessRole };
    const grant = await issueEditableEstimateGrant(f.ownerPool, grantSource, estimate);
    const response = await request(f.app).get(route).set(actor.session.headers);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.data).toMatchObject({ contractVersion: 'm27-polaris-editable-estimate-v1',
      mode: 'paid_tenant', estimate: { id: estimate }, providerCallCount: 0,
      receiverMutationCount: 0, browserArithmeticUsed: false,
      currentness: { current: true }, booking: { reviewId },
      intakeSources: { phone: { state: 'unavailable', value: null },
        photo: { state: 'unavailable', value: null },
        extraction: { state: 'unavailable', value: null } } });
    expect(response.body.data.options).toHaveLength(1);
    expect(response.body.data.options[0].lines.length).toBeGreaterThan(0);
    expect((await request(f.app).get(route).set(f.actors.member.session.headers)).status).toBe(403);
    expect((await request(f.app).get(route).set(f.actors.otherOwner.session.headers)).status).toBe(403);
    const snapshot = JSON.stringify(response.body.data);
    const reread = await request(f.app).get(route).set(actor.session.headers);
    expect(reread.status).toBe(200);
    expect(reread.body.data.digest).toBe(response.body.data.digest);
    expect(JSON.stringify(reread.body.data)).toBe(snapshot);
    await f.ownerPool.query("UPDATE subscriptions SET status='past_due' WHERE organization_id=$1", [f.org]);
    try {
      expect((await request(f.app).get(route).set(actor.session.headers)).status).toBe(403);
    } finally {
      await f.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1", [f.org]);
    }
    expect((await request(f.app).get(route).set(actor.session.headers)).body.data.digest)
      .toBe(response.body.data.digest);
    await issueEditableEstimateGrant(f.ownerPool, grantSource, estimate, {
      grantId: grant.grantId, revision: 2, active: false,
    });
    expect((await request(f.app).get(route).set(actor.session.headers)).status).toBe(403);
    await issueEditableEstimateGrant(f.ownerPool, grantSource, estimate, {
      grantId: grant.grantId, revision: 3, active: true,
    });
    const regranted = await request(f.app).get(route).set(actor.session.headers);
    expect(regranted.status).toBe(200);
    expect(regranted.body.data).toMatchObject({ authority: { capabilityGrantId: grant.grantId,
      capabilityGrantRevision: 3 }, revision: response.body.data.revision,
      options: response.body.data.options, estimate: response.body.data.estimate });
    const capabilityRead = await f.runtimePool.connect(); let pendingGrant;
    try {
      await capabilityRead.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      expect((await capabilityRead.query(
        'SELECT public.canonical_customer_financial_editable_basis_v1_read($1,$2,$3,$4,$5) value',
        [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId, estimate]))
        .rows[0].value.state).toBe('current_mission24_commercial_lineage');
      let grantSettled = false;
      pendingGrant = issueEditableEstimateGrant(f.ownerPool, grantSource, estimate)
        .then(value => { grantSettled = true; return value; });
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(grantSettled).toBe(false);
      await capabilityRead.query('COMMIT');
    } catch (error) {
      await capabilityRead.query('ROLLBACK').catch(() => {});
      if (pendingGrant) await pendingGrant.catch(() => {});
      throw error;
    } finally { capabilityRead.release(); }
    const competingGrant = await pendingGrant;
    expect((await request(f.app).get(route).set(actor.session.headers)).status).toBe(403);
    await issueEditableEstimateGrant(f.ownerPool, grantSource, estimate, {
      grantId: grant.grantId, revision: 4, active: false,
    });
    await issueEditableEstimateGrant(f.ownerPool, grantSource, estimate, {
      grantId: competingGrant.grantId, revision: 2, active: false,
    });
    const restoredGrant = await issueEditableEstimateGrant(f.ownerPool, grantSource, estimate);
    const restored = await request(f.app).get(route).set(actor.session.headers);
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ authority: {
      capabilityGrantId: restoredGrant.grantId, capabilityGrantRevision: 1 },
      revision: response.body.data.revision, options: response.body.data.options });
    const appointment = f.estimateGraphs[0].ids.appointment;
    const beforeChange = (await f.ownerPool.query(
      'SELECT revision,rtrim(canonical_digest) digest,appointment_status FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2',
      [f.org, appointment])).rows[0];
    const changePreview = await request(f.app)
      .post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
      .set(actor.session.headers).send({ expectedRevision: Number(beforeChange.revision),
        expectedDigest: beforeChange.digest, expectedTimeZone: 'UTC', action: 'reschedule',
        target: { kind: 'unassigned', id: null }, scheduledStart: '2029-06-12T15:00:00.000Z',
        scheduledEnd: '2029-06-12T16:00:00.000Z',
        appointmentStatus: beforeChange.appointment_status,
        reason: 'Move the synthetic appointment to prove the Part 3A currentness fence.' });
    if (changePreview.status !== 201) throw new Error(
      `Part 3A schedule change preview failed: ${JSON.stringify(changePreview.body)}`);
    const pinnedRead = await f.runtimePool.connect(); let changed; let pendingChange;
    try {
      await pinnedRead.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const pinned = (await pinnedRead.query(
        'SELECT public.canonical_customer_financial_editable_basis_v1_read($1,$2,$3,$4,$5) value',
        [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId, estimate])).rows[0].value;
      expect(pinned.state).toBe('current_mission24_commercial_lineage');
      let settled = false;
      pendingChange = request(f.app)
        .post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
        .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send({
          previewId: changePreview.body.data.id,
          previewDigest: changePreview.body.data.previewDigest,
          acknowledgedWarningDigests: changePreview.body.data.warningDigests,
          acknowledgedReviewReasonDigests: changePreview.body.data.reviewReasonDigests,
          reason: 'Move the synthetic appointment to prove the Part 3A currentness fence.',
        }).then(value => { settled = true; return value; });
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(settled).toBe(false);
      await pinnedRead.query('COMMIT');
      changed = await pendingChange;
    } catch (error) {
      await pinnedRead.query('ROLLBACK').catch(() => {});
      if (pendingChange) await pendingChange.catch(() => {});
      throw error;
    } finally { pinnedRead.release(); }
    expect(changed.status).toBe(200);
    const stale = await request(f.app).get(route).set(actor.session.headers);
    expect(stale.status).toBe(200);
    expect(stale.body.data).toEqual({ contractVersion: 'm27-polaris-editable-estimate-v1',
      state: 'unavailable', reason: 'source_currentness_unavailable', value: null,
      sourceCurrent: false, providerCallCount: 0, receiverMutationCount: 0,
      phoneSourceValue: null, photoSourceValue: null, extractionValue: null });
  }, 120000);

  test('migration 264 withholds tables/helpers and grants only the read entry', async () => {
    expect((await f.ownerPool.query(
      "SELECT filename FROM _migrations WHERE filename='264_customer_financial_editable_estimate_basis_v1.sql'"))
      .rows.map(row => row.filename)).toEqual(['264_customer_financial_editable_estimate_basis_v1.sql']);
    for (const table of ['canonical_customer_financial_estimate_capability_grants_v1',
      'canonical_customer_financial_estimate_capability_heads_v1']) {
      expect((await f.ownerPool.query(
        "SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",
        [f.roles.runtime, `public.${table}`])).rows[0].allowed).toBe(false);
    }
    expect((await f.ownerPool.query(
      "SELECT has_function_privilege($1,'public.canonical_customer_financial_editable_basis_v1_read(uuid,uuid,text,uuid,uuid)','EXECUTE') allowed",
      [f.roles.runtime])).rows[0].allowed).toBe(true);
    expect((await f.ownerPool.query(
      "SELECT has_function_privilege($1,'public.canonical_customer_financial_editable_basis_v1_authority(uuid,uuid,text,uuid,uuid)','EXECUTE') allowed",
      [f.roles.runtime])).rows[0].allowed).toBe(false);
  });
});
