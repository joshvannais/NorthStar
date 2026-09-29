'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } =
  require('../helpers/m24-estimate-review-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const root = '/api/v1/forecast/price-history';
const profileRoot = '/api/v1/forecast/reporting-windows/effective-anchors';
const day = 86400000;
const key = () => crypto.randomUUID();
const utc = value => new Date(value).toISOString();

realPostgres('Mission 26 Part 3D matched algorithm population', () => {
  let f;
  beforeAll(async () => { f = await createEstimateReviewFixture({
    operationalSchedule: true, additionalCompleteEstimates: 59,
  }); }, 300000);
  afterAll(async () => { if (f) await f.cleanup(); }, 300000);

  test('startup refuses missing entries and inherited registry authority, then recovers',
    async () => {
      const missing = await f.ownerPool.connect();
      try {
        await missing.query('BEGIN');
        await missing.query(`ALTER FUNCTION
          public.canonical_forecast_price_flow_matched_population(uuid,uuid,text,uuid,boolean)
          RENAME TO canonical_forecast_price_flow_matched_population_missing_for_test`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(missing,
          { runtimeRole: f.roles.runtime })).rejects.toThrow(
          'Runtime database role privilege verification failed');
        await missing.query('ROLLBACK');
      } catch (error) {
        await missing.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        missing.release();
      }

      const leaked = await f.ownerPool.connect();
      try {
        await leaked.query('BEGIN');
        await leaked.query(
          'GRANT SELECT ON canonical_forecast_price_flow_algorithms TO PUBLIC');
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(leaked,
          { runtimeRole: f.roles.runtime })).rejects.toThrow(
          'Runtime database role privilege verification failed');
        await leaked.query(
          'REVOKE SELECT ON canonical_forecast_price_flow_algorithms FROM PUBLIC');
        await leaked.query(`GRANT EXECUTE ON FUNCTION
          canonical_forecast_price_flow_registered_insert() TO PUBLIC`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(leaked,
          { runtimeRole: f.roles.runtime })).rejects.toThrow(
          'Runtime database role privilege verification failed');
        await leaked.query(`REVOKE EXECUTE ON FUNCTION
          canonical_forecast_price_flow_registered_insert() FROM PUBLIC`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(leaked,
          { runtimeRole: f.roles.runtime })).resolves.toBeUndefined();
        await leaked.query('ROLLBACK');
      } catch (error) {
        await leaked.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        leaked.release();
      }
    }, 300000);

  test('matched population scans use the bounded partial horizon indexes',
    async () => {
      const indexes = await f.ownerPool.query(`SELECT indexname FROM pg_indexes
        WHERE schemaname='public' AND indexname=ANY($1::text[])`, [[
        'canonical_forecast_price_flow_carry_horizon_lookup',
        'canonical_forecast_price_flow_zero_horizon_lookup',
      ]]);
      expect(indexes.rows.map(row => row.indexname).sort()).toEqual([
        'canonical_forecast_price_flow_carry_horizon_lookup',
        'canonical_forecast_price_flow_zero_horizon_lookup',
      ]);
      const client = await f.ownerPool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL enable_seqscan=off');
        const carry = await client.query(`EXPLAIN (FORMAT JSON)
          SELECT id FROM canonical_forecast_price_flow_saved_origins
          WHERE organization_id=$1 AND
            output->>'calculationVersion'='m26_price_flow_carry_forward_v1' AND
            horizon_end<=clock_timestamp()
          ORDER BY horizon_start DESC,id DESC LIMIT 1`, [f.org]);
        expect(JSON.stringify(carry.rows[0]['QUERY PLAN'])).toContain(
          'canonical_forecast_price_flow_carry_horizon_lookup');
        const zero = await client.query(`EXPLAIN (FORMAT JSON)
          SELECT id FROM canonical_forecast_price_flow_saved_origins
          WHERE organization_id=$1 AND horizon_start>=$2 AND
            horizon_start<$3 AND
            output->>'calculationVersion'='m26_price_flow_zero_baseline_v1'
          ORDER BY horizon_start,id LIMIT 101`, [f.org,
          new Date(Date.now() - 60 * day), new Date()]);
        expect(JSON.stringify(zero.rows[0]['QUERY PLAN'])).toContain(
          'canonical_forecast_price_flow_zero_horizon_lookup');
        await client.query('ROLLBACK');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }, 300000);

  test('sixty fictional source-owned matched origins and actuals remain private and non-promoting',
    async () => {
      const owner = f.actors.owner;
      const args = [f.org, owner.actorUserId, owner.actorAccessRole,
        owner.authSessionId];
      const estimates = [f.estimateGraphs[0], ...f.estimateGraphs.slice(2)];
      expect(estimates).toHaveLength(60);
      const first = await request(f.app).post(`${root}/ordered-snapshots`)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({});
      expect(first.status).toBe(201);
      const activated = await request(f.app)
        .post(`${root}/ordered-anchor/activate`)
        .set(owner.session.headers).send({});
      expect(activated.status).toBe(200);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const future = new Date(today.getTime() + day);
      const futureEnd = new Date(future.getTime() + day);
      const start = new Date(today.getTime() - 60 * day);
      const coverageBefore = new Date(start.getTime() - 4 * day);
      const profile = await request(f.app).post(profileRoot)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ reason: 'Fictional source-event-day population.',
          confirmed: true });
      expect(profile.status).toBe(201);
      const profileAnchorId = profile.body.data.anchorId;
      const profileActivation = await request(f.app)
        .post(`${profileRoot}/${profileAnchorId}/activate`)
        .set(owner.session.headers).send({});
      expect(profileActivation.status).toBe(200);
      // Owner-only clock changes are confined to this disposable fixture.
      // They exercise the mounted source writer and reader; they do not prove
      // genuinely elapsed days or production month/day-end balance.
      const anchorTriggers = [
        ['canonical_forecast_price_ordered_anchors',
          'canonical_forecast_price_ordered_anchors_immutable'],
        ['canonical_forecast_price_anchor_activations',
          'canonical_forecast_price_anchor_activations_immutable'],
      ];
      try {
        for (const [table, trigger] of anchorTriggers) {
          await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        }
        await f.ownerPool.query(`UPDATE canonical_forecast_price_ordered_anchors
          SET coverage_starts_at=$2 WHERE organization_id=$1`,
        [f.org, coverageBefore]);
        await f.ownerPool.query(`UPDATE canonical_forecast_price_anchor_activations
          SET observed_at=$2 WHERE organization_id=$1`,
        [f.org, coverageBefore]);
      } finally {
        for (const [table, trigger] of anchorTriggers.reverse()) {
          await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
      const runIds = [];
      const zeroRunIds = [];
      const receiptIds = [];
      const decisionIds = [];
      const sourceTriggers = [
        ['canonical_estimate_decisions',
          'canonical_estimate_decision_immutable'],
        ['canonical_forecast_price_decision_orders',
          'canonical_forecast_price_decision_order_immutable'],
      ];
      try {
        for (const [table, trigger] of sourceTriggers) {
          await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        }
        for (let index = 0; index < 60; index += 1) {
          const estimateId = estimates[index].ids.estimate;
          const path = `/api/v1/canonical/estimates/${estimateId}`;
          const review = await request(f.app).get(`${path}/review`)
            .set(owner.session.headers);
          expect(review.status).toBe(200);
          const approval = await request(f.app).post(`${path}/decisions`)
            .set(owner.session.headers).set('Idempotency-Key', key())
            .send({ action: 'approve', expectedRevision: 0,
              expectedDigest: 'none', sourcePins: review.body.data.pins,
              scopeSummary: `Fictional approval ${index + 1}.`,
              priceBeforeTax: '1400.00',
              currency: review.body.data.currency,
              reason: 'Fictional owner review.', confirmed: true,
              confirmationVersion: 'estimate-quote-preparation-v1' });
          expect(approval.status).toBe(201);
          const eventAt = new Date(start.getTime() + (index - 2) * day +
            10 * 3600000);
          const decisionId = approval.body.data.receipt.id;
          decisionIds.push(decisionId);
          await f.ownerPool.query(`UPDATE canonical_estimate_decisions
            SET created_at=$2 WHERE id=$1`, [decisionId, eventAt]);
          await f.ownerPool.query(`UPDATE canonical_forecast_price_decision_orders
            SET ordered_at=$2::timestamptz + interval '123 microseconds'
            WHERE decision_id=$1`, [decisionId, eventAt]);
          const observed = await f.runtimePool.query(
            'SELECT public.canonical_forecast_observe_price_decision_commit($1,$2,$3,$4,$5,$6) value',
            [...args, owner.csrfToken, decisionId]);
          expect(observed.rows[0].value.state).toBe(
            'price_decision_commit_observed');
          // Call the same mounted source-owned capture function directly so
          // the one-minute HTTP rate limit does not invalidate this synthetic
          // sixty-event stress fixture.
          const source = await f.runtimePool.query(
            'SELECT public.canonical_forecast_price_ordered_capture($1,$2,$3,$4,$5,$6) value',
            [...args, owner.csrfToken, key()]);
          expect(source.rows[0].value.snapshot.scope).toBe(
            'northstar_m24_approved_price_decisions');
          const receiptId = source.rows[0].value.snapshot.id;
          receiptIds.push(receiptId);
          const saved = await f.runtimePool.query(
            'SELECT public.canonical_forecast_capture_price_flow_origin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
            [...args, owner.csrfToken, key(), receiptId,
              'USD', future, futureEnd]);
          expect(saved.rows[0].value.state).toBe('saved_price_flow_origin');
          const runId = saved.rows[0].value.runId;
          runIds.push(runId);
          const proof = await f.runtimePool.query(
            'SELECT public.canonical_forecast_activate_price_flow_origin($1,$2,$3,$4,$5,$6) value',
            [...args, owner.csrfToken, runId]);
          expect(proof.rows[0].value.state).toBe('price_flow_origin_activated');
          const witness = await f.runtimePool.query(
            'SELECT public.canonical_forecast_price_flow_profile_observe($1,$2,$3,$4,$5,$6,$7) value',
            [...args, owner.csrfToken, runId, profileAnchorId]);
          expect(witness.rows[0].value.state).toBe('profile_witness_recorded');
          const zero = await f.runtimePool.query(
            'SELECT public.canonical_forecast_capture_price_flow_zero_baseline($1,$2,$3,$4,$5,$6,$7) value',
            [...args, owner.csrfToken, key(), runId]);
          expect(zero.rows[0].value.state).toBe('saved_price_flow_origin');
          const zeroRunId = zero.rows[0].value.runId;
          zeroRunIds.push(zeroRunId);
          const zeroProof = await f.runtimePool.query(
            'SELECT public.canonical_forecast_activate_price_flow_origin($1,$2,$3,$4,$5,$6) value',
            [...args, owner.csrfToken, zeroRunId]);
          expect(zeroProof.rows[0].value.state).toBe(
            'price_flow_origin_activated');
          const zeroWitness = await f.runtimePool.query(
            'SELECT public.canonical_forecast_price_flow_profile_observe($1,$2,$3,$4,$5,$6,$7) value',
            [...args, owner.csrfToken, zeroRunId, profileAnchorId]);
          expect(zeroWitness.rows[0].value.state).toBe(
            'profile_witness_recorded');
        }
      } finally {
        for (const [table, trigger] of sourceTriggers.reverse()) {
          await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
      expect(new Set(runIds).size).toBe(60);
      expect(new Set(zeroRunIds).size).toBe(60);
      expect(new Set(receiptIds).size).toBe(60);
      const mutable = [
        ['canonical_forecast_price_ordered_receipts',
          'canonical_forecast_price_ordered_receipts_immutable'],
        ['canonical_forecast_price_flow_saved_origins',
          'canonical_forecast_price_flow_origins_immutable'],
        ['canonical_forecast_price_flow_origin_activations',
          'canonical_forecast_price_flow_activation_immutable'],
        ['canonical_forecast_profile_effective_anchors',
          'canonical_forecast_profile_effective_anchors_immutable'],
        ['canonical_forecast_profile_effective_activations',
          'canonical_forecast_profile_effective_activations_immutable'],
        ['canonical_forecast_price_flow_profile_witnesses',
          'canonical_forecast_price_flow_profile_witness_immutable'],
        ['canonical_forecast_price_decision_commit_observations',
          'canonical_forecast_price_decision_commit_immutable'],
      ];
      try {
        for (const [table, trigger] of mutable) {
          await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        }
        const profileCaptured = new Date(start.getTime() - 13 * 3600000);
        await f.ownerPool.query(`UPDATE canonical_forecast_profile_effective_anchors
          SET captured_at=$2 WHERE id=$1`, [profileAnchorId, profileCaptured]);
        await f.ownerPool.query(`UPDATE canonical_forecast_profile_effective_activations
          SET observed_at=$2 WHERE anchor_id=$1`,
        [profileAnchorId, new Date(profileCaptured.getTime() + 3600000)]);
        for (let index = 0; index < 60; index += 1) {
          const horizon = new Date(start.getTime() + index * day);
          const horizonEnd = new Date(horizon.getTime() + day);
          const capturedAt = new Date(horizon.getTime() - 11 * 3600000);
          const savedAt = new Date(horizon.getTime() - 10 * 3600000);
          const proofAt = new Date(horizon.getTime() - 9 * 3600000);
          const witnessAt = new Date(horizon.getTime() - 8 * 3600000);
          const sourceEventAt = new Date(horizon.getTime() - 2 * day +
            10 * 3600000);
          await f.ownerPool.query(`
            UPDATE canonical_forecast_price_decision_commit_observations
            SET observed_at=$2 WHERE decision_id=$1`,
          [decisionIds[index],
            new Date(sourceEventAt.getTime() + 3600000)]);
          const changedSource = await f.ownerPool.query(`
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
          [receiptIds[index], capturedAt]);
          for (const currentRunId of [runIds[index], zeroRunIds[index]]) {
          const current = await f.ownerPool.query(`
            SELECT output FROM canonical_forecast_price_flow_saved_origins
            WHERE organization_id=$1 AND id=$2`, [f.org, currentRunId]);
          const output = { ...current.rows[0].output,
            asOf: utc(savedAt),
            sourceSnapshotDigest: changedSource.rows[0].digest,
            horizon: { startsAt: utc(horizon), endsAt: utc(horizonEnd),
              grain: 'day' },
            value: { kind: 'point', amount:
              currentRunId === runIds[index] ? '1400.00' : '0.00' },
            evidenceCoverage: { included: 1, excluded: 0, missing: 0,
              stale: 0, conflicting: 0 } };
          const changed = await f.ownerPool.query(`
            UPDATE canonical_forecast_price_flow_saved_origins
            SET saved_at=$3,horizon_start=$4,horizon_end=$5,
              output=$6::jsonb,
              receipt_digest=public.canonical_completion_digest($6::jsonb)
            WHERE organization_id=$1 AND id=$2 RETURNING receipt_digest`,
          [f.org, currentRunId, savedAt, horizon, horizonEnd,
            JSON.stringify(output)]);
          const currentProof = await f.ownerPool.query(`
            SELECT proof FROM canonical_forecast_price_flow_origin_activations
            WHERE organization_id=$1 AND run_id=$2`, [f.org, currentRunId]);
          const proof = { ...currentProof.rows[0].proof,
            savedReceiptDigest: changed.rows[0].receipt_digest,
            captureCommitObservedAt: utc(proofAt),
            horizonStartsAt: utc(horizon) };
          await f.ownerPool.query(`
            UPDATE canonical_forecast_price_flow_origin_activations
            SET observed_at=$3,proof=$4::jsonb,
              proof_digest=public.canonical_completion_digest($4::jsonb)
            WHERE organization_id=$1 AND run_id=$2`,
          [f.org, currentRunId, proofAt, JSON.stringify(proof)]);
          await f.ownerPool.query(`
            UPDATE canonical_forecast_price_flow_profile_witnesses
            SET observed_at=$3 WHERE organization_id=$1 AND run_id=$2`,
          [f.org, currentRunId, witnessAt]);
          }
        }
      } finally {
        for (const [table, trigger] of mutable.reverse()) {
          await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
      const postHorizon = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_ordered_capture($1,$2,$3,$4,$5,$6) value',
        [...args, owner.csrfToken, key()]);
      expect(postHorizon.rows[0].value.snapshot.eventCount).toBe(60);
      for (const runId of [...runIds, ...zeroRunIds]) {
        const actual = await f.runtimePool.query(
          'SELECT public.canonical_forecast_capture_price_flow_actual($1,$2,$3,$4,$5,$6,$7,$8) value',
          [...args, owner.csrfToken, key(), runId,
            postHorizon.rows[0].value.snapshot.id]);
        expect(actual.rows[0].value).toMatchObject({
          state: 'price_flow_actual_recorded', actualState: 'known',
          selectedSourceFinalizedAtCapture: true });
      }
      const matchedPopulation = await request(f.app)
        .get(`${root}/algorithm-matched-population`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(matchedPopulation.status).toBe(200);
      expect(matchedPopulation.body.data).toMatchObject({
        state: 'matched_population_observed',
        completeRegisteredPopulation: true,
        sourceEventDiversityVerified: true,
        counts: { storedBaseCount: 60, matchingBaseCount: 60,
          pairedCount: 60, distinctSourceEventDays: 60,
          candidateMissingCount: 0, unavailableCount: 0 },
        observationLag: { state: 'descriptive_only' },
        promotionAvailable: false, realForecastEligible: false });
      expect(JSON.stringify(matchedPopulation.body.data))
        .not.toContain('1400.00');
      const guardedReader = await f.runtimePool.connect();
      const competingWriter = await f.runtimePool.connect();
      try {
        await guardedReader.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await guardedReader.query("SET LOCAL statement_timeout = '15000ms'");
        await guardedReader.query("SET LOCAL lock_timeout = '2000ms'");
        const inventory = await guardedReader.query(
          'SELECT public.canonical_forecast_price_flow_matched_population($1,$2,$3,$4,FALSE) value',
          args);
        const selectedRunIds = inventory.rows[0].value.selectedRunIds;
        expect(selectedRunIds).toHaveLength(120);
        const acquired = await guardedReader.query(`
          SELECT bool_and(pg_try_advisory_xact_lock(hashtextextended(
            'm26:price-flow-actual:'||$1::text||':'||run_id::text,0))) locked
          FROM unnest($2::uuid[]) run_id`, [f.org, selectedRunIds]);
        expect(acquired.rows[0].locked).toBe(true);
        await competingWriter.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const blockedBeforeRead = await competingWriter.query(`
          SELECT pg_try_advisory_xact_lock(hashtextextended(
            'm26:price-flow-actual:'||$1::text||':'||$2::text,0)) locked`,
        [f.org, selectedRunIds[0]]);
        expect(blockedBeforeRead.rows[0].locked).toBe(false);
        const guardedPopulation = await guardedReader.query(
          'SELECT public.canonical_forecast_price_flow_matched_population($1,$2,$3,$4,TRUE) value',
          args);
        expect(guardedPopulation.rows[0].value).toMatchObject({
          state: 'matched_population_observed', pairedCount: 60,
          selectedRunIds,
        });
        const blockedAfterRead = await competingWriter.query(`
          SELECT pg_try_advisory_xact_lock(hashtextextended(
            'm26:price-flow-actual:'||$1::text||':'||$2::text,0)) locked`,
        [f.org, selectedRunIds[0]]);
        expect(blockedAfterRead.rows[0].locked).toBe(false);
        await guardedReader.query('COMMIT');
        const acquiredAfterCommit = await competingWriter.query(`
          SELECT pg_try_advisory_xact_lock(hashtextextended(
            'm26:price-flow-actual:'||$1::text||':'||$2::text,0)) locked`,
        [f.org, selectedRunIds[0]]);
        expect(acquiredAfterCommit.rows[0].locked).toBe(true);
      } finally {
        await guardedReader.query('ROLLBACK').catch(() => {});
        await competingWriter.query('ROLLBACK').catch(() => {});
        guardedReader.release();
        competingWriter.release();
      }
      const heldActualWriter = await f.runtimePool.connect();
      try {
        await heldActualWriter.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await heldActualWriter.query(`SELECT pg_advisory_xact_lock(
          hashtextextended('m26:price-flow-actual:'||$1::text||':'||$2::text,0))`,
        [f.org, runIds[0]]);
        const busyPopulation = await request(f.app)
          .get(`${root}/algorithm-matched-population`)
          .set('Cookie', owner.session.headers.Cookie);
        expect(busyPopulation.status).toBe(409);
        expect(busyPopulation.body.error.category).toBe(
          'FORECAST_SOURCE_BUSY');
      } finally {
        await heldActualWriter.query('ROLLBACK').catch(() => {});
        heldActualWriter.release();
      }
    }, 600000);
});
