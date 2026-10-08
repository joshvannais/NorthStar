'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { ingestLead } = require('../../src/services/canonicalGraphService');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const root = '/api/v1/forecast/named-pipeline-scenarios';
const pipelineRoot = '/api/v1/forecast/pipeline-scenarios';
const profileRoot = '/api/v1/forecast/reporting-windows/effective-anchors';
const demandRoot = '/api/v1/forecast/demand-to-schedule';
const key = () => crypto.randomUUID();

function completeProfile() {
  const profile = canonicalFenceProfile();
  profile.company.timeZone = 'UTC';
  profile.hours = Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      .map(day => [day, { open: '00:00', close: '23:59', lunch: '', emergency: false,
        afterHours: false, holiday: false }]));
  return profile;
}

async function ingestScenarioEstimate(f, label) {
  const id = crypto.randomUUID();
  const start = new Date(Date.UTC(2027, 9, 1, crypto.randomInt(1, 20), 0, 0));
  const result = await ingestLead(f.runtimePool, {
    tenantContext: { organizationId: f.org, trusted: true },
    idempotencyKey: id, sourceVersion: 'm26-part9c-integration-v1',
    external: { customerId: id, callId: id, transcriptId: id,
      communicationId: id, appointmentId: id },
    customer: { name: `Fictional Part 9C ${label} customer`,
      phone: `+1555${crypto.randomInt(1000000, 9999999)}`,
      email: `${id}@example.test`, address: { line1: '1 Test Way', city: 'Boston',
        state: 'MA', postalCode: '02108' } },
    transcript: [{ turnId: 'scope', speaker: 'customer',
      text: 'I need a 100-foot cedar fence.' }],
    facts: [{ variable: 'linearFeet', normalizedValue: 100, evidenceText: '100-foot',
      speaker: 'customer', evidenceTurnId: 'scope', confidence: 1 }],
    service: { key: 'fence', scope: { jobType: 'replace', linearFeet: 100, height: 6,
      material: 'cedar', removalRequired: true, gates: [{ type: 'walk' }],
      permitsRequired: true } },
    scheduledAppointment: { start: start.toISOString(),
      end: new Date(start.getTime() + 3600000).toISOString(), status: 'scheduled' },
    businessProfile: completeProfile(), businessProfileVersion: 1,
  });
  expect(result.status).toBe(201);
  return result.body;
}

function assumptionsFor(members, base = 333333) {
  return members.map((member, index) => ({ estimateId: member.estimateId,
    estimateSnapshotDigest: member.estimateSnapshotDigest, category: member.category,
    variations: {
      adverse: { weightPpm: 100000 + index,
        reason: `Permit timing may defer exact estimate ${index + 1}.` },
      base: { weightPpm: base,
        reason: `Use the current reviewed central policy for exact estimate ${index + 1}.` },
      favorable: { weightPpm: 700000 + index,
        reason: `Verified access may advance exact estimate ${index + 1}.` },
    } }));
}

async function setScenarioClock(pool, instant) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL northstar.m26_part6b_disposable_clock='enabled'");
    await client.query('SELECT canonical_forecast_pipeline_scenario_test_clock_set($1)',
      [instant]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(); }
}

