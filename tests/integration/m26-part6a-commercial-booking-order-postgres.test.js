'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const commercial = require('../../src/estimating/commercialContract');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');
const { fixture: pricingFixture } = require('../helpers/m24-pricing-input');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 6A shared customer acceptance and booking order', () => {
  let f;
  let issuedVersionId;
  let estimateRoute;
  beforeAll(async () => { f = await createEstimateReviewFixture(); }, 120000);
  afterAll(async () => { if (f) await f.cleanup(); }, 120000);

  test('orders new accepted estimate, human schedule approval, and link revocation without booking-price promotion', async () => {
    const actor = f.actors.owner;
    const estimate = f.estimateGraphs[0].ids.estimate;
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const get = suffix => request(f.app).get(route + suffix).set(actor.session.headers);
    const post = (suffix, body) => request(f.app).post(route + suffix)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(body);

    let review = (await get('/review')).body.data;
    const pricing = review.pricingPlans;
    expect((await post('/pricing-plans', {
      action: 'save', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: pricingFixture(pricing.serviceKey), currency: review.currency,
      reason: 'Synthetic accepted-estimate source-order pricing', confirmed: true,
      confirmationVersion: pricing.contract, evidenceDigest: pricing.sources.digest,
    })).status).toBe(201);
    review = (await get('/review')).body.data;
    const terms = review.commercialTerms;
    const inputs = commercialFixture().value;
    inputs.version = terms.contract;
    inputs.jobApplicability = {
      serviceOperation: 'fence_installation', propertyUse: 'residential',
      workContext: 'new_construction', customerExemption: 'none',
      evidenceRef: { serviceOperation: 'Reviewed scope', propertyUse: 'Recorded property',
        workContext: 'Reviewed scope', customerExemption: 'Customer statement' },
    };
    inputs.transactionDate = terms.sources.asOfDate;
    inputs.taxGroups = [group(['installation'])];
    inputs.taxGroups[0].source.serviceKey = terms.sources.serviceKey;
    Object.assign(inputs.taxGroups[0].source, {
      legalEffectiveOn: inputs.taxGroups[0].source.effectiveOn,
      legalEndsOn: null, reviewedOn: terms.sources.asOfDate,
      reviewValidThrough: terms.sources.asOfDate,
    });
    delete inputs.taxGroups[0].source.effectiveOn;
    delete inputs.taxGroups[0].source.endsOn;
    expect((await post('/commercial-terms', {
      action: 'save', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: terms.decisionBasis.revision,
      expectedDecisionDigest: terms.decisionBasis.digest, inputs,
      currency: review.currency, reason: 'Synthetic terms for ordered acceptance',
      confirmed: true, confirmationVersion: terms.contract,
      evidenceDigest: terms.sources.digest,
    })).status).toBe(201);
    review = (await get('/review')).body.data;
    const currentTerms = review.commercialTerms;
    expect((await post('/commercial-approvals', {
      termsPin: commercial.pin(currentTerms.current),
      evidenceDigest: currentTerms.sources.digest,
      expectedDecisionRevision: currentTerms.decisionBasis.revision,
      expectedDecisionDigest: currentTerms.decisionBasis.digest,
      scopeSummary: 'Install the recorded cedar fence and complete reviewed work.',
      reason: 'Synthetic approved commercial scope', confirmed: true,
      confirmationVersion: currentTerms.contract,
      exceptions: { policyReason: '', policyUnknownAcknowledged: true,
        ownerRecordedTaxAcknowledged: true },
    })).status).toBe(201);
    const issued = await post('/customer-estimate-versions', {
      reason: 'Synthetic issued customer estimate', confirmed: true,
      confirmationVersion: 'customer-estimate-issue-v1',
    });
    expect(issued.status).toBe(201);
    issuedVersionId = issued.body.data.receipt.id;
    estimateRoute = route;
    const link = await post('/customer-estimate-links', {
      versionId: issued.body.data.receipt.id, expiresInDays: 14,
      confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1',
    });
    expect(link.status).toBe(201);
    const token = decodeURIComponent(link.body.data.urlPath.split('/').pop());
    const countBefore = (await f.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1',
      [f.org])).rows[0].count;
    expect(countBefore).toBe(0);

    const acceptKey = crypto.randomUUID();
    const acceptBody = { customerName: 'Taylor Customer', confirmed: true,
      confirmationVersion: 'customer-estimate-accept-v1' };
    const accept = () => request(f.app).post(`/api/public/customer-estimates/${token}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', acceptKey).send(acceptBody);
    expect((await accept()).status).toBe(201);
    expect((await accept()).status).toBe(200);

    await f.createExecution({ approvedScheduling: true, stopAfterScheduling: true });
    const links = await get('/customer-estimate-links');
    expect(links.status).toBe(200);
    const revoked = await post(`/customer-estimate-links/${links.body.data.links[0].id}/revoke`, {});
    expect(revoked.status).toBe(201);

    const ordered = (await f.ownerPool.query(
      `SELECT source_kind,approval_id,delivery_event_id,source_order
         FROM canonical_forecast_commercial_booking_orders
        WHERE organization_id=$1 ORDER BY source_order`, [f.org])).rows;
    expect(ordered.map(row => row.source_kind)).toEqual([
      'customer_estimate_acceptance', 'schedule_approval', 'schedule_approval',
      'customer_estimate_link_revocation',
    ]);
    expect(new Set(ordered.map(row => row.source_order))).toHaveProperty('size', 4);
    expect(ordered[0].delivery_event_id).toBeTruthy();
    expect(ordered[1].approval_id).toBeTruthy();
    expect(ordered[3].delivery_event_id).toBeTruthy();
    await expect(f.runtimePool.query('SELECT * FROM canonical_forecast_commercial_booking_orders'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(f.ownerPool.query(
      'DELETE FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1', [f.org]))
      .rejects.toMatchObject({ code: '23514' });
  }, 120000);

  test('customer acceptance waits on the tenant fence and rollback leaves no phantom event', async () => {
    const actor = f.actors.owner;
    const createLink = async () => {
      const response = await request(f.app).post(estimateRoute + '/customer-estimate-links')
        .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
        .send({ versionId: issuedVersionId, expiresInDays: 14,
          confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1' });
      expect(response.status).toBe(201);
      return { id: response.body.data.link.id,
        token: decodeURIComponent(response.body.data.urlPath.split('/').pop()) };
    };
    const accept = token => request(f.app).post(`/api/public/customer-estimates/${token}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ customerName: 'Concurrent Synthetic Customer', confirmed: true,
        confirmationVersion: 'customer-estimate-accept-v1' });

    const concurrentLink = await createLink();
    const held = await f.ownerPool.connect();
    let acceptance;
    try {
      await held.query('BEGIN');
      await held.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('m26:commercial-booking-order:'||$1::text,0))",
        [f.org]);
      acceptance = accept(concurrentLink.token).then(response => response);
      const deadline = Date.now() + 4000;
      let waiters = 0;
      while (Date.now() < deadline) {
        waiters = (await f.ownerPool.query(
          `SELECT count(*)::int AS count FROM pg_locks
            WHERE locktype='advisory' AND NOT granted
              AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`)).rows[0].count;
        if (waiters >= 1) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      expect(waiters).toBeGreaterThanOrEqual(1);
      const beforeRelease = (await f.ownerPool.query(
        'SELECT count(*)::int count FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1',
        [f.org])).rows[0].count;
      expect(beforeRelease).toBe(4);
    } finally {
      await held.query('ROLLBACK');
      held.release();
    }
    const accepted = await acceptance;
    expect(accepted.status).toBe(201);
    const afterRelease = (await f.ownerPool.query(
      `SELECT source_kind FROM canonical_forecast_commercial_booking_orders
        WHERE organization_id=$1 ORDER BY source_order`, [f.org])).rows;
    expect(afterRelease).toHaveLength(5);
    expect(afterRelease.slice(4).filter(row => row.source_kind === 'customer_estimate_acceptance')).toHaveLength(1);

    const rollbackLink = await createLink();
    const transaction = await f.ownerPool.connect();
    const lastOrder = (await f.ownerPool.query(
      'SELECT max(source_order)::bigint AS value FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1',
      [f.org])).rows[0].value;
    try {
      await transaction.query('BEGIN');
      await transaction.query(
        `INSERT INTO canonical_customer_estimate_delivery_events(
           organization_id,estimate_id,version_id,link_id,kind,body,actor_user_id,
           request_key_hash,request_digest,digest)
         SELECT organization_id,estimate_id,version_id,id,'accepted',
                $2::jsonb,NULL,$3,$4,$5
           FROM canonical_customer_estimate_delivery_links WHERE id=$1`,
        [rollbackLink.id, JSON.stringify({ customerName: 'Rolled back synthetic customer',
          confirmed: true, confirmationVersion: 'customer-estimate-accept-v1' }),
        crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'),
        crypto.randomBytes(32).toString('hex')]);
      expect((await transaction.query(
        'SELECT count(*)::int count FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1',
        [f.org])).rows[0].count).toBe(6);
    } finally {
      await transaction.query('ROLLBACK');
      transaction.release();
    }
    expect((await f.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1',
      [f.org])).rows[0].count).toBe(5);
    expect((await accept(rollbackLink.token)).status).toBe(201);
    const finalOrder = (await f.ownerPool.query(
      `SELECT source_order FROM canonical_forecast_commercial_booking_orders
        WHERE organization_id=$1 ORDER BY source_order DESC LIMIT 1`, [f.org])).rows[0].source_order;
    expect(BigInt(finalOrder)).toBeGreaterThan(BigInt(lastOrder) + 1n);
  }, 120000);
});
