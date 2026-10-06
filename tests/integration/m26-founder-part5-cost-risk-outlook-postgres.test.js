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
const costComposition = require('../helpers/m24-cost-composition-input');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');
const { fixture: pricingFixture } = require('../helpers/m24-pricing-input');
const db = require('../../src/db');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const migration = '237_canonical_forecast_cost_risk_outlook.sql';

function copyMigrations(maximum) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-founder-p5-'));
  const source = path.resolve(__dirname, '../../migrations');
  for (const name of fs.readdirSync(source)
    .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= maximum)) {
    fs.copyFileSync(path.join(source, name), path.join(directory, name));
  }
  return directory;
}

async function waitForLockWait(pool, pid, minimumAdvisory = 5) {
  const deadline = Date.now() + 10000;
  let lastState;
  while (Date.now() < deadline) {
    const state = (await pool.query(
      `SELECT count(*) FILTER(WHERE locktype='advisory' AND granted)::int advisory_granted,
        count(*) FILTER(WHERE NOT granted)::int waiting
       FROM pg_locks WHERE pid=$1`, [pid])).rows[0];
    lastState = state;
    if (state && state.advisory_granted >= minimumAdvisory && state.waiting >= 1) return state;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Backend ${pid} did not enter the expected lock wait: ${JSON.stringify(lastState)}`);
}

function readOutlook(client, fixture) {
  const actor = fixture.actors.owner;
  return client.query(
    'SELECT public.canonical_forecast_cost_risk_outlook_current($1,$2,$3,$4) value',
    [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId]);
}

async function waitForPricingLock(pool) {
  const deadline = Date.now() + 1800;
  while (Date.now() < deadline) {
    const count = Number((await pool.query(
      `SELECT count(*)::int count FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid()
          AND cardinality(pg_blocking_pids(pid))>0`)).rows[0].count);
    if (count >= 1) return count;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Pricing writer did not wait for the cost-risk estimate fence');
}

function cents(value) {
  const negative = value.startsWith('-');
  const parts = (negative ? value.slice(1) : value).split('.');
  const amount = BigInt(parts[0]) * 100n + BigInt(parts[1]);
  return negative ? -amount : amount;
}

function money(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function ratioTenths(numerator, denominator) {
  const negative = numerator < 0n;
  const scaled = (negative ? -numerator : numerator) * 1000n;
  let rounded = scaled / denominator;
  if ((scaled % denominator) * 2n >= denominator) rounded += 1n;
  if (negative) rounded = -rounded;
  const absolute = rounded < 0n ? -rounded : rounded;
  return `${rounded < 0n ? '-' : ''}${absolute / 10n}.${absolute % 10n}`;
}

realPostgres('Mission 26 founder Part 5 migration 236 to 237 upgrade', () => {
  let database;
  let pool;
  let directory;
  beforeAll(async () => {
    database = await createSuiteDatabase('m26-founder-p5-up');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    directory = copyMigrations(236);
    await db.runMigrations({ pool, migrationsDirectory: directory });
  }, 180000);
  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (directory && path.dirname(directory) === os.tmpdir() &&
        path.basename(directory).startsWith('northstar-m26-founder-p5-')) {
      fs.rmSync(directory, { recursive: true });
    }
  }, 120000);

  test('adds one read-only protected projection without changing predecessor receipts', async () => {
    const before = (await pool.query(`SELECT filename,trim(checksum) checksum FROM _migrations
      WHERE filename IN ('234_canonical_forecast_integrated_commercial_baseline.sql',
       '235_canonical_forecast_pipeline_scenarios.sql',
       '236_canonical_forecast_revenue_cash_outlook.sql') ORDER BY filename`)).rows;
    fs.copyFileSync(path.resolve(__dirname, '../../migrations', migration),
      path.join(directory, migration));
    await expect(db.runMigrations({ pool, migrationsDirectory: directory })).resolves.toBe(true);
    const topology = (await pool.query(`SELECT
      to_regprocedure('canonical_forecast_cost_risk_outlook_current(uuid,uuid,text,uuid)')::text routine,
      (SELECT routine.prosecdef AND routine.proconfig @>
        ARRAY['search_path=pg_catalog, public, pg_temp']::text[] FROM pg_proc routine WHERE routine.oid=
        'canonical_forecast_cost_risk_outlook_current(uuid,uuid,text,uuid)'::regprocedure) security,
      has_function_privilege('public',
        'canonical_forecast_cost_risk_outlook_current(uuid,uuid,text,uuid)','EXECUTE') public_execute,
      (SELECT count(*)::int FROM _migrations WHERE filename=$1) receipt`, [migration])).rows[0];
    expect(topology).toEqual({
      routine: 'canonical_forecast_cost_risk_outlook_current(uuid,uuid,text,uuid)',
      security: true, public_execute: false, receipt: 1,
    });
    expect((await pool.query(`SELECT filename,trim(checksum) checksum FROM _migrations
      WHERE filename IN ('234_canonical_forecast_integrated_commercial_baseline.sql',
       '235_canonical_forecast_pipeline_scenarios.sql',
       '236_canonical_forecast_revenue_cash_outlook.sql') ORDER BY filename`)).rows).toEqual(before);
  }, 180000);
});

realPostgres('Mission 26 founder Part 5 fresh mounted refusal contract', () => {
  let fixture;
  beforeAll(async () => { fixture = await createEstimateReviewFixture(); }, 180000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('distinguishes complete zero from unavailable and enforces role and tenant scope', async () => {
    const endpoint = '/api/v1/forecast/cost-risk-outlook/current';
    const owner = await request(fixture.app).get(endpoint)
      .set('Cookie', fixture.actors.owner.session.headers.Cookie);
    expect(owner.status).toBe(200);
    expect(owner.headers['cache-control']).toBe('private, no-store');
    expect(owner.body.data).toMatchObject({
      version: 'm26-cost-risk-outlook-v1', state: 'current', reason: null, currency: 'USD',
      bookedWork: { state: 'current', count: 0, amountBeforeTax: '0.00' },
      costBasis: { state: 'current', coveredCount: 0, amount: '0.00', reason: null },
      contribution: { state: 'current', amount: '0.00', reason: null },
      margin: { state: 'unavailable', percent: null, reason: 'no_booked_value' },
      concentration: { state: 'none', largestBookedSharePercent: '0.0',
        largestBookedAmount: '0.00', reason: null },
      companyProfit: { state: 'unavailable', reason: 'complete_overhead_authority_unavailable' },
      delays: { state: 'unavailable', reason: 'verified_delay_authority_unavailable' },
      equipmentDowntime: { state: 'unavailable',
        reason: 'verified_downtime_authority_unavailable' },
      forecastIssued: false, automaticActionAuthorized: false,
    });
    expect(JSON.stringify(owner.body)).not.toMatch(/estimateId|pricingId|termsId|digest|sourcePins/);
    expect((await request(fixture.app).get(endpoint)
      .set('Cookie', fixture.actors.member.session.headers.Cookie)).status).toBe(403);
    expect((await request(fixture.app).get(endpoint + '?organizationId=' + fixture.org)
      .set('Cookie', fixture.actors.otherOwner.session.headers.Cookie)).status).toBe(400);
  }, 120000);

  test('reauthenticates the currency-unavailable branch after concurrent session revocation', async () => {
    const actor = fixture.actors.owner;
    const profile = (await fixture.ownerPool.query(
      `SELECT id,raw_profile FROM public.canonical_business_profiles
        WHERE organization_id=$1 AND is_active=TRUE ORDER BY version_number DESC LIMIT 1`,
      [fixture.org])).rows[0];
    const holder = await fixture.ownerPool.connect();
    const reader = await fixture.runtimePool.connect();
    let pending;
    try {
      await holder.query('BEGIN');
      await holder.query(
        'LOCK TABLE public.canonical_business_profiles IN ACCESS EXCLUSIVE MODE');
      await holder.query('ALTER TABLE public.canonical_business_profiles DISABLE TRIGGER USER');
      await holder.query(
        `UPDATE public.canonical_business_profiles
          SET raw_profile=jsonb_set(raw_profile,'{company,currency}','"unsupported"'::jsonb)
          WHERE organization_id=$1 AND id=$2`, [fixture.org, profile.id]);
      const pid = Number((await reader.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      pending = readOutlook(reader, fixture).catch(error => error);
      await waitForLockWait(fixture.ownerPool, pid, 0);
      await fixture.ownerPool.query(
        `UPDATE public.auth_sessions SET status='revoked',revoked_at=clock_timestamp(),
          revoke_reason='m26_founder_part5_currency_race' WHERE id=$1`,
        [actor.authSessionId]);
      await holder.query('COMMIT');
      const outcome = await pending;
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome.code).toBe('42501');
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      if (pending) await pending.catch(() => {});
      await fixture.ownerPool.query(
        `UPDATE public.auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL
          WHERE id=$1`, [actor.authSessionId]);
      await fixture.ownerPool.query(
        'UPDATE public.canonical_business_profiles SET raw_profile=$3::jsonb WHERE organization_id=$1 AND id=$2',
        [fixture.org, profile.id, profile.raw_profile]);
      await fixture.ownerPool.query(
        'ALTER TABLE public.canonical_business_profiles ENABLE TRIGGER USER');
      reader.release();
      holder.release();
    }
  }, 120000);

  test('reauthenticates the source-unavailable branch after concurrent membership revocation', async () => {
    const actor = fixture.actors.owner;
    const signature = 'canonical_forecast_integrated_commercial_sources(uuid,uuid,text,uuid,text)';
    const original = (await fixture.ownerPool.query(
      'SELECT pg_get_functiondef($1::regprocedure) definition', [signature])).rows[0].definition;
    await fixture.ownerPool.query(`
      CREATE OR REPLACE FUNCTION public.canonical_forecast_integrated_commercial_sources(
       org UUID,actor UUID,role_value TEXT,session_value UUID,currency_hint TEXT)
      RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
      SET search_path=pg_catalog,public,pg_temp AS $test$
      BEGIN
       PERFORM pg_advisory_lock(hashtextextended(
        'm26:test:cost-risk-source-unavailable:'||org::text,0));
       PERFORM pg_advisory_unlock(hashtextextended(
        'm26:test:cost-risk-source-unavailable:'||org::text,0));
       RETURN jsonb_build_object('state','test_unavailable',
        'sourceCohortsCompleteAtRead',FALSE);
      END $test$`);
    const holder = await fixture.ownerPool.connect();
    const reader = await fixture.runtimePool.connect();
    let pending;
    try {
      await holder.query(
        `SELECT pg_advisory_lock(hashtextextended(
          'm26:test:cost-risk-source-unavailable:'||$1::text,0))`, [fixture.org]);
      const pid = Number((await reader.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      pending = readOutlook(reader, fixture).catch(error => error);
      await waitForLockWait(fixture.ownerPool, pid);
      await fixture.ownerPool.query(
        `UPDATE public.organization_memberships SET status='revoked',revoked_at=clock_timestamp()
          WHERE organization_id=$1 AND user_id=$2`, [fixture.org, actor.actorUserId]);
      await holder.query(
        `SELECT pg_advisory_unlock(hashtextextended(
          'm26:test:cost-risk-source-unavailable:'||$1::text,0))`, [fixture.org]);
      const outcome = await pending;
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome.code).toBe('42501');
    } finally {
      await holder.query(
        `SELECT pg_advisory_unlock(hashtextextended(
          'm26:test:cost-risk-source-unavailable:'||$1::text,0))`, [fixture.org])
        .catch(() => {});
      if (pending) await pending.catch(() => {});
      await fixture.ownerPool.query(
        `UPDATE public.organization_memberships SET status='active',revoked_at=NULL
          WHERE organization_id=$1 AND user_id=$2`, [fixture.org, actor.actorUserId]);
      await fixture.ownerPool.query(original);
      reader.release();
      holder.release();
    }
  }, 120000);

  test('computes a positive booked job from real M24 sources and fences a concurrent source revision', async () => {
    const actor = fixture.actors.owner;
    const estimate = fixture.estimateGraphs[0].ids.estimate;
    const appointment = fixture.estimateGraphs[0].ids.appointment;
    const estimateRoute = `/api/v1/canonical/estimates/${estimate}`;
    const get = suffix => request(fixture.app).get(estimateRoute + suffix)
      .set(actor.session.headers);
    const post = (suffix, body) => request(fixture.app).post(estimateRoute + suffix)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(body);

    let review = (await get('/review')).body.data;
    const laborPlan = costComposition.planBody(review, 'labor');
    const laborPreview = await post('/labor-plan-preview', laborPlan);
    expect(laborPreview.status).toBe(200);
    costComposition.acceptPlanPreview(laborPlan, laborPreview.body.data);
    expect((await post('/labor-plans', laborPlan)).status).toBe(201);
    review = (await get('/review')).body.data;
    const adoption = costComposition.adoptionBody(review, 'labor');
    const adoptionPreview = await post('/cost-adoption-preview', adoption);
    expect(adoptionPreview.status).toBe(200);
    adoption.assessment = adoptionPreview.body.data.assessment;
    expect((await post('/cost-adoptions', adoption)).status).toBe(201);
    review = (await get('/review')).body.data;
    const initialPricing = review.pricingPlans;
    const pricingInputs = pricingFixture(initialPricing.serviceKey);
    expect((await post('/pricing-plans', {
      action: 'save', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: pricingInputs, currency: review.currency,
      reason: 'Founder Part 5 positive cost-source proof', confirmed: true,
      confirmationVersion: initialPricing.contract,
      evidenceDigest: initialPricing.sources.digest,
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
      currency: review.currency, reason: 'Founder Part 5 positive terms proof',
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
      reason: 'Founder Part 5 positive commercial approval proof', confirmed: true,
      confirmationVersion: currentTerms.contract,
      exceptions: { policyReason: '', policyUnknownAcknowledged: true,
        ownerRecordedTaxAcknowledged: true },
    })).status).toBe(201);
    const issued = await post('/customer-estimate-versions', {
      reason: 'Founder Part 5 positive issued estimate proof', confirmed: true,
      confirmationVersion: 'customer-estimate-issue-v1',
    });
    expect(issued.status).toBe(201);
    const link = await post('/customer-estimate-links', {
      versionId: issued.body.data.receipt.id, expiresInDays: 14,
      confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1',
    });
    expect(link.status).toBe(201);
    const token = decodeURIComponent(link.body.data.urlPath.split('/').pop());
    expect((await request(fixture.app)
      .post(`/api/public/customer-estimates/${token}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ customerName: 'Founder Part 5 Customer', confirmed: true,
        confirmationVersion: 'customer-estimate-accept-v1' })).status).toBe(201);

    const assignment = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,appointment_status
        FROM public.canonical_schedule_assignments
        WHERE organization_id=$1 AND appointment_id=$2`, [fixture.org, appointment])).rows[0];
    const reason = 'Match the accepted estimate to the founder Part 5 booked job.';
    const preview = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
      .set(actor.session.headers).send({ expectedRevision: Number(assignment.revision),
        expectedDigest: assignment.digest, expectedTimeZone: 'UTC', action: 'schedule',
        target: { kind: 'unassigned', id: null },
        scheduledStart: '2029-08-14T13:00:00.000Z',
        scheduledEnd: '2029-08-14T14:00:00.000Z',
        appointmentStatus: assignment.appointment_status, reason });
    expect(preview.status).toBe(201);
    const schedule = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
        acknowledgedWarningDigests: preview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason });
    expect(schedule.status).toBe(200);
    const scheduleApproval = (await fixture.ownerPool.query(
      `SELECT id FROM public.canonical_schedule_human_approvals
        WHERE organization_id=$1 AND appointment_id=$2
        ORDER BY approved_at DESC,id DESC LIMIT 1`, [fixture.org, appointment])).rows[0].id;
    const bookingRoute = '/api/v1/forecast/booking-reviews';
    const bookingReview = await request(fixture.app).post(`${bookingRoute}/first`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ approvalId: scheduleApproval,
        reason: 'Review the accepted and scheduled job for cost-risk proof.' });
    expect(bookingReview.status).toBe(201);
    const bookingConfirmation = await request(fixture.app)
      .post(`${bookingRoute}/${bookingReview.body.data.reviewId}/confirm-booked`)
      .set(actor.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Confirm the accepted and scheduled job is booked.',
        confirmed: true, confirmationVersion: 'owner-booked-work-confirm-v1' });
    expect(bookingConfirmation.status).toBe(201);

    const source = (await fixture.ownerPool.query(
      `SELECT review.reviewed_price_before_tax booked,
        pricing.result->>'costWithOverhead' cost
       FROM public.canonical_forecast_commercial_booking_reviews review
       JOIN public.canonical_customer_estimate_versions version
        ON version.organization_id=review.organization_id AND version.id=review.issued_version_id
       JOIN LATERAL(SELECT result FROM public.canonical_pricing_plans value
        WHERE value.organization_id=version.organization_id AND value.estimate_id=version.estimate_id
        ORDER BY revision DESC,id DESC LIMIT 1) pricing ON TRUE
       WHERE review.organization_id=$1 AND review.id=$2`,
      [fixture.org, bookingReview.body.data.reviewId])).rows[0];
    expect(source).toEqual(expect.objectContaining({
      booked: expect.stringMatching(/^[0-9]+\.[0-9]{2}$/),
      cost: expect.stringMatching(/^[0-9]+\.[0-9]{2}$/),
    }));
    const booked = cents(source.booked);
    const cost = cents(source.cost);
    const expectedContribution = money(booked - cost);
    const directOutlook = (await readOutlook(fixture.runtimePool, fixture)).rows[0].value;
    expect(directOutlook.state).toBe('current');
    const outlook = await request(fixture.app)
      .get('/api/v1/forecast/cost-risk-outlook/current').set(actor.session.headers);
    expect(outlook.status).toBe(200);
    expect(outlook.body.data).toMatchObject({
      state: 'current', bookedWork: { state: 'current', count: 1,
        amountBeforeTax: source.booked },
      costBasis: { state: 'current', coveredCount: 1, amount: source.cost, reason: null },
      contribution: { state: 'current', amount: expectedContribution, reason: null },
      margin: { state: 'current', percent: ratioTenths(booked - cost, booked), reason: null },
      concentration: { state: 'current', largestBookedSharePercent: '100.0',
        largestBookedAmount: source.booked, reason: null },
      companyProfit: { state: 'unavailable', reason: 'complete_overhead_authority_unavailable' },
    });

    review = (await get('/review')).body.data;
    const nextPricing = review.pricingPlans;
    const nextBody = {
      action: 'save', expectedRevision: nextPricing.current.revision,
      expectedDigest: nextPricing.current.digest, sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: pricingFixture(nextPricing.serviceKey), currency: review.currency,
      reason: 'Concurrent founder Part 5 source-fence proof', confirmed: true,
      confirmationVersion: nextPricing.contract, evidenceDigest: nextPricing.sources.digest,
    };
    const reader = await fixture.runtimePool.connect();
    let revisionPromise;
    try {
      await reader.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const heldOutlook = (await readOutlook(reader, fixture)).rows[0].value;
      expect(heldOutlook.costBasis.state).toBe('current');
      let settled = false;
      revisionPromise = post('/pricing-plans', nextBody)
        .then(response => { settled = true; return response; });
      await waitForPricingLock(fixture.ownerPool);
      expect(settled).toBe(false);
      await reader.query('COMMIT');
      expect((await revisionPromise).status).toBe(201);
    } finally {
      await reader.query('ROLLBACK').catch(() => {});
      if (revisionPromise) await revisionPromise.catch(() => {});
      reader.release();
    }
    const changed = await request(fixture.app)
      .get('/api/v1/forecast/cost-risk-outlook/current').set(actor.session.headers);
    expect(changed.status).toBe(200);
    expect(changed.body.data.costBasis.state === 'unavailable' ||
      changed.body.data.bookedWork.count === 0).toBe(true);
  }, 180000);
});
