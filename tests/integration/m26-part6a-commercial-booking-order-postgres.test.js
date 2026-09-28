'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const commercial = require('../../src/estimating/commercialContract');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');
const { fixture: pricingFixture } = require('../helpers/m24-pricing-input');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 6A shared customer acceptance and booking order', () => {
  let f;
  let issuedVersionId;
  let estimateRoute;
  let matchingApprovalId;
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

    const appointment = f.estimateGraphs[0].ids.appointment;
    const before = (await f.ownerPool.query(
      'SELECT revision,rtrim(canonical_digest) AS digest,appointment_status FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2',
      [f.org, appointment])).rows[0];
    const scheduledStart = '2029-06-12T13:00:00.000Z';
    const scheduledEnd = '2029-06-12T14:00:00.000Z';
    const preview = await request(f.app).post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
      .set(actor.session.headers).send({ expectedRevision: Number(before.revision),
        expectedDigest: before.digest, expectedTimeZone: 'UTC', action: 'schedule',
        target: { kind: 'unassigned', id: null },
        scheduledStart, scheduledEnd, appointmentStatus: before.appointment_status,
        reason: 'Match synthetic accepted estimate to this appointment' });
    if (preview.status !== 201) throw new Error('Matching preview failed: ' +
      JSON.stringify({ body: preview.body, before }));
    const approval = await request(f.app).post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
        reason: 'Match synthetic accepted estimate to this appointment' });
    if (approval.status !== 200) throw new Error('Matching approval failed: ' + JSON.stringify(approval.body));
    matchingApprovalId = (await f.ownerPool.query(
      'SELECT id FROM canonical_schedule_human_approvals WHERE organization_id=$1 AND appointment_id=$2 ORDER BY approved_at DESC LIMIT 1',
      [f.org, appointment])).rows[0].id;

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
      'customer_estimate_acceptance', 'schedule_approval', 'schedule_approval', 'schedule_approval',
      'customer_estimate_link_revocation',
    ]);
    expect(new Set(ordered.map(row => row.source_order))).toHaveProperty('size', 5);
    expect(ordered[0].delivery_event_id).toBeTruthy();
    expect(ordered[1].approval_id).toBeTruthy();
    expect(ordered[4].delivery_event_id).toBeTruthy();
    await expect(f.runtimePool.query('SELECT * FROM canonical_forecast_commercial_booking_orders'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(f.ownerPool.query(
      'DELETE FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1', [f.org]))
      .rejects.toMatchObject({ code: '23514' });
  }, 120000);

  test('guarded reader links one earlier accepted issued version to the same immutable opportunity without claiming booked work', async () => {
    const actor = f.actors.owner;
    const params = [f.org, actor.actorUserId, actor.actorAccessRole,
      actor.authSessionId, matchingApprovalId];
    const paired = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      params)).rows[0].value;
    expect(paired).toMatchObject({ state: 'ordered_same_opportunity_candidate',
      issuedVersionId, approvalId: matchingApprovalId, candidateOnly: true,
      bookedWorkVerified: false, forecastIssued: false,
      acceptancePrecedesApproval: true, decisionCurrentnessVerified: false,
      linkRevokedBeforeApproval: false, linkRevokedAfterApproval: true });
    expect(paired).not.toHaveProperty('acceptanceSourceOrder');
    expect(paired).not.toHaveProperty('approvalSourceOrder');
    expect(paired).not.toHaveProperty('decisionStillLatest');
    const unrelatedApproval = (await f.ownerPool.query(
      `SELECT source.approval_id FROM canonical_forecast_commercial_booking_orders source
        WHERE source.organization_id=$1 AND source.source_kind='schedule_approval'
          AND source.approval_id<>$2 ORDER BY source.source_order LIMIT 1`,
      [f.org, matchingApprovalId])).rows[0].approval_id;
    const unrelated = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      [...params.slice(0, 4), unrelatedApproval])).rows[0].value;
    expect(unrelated).toMatchObject({ state: 'no_ordered_acceptance',
      candidateOnly: true, bookedWorkVerified: false, forecastIssued: false });
    const member = f.actors.member;
    await expect(f.runtimePool.query(
      'SELECT public.canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      [f.org, member.actorUserId, member.actorAccessRole,
        member.authSessionId, matchingApprovalId]))
      .rejects.toMatchObject({ code: '42501' });
    const other = f.actors.otherOwner;
    await expect(f.runtimePool.query(
      'SELECT public.canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      [other.organizationId, other.actorUserId, other.actorAccessRole,
        other.authSessionId, matchingApprovalId]))
      .resolves.toMatchObject({ rows: [{ value: {
        state: 'source_order_unavailable', candidateOnly: true,
        bookedWorkVerified: false } }] });
  }, 120000);

  test('a later approval does not silently choose among two accepted links', async () => {
    const actor = f.actors.owner;
    const link = await request(f.app).post(estimateRoute + '/customer-estimate-links')
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ versionId: issuedVersionId, expiresInDays: 14,
        confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1' });
    expect(link.status).toBe(201);
    const token = decodeURIComponent(link.body.data.urlPath.split('/').pop());
    const accepted = await request(f.app).post(`/api/public/customer-estimates/${token}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ customerName: 'Second Synthetic Customer', confirmed: true,
        confirmationVersion: 'customer-estimate-accept-v1' });
    expect(accepted.status).toBe(201);
    const appointment = f.estimateGraphs[0].ids.appointment;
    const before = (await f.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) AS digest,appointment_status,
         scheduled_start,scheduled_end FROM canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2`, [f.org, appointment])).rows[0];
    const reason = 'Review multiple synthetic accepted estimate links';
    const preview = await request(f.app).post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
      .set(actor.session.headers).send({ expectedRevision: Number(before.revision),
        expectedDigest: before.digest, expectedTimeZone: 'UTC', action: 'assign',
        target: { kind: 'profile', id: f.actors.member.actorUserId },
        scheduledStart: before.scheduled_start.toISOString(),
        scheduledEnd: before.scheduled_end.toISOString(),
        appointmentStatus: before.appointment_status, reason });
    expect(preview.status).toBe(201);
    const approval = await request(f.app).post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason });
    expect(approval.status).toBe(200);
    const latestApproval = (await f.ownerPool.query(
      `SELECT id FROM canonical_schedule_human_approvals
        WHERE organization_id=$1 AND appointment_id=$2 ORDER BY approved_at DESC LIMIT 1`,
      [f.org, appointment])).rows[0].id;
    const ambiguous = (await f.runtimePool.query(
      'SELECT public.canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      [f.org, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, latestApproval])).rows[0].value;
    expect(ambiguous).toMatchObject({ state: 'ambiguous_accepted_responses',
      candidateOnly: true, bookedWorkVerified: false, forecastIssued: false });
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
      expect(beforeRelease).toBe(7);
    } finally {
      await held.query('ROLLBACK');
      held.release();
    }
    const accepted = await acceptance;
    expect(accepted.status).toBe(201);
    const afterRelease = (await f.ownerPool.query(
      `SELECT source_kind FROM canonical_forecast_commercial_booking_orders
        WHERE organization_id=$1 ORDER BY source_order`, [f.org])).rows;
    expect(afterRelease).toHaveLength(8);
    expect(afterRelease.slice(7).filter(row => row.source_kind === 'customer_estimate_acceptance')).toHaveLength(1);

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
        [f.org])).rows[0].count).toBe(9);
    } finally {
      await transaction.query('ROLLBACK');
      transaction.release();
    }
    expect((await f.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_commercial_booking_orders WHERE organization_id=$1',
      [f.org])).rows[0].count).toBe(8);
    expect((await accept(rollbackLink.token)).status).toBe(201);
    const finalOrder = (await f.ownerPool.query(
      `SELECT source_order FROM canonical_forecast_commercial_booking_orders
        WHERE organization_id=$1 ORDER BY source_order DESC LIMIT 1`, [f.org])).rows[0].source_order;
    expect(BigInt(finalOrder)).toBeGreaterThan(BigInt(lastOrder) + 1n);
  }, 120000);
});

