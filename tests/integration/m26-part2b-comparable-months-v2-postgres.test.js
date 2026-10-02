'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } =
  require('../helpers/m24-estimate-review-fixture');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { putBusinessProfile } = require('../../src/services/organizationAuthority');
const { deriveReportingWindow } = require('../../src/forecasting/timeSeriesWindows');
const { captureView, readView } =
  require('../../src/forecasting/comparableApprovedEstimateMonthsV2');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const base = '/api/v1/forecast/reporting-windows/effective-anchors';
const dates = { firstLocalStartDate: '2026-03-01',
  secondLocalStartDate: '2026-04-01', areaScope: 'tenant_all' };
const uuid = () => crypto.randomUUID();

realPostgres('Mission 26 Part 2B target-complete comparable months v2', () => {
  let f;
  let anchorId;
  let windows;
  let refreshedReceiptId;
  let refreshedReceiptKey;
  beforeAll(async () => {
    f = await createEstimateReviewFixture({ operationalSchedule: true });
    const active = (await f.ownerPool.query(
      `SELECT raw_profile,version_label FROM canonical_business_profiles
       WHERE organization_id=$1 AND is_active=TRUE`, [f.org])).rows[0];
    const profile = canonicalFenceProfile();
    profile.company.timeZone = 'America/New_York';
    profile.hours = Object.fromEntries(['monday', 'tuesday', 'wednesday',
      'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, {
      open: '08:00', close: '17:00', lunch: '', emergency: false,
      afterHours: false, holiday: false,
    }]));
    await putBusinessProfile(f.ownerPool, { organizationId: f.org,
      userId: f.actors.owner.actorUserId, expectedVersion: active.version_label, profile });
    const anchored = await request(f.app).post(base)
      .set(f.actors.owner.session.headers).set('Idempotency-Key', uuid())
      .send({ reason: 'Observe the fictional comparable-month profile source.',
        confirmed: true });
    expect(anchored.status).toBe(201);
    anchorId = anchored.body.data.anchorId;
    expect((await request(f.app).post(`${base}/${anchorId}/activate`)
      .set(f.actors.owner.session.headers).send({})).status).toBe(200);
    const pinned = (await f.ownerPool.query(
      `SELECT id,version_number,normalized_profile_hash,raw_profile
       FROM canonical_business_profiles
       WHERE organization_id=$1 AND is_active=TRUE`, [f.org])).rows[0];
    windows = [dates.firstLocalStartDate, dates.secondLocalStartDate]
      .map(localStartDate => deriveReportingWindow({
        organizationId: f.org, businessProfileId: pinned.id,
        businessProfileVersion: Number(pinned.version_number),
        businessProfileHash: pinned.normalized_profile_hash,
        rawProfile: pinned.raw_profile, grain: 'month', localStartDate,
        serviceKey: null, areaScope: 'tenant_all',
      }));
    // Disposable PostgreSQL only: move the installation and activation clocks
    // before the selected months. Production never reconstructs this history.
    await f.ownerPool.query(
      'ALTER TABLE canonical_forecast_approved_estimate_v2_epochs DISABLE TRIGGER canonical_forecast_approved_estimate_v2_epoch_immutable');
    await f.ownerPool.query(
      'ALTER TABLE canonical_forecast_profile_effective_activations DISABLE TRIGGER canonical_forecast_profile_effective_activations_immutable');
    try {
      await f.ownerPool.query(
        `UPDATE canonical_forecast_approved_estimate_v2_epochs
         SET coverage_starts_at='2026-02-20T12:00:00Z' WHERE organization_id=$1`,
        [f.org]);
      await f.ownerPool.query(
        `UPDATE canonical_forecast_approved_estimate_v2_states
         SET coverage_starts_at='2026-02-20T12:00:00Z' WHERE organization_id=$1`,
        [f.org]);
      await f.ownerPool.query(
        `UPDATE canonical_forecast_profile_effective_activations
         SET observed_at='2026-02-20T13:00:00Z'
         WHERE organization_id=$1 AND anchor_id=$2`, [f.org, anchorId]);
    } finally {
      await f.ownerPool.query(
        'ALTER TABLE canonical_forecast_profile_effective_activations ENABLE TRIGGER canonical_forecast_profile_effective_activations_immutable');
      await f.ownerPool.query(
        'ALTER TABLE canonical_forecast_approved_estimate_v2_epochs ENABLE TRIGGER canonical_forecast_approved_estimate_v2_epoch_immutable');
    }
  }, 120000);
  afterAll(async () => { if (f) await f.cleanup(); }, 120000);

  function capture(key = uuid(), actor = f.actors.owner, body = dates) {
    return request(f.app)
      .post(`${base}/${anchorId}/comparable-month-receipts/v2`)
      .set(actor.session.headers).set('Idempotency-Key', key).send(body);
  }

  function read(receiptId, actor = f.actors.owner) {
    return request(f.app)
      .get(`${base}/${anchorId}/comparable-month-receipts/v2/${receiptId}`)
      .set('Cookie', actor.session.headers.Cookie).query(dates);
  }

  async function directCapture(actor = f.actors.owner, key = uuid()) {
    const result = await f.runtimePool.query(
      `SELECT public.canonical_forecast_comparable_month_v2_capture(
       $1,$2,$3,$4,$5,$6,$7,$8::date,$9::date) value`,
      [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
        actor.csrfToken, key, anchorId, dates.firstLocalStartDate,
        dates.secondLocalStartDate]);
    return captureView(result.rows[0].value, f.org, anchorId, windows);
  }

  async function directRead(receiptId, actor = f.actors.owner) {
    const result = await f.runtimePool.query(
      `SELECT public.canonical_forecast_comparable_month_v2_read(
       $1,$2,$3,$4,$5) value`,
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, receiptId]);
    if (result.rows[0].value === null) return null;
    return readView(result.rows[0].value, f.org, anchorId, windows);
  }

  async function installAndActivateProfile(profile, reason) {
    const active = (await f.ownerPool.query(
      `SELECT version_label FROM canonical_business_profiles
       WHERE organization_id=$1 AND is_active=TRUE`, [f.org])).rows[0];
    await putBusinessProfile(f.ownerPool, { organizationId: f.org,
      userId: f.actors.owner.actorUserId, expectedVersion: active.version_label, profile });
    const actor = f.actors.owner;
    const anchored = (await f.runtimePool.query(
      `SELECT canonical_forecast_profile_effective_anchor_capture(
       $1,$2,$3,$4,$5,$6,$7,TRUE) value`,
      [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
        actor.csrfToken, uuid(), reason])).rows[0].value;
    expect(anchored).toMatchObject({ state: 'profile_effective_anchor_recorded',
      replayed: false });
    const value = anchored.anchorId;
    const activated = (await f.runtimePool.query(
      `SELECT canonical_forecast_profile_effective_anchor_activate(
       $1,$2,$3,$4,$5,$6) value`,
      [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
        actor.csrfToken, value])).rows[0].value;
    expect(activated).toMatchObject({ state: 'profile_effective_activation_recorded',
      replayed: false });
    return value;
  }

  async function moveCoverageBefore(anchor, instant = '2020-10-01T12:00:00Z') {
    await f.ownerPool.query(
      'ALTER TABLE canonical_forecast_approved_estimate_v2_epochs DISABLE TRIGGER canonical_forecast_approved_estimate_v2_epoch_immutable');
    await f.ownerPool.query(
      'ALTER TABLE canonical_forecast_profile_effective_activations DISABLE TRIGGER canonical_forecast_profile_effective_activations_immutable');
    try {
      await f.ownerPool.query(
        `UPDATE canonical_forecast_approved_estimate_v2_epochs
         SET coverage_starts_at=$2 WHERE organization_id=$1`, [f.org, instant]);
      await f.ownerPool.query(
        `UPDATE canonical_forecast_approved_estimate_v2_states
         SET coverage_starts_at=$2 WHERE organization_id=$1`, [f.org, instant]);
      await f.ownerPool.query(
        `UPDATE canonical_forecast_profile_effective_activations
         SET observed_at=$3 WHERE organization_id=$1 AND anchor_id=$2`,
        [f.org, anchor, instant]);
    } finally {
      await f.ownerPool.query(
        'ALTER TABLE canonical_forecast_profile_effective_activations ENABLE TRIGGER canonical_forecast_profile_effective_activations_immutable');
      await f.ownerPool.query(
        'ALTER TABLE canonical_forecast_approved_estimate_v2_epochs ENABLE TRIGGER canonical_forecast_approved_estimate_v2_epoch_immutable');
    }
  }

  async function decide(action, price = null) {
    const estimate = f.estimateGraphs[0].ids.estimate;
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const current = await request(f.app).get(`${route}/review`)
      .set(f.actors.owner.session.headers);
    expect(current.status).toBe(200);
    const review = current.body.data;
    const response = await request(f.app).post(`${route}/decisions`)
      .set(f.actors.owner.session.headers).set('Idempotency-Key', uuid())
      .send({ action, expectedRevision: review.decisions.current?.revision || 0,
        expectedDigest: review.decisions.current?.digest || 'none',
        sourcePins: review.pins,
        scopeSummary: action === 'approve' ? 'Fictional comparable-month scope.' : null,
        priceBeforeTax: action === 'approve' ? price : null,
        currency: review.currency, reason: `Fictional ${action} source decision.`,
        confirmed: true, confirmationVersion: 'estimate-quote-preparation-v1' });
    expect(response.status).toBe(201);
    return response.body.data.receipt;
  }

  async function observeAndShift(decisionId, orderedAt, commitObservedAt) {
    const observed = (await f.runtimePool.query(
      `SELECT canonical_forecast_observe_price_decision_commit(
       $1,$2,$3,$4,$5,$6) value`,
      [f.org, f.actors.owner.actorUserId, f.actors.owner.actorAccessRole,
        f.actors.owner.authSessionId, f.actors.owner.csrfToken, decisionId])).rows[0].value;
    expect(observed.state).toBe('price_decision_commit_observed');
    await f.ownerPool.query(
      'ALTER TABLE canonical_forecast_price_decision_orders DISABLE TRIGGER canonical_forecast_price_decision_order_immutable');
    await f.ownerPool.query(
      'ALTER TABLE canonical_forecast_price_decision_commit_observations DISABLE TRIGGER canonical_forecast_price_decision_commit_immutable');
    try {
      await f.ownerPool.query(
        `UPDATE canonical_forecast_price_decision_orders SET ordered_at=$2
         WHERE organization_id=$1 AND decision_id=$3`, [f.org, orderedAt, decisionId]);
      await f.ownerPool.query(
        `UPDATE canonical_forecast_price_decision_commit_observations SET observed_at=$2
         WHERE organization_id=$1 AND decision_id=$3`,
        [f.org, commitObservedAt, decisionId]);
    } finally {
      await f.ownerPool.query(
        'ALTER TABLE canonical_forecast_price_decision_commit_observations ENABLE TRIGGER canonical_forecast_price_decision_commit_immutable');
      await f.ownerPool.query(
        'ALTER TABLE canonical_forecast_price_decision_orders ENABLE TRIGGER canonical_forecast_price_decision_order_immutable');
    }
  }

  test('captures complete zero, replays, normalizes DST and withholds area coverage',
    async () => {
      const key = uuid();
      const zero = await capture(key);
      expect(zero.status).toBe(201);
      expect(zero.body.data).toMatchObject({ state: 'current', sourceEventCount: 0,
        targetComplete: true, observationCoverageVerified: true,
        selectedSourceCoverageVerified: true,
        areaObservationCoverageVerified: false,
        providerCoverageVerified: false, wholeBusinessCoverageVerified: false,
        eligibleForForecast: false, forecastIssued: false,
        periods: [{ sourceDecisionCount: 0, completeSelectedSourceZero: true },
          { sourceDecisionCount: 0, completeSelectedSourceZero: true }] });
      expect(zero.body.data.normalizationDimensions).toContain('elapsed_minutes');
      expect(zero.body.data.windows.map(value => value.elapsedMinutes))
        .toEqual([44580, 43200]);
      expect(zero.body.data.windows.map(value => value.openMinutes))
        .toEqual([16740, 16200]);
      const planner = await f.ownerPool.connect();
      try {
        await planner.query('BEGIN');
        await planner.query('SET LOCAL enable_seqscan=off');
        const plan = JSON.stringify((await planner.query(
          `EXPLAIN (FORMAT JSON) SELECT source_order
           FROM canonical_forecast_price_decision_orders
           WHERE organization_id=$1 AND ordered_at>=$2 AND ordered_at<$3
           ORDER BY ordered_at,source_order LIMIT 1001`,
          [f.org, windows[0].startsAt, windows[0].endsAt])).rows);
        expect(plan).toContain('canonical_forecast_price_decision_orders_tenant_time_idx');
      } finally {
        await planner.query('ROLLBACK').catch(() => {});
        planner.release();
      }
      const replay = await capture(key);
      expect(replay.status).toBe(200);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body.data.receiptId).toBe(zero.body.data.receiptId);
      expect((await read(zero.body.data.receiptId)).body.data)
        .toMatchObject({ state: 'current', sourceCurrent: true, sourceEventCount: 0 });
      const area = await capture(uuid(), f.actors.owner, { ...dates,
        areaScope: 'profile_area' });
      expect(area.status).toBe(409);
      expect(area.body).toMatchObject({ data: {
        reason: 'area_observation_coverage_unavailable',
        observationCoverageVerified: false, areaObservationCoverageVerified: false,
        targetComplete: false, forecastIssued: false } });
      expect((await capture(uuid(), f.actors.member)).status).toBe(403);
      await expect(f.runtimePool.query(
        `SELECT public.canonical_forecast_comparable_month_v2_capture(
         $1,$2,$3,$4,$5,$6,$7,$8::date,$9::date) value`,
        [f.org, f.actors.owner.actorUserId, f.actors.owner.actorAccessRole,
          f.actors.owner.authSessionId, 'invalid-csrf', uuid(), anchorId,
          dates.firstLocalStartDate, dates.secondLocalStartDate]))
        .rejects.toMatchObject({ code: '42501' });
      await expect(f.runtimePool.query(
        `SELECT public.canonical_forecast_comparable_month_v2_capture(
         $1,$2,$3,$4,$5,$6,$7,$8::date,$9::date) value`,
        [f.org, f.actors.owner.actorUserId, f.actors.owner.actorAccessRole,
          f.actors.owner.authSessionId, f.actors.owner.csrfToken, uuid(), anchorId,
          '2026-03-02', dates.secondLocalStartDate]))
        .rejects.toMatchObject({ code: '22023' });
      const hidden = await read(zero.body.data.receiptId, f.actors.otherOwner);
      expect(hidden.status).toBe(404);
      expect(JSON.stringify(hidden.body)).not.toMatch(/sourceEvent|SnapshotDigest|current/i);
    }, 120000);

  test('refuses inapplicable coverage and profile epochs without partial persistence',
    async () => {
      const before = (await f.ownerPool.query(
        `SELECT count(*)::integer count
         FROM canonical_forecast_comparable_month_v2_receipts
         WHERE organization_id=$1`, [f.org])).rows[0].count;
      await f.ownerPool.query(
        'ALTER TABLE canonical_forecast_approved_estimate_v2_epochs DISABLE TRIGGER canonical_forecast_approved_estimate_v2_epoch_immutable');
      try {
        await f.ownerPool.query(
          `UPDATE canonical_forecast_approved_estimate_v2_epochs
           SET coverage_starts_at=$2 WHERE organization_id=$1`,
          [f.org, windows[0].startsAt]);
        await f.ownerPool.query(
          `UPDATE canonical_forecast_approved_estimate_v2_states
           SET coverage_starts_at=$2 WHERE organization_id=$1`,
          [f.org, windows[0].startsAt]);
        expect(await directCapture()).toMatchObject({ state: 'unavailable',
          reason: 'coverage_epoch_ineligible', receiptId: null,
          observationCoverageVerified: false });
      } finally {
        await f.ownerPool.query(
          `UPDATE canonical_forecast_approved_estimate_v2_epochs
           SET coverage_starts_at='2026-02-20T12:00:00Z' WHERE organization_id=$1`,
          [f.org]);
        await f.ownerPool.query(
          `UPDATE canonical_forecast_approved_estimate_v2_states
           SET coverage_starts_at='2026-02-20T12:00:00Z' WHERE organization_id=$1`,
          [f.org]);
        await f.ownerPool.query(
          'ALTER TABLE canonical_forecast_approved_estimate_v2_epochs ENABLE TRIGGER canonical_forecast_approved_estimate_v2_epoch_immutable');
      }
      await f.ownerPool.query(
        'ALTER TABLE canonical_forecast_profile_effective_activations DISABLE TRIGGER canonical_forecast_profile_effective_activations_immutable');
      try {
        await f.ownerPool.query(
          `UPDATE canonical_forecast_profile_effective_activations
           SET observed_at=$3 WHERE organization_id=$1 AND anchor_id=$2`,
          [f.org, anchorId, windows[0].startsAt]);
        expect(await directCapture()).toMatchObject({ state: 'unavailable',
          reason: 'profile_epoch_ineligible', receiptId: null,
          observationCoverageVerified: false });
      } finally {
        await f.ownerPool.query(
          `UPDATE canonical_forecast_profile_effective_activations
           SET observed_at='2026-02-20T13:00:00Z'
           WHERE organization_id=$1 AND anchor_id=$2`, [f.org, anchorId]);
        await f.ownerPool.query(
          'ALTER TABLE canonical_forecast_profile_effective_activations ENABLE TRIGGER canonical_forecast_profile_effective_activations_immutable');
      }
      expect((await f.ownerPool.query(
        `SELECT count(*)::integer count
         FROM canonical_forecast_comparable_month_v2_receipts
         WHERE organization_id=$1`, [f.org])).rows[0].count).toBe(before);
    }, 120000);

  test('captures genuine M24 events and later correction/profile change makes receipts stale',
    async () => {
      const first = await decide('approve', '1400.00');
      const second = await decide('approve', '1600.00');
      const third = await decide('withdraw');
      await observeAndShift(first.id, '2026-03-12T13:00:00Z',
        '2026-03-12T13:00:01Z');
      await observeAndShift(second.id, '2026-04-08T13:00:00Z',
        '2026-04-08T13:00:01Z');
      await observeAndShift(third.id, '2026-04-19T13:00:00Z',
        '2026-04-19T13:00:01Z');
      const capturedKey = uuid();
      const captured = await directCapture(f.actors.owner, capturedKey);
      expect(captured).toMatchObject({ state: 'current',
        sourceEventCount: 3, periods: [{ sourceDecisionCount: 1 },
          { sourceDecisionCount: 2 }], observationCoverageVerified: true });
      expect(await directCapture(f.actors.admin)).toMatchObject({ state: 'current',
        sourceEventCount: 3, observationCoverageVerified: true });
      const later = await decide('approve', '1750.00');
      expect(await directCapture(f.actors.owner, capturedKey)).toMatchObject({
        receiptId: captured.receiptId, state: 'stale', reason: 'source_changed',
        replayed: true, sourceCurrent: false, sourceEventCount: 3,
        periods: [{ sourceDecisionCount: 1 }, { sourceDecisionCount: 2 }],
      });
      const stale = await directRead(captured.receiptId);
      expect(stale).toMatchObject({ state: 'stale',
        reason: 'source_changed', sourceCurrent: false,
        sourceEventCount: 3, periods: [{ sourceDecisionCount: 1 },
          { sourceDecisionCount: 2 }] });
      refreshedReceiptKey = uuid();
      const refreshed = await directCapture(f.actors.owner, refreshedReceiptKey);
      expect(refreshed).toMatchObject({ state: 'current',
        sourceEventCount: 3 });
      refreshedReceiptId = refreshed.receiptId;
      expect(later.revision).toBe(4);
    }, 120000);

  test('refuses an in-flight writer and persists no partial receipt', async () => {
    const estimate = f.estimateGraphs[0].ids.estimate;
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const review = (await request(f.app).get(`${route}/review`)
      .set(f.actors.owner.session.headers)).body.data;
    const writer = await f.ownerPool.connect();
    let heldDecisionId;
    try {
      await writer.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const mutation = await writer.query(
        'SELECT canonical_estimate_decision_mutate($1,$2,$3,$4,$5,$6,$7,$8) value',
        [f.org, f.actors.owner.actorUserId, f.actors.owner.actorAccessRole,
          f.actors.owner.authSessionId, estimate,
          f.actors.owner.csrfToken, `m26-p2b-race-${uuid()}`, {
            action: 'approve', expectedRevision: review.decisions.current.revision,
            expectedDigest: review.decisions.current.digest,
            sourcePins: review.pins, scopeSummary: 'Fictional cutoff race.',
            priceBeforeTax: '500.00', currency: review.currency,
            reason: 'Fictional held approval.', confirmed: true,
            confirmationVersion: 'estimate-quote-preparation-v1',
          }]);
      heldDecisionId = mutation.rows[0].value.receipt.id;
      await writer.query(
        'ALTER TABLE canonical_forecast_price_decision_orders DISABLE TRIGGER canonical_forecast_price_decision_order_immutable');
      await writer.query(
        `UPDATE canonical_forecast_price_decision_orders
         SET ordered_at='2026-04-30T23:59:59Z'
         WHERE organization_id=$1 AND source_order=(SELECT max(source_order)
          FROM canonical_forecast_price_decision_orders WHERE organization_id=$1)`, [f.org]);
      await writer.query(
        'ALTER TABLE canonical_forecast_price_decision_orders ENABLE TRIGGER canonical_forecast_price_decision_order_immutable');
      const before = (await f.ownerPool.query(
        `SELECT count(*)::integer count
         FROM canonical_forecast_comparable_month_v2_receipts
         WHERE organization_id=$1`, [f.org])).rows[0].count;
      await expect(directCapture()).rejects.toMatchObject({ code: '55P03' });
      expect((await f.ownerPool.query(
        `SELECT count(*)::integer count
         FROM canonical_forecast_comparable_month_v2_receipts
         WHERE organization_id=$1`, [f.org])).rows[0].count).toBe(before);
      await writer.query('COMMIT');
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      writer.release();
    }
    const afterCutoff = await directCapture();
    expect(afterCutoff).toMatchObject({ state: 'unavailable',
      reason: 'commit_cutoff_unavailable', observationCoverageVerified: false,
      receiptId: null });
    await observeAndShift(heldDecisionId, '2026-04-30T23:59:59Z',
      '2026-04-30T23:59:59.500Z');
  }, 180000);

  test('fails both row and byte bounds without partial persistence', async () => {
    const estimate = f.estimateGraphs[0].ids.estimate;
    const template = (await f.ownerPool.query(
      `SELECT source_pins,currency,membership_id,auth_session_id,actor_user_id
       FROM canonical_estimate_decisions
       WHERE organization_id=$1 AND estimate_id=$2 ORDER BY revision DESC LIMIT 1`,
      [f.org, estimate])).rows[0];
    async function addFixtureRows(count, label) {
      const firstRevision = Number((await f.ownerPool.query(
        `SELECT COALESCE(max(revision),0)+1 value FROM canonical_estimate_decisions
         WHERE organization_id=$1 AND estimate_id=$2`, [f.org, estimate])).rows[0].value);
      const inserted = (await f.ownerPool.query(
        `INSERT INTO canonical_estimate_decisions(id,organization_id,estimate_id,
          revision,previous_id,action,actor_user_id,membership_id,auth_session_id,
          actor_name,source_pins,scope_summary,price_before_tax,currency,reason,
          confirmation_version,request_key_hash,request_digest,digest)
         SELECT gen_random_uuid(),$1,$2,$3+series-1,NULL,'approve',$4,$5,$6,
          'Bound fixture actor',$7,'Bounded source fixture.','1.00',$8,
          'Disposable mounted bound fixture.','estimate-quote-preparation-v1',
          encode(sha256(convert_to($9||':key:'||series::text,'UTF8')),'hex'),
          encode(sha256(convert_to($9||':request:'||series::text,'UTF8')),'hex'),
          encode(sha256(convert_to($9||':digest:'||series::text,'UTF8')),'hex')
         FROM generate_series(1,$10) series RETURNING id`,
        [f.org, estimate, firstRevision, template.actor_user_id,
          template.membership_id, template.auth_session_id, template.source_pins,
          template.currency, label, count])).rows.map(row => row.id);
      await f.ownerPool.query(
        'ALTER TABLE canonical_forecast_price_decision_orders DISABLE TRIGGER canonical_forecast_price_decision_order_immutable');
      try {
        await f.ownerPool.query(
          `UPDATE canonical_forecast_price_decision_orders
           SET ordered_at='2026-03-15T12:00:00Z'
           WHERE organization_id=$1 AND decision_id=ANY($2::uuid[])`,
          [f.org, inserted]);
      } finally {
        await f.ownerPool.query(
          'ALTER TABLE canonical_forecast_price_decision_orders ENABLE TRIGGER canonical_forecast_price_decision_order_immutable');
      }
      await f.ownerPool.query(
        `INSERT INTO canonical_forecast_price_decision_commit_observations(
          organization_id,decision_id,observed_at,actor_user_id,auth_session_id)
         SELECT $1,id,'2026-03-15T12:00:01Z',$2,$3
         FROM unnest($4::uuid[]) id`,
        [f.org, template.actor_user_id, template.auth_session_id, inserted]);
    }
    const before = Number((await f.ownerPool.query(
      `SELECT count(*) FROM canonical_forecast_comparable_month_v2_receipts
       WHERE organization_id=$1`, [f.org])).rows[0].count);
    await addFixtureRows(900, `m26-p2b-bytes-${uuid()}`);
    await expect(directCapture()).rejects.toMatchObject({ code: '54000' });
    expect(Number((await f.ownerPool.query(
      `SELECT count(*) FROM canonical_forecast_comparable_month_v2_receipts
       WHERE organization_id=$1`, [f.org])).rows[0].count)).toBe(before);
    await addFixtureRows(101, `m26-p2b-rows-${uuid()}`);
    await expect(directCapture()).rejects.toMatchObject({ code: '54000' });
    expect(Number((await f.ownerPool.query(
      `SELECT count(*) FROM canonical_forecast_comparable_month_v2_receipts
       WHERE organization_id=$1`, [f.org])).rows[0].count)).toBe(before);
  }, 180000);

  test('later profile change leaves the immutable receipt stale', async () => {
    const active = (await f.ownerPool.query(
      `SELECT raw_profile,version_label FROM canonical_business_profiles
       WHERE organization_id=$1 AND is_active=TRUE`, [f.org])).rows[0];
    const changed = canonicalFenceProfile();
    changed.company.timeZone = 'America/New_York';
    changed.company.name = 'Changed fictional profile after receipt';
    changed.hours = Object.fromEntries(['monday', 'tuesday', 'wednesday',
      'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, {
      open: '08:00', close: '17:00', lunch: '', emergency: false,
      afterHours: false, holiday: false,
    }]));
    await putBusinessProfile(f.ownerPool, { organizationId: f.org,
      userId: f.actors.owner.actorUserId, expectedVersion: active.version_label,
      profile: changed });
    expect(await directCapture(f.actors.owner, refreshedReceiptKey)).toMatchObject({
      receiptId: refreshedReceiptId, state: 'stale', reason: 'source_changed',
      replayed: true, sourceCurrent: false, sourceEventCount: 3,
    });
    expect(await directRead(refreshedReceiptId)).toMatchObject({ state: 'stale',
      sourceCurrent: false, reason: 'source_changed' });
  }, 120000);

  test('keeps runtime entry-only, PUBLIC denied, and startup authority mandatory',
    async () => {
      const privileges = (await f.ownerPool.query(
        `SELECT
         has_function_privilege($1,
          'canonical_forecast_comparable_month_v2_capture(uuid,uuid,text,uuid,text,text,uuid,date,date)',
          'EXECUTE') runtime_capture,
         has_function_privilege($1,
           'canonical_forecast_comparable_month_v2_events(uuid,timestamptz,timestamptz,timestamptz,timestamptz)',
           'EXECUTE') runtime_helper,
         has_function_privilege($1,
           'canonical_forecast_comparable_month_v2_unique_instant(text,timestamp without time zone)',
           'EXECUTE') runtime_wall_time_helper,
         has_function_privilege('public',
           'canonical_forecast_comparable_month_v2_unique_instant(text,timestamp without time zone)',
           'EXECUTE') public_wall_time_helper,
         has_table_privilege($1,'canonical_forecast_comparable_month_v2_receipts',
          'SELECT') runtime_table,
         has_function_privilege('public',
          'canonical_forecast_comparable_month_v2_read(uuid,uuid,text,uuid,uuid)',
          'EXECUTE') public_read`, [f.roles.runtime])).rows[0];
      expect(privileges).toEqual({ runtime_capture: true, runtime_helper: false,
        runtime_wall_time_helper: false, public_wall_time_helper: false,
        runtime_table: false, public_read: false });
      const missing = await f.ownerPool.connect();
      try {
        await missing.query('BEGIN');
        await missing.query(`ALTER FUNCTION canonical_forecast_comparable_month_v2_capture(
         uuid,uuid,text,uuid,text,text,uuid,date,date)
         RENAME TO canonical_forecast_comparable_month_v2_capture_missing`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(missing,
          { runtimeRole: f.roles.runtime }))
          .rejects.toThrow('Required comparable-month v2 authority is missing');
      } finally { await missing.query('ROLLBACK').catch(() => {}); missing.release(); }
      const missingHelper = await f.ownerPool.connect();
      try {
        await missingHelper.query('BEGIN');
        await missingHelper.query(`ALTER FUNCTION
         canonical_forecast_comparable_month_v2_unique_instant(
          text,timestamp without time zone)
         RENAME TO canonical_forecast_comparable_month_v2_unique_instant_missing`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(missingHelper,
          { runtimeRole: f.roles.runtime }))
          .rejects.toThrow('Required comparable-month v2 authority is missing');
      } finally {
        await missingHelper.query('ROLLBACK').catch(() => {});
        missingHelper.release();
      }
      const leaked = await f.ownerPool.connect();
      try {
        await leaked.query('BEGIN');
        await leaked.query(`GRANT EXECUTE ON FUNCTION
         canonical_forecast_comparable_month_v2_read(uuid,uuid,text,uuid,uuid) TO PUBLIC`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(leaked,
          { runtimeRole: f.roles.runtime }))
          .rejects.toThrow('Runtime database role privilege verification failed');
      } finally { await leaked.query('ROLLBACK').catch(() => {}); leaked.release(); }
    }, 120000);

  test('direct runtime rejects repeated work clocks and month-boundary midnights',
    async () => {
      async function proveUnavailable(profile, localDates, expectedReason, reason) {
        const scopedAnchor = await installAndActivateProfile(profile, reason);
        await moveCoverageBefore(scopedAnchor);
        const pinned = (await f.ownerPool.query(
          `SELECT id,version_number,normalized_profile_hash,raw_profile
           FROM canonical_business_profiles
           WHERE organization_id=$1 AND is_active=TRUE`, [f.org])).rows[0];
        const derive = () => deriveReportingWindow({ organizationId: f.org,
          businessProfileId: pinned.id, businessProfileVersion: Number(pinned.version_number),
          businessProfileHash: pinned.normalized_profile_hash,
          rawProfile: pinned.raw_profile, grain: 'month',
          localStartDate: localDates.firstLocalStartDate, serviceKey: null,
          areaScope: 'tenant_all' });
        if (expectedReason === 'calendar_unknown') {
          expect(derive()).toMatchObject({ calendarState: 'unknown',
            calendarDigest: null, openMinutes: null });
        } else {
          expect(derive).toThrow(expect.objectContaining({
            code: 'M26_REPORTING_WINDOW_UNAVAILABLE', reason: expectedReason,
          }));
        }
        const before = Number((await f.ownerPool.query(
          `SELECT count(*) FROM canonical_forecast_comparable_month_v2_receipts
           WHERE organization_id=$1`, [f.org])).rows[0].count);
        const value = (await f.runtimePool.query(
          `SELECT public.canonical_forecast_comparable_month_v2_capture(
           $1,$2,$3,$4,$5,$6,$7,$8::date,$9::date) value`,
          [f.org, f.actors.owner.actorUserId, f.actors.owner.actorAccessRole,
            f.actors.owner.authSessionId, f.actors.owner.csrfToken, uuid(), scopedAnchor,
            localDates.firstLocalStartDate, localDates.secondLocalStartDate])).rows[0].value;
        expect(value).toMatchObject({ state: 'unavailable',
          reason: 'window_authority_unavailable', receipt: null, replayed: false });
        expect(Number((await f.ownerPool.query(
          `SELECT count(*) FROM canonical_forecast_comparable_month_v2_receipts
           WHERE organization_id=$1`, [f.org])).rows[0].count)).toBe(before);
      }

      const repeatedWork = canonicalFenceProfile();
      repeatedWork.company.timeZone = 'America/New_York';
      repeatedWork.company.name = 'Repeated work clock fixture';
      repeatedWork.hours = Object.fromEntries(['monday', 'tuesday', 'wednesday',
        'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, {
        open: day === 'sunday' ? '01:30' : '08:00',
        close: day === 'sunday' ? '02:30' : '17:00', lunch: '', emergency: false,
        afterHours: false, holiday: false,
      }]));
      await proveUnavailable(repeatedWork, { firstLocalStartDate: '2020-11-01',
        secondLocalStartDate: '2020-12-01' }, 'calendar_unknown',
      'Pin the repeated New York work-clock fixture.');

      const repeatedMidnight = canonicalFenceProfile();
      repeatedMidnight.company.timeZone = 'America/Havana';
      repeatedMidnight.company.name = 'Repeated month boundary fixture';
      repeatedMidnight.hours = Object.fromEntries(['monday', 'tuesday', 'wednesday',
        'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, {
        open: '08:00', close: '17:00', lunch: '', emergency: false,
        afterHours: false, holiday: false,
      }]));
      await proveUnavailable(repeatedMidnight, { firstLocalStartDate: '2020-11-01',
        secondLocalStartDate: '2020-12-01' }, 'non_unique_period_boundary',
      'Pin the repeated Havana month-boundary fixture.');
    }, 180000);
});
