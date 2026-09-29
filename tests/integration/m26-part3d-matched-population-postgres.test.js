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
const preciseUtc = value => utc(value).replace('Z', '000Z');

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

      const missingFixed = await f.ownerPool.connect();
      try {
        await missingFixed.query('BEGIN');
        await missingFixed.query(`ALTER FUNCTION
          public.canonical_forecast_price_flow_matched_population_at_anchor(
            uuid,uuid,text,uuid,uuid)
          RENAME TO canonical_forecast_price_flow_fixed_population_missing_for_test`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(missingFixed,
          { runtimeRole: f.roles.runtime })).rejects.toThrow(
          'Runtime database role privilege verification failed');
        await missingFixed.query('ROLLBACK');
      } catch (error) {
        await missingFixed.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        missingFixed.release();
      }

      const missingFixedPolicy = await f.ownerPool.connect();
      try {
        await missingFixedPolicy.query('BEGIN');
        await missingFixedPolicy.query(`ALTER FUNCTION
          public.canonical_forecast_price_flow_fixed_research_review(
            uuid,uuid,text,uuid,uuid)
          RENAME TO canonical_forecast_price_flow_fixed_review_missing_for_test`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(
          missingFixedPolicy, { runtimeRole: f.roles.runtime }))
          .rejects.toThrow('Runtime database role privilege verification failed');
        await missingFixedPolicy.query('ROLLBACK');
      } catch (error) {
        await missingFixedPolicy.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        missingFixedPolicy.release();
      }

      const missingStaging = await f.ownerPool.connect();
      try {
        await missingStaging.query('BEGIN');
        await missingStaging.query(`ALTER FUNCTION
          public.canonical_forecast_price_flow_stage_algorithm(
            uuid,uuid,text,uuid,text,text,integer,uuid,uuid,text,boolean)
          RENAME TO canonical_forecast_price_flow_stage_missing_for_test`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(
          missingStaging, { runtimeRole: f.roles.runtime }))
          .rejects.toThrow('Runtime database role privilege verification failed');
        await missingStaging.query('ROLLBACK');
      } catch (error) {
        await missingStaging.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        missingStaging.release();
      }

      const missingStagedRead = await f.ownerPool.connect();
      try {
        await missingStagedRead.query('BEGIN');
        await missingStagedRead.query(`ALTER FUNCTION
          public.canonical_forecast_price_flow_staged_read(
            uuid,uuid,text,uuid,uuid)
          RENAME TO canonical_forecast_price_flow_staged_read_missing_for_test`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(
          missingStagedRead, { runtimeRole: f.roles.runtime }))
          .rejects.toThrow('Runtime database role privilege verification failed');
        await missingStagedRead.query('ROLLBACK');
      } catch (error) {
        await missingStagedRead.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        missingStagedRead.release();
      }

      const missingSelectedOrigin = await f.ownerPool.connect();
      try {
        await missingSelectedOrigin.query('BEGIN');
        await missingSelectedOrigin.query(`ALTER FUNCTION
          public.canonical_forecast_capture_research_selected_price_flow_origin(
            uuid,uuid,text,uuid,text,text,uuid)
          RENAME TO canonical_forecast_capture_research_selected_origin_missing_for_test`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(
          missingSelectedOrigin, { runtimeRole: f.roles.runtime }))
          .rejects.toThrow('Runtime database role privilege verification failed');
        await missingSelectedOrigin.query('ROLLBACK');
      } catch (error) {
        await missingSelectedOrigin.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        missingSelectedOrigin.release();
      }

      const missingSelectedActivation = await f.ownerPool.connect();
      try {
        await missingSelectedActivation.query('BEGIN');
        await missingSelectedActivation.query(`ALTER FUNCTION
          public.canonical_forecast_activate_research_selected_price_flow_origin(
            uuid,uuid,text,uuid,text,uuid)
          RENAME TO canonical_forecast_activate_research_selected_origin_missing_for_test`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(
          missingSelectedActivation, { runtimeRole: f.roles.runtime }))
          .rejects.toThrow('Runtime database role privilege verification failed');
        await missingSelectedActivation.query('ROLLBACK');
      } catch (error) {
        await missingSelectedActivation.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        missingSelectedActivation.release();
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
        await leaked.query(`GRANT SELECT ON
          canonical_forecast_price_flow_research_selections TO PUBLIC`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(leaked,
          { runtimeRole: f.roles.runtime })).rejects.toThrow(
          'Runtime database role privilege verification failed');
        await leaked.query(`REVOKE SELECT ON
          canonical_forecast_price_flow_research_selections FROM PUBLIC`);
        await leaked.query(`GRANT EXECUTE ON FUNCTION
          canonical_forecast_price_flow_research_mac(text,bytea) TO PUBLIC`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(leaked,
          { runtimeRole: f.roles.runtime })).rejects.toThrow(
          'Runtime database role privilege verification failed');
        await leaked.query(`REVOKE EXECUTE ON FUNCTION
          canonical_forecast_price_flow_research_mac(text,bytea) FROM PUBLIC`);
        await leaked.query(`GRANT SELECT ON
          canonical_forecast_price_flow_research_selected_origins TO PUBLIC`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(leaked,
          { runtimeRole: f.roles.runtime })).rejects.toThrow(
          'Runtime database role privilege verification failed');
        await leaked.query(`REVOKE SELECT ON
          canonical_forecast_price_flow_research_selected_origins FROM PUBLIC`);
        await leaked.query(`GRANT SELECT ON
          canonical_forecast_price_flow_research_selected_activations TO PUBLIC`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(leaked,
          { runtimeRole: f.roles.runtime })).rejects.toThrow(
          'Runtime database role privilege verification failed');
        await leaked.query(`REVOKE SELECT ON
          canonical_forecast_price_flow_research_selected_activations FROM PUBLIC`);
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


  test('research review fails closed for incomplete, mistyped and null-lag population contracts',
    async () => {
      const owner = f.actors.owner;
      const client = await f.ownerPool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query(`CREATE OR REPLACE FUNCTION
          public.canonical_forecast_price_flow_matched_population(
            org uuid,actor uuid,role_value text,session_value uuid,
            include_pairs boolean)
          RETURNS jsonb LANGUAGE sql VOLATILE AS $$
            SELECT jsonb_build_object(
              'state','matched_population_observed',
              'selectedRunIds','[]'::jsonb,
              'items','[]'::jsonb,
              'sourceEventDiversityVerified',TRUE,
              'distinctSourceEventDays',60)
          $$`);
        const result = await client.query(
          'SELECT public.canonical_forecast_price_flow_research_review($1,$2,$3,$4) value',
          [f.org, owner.actorUserId, owner.actorAccessRole,
            owner.authSessionId]);
        expect(result.rows[0].value).toMatchObject({
          state: 'research_review_unavailable',
          reason: 'matched_population_incomplete',
          forecastServingEnabled: false });
        await client.query(`CREATE OR REPLACE FUNCTION
          public.canonical_forecast_price_flow_matched_population(
            org uuid,actor uuid,role_value text,session_value uuid,
            include_pairs boolean)
          RETURNS jsonb LANGUAGE sql VOLATILE AS $$
            SELECT jsonb_build_object(
              'state','matched_population_observed',
              'selectedRunIds','[]'::jsonb,
              'completeRegisteredPopulation',to_jsonb('true'::text),
              'sourceEventDiversityVerified',to_jsonb('true'::text),
              'distinctSourceEventDays',to_jsonb('60'::text),
              'items',(SELECT jsonb_agg('{}'::jsonb)
                FROM generate_series(1,60)))
          $$`);
        const mistyped = await client.query(
          'SELECT public.canonical_forecast_price_flow_research_review($1,$2,$3,$4) value',
          [f.org, owner.actorUserId, owner.actorAccessRole,
            owner.authSessionId]);
        expect(mistyped.rows[0].value).toMatchObject({
          state: 'research_review_unavailable',
          reason: 'matched_population_incomplete' });
        await client.query(`CREATE OR REPLACE FUNCTION
          public.canonical_forecast_price_flow_matched_population(
            org uuid,actor uuid,role_value text,session_value uuid,
            include_pairs boolean)
          RETURNS jsonb LANGUAGE sql VOLATILE AS $$
            SELECT jsonb_build_object(
              'state','matched_population_observed',
              'selectedRunIds','[]'::jsonb,
              'completeRegisteredPopulation',TRUE,
              'sourceEventDiversityVerified',TRUE,
              'distinctSourceEventDays',60,
              'items',(SELECT jsonb_agg(jsonb_build_object(
                'state','matched_algorithms_observed',
                'actualPairStatus','paired',
                'baseActual',jsonb_build_object(
                  'state','pair_actual_known'),
                'candidateActual',jsonb_build_object(
                  'state','pair_actual_known')))
                FROM generate_series(1,60)))
          $$`);
        const nullLag = await client.query(
          'SELECT public.canonical_forecast_price_flow_research_review($1,$2,$3,$4) value',
          [f.org, owner.actorUserId, owner.actorAccessRole,
            owner.authSessionId]);
        expect(nullLag.rows[0].value).toMatchObject({
          state: 'research_review_unavailable',
          reason: 'source_observation_lag_unverified' });

        const fixedArgs = [f.org, owner.actorUserId, owner.actorAccessRole,
          owner.authSessionId, key()];
        await client.query(`CREATE OR REPLACE FUNCTION
          public.canonical_forecast_price_flow_matched_population_at_anchor(
            org uuid,actor uuid,role_value text,session_value uuid,
            anchor_run_value uuid)
          RETURNS jsonb LANGUAGE sql VOLATILE AS $$
            SELECT jsonb_build_object(
              'state','matched_population_observed',
              'anchorRunId',anchor_run_value,
              'items','[]'::jsonb,
              'sourceEventDiversityVerified',TRUE,
              'distinctSourceEventDays',60)
          $$`);
        const fixedMissing = await client.query(
          'SELECT public.canonical_forecast_price_flow_fixed_research_review($1,$2,$3,$4,$5) value',
          fixedArgs);
        expect(fixedMissing.rows[0].value).toMatchObject({
          state: 'fixed_research_review_unavailable',
          reason: 'matched_population_incomplete',
          productionPromotionEligible: false });
        await client.query(`CREATE OR REPLACE FUNCTION
          public.canonical_forecast_price_flow_matched_population_at_anchor(
            org uuid,actor uuid,role_value text,session_value uuid,
            anchor_run_value uuid)
          RETURNS jsonb LANGUAGE sql VOLATILE AS $$
            SELECT jsonb_build_object(
              'state','matched_population_observed',
              'anchorRunId',anchor_run_value,
              'completeRegisteredPopulation',to_jsonb('true'::text),
              'sourceEventDiversityVerified',to_jsonb('true'::text),
              'distinctSourceEventDays',to_jsonb('60'::text),
              'items',(SELECT jsonb_agg('{}'::jsonb)
                FROM generate_series(1,60)))
          $$`);
        const fixedMistyped = await client.query(
          'SELECT public.canonical_forecast_price_flow_fixed_research_review($1,$2,$3,$4,$5) value',
          fixedArgs);
        expect(fixedMistyped.rows[0].value).toMatchObject({
          state: 'fixed_research_review_unavailable',
          reason: 'matched_population_incomplete' });
        await client.query(`CREATE OR REPLACE FUNCTION
          public.canonical_forecast_price_flow_matched_population_at_anchor(
            org uuid,actor uuid,role_value text,session_value uuid,
            anchor_run_value uuid)
          RETURNS jsonb LANGUAGE sql VOLATILE AS $$
            SELECT jsonb_build_object(
              'state','matched_population_observed',
              'anchorRunId',anchor_run_value,
              'completeRegisteredPopulation',TRUE,
              'sourceEventDiversityVerified',TRUE,
              'distinctSourceEventDays',60,
              'items',(SELECT jsonb_agg(jsonb_build_object(
                'state','matched_algorithms_observed',
                'actualPairStatus','paired',
                'horizonEnd','2026-01-01T00:00:00.000000Z',
                'baseActual',jsonb_build_object(
                  'state','pair_actual_known'),
                'candidateActual',jsonb_build_object(
                  'state','pair_actual_known')))
                FROM generate_series(1,60)))
          $$`);
        const fixedNullLag = await client.query(
          'SELECT public.canonical_forecast_price_flow_fixed_research_review($1,$2,$3,$4,$5) value',
          fixedArgs);
        expect(fixedNullLag.rows[0].value).toMatchObject({
          state: 'fixed_research_review_unavailable',
          reason: 'source_observation_lag_unverified' });
        await client.query(`CREATE OR REPLACE FUNCTION
          public.canonical_forecast_price_flow_matched_population_at_anchor(
            org uuid,actor uuid,role_value text,session_value uuid,
            anchor_run_value uuid)
          RETURNS jsonb LANGUAGE sql VOLATILE AS $$
            SELECT jsonb_build_object(
              'state','matched_population_observed',
              'anchorRunId',anchor_run_value,
              'completeRegisteredPopulation',TRUE,
              'sourceEventDiversityVerified',TRUE,
              'distinctSourceEventDays',60,
              'items',(SELECT jsonb_agg(jsonb_build_object(
                'state','matched_algorithms_observed',
                'actualPairStatus','paired',
                'horizonEnd','not-a-timestamp',
                'baseActual',jsonb_build_object(
                  'state','pair_actual_known',
                  'observedThrough','2026-01-01T00:00:00.000Z'),
                'candidateActual',jsonb_build_object(
                  'state','pair_actual_known',
                  'observedThrough','2026-01-01T00:00:00.000Z')))
                FROM generate_series(1,60)))
          $$`);
        const fixedMalformedLag = await client.query(
          'SELECT public.canonical_forecast_price_flow_fixed_research_review($1,$2,$3,$4,$5) value',
          fixedArgs);
        expect(fixedMalformedLag.rows[0].value).toMatchObject({
          state: 'fixed_research_review_unavailable',
          reason: 'source_observation_lag_unverified' });
        await client.query('ROLLBACK');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
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
        const busyResearchReview = await request(f.app)
          .get(`${root}/algorithm-research-review`)
          .set('Cookie', owner.session.headers.Cookie);
        expect(busyResearchReview.status).toBe(409);
        expect(busyResearchReview.body.error.category).toBe(
          'FORECAST_SOURCE_BUSY');
      } finally {
        await heldActualWriter.query('ROLLBACK').catch(() => {});
        heldActualWriter.release();
      }
      const reviewRoute = `${root}/algorithm-research-review`;
      const selectionRoute = `${root}/algorithm-research-selections`;
      const reviewed = await request(f.app).get(reviewRoute)
        .set('Cookie', owner.session.headers.Cookie);
      expect(reviewed.status).toBe(200);
      expect(reviewed.body.data).toMatchObject({
        state: 'research_review_ready', currentRevision: 0,
        currentEventId: null,
        humanResearchReviewAvailable: true,
        promotionAvailable: false, forecastServingEnabled: false,
        reviewToken: null });
      expect(JSON.stringify(reviewed.body.data)).not.toContain('1400.00');
      const challengeRoute = `${root}/algorithm-research-challenges`;
      const selectedKey = key();
      const selectionRequest = {
        expectedRevision: 0, action: 'select_candidate',
        algorithmVersion: 'm26_price_flow_zero_baseline_v1',
        reversesEventId: null,
        reason: 'Fictional owner review of complete M24 source comparison.' };
      const impossibleCandidate = await request(f.app).post(challengeRoute)
        .set(owner.session.headers).send({ ...selectionRequest,
          algorithmVersion: 'm26_price_flow_carry_forward_v1' });
      expect(impossibleCandidate.status).toBe(200);
      expect(impossibleCandidate.body.data).toMatchObject({
        state: 'research_challenge_unavailable',
        reason: 'selection_transition_invalid', reviewToken: null });
      const challenged = await request(f.app).post(challengeRoute)
        .set(owner.session.headers).send(selectionRequest);
      expect(challenged.status).toBe(200);
      expect(challenged.body.data).toMatchObject({
        state: 'research_challenge_ready',
        researchOnly: true, forecastServingEnabled: false });
      expect(challenged.body.data.reviewToken).toMatch(/^[a-f0-9]{64}$/);
      const fixedReview = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_matched_population_at_anchor($1,$2,$3,$4,$5) value',
        [...args, runIds[59]]);
      expect(fixedReview.rows[0].value).toMatchObject({
        state: 'matched_population_observed', anchorRunId: runIds[59],
        completeRegisteredPopulation: true });
      const fixedPolicy = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_fixed_research_review($1,$2,$3,$4,$5) value',
        [...args, runIds[59]]);
      expect(fixedPolicy.rows[0].value).toMatchObject({
        state: 'fixed_research_review_ready',
        anchorRunId: runIds[59],
        comparisonDigest: (await f.ownerPool.query(
          'SELECT public.canonical_completion_digest($1::jsonb) digest',
          [fixedReview.rows[0].value])).rows[0].digest,
        researchOnly: true, productionPromotionEligible: false,
        forecastServingEnabled: false });
      for (const table of [
        'canonical_forecast_price_ordered_receipts',
        'canonical_forecast_price_decision_orders',
        'canonical_forecast_price_decision_commit_observations',
      ]) await f.ownerPool.query(`VACUUM FREEZE ${table}`);
      const frozenFixedReview = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_matched_population_at_anchor($1,$2,$3,$4,$5) value',
        [...args, runIds[59]]);
      expect(frozenFixedReview.rows[0].value).toMatchObject({
        anchorRunId: runIds[59], completeRegisteredPopulation: true,
        distinctSourceEventDays: 60 });
      const savedCommitWitness = (await f.ownerPool.query(`
        SELECT observed_at,actor_user_id,auth_session_id
        FROM canonical_forecast_price_decision_commit_observations
        WHERE organization_id=$1 AND decision_id=$2`,
      [f.org, decisionIds[0]])).rows[0];
      const firstReceipt = (await f.ownerPool.query(`
        SELECT captured_at FROM canonical_forecast_price_ordered_receipts
        WHERE organization_id=$1 AND id=$2`,
      [f.org, receiptIds[0]])).rows[0];
      await f.ownerPool.query(`ALTER TABLE
        canonical_forecast_price_decision_commit_observations
        DISABLE TRIGGER canonical_forecast_price_decision_commit_immutable`);
      try {
        await f.ownerPool.query(`UPDATE
          canonical_forecast_price_decision_commit_observations
          SET observed_at=$3::timestamptz + interval '1 second'
          WHERE organization_id=$1 AND decision_id=$2`,
        [f.org, decisionIds[0], firstReceipt.captured_at]);
        const staleCommitWitness = await f.runtimePool.query(
          'SELECT public.canonical_forecast_price_flow_matched_population_at_anchor($1,$2,$3,$4,$5) value',
          [...args, runIds[59]]);
        expect(staleCommitWitness.rows[0].value).toMatchObject({
          sourceEventDiversityVerified: false,
          distinctSourceEventDays: 59 });
        const staleFixedPolicy = await f.runtimePool.query(
          'SELECT public.canonical_forecast_price_flow_fixed_research_review($1,$2,$3,$4,$5) value',
          [...args, runIds[59]]);
        expect(staleFixedPolicy.rows[0].value).toMatchObject({
          state: 'fixed_research_review_unavailable',
          reason: 'matched_population_incomplete',
          productionPromotionEligible: false });
        await f.ownerPool.query(`UPDATE
          canonical_forecast_price_decision_commit_observations
          SET observed_at=$3 WHERE organization_id=$1 AND decision_id=$2`,
        [f.org, decisionIds[0], savedCommitWitness.observed_at]);
        await f.ownerPool.query(`DELETE FROM
          canonical_forecast_price_decision_commit_observations
          WHERE organization_id=$1 AND decision_id=$2`,
        [f.org, decisionIds[0]]);
        const missingCommitWitness = await f.runtimePool.query(
          'SELECT public.canonical_forecast_price_flow_matched_population_at_anchor($1,$2,$3,$4,$5) value',
          [...args, runIds[59]]);
        expect(missingCommitWitness.rows[0].value).toMatchObject({
          sourceEventDiversityVerified: false,
          distinctSourceEventDays: 59 });
        const missingFixedPolicy = await f.runtimePool.query(
          'SELECT public.canonical_forecast_price_flow_fixed_research_review($1,$2,$3,$4,$5) value',
          [...args, runIds[59]]);
        expect(missingFixedPolicy.rows[0].value).toMatchObject({
          state: 'fixed_research_review_unavailable',
          reason: 'matched_population_incomplete',
          productionPromotionEligible: false });
      } finally {
        await f.ownerPool.query(`INSERT INTO
          canonical_forecast_price_decision_commit_observations(
            organization_id,decision_id,observed_at,actor_user_id,auth_session_id)
          VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(organization_id,decision_id) DO UPDATE SET
            observed_at=EXCLUDED.observed_at,
            actor_user_id=EXCLUDED.actor_user_id,
            auth_session_id=EXCLUDED.auth_session_id`,
        [f.org, decisionIds[0], savedCommitWitness.observed_at,
          savedCommitWitness.actor_user_id, savedCommitWitness.auth_session_id]);
        await f.ownerPool.query(`ALTER TABLE
          canonical_forecast_price_decision_commit_observations
          ENABLE TRIGGER canonical_forecast_price_decision_commit_immutable`);
      }
      const restoredFixedReview = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_matched_population_at_anchor($1,$2,$3,$4,$5) value',
        [...args, runIds[59]]);
      expect(restoredFixedReview.rows[0].value.completeRegisteredPopulation)
        .toBe(true);
      const restoredFixedPolicy = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_fixed_research_review($1,$2,$3,$4,$5) value',
        [...args, runIds[59]]);
      expect(restoredFixedPolicy.rows[0].value.state)
        .toBe('fixed_research_review_ready');
      const forgedDirect = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_research_select($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value',
        [...args, owner.csrfToken, key(), 0, 'select_candidate',
          'm26_price_flow_zero_baseline_v1', null,
          selectionRequest.reason, '0'.repeat(64), true]);
      expect(forgedDirect.rows[0].value).toMatchObject({
        state: 'research_selection_unavailable',
        reason: 'review_challenge_invalid' });
      const selectionBody = { ...selectionRequest,
        reviewToken: challenged.body.data.reviewToken, confirmed: true };
      const selected = await request(f.app).post(selectionRoute)
        .set(owner.session.headers).set('Idempotency-Key', selectedKey)
        .send(selectionBody);
      expect(selected.status).toBe(201);
      expect(selected.body.data).toMatchObject({
        state: 'research_selection_recorded', revision: 1,
        algorithmVersion: 'm26_price_flow_zero_baseline_v1',
        researchOnly: true, forecastServingEnabled: false,
        forecastValueAvailable: false, realForecastEligible: false,
        replayed: false });
      const selectionReceipt = await f.ownerPool.query(
        `SELECT actor_user_id,auth_session_id FROM
          canonical_forecast_price_flow_research_selections
          WHERE organization_id=$1 AND id=$2`,
        [f.org, selected.body.data.eventId]);
      expect(selectionReceipt.rows[0]).toEqual({
        actor_user_id: owner.actorUserId,
        auth_session_id: owner.authSessionId });
      const stagingRoute = `${root}/algorithm-staging`;
      const stagedRequest = { expectedRevision: 0,
        researchEventId: selected.body.data.eventId,
        anchorRunId: runIds[59],
        reason: 'Fictional owner stages the reviewed source comparison.',
        confirmed: true };
      // Even a fixed-review function reporting an older saved anchor as ready
      // cannot bind that unrelated cohort to the current rolling selection.
      const wrongCohort = await f.ownerPool.connect();
      try {
        await wrongCohort.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await wrongCohort.query(`CREATE OR REPLACE FUNCTION
          public.canonical_forecast_price_flow_fixed_research_review(
            org uuid,actor uuid,role_value text,session_value uuid,
            anchor_run_value uuid)
          RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER
          SET search_path=pg_catalog,public,pg_temp AS $$
            SELECT jsonb_build_object(
              'state','fixed_research_review_ready',
              'anchorRunId',anchor_run_value,
              'comparisonDigest',repeat('a',64),
              'researchOnly',TRUE,'productionPromotionEligible',FALSE,
              'forecastServingEnabled',FALSE)
          $$`);
        const rejected = await wrongCohort.query(
          'SELECT public.canonical_forecast_price_flow_stage_algorithm($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
          [...args, owner.csrfToken, key(), 0, selected.body.data.eventId,
            runIds[58],
            'Fictional owner cannot stage an unrelated valid cohort.', true]);
        expect(rejected.rows[0].value).toMatchObject({
          state: 'algorithm_staging_unavailable',
          reason: 'review_choice_cohort_changed',
          forecastServingEnabled: false });
        await wrongCohort.query('ROLLBACK');
      } catch (error) {
        await wrongCohort.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { wrongCohort.release(); }
      const stagedKey = key();
      await f.ownerPool.query(`CREATE FUNCTION m26_staging_delay()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_sleep(2); RETURN NEW; END $$`);
      await f.ownerPool.query(`CREATE TRIGGER m26_staging_delay
        BEFORE INSERT ON canonical_forecast_price_flow_staged_algorithms
        FOR EACH ROW EXECUTE FUNCTION m26_staging_delay()`);
      let stagedConcurrent;
      try {
        stagedConcurrent = await Promise.all([1, 2].map(() => request(f.app)
          .post(stagingRoute).set(owner.session.headers)
          .set('Idempotency-Key', stagedKey).send(stagedRequest)));
      } finally {
        await f.ownerPool.query(`DROP TRIGGER m26_staging_delay
          ON canonical_forecast_price_flow_staged_algorithms`);
        await f.ownerPool.query('DROP FUNCTION m26_staging_delay()');
      }
      expect(stagedConcurrent.map(value => value.status).sort())
        .toEqual([200, 201]);
      const staged = stagedConcurrent.find(value => value.status === 201);
      const stagedReplay = stagedConcurrent.find(value => value.status === 200);
      expect(staged.body.data).toMatchObject({
        state: 'algorithm_staged', revision: 1,
        algorithmVersion: 'm26_price_flow_zero_baseline_v1',
        forecastServingEnabled: false, forecastValueAvailable: false });
      expect(stagedReplay.headers['idempotency-replayed']).toBe('true');
      expect(stagedReplay.body.data).toMatchObject({
        eventId: staged.body.data.eventId, replayed: true });
      const stagedRead = await request(f.app)
        .get(`${stagingRoute}/${runIds[59]}`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(stagedRead.status).toBe(200);
      expect(stagedRead.body.data).toMatchObject({
        state: 'staged_algorithm_current', revision: 1,
        algorithmVersion: 'm26_price_flow_zero_baseline_v1',
        forecastServingEnabled: false, forecastValueAvailable: false });
      expect(JSON.stringify(stagedRead.body.data)).not.toContain('1400.00');
      // A rolling-only evidence drift invalidates the stage even while its
      // fixed cohort remains unchanged and ready.
      const rollingDrift = await f.ownerPool.connect();
      try {
        await rollingDrift.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const currentPopulation = (await rollingDrift.query(
          'SELECT public.canonical_forecast_price_flow_matched_population($1,$2,$3,$4,TRUE) value',
          args)).rows[0].value;
        const driftedPopulation = { ...currentPopulation,
          windowEnd: '2099-01-01T00:00:00.000000Z' };
        await rollingDrift.query(
          "SELECT set_config('m26.test_population',$1,TRUE)",
          [JSON.stringify(driftedPopulation)]);
        await rollingDrift.query(`CREATE OR REPLACE FUNCTION
          public.canonical_forecast_price_flow_matched_population(
            org uuid,actor uuid,role_value text,session_value uuid,
            include_pairs boolean)
          RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER
          SET search_path=pg_catalog,public,pg_temp AS $$
            SELECT current_setting('m26.test_population')::jsonb
          $$`);
        const drifted = await rollingDrift.query(
          'SELECT public.canonical_forecast_price_flow_staged_read($1,$2,$3,$4,$5) value',
          [...args, runIds[59]]);
        expect(drifted.rows[0].value).toMatchObject({
          state: 'staged_algorithm_unavailable',
          reason: 'staged_evidence_changed',
          forecastServingEnabled: false });
        await rollingDrift.query('ROLLBACK');
      } catch (error) {
        await rollingDrift.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { rollingDrift.release(); }
      const stagedMember = await request(f.app).post(stagingRoute)
        .set(f.actors.member.session.headers).set('Idempotency-Key', key())
        .send({ ...stagedRequest, expectedRevision: 1 });
      expect(stagedMember.status).toBe(403);
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_flow_staged_algorithms WHERE organization_id=$1',
        [f.org])).rejects.toMatchObject({ code: '42501' });
      const replayed = await request(f.app).post(selectionRoute)
        .set(owner.session.headers).set('Idempotency-Key', selectedKey)
        .send(selectionBody);
      expect(replayed.status).toBe(200);
      expect(replayed.body.data).toMatchObject({
        eventId: selected.body.data.eventId, revision: 1,
        replayed: true });
      const newerReview = await request(f.app).get(reviewRoute)
        .set('Cookie', owner.session.headers.Cookie);
      expect(newerReview.status).toBe(200);
      expect(newerReview.body.data).toMatchObject({
        state: 'research_review_ready', currentRevision: 1,
        currentEventId: selected.body.data.eventId,
        currentAlgorithmVersion: 'm26_price_flow_zero_baseline_v1' });
      const selectedOriginRoute = `${root}/research-selected-origins`;
      const futureBase = await request(f.app)
        .post(`${root}/saved-price-flow-origins`)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({
        sourceReceiptId: postHorizon.rows[0].value.snapshot.id,
        currency: 'USD', horizonStartsAt: preciseUtc(future),
        horizonEndsAt: preciseUtc(futureEnd) });
      expect(futureBase.status).toBe(201);
      const futureBaseId = futureBase.body.data.runId;
      const futureActivated = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${futureBaseId}/activate`)
        .set(owner.session.headers).send({});
      expect(futureActivated.status).toBe(200);
      expect(futureActivated.body.data.state)
        .toBe('price_flow_origin_activated');
      const futureProfile = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${futureBaseId}/profile-witness`)
        .set(owner.session.headers).send({ profileAnchorId });
      expect(futureProfile.status).toBe(200);
      expect(futureProfile.body.data.state).toBe('profile_witness_recorded');
      const selectedOriginBody = { baseRunId: futureBaseId };
      await f.ownerPool.query(`CREATE FUNCTION m26_selected_origin_delay()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_sleep(2); RETURN NEW; END $$`);
      await f.ownerPool.query(`CREATE TRIGGER m26_selected_origin_delay
        BEFORE INSERT ON canonical_forecast_price_flow_research_selected_origins
        FOR EACH ROW EXECUTE FUNCTION m26_selected_origin_delay()`);
      const concurrentKey = key();
      let concurrent;
      try {
        concurrent = await Promise.all([1, 2].map(() => request(f.app)
          .post(selectedOriginRoute).set(owner.session.headers)
          .set('Idempotency-Key', concurrentKey).send(selectedOriginBody)));
      } finally {
        await f.ownerPool.query(`DROP TRIGGER m26_selected_origin_delay
          ON canonical_forecast_price_flow_research_selected_origins`);
        await f.ownerPool.query('DROP FUNCTION m26_selected_origin_delay()');
      }
      expect(concurrent.map(value => value.status).sort()).toEqual([200, 201]);
      const selectedOrigin = concurrent.find(value => value.status === 201);
      const concurrentReplay = concurrent.find(value => value.status === 200);
      expect(selectedOrigin.body.data).toMatchObject({
        state: 'research_selected_origin_saved',
        algorithmVersion: 'm26_price_flow_zero_baseline_v1',
        selectionEventId: selected.body.data.eventId,
        stagedEventId: staged.body.data.eventId,
        researchOnly: true, forecastServingEnabled: false,
        realForecastEligible: false, forecastValueAvailable: false,
        output: null, replayed: false });
      expect(concurrentReplay.headers['idempotency-replayed']).toBe('true');
      expect(concurrentReplay.body.data).toMatchObject({
        runId: selectedOrigin.body.data.runId, replayed: true });
      expect(new Set(concurrent.map(value => value.body.data.runId)).size).toBe(1);
      const privateSelected = await f.ownerPool.query(`
        SELECT o.output->>'calculationVersion' algorithm,
          r.forecast_serving_enabled serving, r.staged_event_id staged_event_id
        FROM canonical_forecast_price_flow_research_selected_origins r
        JOIN canonical_forecast_price_flow_saved_origins o
          ON o.organization_id=r.organization_id AND o.id=r.selected_run_id
        WHERE r.organization_id=$1 AND r.selected_run_id=$2`,
      [f.org, selectedOrigin.body.data.runId]);
      expect(privateSelected.rows[0]).toMatchObject({
        algorithm: 'm26_price_flow_zero_baseline_v1', serving: false,
        staged_event_id: staged.body.data.eventId });
      const stagedConstraint =
        'canonical_forecast_price_flow_selected_staged_event_required';
      const legacyDirectKey = crypto.createHash('sha256')
        .update(key()).digest('hex');
      await expect(f.ownerPool.query(`INSERT INTO
        canonical_forecast_price_flow_research_selected_origins(
          organization_id,base_run_id,selected_run_id,selection_event_id,
          algorithm_version,actor_user_id,auth_session_id,request_key_hash,
          request_digest)
        SELECT organization_id,base_run_id,selected_run_id,selection_event_id,
          algorithm_version,actor_user_id,auth_session_id,$2,request_digest
        FROM canonical_forecast_price_flow_research_selected_origins
        WHERE organization_id=$1 AND id=$3`,
      [f.org, legacyDirectKey, selectedOrigin.body.data.selectionReceiptId]))
        .rejects.toMatchObject({ code: '23514', constraint: stagedConstraint });

      // Rehearse the rolling-upgrade edge: an old function body is already
      // running but blocked before its first sidecar-table statement. The
      // migration table fence installs the NOT VALID check, which preserves
      // historical nulls while rejecting that queued old body's future row.
      const oldBodyKey = crypto.createHash('sha256').update(key()).digest('hex');
      const oldBodyLock = `m26:test-old-selected:${oldBodyKey}`;
      const lockHolder = await f.ownerPool.connect();
      const oldBodyClient = await f.ownerPool.connect();
      const fenceClient = await f.ownerPool.connect();
      let constraintInstalled = true;
      let holderOpen = false;
      let queuedOldBody;
      try {
        await f.ownerPool.query(`ALTER TABLE
          canonical_forecast_price_flow_research_selected_origins
          DROP CONSTRAINT ${stagedConstraint}`);
        constraintInstalled = false;
        await f.ownerPool.query(`CREATE FUNCTION
          public.m26_test_old_research_selected_origin_insert(
            source_id uuid,key_hash_value text,lock_value text)
          RETURNS uuid LANGUAGE plpgsql AS $$
          DECLARE inserted_id uuid;
          BEGIN
            PERFORM pg_advisory_xact_lock(hashtextextended(lock_value,0));
            INSERT INTO canonical_forecast_price_flow_research_selected_origins(
              organization_id,base_run_id,selected_run_id,selection_event_id,
              algorithm_version,actor_user_id,auth_session_id,request_key_hash,
              request_digest)
            SELECT organization_id,base_run_id,selected_run_id,selection_event_id,
              algorithm_version,actor_user_id,auth_session_id,key_hash_value,
              request_digest
            FROM canonical_forecast_price_flow_research_selected_origins
            WHERE id=source_id
            RETURNING id INTO inserted_id;
            RETURN inserted_id;
          END $$`);
        await lockHolder.query('BEGIN');
        holderOpen = true;
        await lockHolder.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [oldBodyLock]);
        const oldPid = Number((await oldBodyClient.query(
          'SELECT pg_backend_pid() pid')).rows[0].pid);
        queuedOldBody = oldBodyClient.query(
          'SELECT public.m26_test_old_research_selected_origin_insert($1,$2,$3)',
          [selectedOrigin.body.data.selectionReceiptId, oldBodyKey, oldBodyLock])
          .then(value => ({ value }), error => ({ error }));
        let oldBodyWaiting = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const activity = (await f.ownerPool.query(`SELECT wait_event_type,wait_event
            FROM pg_stat_activity WHERE pid=$1`, [oldPid])).rows[0];
          oldBodyWaiting = activity?.wait_event_type === 'Lock' &&
            activity?.wait_event === 'advisory';
          if (oldBodyWaiting) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(oldBodyWaiting).toBe(true);
        await fenceClient.query('BEGIN');
        await fenceClient.query(`ALTER TABLE
          canonical_forecast_price_flow_research_selected_origins
          ADD CONSTRAINT ${stagedConstraint}
          CHECK(staged_event_id IS NOT NULL) NOT VALID`);
        await fenceClient.query('COMMIT');
        constraintInstalled = true;
        await lockHolder.query('COMMIT');
        holderOpen = false;
        const oldBodyResult = await queuedOldBody;
        expect(oldBodyResult.error).toMatchObject({
          code: '23514', constraint: stagedConstraint });
        const leakedOldBody = await f.ownerPool.query(`SELECT count(*)::integer n
          FROM canonical_forecast_price_flow_research_selected_origins
          WHERE organization_id=$1 AND request_key_hash=$2`, [f.org, oldBodyKey]);
        expect(leakedOldBody.rows[0].n).toBe(0);
      } finally {
        await fenceClient.query('ROLLBACK').catch(() => {});
        if (!constraintInstalled) await f.ownerPool.query(`ALTER TABLE
          canonical_forecast_price_flow_research_selected_origins
          ADD CONSTRAINT ${stagedConstraint}
          CHECK(staged_event_id IS NOT NULL) NOT VALID`);
        if (holderOpen) await lockHolder.query('ROLLBACK').catch(() => {});
        if (queuedOldBody) await queuedOldBody;
        await f.ownerPool.query(
          'DROP FUNCTION IF EXISTS public.m26_test_old_research_selected_origin_insert(uuid,text,text)');
        lockHolder.release(); oldBodyClient.release(); fenceClient.release();
      }
      const pendingClient = await f.runtimePool.connect();
      try {
        await pendingClient.query('BEGIN');
        const pending = await pendingClient.query(
          'SELECT public.canonical_forecast_capture_research_selected_price_flow_origin($1,$2,$3,$4,$5,$6,$7) value',
          [...args, owner.csrfToken, key(), futureBaseId]);
        expect(pending.rows[0].value.state).toBe('research_selected_origin_saved');
        const premature = await pendingClient.query(
          'SELECT public.canonical_forecast_activate_research_selected_price_flow_origin($1,$2,$3,$4,$5,$6) value',
          [...args, owner.csrfToken,
            pending.rows[0].value.selectionReceiptId]);
        expect(premature.rows[0].value).toMatchObject({
          state: 'research_selected_origin_unavailable',
          reason: 'selection_commit_not_observed',
          preHorizonCommitVerified: false });
        await pendingClient.query('SAVEPOINT released_selection');
        const subtransactionPending = await pendingClient.query(
          'SELECT public.canonical_forecast_capture_research_selected_price_flow_origin($1,$2,$3,$4,$5,$6,$7) value',
          [...args, owner.csrfToken, key(), futureBaseId]);
        expect(subtransactionPending.rows[0].value.state)
          .toBe('research_selected_origin_saved');
        await pendingClient.query('RELEASE SAVEPOINT released_selection');
        const subtransactionPremature = await pendingClient.query(
          'SELECT public.canonical_forecast_activate_research_selected_price_flow_origin($1,$2,$3,$4,$5,$6) value',
          [...args, owner.csrfToken,
            subtransactionPending.rows[0].value.selectionReceiptId]);
        expect(subtransactionPremature.rows[0].value).toMatchObject({
          state: 'research_selected_origin_unavailable',
          reason: 'selection_commit_not_observed',
          preHorizonCommitVerified: false });
        await pendingClient.query('ROLLBACK');
      } finally { pendingClient.release(); }
      const profileLockCandidate = await f.runtimePool.query(
        'SELECT public.canonical_forecast_capture_research_selected_price_flow_origin($1,$2,$3,$4,$5,$6,$7) value',
        [...args, owner.csrfToken, key(), futureBaseId]);
      expect(profileLockCandidate.rows[0].value.state)
        .toBe('research_selected_origin_saved');
      const profileLockActivationRoute =
        `${selectedOriginRoute}/${profileLockCandidate.rows[0].value.selectionReceiptId}/activate`;
      const heldProfileWriter = await f.ownerPool.connect();
      try {
        await heldProfileWriter.query('BEGIN');
        await heldProfileWriter.query(
          `SELECT pg_advisory_xact_lock(hashtextextended(
            'm26:profile-effective-source:'||$1::text,0))`, [f.org]);
        const busyActivation = await request(f.app)
          .post(profileLockActivationRoute).set(owner.session.headers).send({});
        expect(busyActivation.status).toBe(409);
        expect(busyActivation.body.error.category).toBe('FORECAST_SOURCE_BUSY');
        await heldProfileWriter.query('ROLLBACK');
      } catch (error) {
        await heldProfileWriter.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        heldProfileWriter.release();
      }
      // Frozen/old tuple transaction status must not be needed to observe a
      // commit. READ COMMITTED visibility plus same-transaction refusal is the
      // durable rule.
      await f.ownerPool.query(
        'VACUUM (FREEZE) canonical_forecast_price_flow_research_selected_origins');
      await f.ownerPool.query(
        'VACUUM (FREEZE) canonical_forecast_price_flow_saved_origins');
      const activationRoute = `${selectedOriginRoute}/${selectedOrigin.body.data.selectionReceiptId}/activate`;
      const selectedActivation = await request(f.app).post(activationRoute)
        .set(owner.session.headers).send({});
      expect(selectedActivation.status).toBe(200);
      expect(selectedActivation.body.data).toMatchObject({
        state: 'research_selected_origin_activated',
        selectionReceiptId: selectedOrigin.body.data.selectionReceiptId,
        runId: selectedOrigin.body.data.runId,
        stagedEventId: staged.body.data.eventId,
        preHorizonCommitVerified: true, researchOnly: true,
        forecastServingEnabled: false, realForecastEligible: false });
      const activationReplay = await request(f.app).post(activationRoute)
        .set(owner.session.headers).send({});
      expect(activationReplay.status).toBe(200);
      expect(activationReplay.body.data.replayed).toBe(true);
      const notYetActivated = (await f.runtimePool.query(
        'SELECT public.canonical_forecast_capture_research_selected_price_flow_origin($1,$2,$3,$4,$5,$6,$7) value',
        [...args, owner.csrfToken, key(), futureBaseId])).rows[0].value;
      expect(notYetActivated).toMatchObject({
        state: 'research_selected_origin_saved',
        stagedEventId: staged.body.data.eventId,
        algorithmVersion: 'm26_price_flow_zero_baseline_v1' });
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_flow_research_selected_origins WHERE organization_id=$1',
        [f.org])).rejects.toMatchObject({ code: '42501' });
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_flow_research_selected_activations WHERE organization_id=$1',
        [f.org])).rejects.toMatchObject({ code: '42501' });
      const rollbackRequest = { expectedRevision: 1, action: 'rollback',
        algorithmVersion: 'm26_price_flow_carry_forward_v1',
        reversesEventId: selected.body.data.eventId,
        reason: 'Fictional owner rollback to prior deterministic version.' };
      const impossibleRollback = await request(f.app).post(challengeRoute)
        .set(owner.session.headers).send({ ...rollbackRequest,
          reversesEventId: '00000000-0000-4000-8000-000000000001' });
      expect(impossibleRollback.status).toBe(200);
      expect(impossibleRollback.body.data).toMatchObject({
        state: 'research_challenge_unavailable',
        reason: 'selection_transition_invalid', reviewToken: null });
      const staleSelection = await request(f.app).post(selectionRoute)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ ...rollbackRequest, reviewToken: selectionBody.reviewToken,
          confirmed: true });
      expect(staleSelection.status).toBe(409);
      const rollbackChallenge = await request(f.app).post(challengeRoute)
        .set(owner.session.headers).send(rollbackRequest);
      expect(rollbackChallenge.status).toBe(200);
      expect(rollbackChallenge.body.data).toMatchObject({
        state: 'research_challenge_ready' });
      const rolledBack = await request(f.app).post(selectionRoute)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ ...rollbackRequest,
          reviewToken: rollbackChallenge.body.data.reviewToken,
          confirmed: true });
      expect(rolledBack.status).toBe(201);
      expect(rolledBack.body.data).toMatchObject({
        state: 'research_selection_recorded', revision: 2,
        algorithmVersion: 'm26_price_flow_carry_forward_v1',
        researchOnly: true, forecastServingEnabled: false });
      const awaitingStagedRollback = await request(f.app)
        .get(`${stagingRoute}/${runIds[59]}`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(awaitingStagedRollback.body.data).toMatchObject({
        state: 'staged_algorithm_unavailable',
        reason: 'review_choice_changed', algorithmVersion: null });
      const noFirstActivationAfterChoiceChange = await request(f.app)
        .post(`${selectedOriginRoute}/${notYetActivated.selectionReceiptId}/activate`)
        .set(owner.session.headers).send({});
      expect(noFirstActivationAfterChoiceChange.status).toBe(200);
      expect(noFirstActivationAfterChoiceChange.body.data).toMatchObject({
        state: 'research_selected_origin_unavailable',
        reason: 'staged_choice_changed', preHorizonCommitVerified: false });
      const stagedRollback = await request(f.app).post(stagingRoute)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ expectedRevision: 1,
          researchEventId: rolledBack.body.data.eventId,
          anchorRunId: runIds[59],
          reason: 'Fictional owner stages rollback after source review.',
          confirmed: true });
      expect(stagedRollback.status).toBe(201);
      expect(stagedRollback.body.data).toMatchObject({
        state: 'algorithm_staged', revision: 2,
        algorithmVersion: 'm26_price_flow_carry_forward_v1',
        forecastServingEnabled: false });
      const afterStagedRollback = await request(f.app)
        .get(`${stagingRoute}/${runIds[59]}`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(afterStagedRollback.body.data).toMatchObject({
        state: 'staged_algorithm_current', revision: 2,
        algorithmVersion: 'm26_price_flow_carry_forward_v1' });
      const afterRollback = await request(f.app).post(selectedOriginRoute)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send(selectedOriginBody);
      expect(afterRollback.status).toBe(201);
      expect(afterRollback.body.data).toMatchObject({
        state: 'research_selected_origin_saved',
        algorithmVersion: 'm26_price_flow_carry_forward_v1',
        selectionEventId: rolledBack.body.data.eventId,
        stagedEventId: stagedRollback.body.data.eventId,
        researchOnly: true, forecastServingEnabled: false });
      const secondCandidateRequest = {
        expectedRevision: 2, action: 'select_candidate',
        algorithmVersion: 'm26_price_flow_zero_baseline_v1',
        reversesEventId: null,
        reason: 'Fictional owner begins a second reviewed candidate cycle.' };
      const secondChallenge = await request(f.app).post(challengeRoute)
        .set(owner.session.headers).send(secondCandidateRequest);
      expect(secondChallenge.status).toBe(200);
      expect(secondChallenge.body.data.state).toBe('research_challenge_ready');
      const secondSelected = await request(f.app).post(selectionRoute)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ ...secondCandidateRequest,
          reviewToken: secondChallenge.body.data.reviewToken,
          confirmed: true });
      expect(secondSelected.status).toBe(201);
      expect(secondSelected.body.data).toMatchObject({
        state: 'research_selection_recorded', revision: 3,
        algorithmVersion: 'm26_price_flow_zero_baseline_v1' });
      const secondStaged = await request(f.app).post(stagingRoute)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ expectedRevision: 2,
          researchEventId: secondSelected.body.data.eventId,
          anchorRunId: runIds[59],
          reason: 'Fictional owner stages the second reviewed candidate cycle.',
          confirmed: true });
      expect(secondStaged.status).toBe(201);
      expect(secondStaged.body.data).toMatchObject({
        state: 'algorithm_staged', revision: 3,
        algorithmVersion: 'm26_price_flow_zero_baseline_v1' });
      const secondStagedRead = await request(f.app)
        .get(`${stagingRoute}/${runIds[59]}`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(secondStagedRead.body.data).toMatchObject({
        state: 'staged_algorithm_current', revision: 3,
        algorithmVersion: 'm26_price_flow_zero_baseline_v1' });

      // A rollback row that reverses a different research selection cannot
      // be attached to the latest staged candidate, even if all other source
      // evidence is current.
      const mismatchedRollback = await f.ownerPool.connect();
      try {
        await mismatchedRollback.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const currentReview = (await mismatchedRollback.query(
          'SELECT public.canonical_forecast_price_flow_research_review($1,$2,$3,$4) value',
          args)).rows[0].value;
        const forged = await mismatchedRollback.query(`INSERT INTO
          canonical_forecast_price_flow_research_selections(
            organization_id,revision,action,algorithm_version,
            previous_algorithm_version,reversed_event_id,comparison_digest,
            policy_version,reason,actor_user_id,auth_session_id,
            request_key_hash,request_digest)
          VALUES($1,4,'rollback','m26_price_flow_carry_forward_v1',
            'm26_price_flow_zero_baseline_v1',$2,$3,
            'm26_selected_m24_research_review_v1',
            'Fictional mismatched rollback lineage for fail-closed proof.',
            $4,$5,repeat('c',64),repeat('d',64)) RETURNING id`,
        [f.org, selected.body.data.eventId, currentReview.comparisonDigest,
          owner.actorUserId, owner.authSessionId]);
        await expect(mismatchedRollback.query(
          'SELECT public.canonical_forecast_price_flow_stage_algorithm($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
          [...args, owner.csrfToken, key(), 3, forged.rows[0].id,
            runIds[59],
            'Fictional owner cannot stage mismatched rollback lineage.', true]))
          .rejects.toMatchObject({ code: '22023',
            message: 'Algorithm rollback invalid' });
        await mismatchedRollback.query('ROLLBACK');
      } catch (error) {
        await mismatchedRollback.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { mismatchedRollback.release(); }
      const changedProfile = await f.ownerPool.connect();
      try {
        await changedProfile.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await changedProfile.query(`UPDATE canonical_business_profiles
          SET raw_profile=raw_profile
          WHERE organization_id=$1 AND is_active=TRUE`, [f.org]);
        const rejected = await changedProfile.query(
          'SELECT public.canonical_forecast_capture_research_selected_price_flow_origin($1,$2,$3,$4,$5,$6,$7) value',
          [...args, owner.csrfToken, key(), futureBaseId]);
        expect(rejected.rows[0].value).toMatchObject({
          state: 'research_selected_origin_unavailable',
          reason: 'base_profile_source_changed',
          forecastServingEnabled: false });
        const activationRejected = await changedProfile.query(
          'SELECT public.canonical_forecast_activate_research_selected_price_flow_origin($1,$2,$3,$4,$5,$6) value',
          [...args, owner.csrfToken,
            profileLockCandidate.rows[0].value.selectionReceiptId]);
        expect(activationRejected.rows[0].value).toMatchObject({
          state: 'research_selected_origin_unavailable',
          reason: 'base_profile_source_changed',
          preHorizonCommitVerified: false,
          forecastServingEnabled: false });
        await changedProfile.query('ROLLBACK');
      } catch (error) {
        await changedProfile.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        changedProfile.release();
      }
      const retrospective = await f.runtimePool.query(
        'SELECT public.canonical_forecast_capture_research_selected_price_flow_origin($1,$2,$3,$4,$5,$6,$7) value',
        [...args, owner.csrfToken, key(), runIds[59]]);
      expect(retrospective.rows[0].value).toMatchObject({
        state: 'research_selected_origin_unavailable',
        reason: 'origin_window_not_eligible',
        forecastServingEnabled: false });
      // A separate fictional base lets a test-only insert delay cross its
      // horizon without changing the valid selected/replayed base above.
      const crossingBase = await request(f.app)
        .post(`${root}/saved-price-flow-origins`)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({
          sourceReceiptId: postHorizon.rows[0].value.snapshot.id,
          currency: 'USD', horizonStartsAt: preciseUtc(future),
          horizonEndsAt: preciseUtc(futureEnd) });
      expect(crossingBase.status).toBe(201);
      const crossingBaseId = crossingBase.body.data.runId;
      const crossingActivation = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${crossingBaseId}/activate`)
        .set(owner.session.headers).send({});
      expect(crossingActivation.body.data.state)
        .toBe('price_flow_origin_activated');
      const crossingProfile = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${crossingBaseId}/profile-witness`)
        .set(owner.session.headers).send({ profileAnchorId });
      expect(crossingProfile.body.data.state).toBe('profile_witness_recorded');
      await f.ownerPool.query(`CREATE FUNCTION m26_research_delay() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(25); RETURN NEW; END $$`);
      await f.ownerPool.query(`CREATE TRIGGER m26_research_delay
        BEFORE INSERT ON canonical_forecast_price_flow_research_selected_origins
        FOR EACH ROW EXECUTE FUNCTION m26_research_delay()`);
      const nearHorizon = new Date(Date.now() + 20000);
      const nearEnd = new Date(nearHorizon.getTime() + day);
      try {
        await f.ownerPool.query(`ALTER TABLE canonical_forecast_price_flow_saved_origins
          DISABLE TRIGGER canonical_forecast_price_flow_origins_immutable`);
        await f.ownerPool.query(`ALTER TABLE canonical_forecast_price_flow_origin_activations
          DISABLE TRIGGER canonical_forecast_price_flow_activation_immutable`);
        const changed = await f.ownerPool.query(`
          UPDATE canonical_forecast_price_flow_saved_origins
          SET horizon_start=$3,horizon_end=$4,
            output=jsonb_set(output,'{horizon}',
              jsonb_build_object('startsAt',$5::text,'endsAt',$6::text,
                'grain','day')),
            receipt_digest=public.canonical_completion_digest(
              jsonb_set(output,'{horizon}',
                jsonb_build_object('startsAt',$5::text,'endsAt',$6::text,
                  'grain','day')))
          WHERE organization_id=$1 AND id=$2 RETURNING receipt_digest`,
        [f.org, crossingBaseId, nearHorizon, nearEnd,
          utc(nearHorizon), utc(nearEnd)]);
        const original = await f.ownerPool.query(`
          SELECT proof FROM canonical_forecast_price_flow_origin_activations
          WHERE organization_id=$1 AND run_id=$2`, [f.org, crossingBaseId]);
        const proof = { ...original.rows[0].proof,
          savedReceiptDigest: changed.rows[0].receipt_digest,
          horizonStartsAt: utc(nearHorizon) };
        await f.ownerPool.query(`
          UPDATE canonical_forecast_price_flow_origin_activations
          SET proof=$3::jsonb,proof_digest=public.canonical_completion_digest($3::jsonb)
          WHERE organization_id=$1 AND run_id=$2`,
        [f.org, crossingBaseId, JSON.stringify(proof)]);
      } finally {
        await f.ownerPool.query(`ALTER TABLE canonical_forecast_price_flow_origin_activations
          ENABLE TRIGGER canonical_forecast_price_flow_activation_immutable`);
        await f.ownerPool.query(`ALTER TABLE canonical_forecast_price_flow_saved_origins
          ENABLE TRIGGER canonical_forecast_price_flow_origins_immutable`);
      }
      try {
        const beforeCrossing = await f.ownerPool.query(`
          SELECT count(*)::integer n FROM canonical_forecast_price_flow_research_selected_origins
          WHERE organization_id=$1 AND base_run_id=$2`,
        [f.org, crossingBaseId]);
        const crossingClient = await f.runtimePool.connect();
        try {
          await crossingClient.query('BEGIN');
          await crossingClient.query("SET LOCAL statement_timeout='45000ms'");
          await expect(crossingClient.query(
            'SELECT public.canonical_forecast_capture_research_selected_price_flow_origin($1,$2,$3,$4,$5,$6,$7) value',
            [...args, owner.csrfToken, key(), crossingBaseId]))
            .rejects.toMatchObject({ code: '23514',
              message: 'Research selection crossed horizon after insert' });
          await crossingClient.query('ROLLBACK');
        } finally { crossingClient.release(); }
        const afterCrossing = await f.ownerPool.query(`
          SELECT count(*)::integer n FROM canonical_forecast_price_flow_research_selected_origins
          WHERE organization_id=$1 AND base_run_id=$2`,
        [f.org, crossingBaseId]);
        expect(afterCrossing.rows[0].n).toBe(beforeCrossing.rows[0].n);
      } finally {
        await f.ownerPool.query(`DROP TRIGGER m26_research_delay
          ON canonical_forecast_price_flow_research_selected_origins`);
        await f.ownerPool.query('DROP FUNCTION m26_research_delay()');
      }
      const denied = await request(f.app).post(selectionRoute)
        .set(f.actors.member.session.headers).set('Idempotency-Key', key())
        .send(selectionBody);
      expect(denied.status).toBe(403);
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_flow_research_selections WHERE organization_id=$1',
        [f.org])).rejects.toMatchObject({ code: '42501' });
      const estimateRoute =
        `/api/v1/canonical/estimates/${estimates[0].ids.estimate}`;
      const currentDecision = await request(f.app)
        .get(`${estimateRoute}/review`).set(owner.session.headers);
      expect(currentDecision.status).toBe(200);
      const withdrawn = await request(f.app)
        .post(`${estimateRoute}/decisions`)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ action: 'withdraw',
          expectedRevision:
            currentDecision.body.data.decisions.current.revision,
          expectedDigest:
            currentDecision.body.data.decisions.current.digest,
          sourcePins: currentDecision.body.data.pins,
          scopeSummary: null, priceBeforeTax: null,
          currency: currentDecision.body.data.currency,
          reason: 'Fictional owner source withdrawal.', confirmed: true,
          confirmationVersion: 'estimate-quote-preparation-v1' });
      expect(withdrawn.status).toBe(201);
      const changedReview = await request(f.app).get(reviewRoute)
        .set('Cookie', owner.session.headers.Cookie);
      expect(changedReview.status).toBe(200);
      expect(changedReview.body.data).toMatchObject({
        state: 'research_review_unavailable',
        humanResearchReviewAvailable: false, reviewToken: null });
      const changedFixedReview = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_matched_population_at_anchor($1,$2,$3,$4,$5) value',
        [...args, runIds[59]]);
      expect(changedFixedReview.rows[0].value.completeRegisteredPopulation)
        .toBe(false);
      const changedFixedPolicy = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_fixed_research_review($1,$2,$3,$4,$5) value',
        [...args, runIds[59]]);
      expect(changedFixedPolicy.rows[0].value).toMatchObject({
        state: 'fixed_research_review_unavailable',
        reason: 'matched_population_incomplete',
        productionPromotionEligible: false });
      const staleStaged = await request(f.app)
        .get(`${stagingRoute}/${runIds[59]}`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(staleStaged.status).toBe(200);
      expect(staleStaged.body.data).toMatchObject({
        state: 'staged_algorithm_unavailable',
        reason: 'staged_evidence_changed',
        algorithmVersion: null, forecastServingEnabled: false });
      const changedOrigin = await request(f.app).post(selectedOriginRoute)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send(selectedOriginBody);
      expect(changedOrigin.status).toBe(200);
      expect(changedOrigin.body.data).toMatchObject({
        state: 'research_selected_origin_unavailable',
        reason: 'base_source_unavailable',
        forecastServingEnabled: false });
      const staleAfterSourceChange = await request(f.app)
        .post(selectionRoute).set(owner.session.headers)
        .set('Idempotency-Key', key())
        .send({ ...selectionBody, expectedRevision: 2 });
      expect(staleAfterSourceChange.status).toBe(409);
      const preservedReplay = await request(f.app).post(selectionRoute)
        .set(owner.session.headers).set('Idempotency-Key', selectedKey)
        .send(selectionBody);
      expect(preservedReplay.status).toBe(200);
      expect(preservedReplay.body.data).toMatchObject({
        eventId: selected.body.data.eventId, revision: 1, replayed: true,
        forecastServingEnabled: false });
    }, 600000);
});