realPostgres('Mission 26 Part 6A commercial booking order migration boundary', () => {
  let database;
  let pool;
  let migrationDirectory;

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p6a-commercial-migration');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-commercial-pre156-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) < 156)) {
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    }
    await require('../../src/db').runMigrations({ pool, migrationsDirectory: migrationDirectory });
    fs.copyFileSync(
      path.join(source, '156_canonical_forecast_commercial_booking_order.sql'),
      path.join(migrationDirectory, '156_canonical_forecast_commercial_booking_order.sql')
    );
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-commercial-pre156-')) {
      fs.rmSync(migrationDirectory, { recursive: true });
    }
  }, 120000);

  test('waits for pre-migration approval writers before installing the replacement trigger body', async () => {
    const blocker = await pool.connect();
    let applying;
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'LOCK TABLE public.canonical_schedule_human_approvals IN ROW EXCLUSIVE MODE'
      );
      applying = require('../../src/db').runMigrations({ pool, migrationsDirectory: migrationDirectory });
      const deadline = Date.now() + 4000;
      let waiters = 0;
      while (Date.now() < deadline) {
        waiters = (await pool.query(
          `SELECT count(*)::int AS count
             FROM pg_locks
            WHERE locktype='relation' AND NOT granted
              AND relation='public.canonical_schedule_human_approvals'::regclass`
        )).rows[0].count;
        if (waiters >= 1) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      expect(waiters).toBeGreaterThanOrEqual(1);
      expect((await pool.query(
        "SELECT to_regclass('public.canonical_forecast_commercial_booking_orders') AS relation"
      )).rows).toEqual([{ relation: null }]);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    expect(await applying).toBe(true);
    expect((await pool.query(
      "SELECT to_regclass('public.canonical_forecast_commercial_booking_orders')::text AS relation"
    )).rows).toEqual([{ relation: 'canonical_forecast_commercial_booking_orders' }]);
  }, 120000);
});
