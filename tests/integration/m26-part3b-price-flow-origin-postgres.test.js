'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } =
  require('../helpers/m24-estimate-review-fixture');
const { sha256 } = require('../../src/services/businessProfileAdapter');
const { getActiveBusinessProfile, putBusinessProfile } =
  require('../../src/services/organizationAuthority');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const root = '/api/v1/forecast/price-history';
const profileRoot = '/api/v1/forecast/reporting-windows/effective-anchors';
const key = () => crypto.randomUUID();
const utc = day => `${day.toISOString().slice(0, 10)}T00:00:00.000000Z`;

realPostgres('Mission 26 Part 3B supported price-flow prediction origin', () => {
  let f;
  beforeAll(async () => { f = await createEstimateReviewFixture({
    operationalSchedule: true }); }, 120000);
  afterAll(async () => { if (f) await f.cleanup(); }, 120000);
  const owner = () => f.actors.owner;

  async function capturePrice() {
    const response = await request(f.app).post(`${root}/ordered-snapshots`)
      .set(owner().session.headers).set('Idempotency-Key', key()).send({});
    expect(response.status).toBe(201);
    return response.body.data.snapshotId;
  }

  async function capturePriceThroughGuardedSource() {
    // Same production SQL source capture after the test-only HTTP capture
    // allowance is exhausted; this does not bypass source authorization.
    const client = await f.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await client.query(
        'SELECT public.canonical_forecast_price_ordered_capture($1,$2,$3,$4,$5,$6) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, owner().csrfToken, key()]);
      await client.query('COMMIT');
      return result.rows[0].value.snapshot.id;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function approve(estimate) {
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const review = await request(f.app).get(`${route}/review`)
      .set(owner().session.headers);
    expect(review.status).toBe(200);
    const response = await request(f.app).post(`${route}/decisions`)
      .set(owner().session.headers).set('Idempotency-Key', key())
      .send({ action: 'approve', expectedRevision: 0,
        expectedDigest: 'none', sourcePins: review.body.data.pins,
        scopeSummary: 'Fictional price-flow work.',
        priceBeforeTax: '1400.00', currency: review.body.data.currency,
        reason: 'Fictional owner price review.', confirmed: true,
        confirmationVersion: 'estimate-quote-preparation-v1' });
    expect(response.status).toBe(201);
    return response.body.data.receipt.id;
  }

  async function shiftSourceDatesForFictionalDay(decisionId, priorStart) {
    // Disposable fixture only: move real M24 writer rows and the prospective
    // source anchor into a completed UTC day. This does not prove real history.
    const date = new Date(priorStart.getTime() + 12 * 60 * 60 * 1000);
    const before = new Date(priorStart.getTime() - 24 * 60 * 60 * 1000);
    const tables = [
      ['canonical_estimate_decisions', 'canonical_estimate_decision_immutable'],
      ['canonical_forecast_price_decision_orders',
        'canonical_forecast_price_decision_order_immutable'],
      ['canonical_forecast_price_ordered_anchors',
        'canonical_forecast_price_ordered_anchors_immutable'],
      ['canonical_forecast_price_anchor_activations',
        'canonical_forecast_price_anchor_activations_immutable'],
    ];
    try {
      for (const [table, trigger] of tables) {
        await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
      }
      await f.ownerPool.query(
        'UPDATE canonical_estimate_decisions SET created_at=$2 WHERE id=$1',
        [decisionId, date]);
      await f.ownerPool.query(
        'UPDATE canonical_forecast_price_decision_orders SET ordered_at=$2 WHERE decision_id=$1',
        [decisionId, date]);
      await f.ownerPool.query(
        'UPDATE canonical_forecast_price_ordered_anchors SET coverage_starts_at=$2 WHERE organization_id=$1',
        [f.org, before]);
      await f.ownerPool.query(
        'UPDATE canonical_forecast_price_anchor_activations SET observed_at=$2 WHERE organization_id=$1',
        [f.org, before]);
    } finally {
      for (const [table, trigger] of tables.reverse()) {
        await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
      }
    }
  }

  test('paid M24 writer feeds an immutable uncalibrated saved point with causal origin proof',
    async () => {
      const anchorReceiptId = await capturePrice();
      const activation = await request(f.app)
        .post(`${root}/ordered-anchor/activate`)
        .set(owner().session.headers).send({});
      expect(activation.status).toBe(200);
      const decisionId = await approve(f.estimateGraphs[0].ids.estimate);
      const observed = await request(f.app)
        .post(`${root}/decision-commit-observations`)
        .set(owner().session.headers).send({ decisionId });
      expect(observed.status).toBe(200);
      expect(observed.body.data).toMatchObject({
        state: 'price_decision_commit_observed', decisionId,
        sourceFinalized: false, replayed: false });
      const denied = await request(f.app)
        .post(`${root}/decision-commit-observations`)
        .set(f.actors.member.session.headers).send({ decisionId });
      expect(denied.status).toBe(403);
      const tomorrow = new Date();
      tomorrow.setUTCHours(0, 0, 0, 0);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const priorStart = new Date(tomorrow);
      priorStart.setUTCDate(priorStart.getUTCDate() - 3);
      await shiftSourceDatesForFictionalDay(decisionId, priorStart);
      const snapshotId = await capturePrice();
      const horizonStartsAt = utc(tomorrow);
      const horizonEnd = new Date(tomorrow);
      horizonEnd.setUTCDate(horizonEnd.getUTCDate() + 1);
      const body = { sourceReceiptId: snapshotId, currency: 'USD',
        horizonStartsAt, horizonEndsAt: utc(horizonEnd) };

      const activeProfile = await getActiveBusinessProfile(f.ownerPool, f.org);
      const unsupportedRaw = JSON.parse(JSON.stringify(activeProfile.rawProfile));
      unsupportedRaw.company.timeZone = 'America/New_York';
      const unsupportedProfile = await putBusinessProfile(f.ownerPool, {
        organizationId: f.org, userId: owner().actorUserId,
        expectedVersion: activeProfile.versionLabel, profile: unsupportedRaw,
      });
      const unsupportedOrigin = await f.runtimePool.query(
        'SELECT public.canonical_forecast_capture_price_flow_origin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, owner().csrfToken, key(),
          body.sourceReceiptId, body.currency, body.horizonStartsAt,
          body.horizonEndsAt]);
      expect(unsupportedOrigin.rows[0].value).toMatchObject({
        state: 'price_flow_origin_unavailable',
        reason: 'unsupported_calendar_timezone',
        calendarTimeZone: 'America/New_York', forecastIssued: false,
      });
      const conflictingRaw = JSON.parse(JSON.stringify(
        unsupportedProfile.rawProfile));
      conflictingRaw.company.timeZone = 'UTC';
      conflictingRaw.company.currency = 'CAD';
      const conflictingProfile = await putBusinessProfile(f.ownerPool, {
        organizationId: f.org, userId: owner().actorUserId,
        expectedVersion: unsupportedProfile.versionLabel,
        profile: conflictingRaw,
      });
      const conflictingOrigin = await f.runtimePool.query(
        'SELECT public.canonical_forecast_capture_price_flow_origin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, owner().csrfToken, key(),
          body.sourceReceiptId, body.currency, body.horizonStartsAt,
          body.horizonEndsAt]);
      expect(conflictingOrigin.rows[0].value).toMatchObject({
        state: 'price_flow_origin_unavailable', reason: 'currency_conflict',
        profileCurrency: 'CAD', forecastIssued: false,
      });
      const restoredRaw = JSON.parse(JSON.stringify(
        conflictingProfile.rawProfile));
      restoredRaw.company.currency = 'USD';
      await putBusinessProfile(f.ownerPool, {
        organizationId: f.org, userId: owner().actorUserId,
        expectedVersion: conflictingProfile.versionLabel, profile: restoredRaw,
      });
      const profile = await request(f.app).post(profileRoot)
        .set(owner().session.headers).set('Idempotency-Key', key())
        .send({ reason: 'Prospective fictional UTC-day profile basis.',
          confirmed: true });
      expect(profile.status).toBe(201);
      const profileAnchorId = profile.body.data.anchorId;
      const queuedProfile = await request(f.app).post(profileRoot)
        .set(owner().session.headers).set('Idempotency-Key', key())
        .send({ reason: 'Queued legacy activation ordering proof.',
          confirmed: true });
      expect(queuedProfile.status).toBe(201);
      const queuedProfileAnchorId = queuedProfile.body.data.anchorId;
      // Simulate the INSERT tail of a migration-169 activation call that was
      // already executing when migration 171 replaced the function. The new
      // table trigger must serialize even this legacy body with origin save.
      const profileActivationWriter = await f.ownerPool.connect();
      const profileRaceOriginWriter = await f.runtimePool.connect();
      try {
        await profileActivationWriter.query(
          'BEGIN ISOLATION LEVEL READ COMMITTED');
        await profileRaceOriginWriter.query(
          'BEGIN ISOLATION LEVEL READ COMMITTED');
        const profileActivation = await profileActivationWriter.query(
          `INSERT INTO canonical_forecast_profile_effective_activations(
             organization_id,anchor_id,observed_at,actor_user_id,auth_session_id)
           VALUES($1,$2,clock_timestamp(),$3,$4)
           RETURNING anchor_id`,
          [f.org, profileAnchorId, owner().actorUserId,
            owner().authSessionId]);
        expect(profileActivation.rows[0].anchor_id).toBe(profileAnchorId);
        let raceOriginSettled = false;
        const raceOrigin = profileRaceOriginWriter.query(
          'SELECT public.canonical_forecast_capture_price_flow_origin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
          [f.org, owner().actorUserId, owner().actorAccessRole,
            owner().authSessionId, owner().csrfToken, key(),
            body.sourceReceiptId, body.currency, body.horizonStartsAt,
            body.horizonEndsAt]).then(result => {
          raceOriginSettled = true;
          return result.rows[0].value;
        });
        await new Promise(resolve => setTimeout(resolve, 25));
        expect(raceOriginSettled).toBe(false);
        await profileActivationWriter.query('COMMIT');
        expect(await raceOrigin).toMatchObject({
          state: 'saved_price_flow_origin', replayed: false,
        });
        await profileRaceOriginWriter.query('COMMIT');
      } finally {
        await profileActivationWriter.query('ROLLBACK').catch(() => {});
        await profileRaceOriginWriter.query('ROLLBACK').catch(() => {});
        profileActivationWriter.release();
        profileRaceOriginWriter.release();
      }

      // Exercise the opposite ordering: origin owns the shared lock while a
      // legacy INSERT has already formed an artificially earlier row clock.
      // The trigger must wait, then replace that clock after acquiring the
      // lock so the post-origin activation cannot become causal evidence.
      const originFirstWriter = await f.runtimePool.connect();
      const queuedActivationWriter = await f.ownerPool.connect();
      let originFirst;
      let queuedActivation;
      try {
        await originFirstWriter.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await queuedActivationWriter.query(
          'BEGIN ISOLATION LEVEL READ COMMITTED');
        originFirst = (await originFirstWriter.query(
          'SELECT public.canonical_forecast_capture_price_flow_origin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
          [f.org, owner().actorUserId, owner().actorAccessRole,
            owner().authSessionId, owner().csrfToken, key(),
            body.sourceReceiptId, body.currency, body.horizonStartsAt,
            body.horizonEndsAt])).rows[0].value;
        expect(originFirst).toMatchObject({
          state: 'saved_price_flow_origin', replayed: false,
        });
        let queuedActivationSettled = false;
        const waitingActivation = queuedActivationWriter.query(
          `INSERT INTO canonical_forecast_profile_effective_activations(
             organization_id,anchor_id,observed_at,actor_user_id,auth_session_id)
           VALUES($1,$2,clock_timestamp()-interval '1 hour',$3,$4)
           RETURNING observed_at`,
          [f.org, queuedProfileAnchorId, owner().actorUserId,
            owner().authSessionId]).then(result => {
          queuedActivationSettled = true;
          return result.rows[0];
        });
        await new Promise(resolve => setTimeout(resolve, 25));
        expect(queuedActivationSettled).toBe(false);
        await originFirstWriter.query('COMMIT');
        queuedActivation = await waitingActivation;
        await queuedActivationWriter.query('COMMIT');
      } finally {
        await originFirstWriter.query('ROLLBACK').catch(() => {});
        await queuedActivationWriter.query('ROLLBACK').catch(() => {});
        originFirstWriter.release();
        queuedActivationWriter.release();
      }
      const originFirstStored = await f.ownerPool.query(
        'SELECT saved_at FROM canonical_forecast_price_flow_saved_origins WHERE id=$1',
        [originFirst.runId]);
      expect(queuedActivation.observed_at.getTime()).toBeGreaterThanOrEqual(
        originFirstStored.rows[0].saved_at.getTime());
      const queuedWitness = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${originFirst.runId}/profile-witness`)
        .set(owner().session.headers)
        .send({ profileAnchorId: queuedProfileAnchorId });
      expect(queuedWitness.status).toBe(200);
      expect(queuedWitness.body.data).toMatchObject({
        state: 'profile_witness_unavailable',
        reason: 'prospective_profile_unverified',
      });

      const firstOriginWriter = await f.runtimePool.connect();
      const secondOriginWriter = await f.runtimePool.connect();
      const concurrentKey = key();
      const concurrentArgs = [f.org, owner().actorUserId,
        owner().actorAccessRole, owner().authSessionId, owner().csrfToken,
        concurrentKey, body.sourceReceiptId, body.currency,
        body.horizonStartsAt, body.horizonEndsAt];
      try {
        await firstOriginWriter.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await secondOriginWriter.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await secondOriginWriter.query("SET LOCAL lock_timeout = '2000ms'");
        const firstConcurrent = await firstOriginWriter.query(
          'SELECT public.canonical_forecast_capture_price_flow_origin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
          concurrentArgs);
        const waitingReplay = secondOriginWriter.query(
          'SELECT public.canonical_forecast_capture_price_flow_origin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
          concurrentArgs);
        await new Promise(resolve => setTimeout(resolve, 25));
        await firstOriginWriter.query('COMMIT');
        const secondConcurrent = await waitingReplay;
        expect(firstConcurrent.rows[0].value).toMatchObject({
          state: 'saved_price_flow_origin', replayed: false,
        });
        expect(secondConcurrent.rows[0].value).toMatchObject({
          state: 'saved_price_flow_origin',
          runId: firstConcurrent.rows[0].value.runId, replayed: true,
        });
        await secondOriginWriter.query('COMMIT');
      } finally {
        await firstOriginWriter.query('ROLLBACK').catch(() => {});
        await secondOriginWriter.query('ROLLBACK').catch(() => {});
        firstOriginWriter.release();
        secondOriginWriter.release();
      }
      const origin = await request(f.app)
        .post(`${root}/saved-price-flow-origins`)
        .set(owner().session.headers).set('Idempotency-Key', key())
        .send(body);
      expect(origin.status).toBe(201);
      expect(origin.body.data).toMatchObject({
        state: 'saved_price_flow_origin', preHorizonCommitVerified: false,
        realForecastEligible: false, forecastValueAvailable: false,
        output: null,
      });
      const runId = origin.body.data.runId;
      const proof = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/activate`)
        .set(owner().session.headers).send({});
      expect(proof.status).toBe(200);
      expect(proof.body.data).toMatchObject({
        state: 'price_flow_origin_activated', preHorizonCommitVerified: true,
        realForecastEligible: false });
      const lateProfile = await request(f.app).post(profileRoot)
        .set(owner().session.headers).set('Idempotency-Key', key())
        .send({ reason: 'Post-origin profile must not rewrite causal context.',
          confirmed: true });
      expect(lateProfile.status).toBe(201);
      const lateProfileActivation = await request(f.app)
        .post(`${profileRoot}/${lateProfile.body.data.anchorId}/activate`)
        .set(owner().session.headers).send({});
      expect(lateProfileActivation.status).toBe(200);
      const lateProfileWitness = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/profile-witness`)
        .set(owner().session.headers)
        .send({ profileAnchorId: lateProfile.body.data.anchorId });
      expect(lateProfileWitness.status).toBe(200);
      expect(lateProfileWitness.body.data).toMatchObject({
        state: 'profile_witness_unavailable',
        reason: 'prospective_profile_unverified',
        forecastValueAvailable: false, realForecastEligible: false,
      });
      const profileWitness = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/profile-witness`)
        .set(owner().session.headers)
        .send({ profileAnchorId });
      expect(profileWitness.status).toBe(200);
      expect(profileWitness.body.data).toMatchObject({
        state: 'profile_witness_recorded', runId, profileAnchorId,
        replayed: false, realForecastEligible: false });
      const witnessReplay = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/profile-witness`)
        .set(owner().session.headers)
        .send({ profileAnchorId });
      expect(witnessReplay.status).toBe(200);
      expect(witnessReplay.body.data).toMatchObject({
        state: 'profile_witness_recorded', replayed: true,
        proofDigest: profileWitness.body.data.proofDigest });
      const guardedWitness = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_profile_witness_read($1,$2,$3,$4,$5) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, runId]);
      expect(guardedWitness.rows[0].value).toMatchObject({
        state: 'profile_witness_recorded', runId, profileAnchorId,
        proofDigest: profileWitness.body.data.proofDigest });
      const pairSource = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_pair_source_read($1,$2,$3,$4,$5) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, runId]);
      expect(pairSource.rows[0].value).toMatchObject({
        state: 'pair_source_verified', runId, profileAnchorId,
        profileProofDigest: profileWitness.body.data.proofDigest });
      expect(pairSource.rows[0].value.output.asOf)
        .toBe(pairSource.rows[0].value.savedAt);
      expect(new Date(pairSource.rows[0].value.sourceSnapshotAsOf).getTime())
        .toBeLessThanOrEqual(new Date(
          pairSource.rows[0].value.output.asOf).getTime());
      expect(sha256(pairSource.rows[0].value.output))
        .toBe(origin.body.data.outputDigest);
      const deniedWitness = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/profile-witness`)
        .set(f.actors.member.session.headers)
        .send({ profileAnchorId });
      expect(deniedWitness.status).toBe(403);
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_flow_profile_witnesses'))
        .rejects.toMatchObject({ code: '42501' });
      // A competing same-horizon saved origin is sufficient to prove the
      // mounted reader refuses an open profile period. It is not the two
      // distinct elapsed rolling windows required for Slice 3B acceptance.
      const secondSnapshotId = await capturePriceThroughGuardedSource();
      const secondOrigin = await request(f.app)
        .post(`${root}/saved-price-flow-origins`)
        .set(owner().session.headers).set('Idempotency-Key', key())
        .send({ sourceReceiptId: secondSnapshotId, currency: 'USD',
          horizonStartsAt, horizonEndsAt: utc(horizonEnd) });
      expect(secondOrigin.body.data).toMatchObject({
        state: 'saved_price_flow_origin' });
      expect(secondOrigin.status).toBe(201);
      const secondRunId = secondOrigin.body.data.runId;
      const secondProof = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${secondRunId}/activate`)
        .set(owner().session.headers).send({});
      expect(secondProof.status).toBe(200);
      const secondWitness = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${secondRunId}/profile-witness`)
        .set(owner().session.headers).send({ profileAnchorId });
      expect(secondWitness.status).toBe(200);
      const prematurePair = await request(f.app)
        .get(`${root}/saved-price-flow-rolling-pairs`)
        .set('Cookie', owner().session.headers.Cookie)
        .query({ firstRunId: runId, secondRunId });
      expect(prematurePair.status).toBe(200);
      expect(prematurePair.body.data).toMatchObject({
        state: 'rolling_pairs_unavailable',
        reason: 'profile_period_unverified',
        evaluationSaved: false, realForecastEligible: false });
      const read = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(read.status).toBe(200);
      expect(read.body.data).toMatchObject({
        runId, preHorizonCommitVerified: true,
        outputDigest: origin.body.data.outputDigest,
        forecastValueAvailable: false, output: null,
      });
      const pendingActual = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}/actual-candidates/${snapshotId}`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(pendingActual.status).toBe(200);
      expect(pendingActual.body.data).toMatchObject({
        state: 'price_flow_actual_pending', reason: 'horizon_open',
        amount: null, firstApprovalCount: null,
        outcomeFinalized: false, realForecastEligible: false });
      const stored = await f.ownerPool.query(
        `SELECT saved_at,output
         FROM canonical_forecast_price_flow_saved_origins WHERE id=$1`,
        [runId]);
      expect(stored.rows[0].output.value.amount).toBe('0.00');
      expect(stored.rows[0].output.asOf).toBe(
        stored.rows[0].saved_at.toISOString());
      const replay = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/activate`)
        .set(owner().session.headers).send({});
      expect(replay.status).toBe(200);
      expect(replay.body.data).toMatchObject({
        state: 'price_flow_origin_activated', replayed: true,
        preHorizonCommitVerified: true });
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_flow_saved_origins'))
        .rejects.toMatchObject({ code: '42501' });
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_flow_origin_activations'))
        .rejects.toMatchObject({ code: '42501' });
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_decision_commit_observations'))
        .rejects.toMatchObject({ code: '42501' });
      const authorityClient = await f.ownerPool.connect();
      try {
        await authorityClient.query('BEGIN');
        await authorityClient.query(
          'GRANT SELECT ON canonical_forecast_price_flow_saved_origins TO PUBLIC');
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(
          authorityClient, { migrationRole: f.roles.owner,
            runtimeRole: f.roles.runtime }))
          .rejects.toThrow('Runtime database role privilege verification failed');
        await authorityClient.query(
          'REVOKE SELECT ON canonical_forecast_price_flow_saved_origins FROM PUBLIC');
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(
          authorityClient, { migrationRole: f.roles.owner,
            runtimeRole: f.roles.runtime })).resolves.toBeUndefined();
        await authorityClient.query('COMMIT');
      } finally {
        await authorityClient.query('ROLLBACK').catch(() => {});
        authorityClient.release();
      }

      // Disposable fixture only: move the already-proven production writer
      // and its immutable receipts to a coherent past UTC window so the
      // post-horizon calculation can execute today. This cannot prove real
      // elapsed history or causal past commits.
      const fictionalStart = new Date(priorStart);
      const fictionalEnd = new Date(fictionalStart.getTime() + 86400000);
      const captureAt = new Date(fictionalStart.getTime() - 12 * 3600000);
      const savedAt = new Date(fictionalStart.getTime() - 10 * 3600000);
      const proofAt = new Date(fictionalStart.getTime() - 9 * 3600000);
      const witnessAt = new Date(fictionalStart.getTime() + 13 * 3600000);
      const triggers = [
        ['canonical_forecast_price_ordered_receipts',
          'canonical_forecast_price_ordered_receipts_immutable'],
        ['canonical_forecast_price_flow_saved_origins',
          'canonical_forecast_price_flow_origins_immutable'],
        ['canonical_forecast_price_flow_origin_activations',
          'canonical_forecast_price_flow_activation_immutable'],
        ['canonical_forecast_price_decision_commit_observations',
          'canonical_forecast_price_decision_commit_immutable'],
        ['canonical_forecast_profile_effective_anchors',
          'canonical_forecast_profile_effective_anchors_immutable'],
        ['canonical_forecast_profile_effective_activations',
          'canonical_forecast_profile_effective_activations_immutable'],
        ['canonical_forecast_price_flow_profile_witnesses',
          'canonical_forecast_price_flow_profile_witness_immutable'],
      ];
      try {
        for (const [table, trigger] of triggers) {
          await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        }
        const receipt = await f.ownerPool.query(`
          UPDATE canonical_forecast_price_ordered_receipts value
          SET captured_at=$2,
          snapshot_digest=public.canonical_completion_digest(
            jsonb_build_object('version','m26-price-ordered-source-v1',
              'organizationId',value.organization_id,
              'coverageStartOrder',value.coverage_start_order,
              'highWaterOrder',value.high_water_order,
              'digestNonce',value.digest_nonce,
              'capturedAt',public.canonical_forecast_utc_instant($2::timestamptz),
              'events',value.decision_events))
          WHERE id=$1 RETURNING rtrim(snapshot_digest) digest`,
        [anchorReceiptId, captureAt]);
        const output = { ...stored.rows[0].output,
          asOf: savedAt.toISOString(),
          horizon: { startsAt: fictionalStart.toISOString(),
            endsAt: fictionalEnd.toISOString(), grain: 'day' },
          value: { kind: 'point', amount: '0.00' },
          sourceSnapshotDigest: receipt.rows[0].digest };
        const changed = await f.ownerPool.query(`
          UPDATE canonical_forecast_price_flow_saved_origins
          SET source_receipt_id=$2,saved_at=$3,horizon_start=$4,horizon_end=$5,
            output=$6::jsonb,
            receipt_digest=public.canonical_completion_digest($6::jsonb)
          WHERE id=$1 RETURNING receipt_digest`,
        [runId, anchorReceiptId, savedAt, fictionalStart, fictionalEnd,
          JSON.stringify(output)]);
        const proofValue = { ...proof.body.data,
          savedReceiptDigest: changed.rows[0].receipt_digest,
          captureCommitObservedAt: proofAt.toISOString(),
          horizonStartsAt: fictionalStart.toISOString() };
        delete proofValue.proofDigest;
        delete proofValue.replayed;
        await f.ownerPool.query(`
          UPDATE canonical_forecast_price_flow_origin_activations
          SET observed_at=$2,proof=$3::jsonb,
            proof_digest=public.canonical_completion_digest($3::jsonb)
          WHERE run_id=$1`, [runId, proofAt, JSON.stringify(proofValue)]);
        await f.ownerPool.query(`
          UPDATE canonical_forecast_price_decision_commit_observations
          SET observed_at=$2 WHERE decision_id=$1`, [decisionId, witnessAt]);
        const secondCaptureAt = new Date(fictionalStart.getTime() + 14 * 3600000);
        const secondSavedAt = new Date(fictionalStart.getTime() + 15 * 3600000);
        const secondProofAt = new Date(fictionalStart.getTime() + 16 * 3600000);
        const secondWitnessAt = new Date(fictionalStart.getTime() + 17 * 3600000);
        const secondReceipt = await f.ownerPool.query(`
          UPDATE canonical_forecast_price_ordered_receipts value
          SET captured_at=$2,
          snapshot_digest=public.canonical_completion_digest(
            jsonb_build_object('version','m26-price-ordered-source-v1',
              'organizationId',value.organization_id,
              'coverageStartOrder',value.coverage_start_order,
              'highWaterOrder',value.high_water_order,
              'digestNonce',value.digest_nonce,
              'capturedAt',public.canonical_forecast_utc_instant($2::timestamptz),
              'events',value.decision_events))
          WHERE id=$1 RETURNING rtrim(snapshot_digest) digest`,
        [secondSnapshotId, secondCaptureAt]);
        const secondOutput = { ...stored.rows[0].output,
          asOf: secondSavedAt.toISOString(),
          horizon: { startsAt: fictionalEnd.toISOString(),
            endsAt: new Date(fictionalEnd.getTime() + 86400000).toISOString(),
            grain: 'day' },
          value: { kind: 'point', amount: '0.00' },
          sourceSnapshotDigest: secondReceipt.rows[0].digest };
        const changedSecond = await f.ownerPool.query(`
          UPDATE canonical_forecast_price_flow_saved_origins
          SET saved_at=$2,horizon_start=$3,horizon_end=$4,
            output=$5::jsonb,
            receipt_digest=public.canonical_completion_digest($5::jsonb)
          WHERE id=$1 RETURNING receipt_digest`,
        [secondRunId, secondSavedAt, fictionalEnd,
          new Date(fictionalEnd.getTime() + 86400000),
          JSON.stringify(secondOutput)]);
        const secondProofValue = { ...secondProof.body.data,
          savedReceiptDigest: changedSecond.rows[0].receipt_digest,
          captureCommitObservedAt: secondProofAt.toISOString(),
          horizonStartsAt: fictionalEnd.toISOString() };
        delete secondProofValue.proofDigest;
        delete secondProofValue.replayed;
        await f.ownerPool.query(`
          UPDATE canonical_forecast_price_flow_origin_activations
          SET observed_at=$2,proof=$3::jsonb,
            proof_digest=public.canonical_completion_digest($3::jsonb)
          WHERE run_id=$1`,
        [secondRunId, secondProofAt, JSON.stringify(secondProofValue)]);
        const profileBefore = new Date(fictionalStart.getTime() - 12 * 3600000);
        await f.ownerPool.query(`
          UPDATE canonical_forecast_profile_effective_anchors
          SET captured_at=$2 WHERE id=$1`, [profileAnchorId, profileBefore]);
        await f.ownerPool.query(`
          UPDATE canonical_forecast_profile_effective_activations
          SET observed_at=$2 WHERE anchor_id=$1`,
        [profileAnchorId, new Date(profileBefore.getTime() + 3600000)]);
        await f.ownerPool.query(`
          UPDATE canonical_forecast_price_flow_profile_witnesses
          SET observed_at=$2 WHERE run_id=$1`,
        [runId, new Date(profileBefore.getTime() + 2 * 3600000)]);
        await f.ownerPool.query(`
          UPDATE canonical_forecast_price_flow_profile_witnesses
          SET observed_at=$2 WHERE run_id=$1`,
        [secondRunId, secondWitnessAt]);
      } finally {
        for (const [table, trigger] of triggers.reverse()) {
          await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
      const completeWindow = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_complete_window($1,$2,$3,$4) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId]);
      expect(completeWindow.rows[0].value).toMatchObject({
        state: 'complete_saved_origin_window_observed',
        scope: 'northstar_m24_registered_saved_origins_only',
        expectedUtcDays: 60, matchingContextCount: 2,
        unsavedOriginCoverageVerified: false,
        wholeBusinessCoverageVerified: false });
      expect(completeWindow.rows[0].value.origins).toHaveLength(2);
      const actualLock = await f.ownerPool.connect();
      try {
        await actualLock.query('BEGIN');
        await actualLock.query(`SELECT pg_advisory_xact_lock(hashtextextended(
          'm26:price-flow-actual:'||$1::text||':'||$2::text,0))`,
        [f.org, runId]);
        const busyWindow = await request(f.app)
          .get(`${root}/complete-price-flow-evaluation-window`)
          .set('Cookie', owner().session.headers.Cookie);
        expect(busyWindow.status).toBe(409);
        expect(busyWindow.body.error).toMatchObject({
          category: 'FORECAST_SOURCE_BUSY',
        });
        await actualLock.query('ROLLBACK');
      } catch (error) {
        await actualLock.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        actualLock.release();
      }
      const paidWindow = await request(f.app)
        .get(`${root}/complete-price-flow-evaluation-window`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(paidWindow.status).toBe(200);
      expect(paidWindow.body.data).toMatchObject({
        state: 'evaluation_window_descriptive_only',
        policy: {
          denominator: { expectedUtcDays: 60,
            matchingContextCount: 2, missingSavedOriginDays: 58,
            registeredWindowComplete: false },
          sampleSufficiency: { state: 'unavailable',
            reason: 'saved_origin_days_missing' },
          realAccuracyAvailable: false,
        },
        numericalErrorAvailable: false,
        realAccuracyAvailable: false, realForecastEligible: false,
      });
      expect(JSON.stringify(paidWindow.body.data)).not.toContain('1400.00');
      expect(paidWindow.body.data).not.toHaveProperty('digest');
      const foreignWindow = await request(f.app)
        .get(`${root}/complete-price-flow-evaluation-window`)
        .set('Cookie', f.actors.otherOwner.session.headers.Cookie);
      expect(foreignWindow.status).toBe(200);
      expect(foreignWindow.body.data).toMatchObject({
        state: 'evaluation_window_unavailable',
        reason: 'no_completed_saved_origin', realAccuracyAvailable: false,
      });
      const postHorizonReceiptId = await capturePriceThroughGuardedSource();
      const actual = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}/actual-candidates/${postHorizonReceiptId}`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(actual.status).toBe(200);
      expect(actual.body.data).toMatchObject({
        state: 'price_flow_actual_candidate', amount: null,
        firstApprovalCount: null, selectedSourceFinalizedAtCapture: true,
        outcomeFinalized: false });
      const internalActual = await f.ownerPool.query(
        'SELECT public.canonical_forecast_price_flow_actual_candidate($1,$2,$3,$4,$5,$6) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, runId, postHorizonReceiptId]);
      expect(internalActual.rows[0].value).toMatchObject({
        state: 'price_flow_actual_candidate', amount: '1400.00',
        firstApprovalCount: 1, outcomeFinalized: false });
      try {
        await f.ownerPool.query(`ALTER TABLE
          canonical_forecast_price_decision_commit_observations
          DISABLE TRIGGER canonical_forecast_price_decision_commit_immutable`);
        await f.ownerPool.query(`UPDATE
          canonical_forecast_price_decision_commit_observations
          SET observed_at=$2 WHERE decision_id=$1`, [decisionId, new Date()]);
      } finally {
        await f.ownerPool.query(`ALTER TABLE
          canonical_forecast_price_decision_commit_observations
          ENABLE TRIGGER canonical_forecast_price_decision_commit_immutable`);
      }
      const lateWitness = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}/actual-candidates/${postHorizonReceiptId}`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(lateWitness.status).toBe(200);
      expect(lateWitness.body.data).toMatchObject({
        state: 'price_flow_actual_unavailable',
        reason: 'event_commit_boundary_unverified', amount: null,
        outcomeFinalized: false });
      try {
        await f.ownerPool.query(`ALTER TABLE
          canonical_forecast_price_decision_commit_observations
          DISABLE TRIGGER canonical_forecast_price_decision_commit_immutable`);
        await f.ownerPool.query(`UPDATE
          canonical_forecast_price_decision_commit_observations
          SET observed_at=$2 WHERE decision_id=$1`, [decisionId, witnessAt]);
      } finally {
        await f.ownerPool.query(`ALTER TABLE
          canonical_forecast_price_decision_commit_observations
          ENABLE TRIGGER canonical_forecast_price_decision_commit_immutable`);
      }
      const actualKey = key();
      const deniedActual = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/actual-receipts`)
        .set(f.actors.member.session.headers)
        .set('Idempotency-Key', key())
        .send({ sourceReceiptId: postHorizonReceiptId });
      expect(deniedActual.status).toBe(403);
      const missingEvaluation = await request(f.app)
        .post(`${root}/saved-price-flow-rolling-pairs`)
        .set(owner().session.headers).set('Idempotency-Key', key())
        .query({ firstRunId: runId, secondRunId }).send({});
      expect(missingEvaluation.status).toBe(201);
      expect(missingEvaluation.body.data).toMatchObject({
        state: 'price_flow_evaluation_saved', revision: 1 });
      const missingManifest = await request(f.app)
        .get(`${root}/saved-price-flow-evaluations/${missingEvaluation.body.data.evaluationId}/manifest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(missingManifest.status).toBe(200);
      expect(missingManifest.body.data).toMatchObject({
        originCount: 2, pairedCount: 0, accuracyAvailable: false });
      expect(missingManifest.body.data.origins.map(item => item.currentStatus))
        .toEqual(['missing', 'missing']);
      const savedActual = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/actual-receipts`)
        .set(owner().session.headers).set('Idempotency-Key', actualKey)
        .send({ sourceReceiptId: postHorizonReceiptId });
      expect(savedActual.status).toBe(201);
      expect(savedActual.body.data).toMatchObject({
        state: 'price_flow_actual_recorded', revision: 1,
        actualState: 'known', amount: null, firstApprovalCount: null,
        selectedSourceFinalizedAtCapture: true,
        wholeBusinessCoverageVerified: false,
        realForecastEligible: false });
      const actualReplay = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/actual-receipts`)
        .set(owner().session.headers).set('Idempotency-Key', actualKey)
        .send({ sourceReceiptId: postHorizonReceiptId });
      expect(actualReplay.status).toBe(200);
      expect(actualReplay.body.data).toMatchObject({
        receiptId: savedActual.body.data.receiptId,
        revision: 1, replayed: true,
        amount: null, firstApprovalCount: null });
      const latest = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}/actual-receipts/latest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(latest.status).toBe(200);
      expect(latest.body.data).toMatchObject({
        state: 'price_flow_actual_finalized', revision: 1,
        amount: null, firstApprovalCount: null, outcomeFinalized: true,
        wholeBusinessCoverageVerified: false,
        realForecastEligible: false });
      const internalSaved = await f.ownerPool.query(
        'SELECT public.canonical_forecast_price_flow_actual_read($1,$2,$3,$4,$5) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, runId]);
      expect(internalSaved.rows[0].value).toMatchObject({
        state: 'price_flow_actual_finalized', amount: 1400,
        firstApprovalCount: 1, outcomeFinalized: true });
      const pairedActual = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_pair_actual_read($1,$2,$3,$4,$5) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, runId]);
      expect(pairedActual.rows[0].value).toMatchObject({
        state: 'pair_actual_known', amount: '1400.00',
        receiptId: savedActual.body.data.receiptId });
      const partialManifest = await request(f.app)
        .get(`${root}/saved-price-flow-evaluations/${missingEvaluation.body.data.evaluationId}/manifest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(partialManifest.status).toBe(200);
      expect(partialManifest.body.data).toMatchObject({
        originCount: 2, pairedCount: 0 });
      expect(partialManifest.body.data.origins.map(item => item.currentStatus))
        .toEqual(['late_outcome', 'missing']);
      const secondActual = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${secondRunId}/actual-receipts`)
        .set(owner().session.headers).set('Idempotency-Key', key())
        .send({ sourceReceiptId: postHorizonReceiptId });
      expect(secondActual.body.data).toMatchObject({
        state: 'price_flow_actual_recorded', actualState: 'known',
        amount: null, firstApprovalCount: null });
      expect(secondActual.status).toBe(201);
      const lateManifest = await request(f.app)
        .get(`${root}/saved-price-flow-evaluations/${missingEvaluation.body.data.evaluationId}/manifest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(lateManifest.status).toBe(200);
      expect(lateManifest.body.data.origins.map(item => item.currentStatus))
        .toEqual(['late_outcome', 'late_outcome']);
      const secondPairedActual = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_pair_actual_read($1,$2,$3,$4,$5) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, secondRunId]);
      expect(secondPairedActual.rows[0].value).toMatchObject({
        state: 'pair_actual_known', amount: '0.00',
        receiptId: secondActual.body.data.receiptId });
      const paired = await request(f.app)
        .get(`${root}/saved-price-flow-rolling-pairs`)
        .set('Cookie', owner().session.headers.Cookie)
        .query({ firstRunId: runId, secondRunId });
      expect(paired.status).toBe(200);
      expect(paired.body.data).toMatchObject({
        state: 'rolling_pairs_candidate', originCount: 2,
        evaluationSaved: false, accuracyAvailable: false,
        realForecastEligible: false });
      expect(paired.body.data.comparisons).toHaveLength(2);
      expect(paired.body.data.comparisons.map(item => item.status))
        .toEqual(['paired', 'paired']);
      expect(JSON.stringify(paired.body.data)).not.toContain('1400.00');
      expect(paired.body.data).not.toHaveProperty('digest');
      expect(paired.body.data.comparisons[0]).not.toHaveProperty('digest');
      const foreignPair = await request(f.app)
        .get(`${root}/saved-price-flow-rolling-pairs`)
        .set('Cookie', f.actors.otherOwner.session.headers.Cookie)
        .query({ firstRunId: runId, secondRunId });
      expect(foreignPair.status).toBe(200);
      expect(foreignPair.body.data).toMatchObject({
        state: 'rolling_pairs_unavailable',
        reason: 'source_evidence_unavailable',
        evaluationSaved: false });
      expect(foreignPair.body.data?.comparisons).toBeUndefined();
      const evaluationKey = key();
      const savedEvaluation = await request(f.app)
        .post(`${root}/saved-price-flow-rolling-pairs`)
        .set(owner().session.headers)
        .set('Idempotency-Key', evaluationKey)
        .query({ firstRunId: runId, secondRunId }).send({});
      expect(savedEvaluation.status).toBe(201);
      expect(savedEvaluation.body.data).toMatchObject({
        state: 'price_flow_evaluation_saved', revision: 2,
        replayed: false, accuracyAvailable: false,
        forecastValueAvailable: false, realForecastEligible: false });
      const savedReplay = await request(f.app)
        .post(`${root}/saved-price-flow-rolling-pairs`)
        .set(owner().session.headers)
        .set('Idempotency-Key', evaluationKey)
        .query({ firstRunId: runId, secondRunId }).send({});
      expect(savedReplay.status).toBe(200);
      expect(savedReplay.body.data).toMatchObject({
        evaluationId: savedEvaluation.body.data.evaluationId,
        revision: 2, replayed: true });
      const secondEvaluationKey = key();
      const sameResultNewKey = await request(f.app)
        .post(`${root}/saved-price-flow-rolling-pairs`)
        .set(owner().session.headers)
        .set('Idempotency-Key', secondEvaluationKey)
        .query({ firstRunId: runId, secondRunId }).send({});
      expect(sameResultNewKey.status).toBe(201);
      expect(sameResultNewKey.body.data).toMatchObject({
        state: 'price_flow_evaluation_saved', revision: 3,
        previousId: savedEvaluation.body.data.evaluationId, replayed: false });
      expect(JSON.stringify(savedEvaluation.body.data)).not.toContain('1400.00');
      expect(savedEvaluation.body.data).not.toHaveProperty('resultDigest');
      const manifest = await request(f.app)
        .get(`${root}/saved-price-flow-evaluations/${savedEvaluation.body.data.evaluationId}/manifest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(manifest.status).toBe(200);
      expect(manifest.body.data).toMatchObject({
        state: 'evaluation_manifest_available', revision: 2,
        originCount: 2, pairedCount: 2, accuracyAvailable: false,
        realForecastEligible: false });
      expect(manifest.body.data.origins.map(item => item.currentStatus))
        .toEqual(['paired', 'paired']);
      expect(JSON.stringify(manifest.body.data)).not.toContain('1400.00');
      const measurement = await request(f.app)
        .get(`${root}/saved-price-flow-evaluations/${savedEvaluation.body.data.evaluationId}/measurement`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(measurement.status).toBe(200);
      expect(measurement.body.data).toMatchObject({
        state: 'evaluation_descriptive_only', originCount: 2,
        comparisonCount: 2, statusCounts: { paired: 2 },
        currentStatusCounts: { paired: 2 },
        savedOriginPopulation: {
          state: 'bounded_saved_origin_inventory_verified',
          storedOriginCount: 2, matchingContextCount: 2,
          omittedMatchingCount: 0,
          unsavedOriginCoverageVerified: false,
          wholeBusinessCoverageVerified: false,
        },
        descriptiveErrorAvailable: false,
        sampleSufficiency: { state: 'unavailable' },
        calibration: { state: 'unavailable' },
        drift: { state: 'unavailable' },
        policy: {
          scope: 'selected_northstar_m24_saved_price_flow_only',
          denominator: {
            pairedFraction: { numerator: 2, denominator: 2 },
            boundedSavedOriginInventoryVerified: true,
          },
          intervalCoverage: { state: 'not_applicable',
            reason: 'point_only_target' },
          sampleSufficiency: { state: 'unavailable',
            reason: 'unsaved_origin_and_empirical_independence_unverified' },
          realAccuracyAvailable: false,
        },
        realAccuracyAvailable: false, realForecastEligible: false });
      expect(JSON.stringify(measurement.body.data)).not.toContain('1400.00');
      expect(measurement.body.data).not.toHaveProperty('digest');
      const foreignManifest = await request(f.app)
        .get(`${root}/saved-price-flow-evaluations/${savedEvaluation.body.data.evaluationId}/manifest`)
        .set('Cookie', f.actors.otherOwner.session.headers.Cookie);
      expect(foreignManifest.status).toBe(200);
      expect(foreignManifest.body.data).toMatchObject({
        state: 'evaluation_manifest_unavailable', reason: 'evaluation_not_found' });
      const foreignMeasurement = await request(f.app)
        .get(`${root}/saved-price-flow-evaluations/${savedEvaluation.body.data.evaluationId}/measurement`)
        .set('Cookie', f.actors.otherOwner.session.headers.Cookie);
      expect(foreignMeasurement.status).toBe(200);
      expect(foreignMeasurement.body.data).toMatchObject({
        state: 'evaluation_measurement_unavailable',
        reason: 'source_evidence_unavailable', realAccuracyAvailable: false });
      expect(foreignMeasurement.body.data).not.toHaveProperty('statusCounts');
      // Owner-SQL fictional fixture: a third stored same-context candidate in
      // the selected capture span must make the two-origin selection incomplete.
      await f.ownerPool.query(`
        INSERT INTO canonical_forecast_price_flow_saved_origins (
          organization_id,id,saved_at,horizon_start,horizon_end,
          source_receipt_id,output,receipt_digest,actor_user_id,
          auth_session_id,request_key_hash,request_digest)
        SELECT b.organization_id,gen_random_uuid(),
          a.saved_at+(b.saved_at-a.saved_at)/2,b.horizon_start,b.horizon_end,
          b.source_receipt_id,b.output,b.receipt_digest,b.actor_user_id,
          b.auth_session_id,
          encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),
          b.request_digest
        FROM canonical_forecast_price_flow_saved_origins a
        JOIN canonical_forecast_price_flow_saved_origins b
          ON b.organization_id=a.organization_id
        WHERE a.organization_id=$1 AND a.id=$2 AND b.id=$3
      `, [f.org, runId, secondRunId]);
      const incompletePopulation = await request(f.app)
        .get(`${root}/saved-price-flow-evaluations/${savedEvaluation.body.data.evaluationId}/measurement`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(incompletePopulation.status).toBe(200);
      expect(incompletePopulation.body.data.savedOriginPopulation).toMatchObject({
        state: 'evaluation_selection_incomplete',
        storedOriginCount: 3, matchingContextCount: 3,
        omittedMatchingCount: 1,
        unsavedOriginCoverageVerified: false });
      expect(incompletePopulation.body.data.policy.sampleSufficiency)
        .toMatchObject({ state: 'unavailable',
          reason: 'selected_origin_population_incomplete' });
      const unprovenWindow = await request(f.app)
        .get(`${root}/complete-price-flow-evaluation-window`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(unprovenWindow.status).toBe(200);
      expect(unprovenWindow.body.data).toMatchObject({
        state: 'evaluation_window_unavailable',
        reason: 'source_evidence_unavailable',
        realAccuracyAvailable: false, realForecastEligible: false });
      const deniedEvaluation = await request(f.app)
        .post(`${root}/saved-price-flow-rolling-pairs`)
        .set(f.actors.member.session.headers)
        .set('Idempotency-Key', key())
        .query({ firstRunId: runId, secondRunId }).send({});
      expect(deniedEvaluation.status).toBe(403);
      const foreignEvaluation = await request(f.app)
        .post(`${root}/saved-price-flow-rolling-pairs`)
        .set(f.actors.otherOwner.session.headers)
        .set('Idempotency-Key', key())
        .query({ firstRunId: runId, secondRunId }).send({});
      expect(foreignEvaluation.status).toBe(200);
      expect(foreignEvaluation.body.data).toMatchObject({
        state: 'rolling_pairs_unavailable', evaluationSaved: false });
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_flow_evaluations'))
        .rejects.toMatchObject({ code: '42501' });
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_flow_actual_receipts'))
        .rejects.toMatchObject({ code: '42501' });
      const estimate = f.estimateGraphs[0].ids.estimate;
      const route = `/api/v1/canonical/estimates/${estimate}`;
      const current = await request(f.app).get(`${route}/review`)
        .set(owner().session.headers);
      expect(current.status).toBe(200);
      const withdrawal = await request(f.app).post(`${route}/decisions`)
        .set(owner().session.headers).set('Idempotency-Key', key())
        .send({ action: 'withdraw',
          expectedRevision: current.body.data.decisions.current.revision,
          expectedDigest: current.body.data.decisions.current.digest,
          sourcePins: current.body.data.pins, scopeSummary: null,
          priceBeforeTax: null, currency: current.body.data.currency,
          reason: 'Fictional owner withdrawal.', confirmed: true,
          confirmationVersion: 'estimate-quote-preparation-v1' });
      expect(withdrawal.status).toBe(201);
      const stale = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}/actual-receipts/latest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(stale.status).toBe(200);
      expect(stale.body.data).toMatchObject({
        state: 'price_flow_actual_unavailable', reason: 'source_changed',
        amount: null, outcomeFinalized: false });
      const unverifiedManifest = await request(f.app)
        .get(`${root}/saved-price-flow-evaluations/${missingEvaluation.body.data.evaluationId}/manifest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(unverifiedManifest.status).toBe(200);
      expect(unverifiedManifest.body.data.origins.map(item => item.currentStatus))
        .toEqual(['stale', 'stale']);
      expect(unverifiedManifest.body.data.origins.map(item => item.reason))
        .toEqual(['actual_source_changed', 'actual_source_changed']);
      const correctedSource = await capturePriceThroughGuardedSource();
      const unverifiedClient = await f.runtimePool.connect();
      try {
        await unverifiedClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const transientActual = (await unverifiedClient.query(
          'SELECT public.canonical_forecast_capture_price_flow_actual($1,$2,$3,$4,$5,$6,$7,$8) value',
          [f.org, owner().actorUserId, owner().actorAccessRole,
            owner().authSessionId, owner().csrfToken, key(), runId,
            correctedSource])).rows[0].value;
        expect(transientActual).toMatchObject({
          state: 'price_flow_actual_recorded', revision: 2,
          actualState: 'revoked',
        });
        const transientManifest = (await unverifiedClient.query(
          'SELECT public.canonical_forecast_price_flow_evaluation_manifest($1,$2,$3,$4,$5) value',
          [f.org, owner().actorUserId, owner().actorAccessRole,
            owner().authSessionId, savedEvaluation.body.data.evaluationId]))
          .rows[0].value;
        expect(transientManifest.origins.find(item =>
          item.forecastRunId === runId)).toMatchObject({
          currentStatus: 'excluded', reason: 'actual_commit_unverified',
        });
      } finally {
        await unverifiedClient.query('ROLLBACK').catch(() => {});
        unverifiedClient.release();
      }
      const correction = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/actual-receipts`)
        .set(owner().session.headers).set('Idempotency-Key', key())
        .send({ sourceReceiptId: correctedSource });
      expect(correction.status).toBe(201);
      expect(correction.body.data).toMatchObject({
        state: 'price_flow_actual_recorded', revision: 2,
        actualState: 'revoked', amount: null,
        previousId: savedActual.body.data.receiptId });
      const revised = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}/actual-receipts/latest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(revised.status).toBe(200);
      expect(revised.body.data).toMatchObject({
        state: 'price_flow_actual_revoked', revision: 2,
        amount: null, outcomeFinalized: false });
      const revokedPair = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_pair_actual_read($1,$2,$3,$4,$5) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, runId]);
      expect(revokedPair.rows[0].value).toMatchObject({
        state: 'pair_actual_revoked', amount: null,
        reason: 'source_revoked', receiptId: correction.body.data.receiptId });
      const revokedManifest = await request(f.app)
        .get(`${root}/saved-price-flow-evaluations/${missingEvaluation.body.data.evaluationId}/manifest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(revokedManifest.status).toBe(200);
      expect(revokedManifest.body.data.origins.map(item => item.currentStatus))
        .toEqual(['revoked', 'stale']);
      const revisedPairs = await request(f.app)
        .get(`${root}/saved-price-flow-rolling-pairs`)
        .set('Cookie', owner().session.headers.Cookie)
        .query({ firstRunId: runId, secondRunId });
      expect(revisedPairs.status).toBe(200);
      expect(revisedPairs.body.data).toMatchObject({
        state: 'rolling_pairs_candidate', evaluationSaved: false,
        accuracyAvailable: false, realForecastEligible: false });
      expect(revisedPairs.body.data.comparisons.map(item => item.status))
        .toEqual(['outcome_unavailable', 'outcome_unavailable']);
      expect(JSON.stringify(revisedPairs.body.data)).not.toContain('1400.00');
      const staleManifest = await request(f.app)
        .get(`${root}/saved-price-flow-evaluations/${savedEvaluation.body.data.evaluationId}/manifest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(staleManifest.status).toBe(200);
      expect(staleManifest.body.data).toMatchObject({
        state: 'evaluation_manifest_available', revision: 2,
        originCount: 2, pairedCount: 0 });
      expect(staleManifest.body.data.origins.map(item => item.currentStatus))
        .toEqual(['stale', 'stale']);
      const staleMeasurement = await request(f.app)
        .get(`${root}/saved-price-flow-evaluations/${savedEvaluation.body.data.evaluationId}/measurement`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(staleMeasurement.status).toBe(200);
      expect(staleMeasurement.body.data).toMatchObject({
        state: 'evaluation_descriptive_only',
        statusCounts: { paired: 2 }, currentStatusCounts: { stale: 2 },
        descriptiveErrorAvailable: false, realAccuracyAvailable: false });
      const oldKeyAfterSourceChange = await request(f.app)
        .post(`${root}/saved-price-flow-rolling-pairs`)
        .set(owner().session.headers)
        .set('Idempotency-Key', secondEvaluationKey)
        .query({ firstRunId: runId, secondRunId }).send({});
      expect(oldKeyAfterSourceChange.status).toBe(200);
      expect(oldKeyAfterSourceChange.body.data).toMatchObject({
        evaluationId: sameResultNewKey.body.data.evaluationId,
        revision: 3, replayed: true });
      const revisedEvaluation = await request(f.app)
        .post(`${root}/saved-price-flow-rolling-pairs`)
        .set(owner().session.headers)
        .set('Idempotency-Key', key())
        .query({ firstRunId: runId, secondRunId }).send({});
      expect(revisedEvaluation.status).toBe(201);
      expect(revisedEvaluation.body.data).toMatchObject({
        state: 'price_flow_evaluation_saved', revision: 4,
        previousId: sameResultNewKey.body.data.evaluationId,
        accuracyAvailable: false, realForecastEligible: false });
      const revokedSavedManifest = await request(f.app)
        .get(`${root}/saved-price-flow-evaluations/${revisedEvaluation.body.data.evaluationId}/manifest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(revokedSavedManifest.status).toBe(200);
      expect(revokedSavedManifest.body.data.origins.find(item =>
        item.forecastRunId === runId)).toMatchObject({
        currentStatus: 'revoked', reason: 'actual_revoked',
      });
      const evaluationHistory = await f.ownerPool.query(`
        SELECT revision,previous_id,result FROM canonical_forecast_price_flow_evaluations
        WHERE organization_id=$1 ORDER BY revision`, [f.org]);
      expect(evaluationHistory.rows).toHaveLength(4);
      expect(evaluationHistory.rows[0].result.comparisons.map(item => item.status))
        .toEqual(['outcome_unavailable', 'outcome_unavailable']);
      expect(evaluationHistory.rows[1].result.comparisons.map(item => item.status))
        .toEqual(['paired', 'paired']);
      expect(evaluationHistory.rows[2].result.comparisons.map(item => item.status))
        .toEqual(['paired', 'paired']);
      expect(evaluationHistory.rows[3].result.comparisons.map(item => item.status))
        .toEqual(['outcome_unavailable', 'outcome_unavailable']);
      const firstReader = await f.runtimePool.connect();
      const contendingReader = await f.runtimePool.connect();
      const replayArgs = [f.org, owner().actorUserId,
        owner().actorAccessRole, owner().authSessionId,
        owner().csrfToken, key(), runId, secondRunId];
      try {
        await firstReader.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const held = await firstReader.query(
          'SELECT public.canonical_forecast_price_flow_evaluation_replay($1,$2,$3,$4,$5,$6,$7,$8) value',
          replayArgs);
        expect(held.rows[0].value).toMatchObject({
          state: 'price_flow_evaluation_new' });
        await contendingReader.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await expect(contendingReader.query(
          'SELECT public.canonical_forecast_price_flow_evaluation_replay($1,$2,$3,$4,$5,$6,$7,$8) value',
          [...replayArgs.slice(0, 5), key(), ...replayArgs.slice(6)]))
          .rejects.toMatchObject({ code: '55P03' });
      } finally {
        await contendingReader.query('ROLLBACK').catch(() => {});
        await firstReader.query('ROLLBACK').catch(() => {});
        firstReader.release();
        contendingReader.release();
      }
      await f.ownerPool.query(
        "UPDATE organization_memberships SET status='suspended' WHERE organization_id=$1 AND user_id=$2",
        [f.org, owner().actorUserId]);
      try {
        const lostAccess = await request(f.app)
          .get(`${root}/saved-price-flow-evaluations/${savedEvaluation.body.data.evaluationId}/manifest`)
          .set('Cookie', owner().session.headers.Cookie);
        expect([401, 403]).toContain(lostAccess.status);
        expect(lostAccess.body.data?.origins).toBeUndefined();
        const lostMeasurement = await request(f.app)
          .get(`${root}/saved-price-flow-evaluations/${savedEvaluation.body.data.evaluationId}/measurement`)
          .set('Cookie', owner().session.headers.Cookie);
        expect([401, 403]).toContain(lostMeasurement.status);
        expect(lostMeasurement.body.data?.statusCounts).toBeUndefined();
      } finally {
        await f.ownerPool.query(
          "UPDATE organization_memberships SET status='active' WHERE organization_id=$1 AND user_id=$2",
          [f.org, owner().actorUserId]);
      }
      const history = await f.ownerPool.query(
        `SELECT revision,state,amount FROM canonical_forecast_price_flow_actual_receipts
         WHERE run_id=$1 ORDER BY revision`, [runId]);
      expect(history.rows.map(row => row.state)).toEqual(['known', 'revoked']);
      expect(history.rows[0].amount).toBe('1400.00');
    }, 120000);
});