realPostgres('Mission 26 original Part 9C mounted named pipeline scenarios', () => {
  let f; let members; let review; let current;
  beforeAll(async () => {
    f = await createEstimateReviewFixture({ operationalSchedule: true });
    const actor = f.actors.owner;
    const profile = await request(f.app).post(profileRoot)
      .set(actor.session.headers).set('Idempotency-Key', key())
      .send({ reason: 'Record the profile for exact Part 9C scenario lineage.',
        confirmed: true });
    expect(profile.status).toBe(201);
    expect((await request(f.app).post(`${profileRoot}/${profile.body.data.anchorId}/activate`)
      .set(actor.session.headers).send({})).status).toBe(200);
    const epoch = await request(f.app).post(`${demandRoot}/epochs`)
      .set(actor.session.headers).set('Idempotency-Key', key())
      .send({ purpose: 'pipeline_first_booking', profileAnchorId: profile.body.data.anchorId });
    expect(epoch.status).toBe(201);
    await ingestScenarioEstimate(f, 'alpha');
    await ingestScenarioEstimate(f, 'beta');
    const policy = await request(f.app).post(`${pipelineRoot}/policies`)
      .set(actor.session.headers).set('Idempotency-Key', key()).send({ action: 'approve',
        reason: 'Approve the exact Part 9C source policy.', expectedRevision: 0,
        scenarioWeights: {
          preliminaryEstimate: { lowerPpm: 111111, centralPpm: 333333,
            upperPpm: 777777 },
          approvedUnbooked: { lowerPpm: 222222, centralPpm: 555555,
            upperPpm: 888888 },
        }, confirmed: true, confirmationVersion: 'pipeline-scenario-policy-v1' });
    expect(policy.status).toBe(201);
    const sources = (await f.ownerPool.query(`SELECT
      public.canonical_forecast_pipeline_scenario_sources($1,$2,$3,$4,'USD',
       public.canonical_forecast_pipeline_scenario_clock()) value`,
    [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId])).rows[0].value;
    expect(sources).toMatchObject({ state: 'current_pipeline_scenario_sources',
      sourceCoverageComplete: true, currency: 'USD' });
    members = sources.members;
    expect(members).toHaveLength(2);
  }, 120000);
  afterAll(async () => { if (f) await f.cleanup(); }, 120000);

  test('issues reproducible explicit scenarios and preserves per-estimate provenance', async () => {
    const actor = f.actors.owner;
    const assumptions = assumptionsFor(members).reverse();
    const idempotencyKey = key();
    const body = { action: 'approve', expectedRevision: 0, expectedDigest: 'none',
      assumptions, reason: 'Approve explicit estimate-specific named scenario assumptions.',
      confirmed: true, confirmationVersion: 'named-pipeline-scenario-review-v1' };
    review = await request(f.app).post(`${root}/reviews`).set(actor.session.headers)
      .set('Idempotency-Key', idempotencyKey).send(body);
    if (review.status !== 201) throw new Error(JSON.stringify(review.body));
    expect(review.body.data).toMatchObject({ state: 'named_scenario_review_saved',
      revision: 1, action: 'approve', replayed: false, valuesWithheld: true,
      forecastIssued: false, automaticActionAuthorized: false });
    const replay = await request(f.app).post(`${root}/reviews`).set(actor.session.headers)
      .set('Idempotency-Key', idempotencyKey).send({ ...body,
        assumptions: [...assumptions].reverse() });
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toEqual({ ...review.body.data, replayed: true });

    const owner = await request(f.app).get(`${root}/current`).set(actor.session.headers);
    const admin = await request(f.app).get(`${root}/current`)
      .set(f.actors.admin.session.headers);
    expect(owner.status).toBe(200); expect(admin.status).toBe(200);
    current = owner.body.data;
    expect(current).toMatchObject({ state: 'current', reason: null, currency: 'USD',
      target: { key: 'pipeline.open_value_scenario', version: 'v1' },
      sourceSnapshot: { state: 'complete_as_of', completeAsOf: true, hasMore: false },
      scenarioReview: { revision: 1 }, currentness: { reviewCurrent: true,
        sourceCurrent: true, policyCurrent: true, profileCurrent: true,
        refreshRequired: false }, sourceAuthenticated: true,
      assumptionSourcesAuthenticated: true, weightsAreScenarioAssumptions: true,
      probabilityCalibrated: false, percentilesIssued: false,
      earnedRevenueMeasured: false, cashMeasured: false, researchOnly: true,
      realForecastEligible: false, forecastIssued: true, paidNumericServing: false,
      automaticActionAuthorized: false });
    expect(current.assumptions.map(item => item.estimateId))
      .toEqual(members.map(item => item.estimateId).sort());
    for (const assumption of current.assumptions) {
      expect(assumption.variations.base).toMatchObject({ weightPpm: 333333,
        changedAssumption: { field: 'conversion_weight_ppm', fromWeightPpm: 333333,
          toWeightPpm: 333333 }, author: { userId: actor.actorUserId },
        source: { kind: 'owner_approved_scenario_assumption',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/) }, revision: 1 });
      expect(assumption.variations.base.recordedAt)
        .toMatch(/^\d{4}-\d{2}-\d{2}T.*\.\d{6}Z$/);
      expect(assumption.applicability).toMatchObject({ estimateId: assumption.estimateId,
        category: assumption.category, priceBeforeTax: assumption.priceBeforeTax,
        currency: 'USD', horizonRuleVersion: 'next-complete-tenant-local-month-v1' });
    }
    expect(BigInt(current.scenarios.adverse.total.replace('.', '')))
      .toBeLessThan(BigInt(current.scenarios.base.total.replace('.', '')));
    expect(BigInt(current.scenarios.base.total.replace('.', '')))
      .toBeLessThan(BigInt(current.scenarios.favorable.total.replace('.', '')));
    expect(admin.body.data.digests).toEqual(current.digests);
    expect(JSON.stringify(current)).not.toMatch(/p10|p50|p90|probability\s*:/i);
  }, 120000);

  test('fails closed for incomplete, policy-mismatched and cross-tenant inputs', async () => {
    const actor = f.actors.owner;
    const next = { action: 'approve', expectedRevision: 1,
      expectedDigest: review.body.data.digest,
      reason: 'Attempt exact Part 9C source-bound scenario replacement.', confirmed: true,
      confirmationVersion: 'named-pipeline-scenario-review-v1' };
    expect((await request(f.app).post(`${root}/reviews`).set(actor.session.headers)
      .set('Idempotency-Key', key()).send({ ...next,
        assumptions: assumptionsFor(members).slice(0, 1) })).status).toBe(400);
    const wrongBase = assumptionsFor(members); wrongBase[0].variations.base.weightPpm = 333334;
    expect((await request(f.app).post(`${root}/reviews`).set(actor.session.headers)
      .set('Idempotency-Key', key()).send({ ...next, assumptions: wrongBase })).status).toBe(400);
    for (const denied of ['member', 'viewer']) {
      expect((await request(f.app).get(`${root}/current`)
        .set(f.actors[denied].session.headers)).status).toBe(403);
    }
    const other = await request(f.app).get(`${root}/current`)
      .set(f.actors.otherOwner.session.headers);
    expect(other.status).toBe(200);
    expect(other.body.data).toMatchObject({ state: 'unavailable',
      reason: 'no_current_scenario_review', sourceSnapshot: null, scenarioReview: null,
      assumptions: [], scenarios: { adverse: { total: null }, base: { total: null },
        favorable: { total: null } }, forecastIssued: false });
    expect(JSON.stringify(other.body)).not.toMatch(new RegExp(
      [review.body.data.reviewId, current.digests.source].join('|')));
  }, 120000);

  test('keeps complete zero distinct from absent and helper/table authority private', async () => {
    const zero = (await f.ownerPool.query(`SELECT
      canonical_forecast_named_scenario_v1_value('[]'::jsonb,'[]'::jsonb,'base',NULL) value,
      canonical_forecast_named_scenario_v1_amount(0) amount`)).rows[0];
    expect(zero).toEqual({ value: '0', amount: '0.000000' });
    await expect(f.runtimePool.query(
      'SELECT count(*) FROM canonical_forecast_named_scenario_reviews_v1'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(f.runtimePool.query(`SELECT
      canonical_forecast_named_scenario_v1_value('[]'::jsonb,'[]'::jsonb,'base',NULL)`))
      .rejects.toMatchObject({ code: '42501' });
    const privileges = (await f.runtimePool.query(`SELECT
      has_function_privilege(current_user,
       'canonical_forecast_named_scenario_v1_review_mutate(uuid,uuid,text,uuid,text,text,text,integer,text,jsonb,text,boolean,text)','EXECUTE') mutate,
      has_function_privilege(current_user,
       'canonical_forecast_named_scenario_v1_current(uuid,uuid,text,uuid)','EXECUTE') reader,
      has_function_privilege(current_user,
       'canonical_forecast_named_scenario_v1_value(jsonb,jsonb,text,text)','EXECUTE') helper`))
      .rows[0];
    expect(privileges).toEqual({ mutate: true, reader: true, helper: false });
    const authority = { migrationRole: f.roles.owner, runtimeRole: f.roles.runtime };
    const client = await f.ownerPool.connect();
    try {
      await client.query('BEGIN');
      await f.db.grantAndVerifyRuntimeAuthorityForTests(client, authority);
      await f.db.grantAndVerifyRuntimeAuthorityForTests(client, authority);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
    const helper =
      'canonical_forecast_named_scenario_v1_value(jsonb,jsonb,text,text)';
    const reader =
      'canonical_forecast_named_scenario_v1_current(uuid,uuid,text,uuid)';
    for (const change of [
      `GRANT EXECUTE ON FUNCTION ${helper} TO PUBLIC`,
      `ALTER FUNCTION ${reader} RENAME TO canonical_forecast_named_scenario_v1_current_missing_test`,
    ]) {
      const drift = await f.ownerPool.connect();
      try {
        await drift.query('BEGIN');
        await drift.query(change);
        if (change.startsWith('GRANT')) {
          await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(drift, authority))
            .rejects.toThrow('Runtime database role privilege verification failed');
        } else {
          await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(drift, authority))
            .rejects.toThrow('Part 9C runtime authority objects are missing');
        }
      } finally {
        await drift.query('ROLLBACK').catch(() => {}); drift.release();
      }
    }
  }, 120000);

  test('clears stale values on clock reversal, policy change and review revocation', async () => {
    const actor = f.actors.owner;
    const before = (await f.ownerPool.query(
      `SELECT reviewed_at FROM canonical_forecast_named_scenario_reviews_v1
        WHERE id=$1`, [review.body.data.reviewId])).rows[0];
    await setScenarioClock(f.ownerPool,
      new Date(new Date(before.reviewed_at).getTime() - 1000).toISOString());
    const reversed = await request(f.app).get(`${root}/current`).set(actor.session.headers);
    expect(reversed.status).toBe(200);
    expect(reversed.body.data).toMatchObject({ state: 'unavailable', reason: 'clock_reversal',
      sourceSnapshot: null, assumptions: [], scenarios: { base: { total: null } },
      forecastIssued: false });
    await setScenarioClock(f.ownerPool, null);

    const changedPolicy = await request(f.app).post(`${pipelineRoot}/policies`)
      .set(actor.session.headers).set('Idempotency-Key', key()).send({ action: 'approve',
        reason: 'Revise the Part 9C governing central assumption.', expectedRevision: 1,
        scenarioWeights: {
          preliminaryEstimate: { lowerPpm: 111111, centralPpm: 444444,
            upperPpm: 777777 },
          approvedUnbooked: { lowerPpm: 222222, centralPpm: 555555,
            upperPpm: 888888 },
        }, confirmed: true, confirmationVersion: 'pipeline-scenario-policy-v1' });
    expect(changedPolicy.status).toBe(201);
    const stale = await request(f.app).get(`${root}/current`).set(actor.session.headers);
    expect(stale.status).toBe(200);
    expect(stale.body.data).toMatchObject({ state: 'unavailable',
      reason: 'scenario_policy_changed', assumptions: [],
      sourceSnapshot: null, scenarioReview: null, scenarios: { base: { total: null } },
      forecastIssued: false });

    const sources = (await f.ownerPool.query(`SELECT
      public.canonical_forecast_pipeline_scenario_sources($1,$2,$3,$4,'USD',
       public.canonical_forecast_pipeline_scenario_clock()) value`,
    [f.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId])).rows[0].value;
    const recovered = await request(f.app).post(`${root}/reviews`).set(actor.session.headers)
      .set('Idempotency-Key', key()).send({ action: 'approve', expectedRevision: 1,
        expectedDigest: review.body.data.digest, assumptions: assumptionsFor(sources.members, 444444),
        reason: 'Approve corrected explicit assumptions under the revised policy.',
        confirmed: true, confirmationVersion: 'named-pipeline-scenario-review-v1' });
    expect(recovered.status).toBe(201);
    expect((await request(f.app).get(`${root}/current`).set(actor.session.headers)).body.data)
      .toMatchObject({ state: 'current', scenarioReview: { revision: 2 },
        currentness: { refreshRequired: false }, forecastIssued: true });
    const revoked = await request(f.app).post(`${root}/reviews`).set(actor.session.headers)
      .set('Idempotency-Key', key()).send({ action: 'revoke', expectedRevision: 2,
        expectedDigest: recovered.body.data.digest, assumptions: null,
        reason: 'Withdraw these named assumptions after owner review.', confirmed: true,
        confirmationVersion: 'named-pipeline-scenario-review-v1' });
    if (revoked.status !== 201) throw new Error(`Part 9C revoke failed: ${JSON.stringify(revoked.body)}`);
    expect(revoked.status).toBe(201);
    const withdrawn = await request(f.app).get(`${root}/current`).set(actor.session.headers);
    expect(withdrawn.body.data).toMatchObject({ state: 'unavailable',
      reason: 'scenario_review_revoked', assumptions: [],
      sourceSnapshot: null, scenarioReview: null, scenarios: { adverse: { total: null },
        base: { total: null }, favorable: { total: null } }, forecastIssued: false });
  }, 120000);
});
