'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { ingestLead } = require('../../src/services/canonicalGraphService');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const root = '/api/v1/forecast/pipeline-sensitivities';
const namedRoot = '/api/v1/forecast/named-pipeline-scenarios';
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
  const start = new Date(Date.UTC(2027, 9, 1, label === 'alpha' ? 8 : 10, 0, 0));
  const result = await ingestLead(f.runtimePool, {
    tenantContext: { organizationId: f.org, trusted: true },
    idempotencyKey: id, sourceVersion: 'm26-part9d-integration-v1',
    external: { customerId: id, callId: id, transcriptId: id,
      communicationId: id, appointmentId: id },
    customer: { name: `Fictional Part 9D ${label} customer`,
      phone: label === 'alpha' ? '+15551110001' : '+15551110002',
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
}

function assumptionsFor(members) {
  return members.map((member, index) => ({ estimateId: member.estimateId,
    estimateSnapshotDigest: member.estimateSnapshotDigest, category: member.category,
    variations: {
      adverse: { weightPpm: 111111 + index,
        reason: `Permit timing may defer exact estimate ${index + 1}.` },
      base: { weightPpm: 333333,
        reason: `Use the current reviewed central policy for exact estimate ${index + 1}.` },
      favorable: { weightPpm: 777777 + index,
        reason: `Verified access may advance exact estimate ${index + 1}.` },
    } }));
}

function cents(amount) { return BigInt(amount.replace('.', '')); }
function roundedMicro(numerator) { return (numerator + 50n) / 100n; }
function categoryMicro(assumptions, category, selectedId, selectedWeight) {
  return roundedMicro(assumptions.filter(item => item.category === category)
    .reduce((sum, item) => sum + cents(item.priceBeforeTax) * BigInt(
      item.estimateId === selectedId ? selectedWeight : item.variations.base.weightPpm), 0n));
}
function amount(value) {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 1000000n}.${String(absolute % 1000000n).padStart(6, '0')}`;
}

function sensitivityBody(current, selected, proposedWeightPpm, minimumAmount) {
  const a = selected.applicability;
  return {
    version: 'm26-pipeline-sensitivity-request-v1',
    scenario: {
      reviewId: current.scenarioReview.id,
      reviewRevision: current.scenarioReview.revision,
      reviewDigest: current.digests.review,
      sourceSnapshotDigest: current.digests.source,
      assumptionDigest: current.digests.assumptions,
      currentnessDigest: current.digests.currentness,
      asOf: current.asOf,
      horizon: current.horizon,
    },
    estimate: {
      id: selected.estimateId,
      snapshotDigest: selected.estimateSnapshotDigest,
      category: selected.category,
      decisionId: a.decisionId,
      decisionRevision: a.decisionRevision,
      decisionDigest: a.decisionDigest,
      issuedVersionId: a.issuedVersionId,
      issuedVersionRevision: a.issuedVersionRevision,
      issuedDocumentDigest: a.issuedDocumentDigest,
    },
    forward: { proposedWeightPpm },
    reverse: {
      target: { kind: 'minimum_category_total', category: selected.category,
        minimumAmount },
      constraint: { kind: 'selected_estimate_conversion_weight' },
    },
    purpose: 'bounded_open_pipeline_what_if',
  };
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

realPostgres('Mission 26 original Part 9D mounted pipeline sensitivity', () => {
  let f; let current; let selected; let body; let analysis;
  const lower = 111111; const base = 333333; const upper = 777777;

  beforeAll(async () => {
    f = await createEstimateReviewFixture({ operationalSchedule: true });
    const actor = f.actors.owner;
    const profile = await request(f.app).post(profileRoot)
      .set(actor.session.headers).set('Idempotency-Key', key())
      .send({ reason: 'Record the profile for exact Part 9D sensitivity lineage.',
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
        reason: 'Approve exact Part 9D authenticated bounds.', expectedRevision: 0,
        scenarioWeights: {
          preliminaryEstimate: { lowerPpm: lower, centralPpm: base, upperPpm: upper },
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
    const review = await request(f.app).post(`${namedRoot}/reviews`)
      .set(actor.session.headers).set('Idempotency-Key', key()).send({ action: 'approve',
        expectedRevision: 0, expectedDigest: 'none', assumptions: assumptionsFor(sources.members),
        reason: 'Approve explicit source-bound Part 9D base assumptions.', confirmed: true,
        confirmationVersion: 'named-pipeline-scenario-review-v1' });
    if (review.status !== 201) throw new Error(JSON.stringify(review.body));
    const response = await request(f.app).get(`${namedRoot}/current`).set(actor.session.headers);
    expect(response.status).toBe(200);
    current = response.body.data;
    expect(current).toMatchObject({ state: 'current', forecastIssued: true,
      currentness: { refreshRequired: false } });
    selected = current.assumptions.find(item => item.category === 'preliminary_estimate');
    expect(selected).toBeDefined();
    const baseline = categoryMicro(current.assumptions, selected.category,
      selected.estimateId, base);
    const maximum = categoryMicro(current.assumptions, selected.category,
      selected.estimateId, upper);
    const target = baseline + (maximum - baseline) / 2n;
    body = sensitivityBody(current, selected, upper, amount(target));
  }, 120000);

  afterAll(async () => { if (f) await f.cleanup(); }, 120000);

  test('uses exact one-estimate arithmetic and finds the minimum bounded weight reproducibly',
    async () => {
      const actor = f.actors.owner;
      const first = await request(f.app).post(`${root}/analyze`)
        .set(actor.session.headers).send(body);
      if (first.status !== 200) throw new Error(JSON.stringify(first.body));
      analysis = first.body.data;
      expect(analysis).toMatchObject({ state: 'assumption_only', reason: null,
        scenario: { reviewId: current.scenarioReview.id,
          reviewDigest: current.digests.review,
          sourceSnapshotDigest: current.digests.source,
          assumptionDigest: current.digests.assumptions,
          currentnessDigest: current.digests.currentness },
        selectedEstimate: { id: selected.estimateId, category: selected.category },
        constraint: { kind: 'selected_estimate_conversion_weight',
          bounds: { lowerPpm: lower, basePpm: base, upperPpm: upper } },
        forward: { state: 'assumption_only', changedAssumption: {
          field: 'conversion_weight_ppm', fromWeightPpm: base, toWeightPpm: upper },
        bindingConstraint: { kind: 'selected_weight_upper_bound', weightPpm: upper } },
        reverse: { state: 'assumption_only', reason: null },
        currentness: { scenarioCurrent: true, sourceCurrent: true,
          assumptionsCurrent: true, policyCurrent: true, profileCurrent: true,
          refreshRequired: false, correctionOrRevocationApplied: false },
        sourceAuthenticated: true, assumptionSourcesAuthenticated: true,
        weightsAreScenarioAssumptions: true, probabilityCalibrated: false,
        percentilesIssued: false, targetIsWhatIfThreshold: true,
        earnedRevenueMeasured: false, cashMeasured: false,
        recommendationIssued: false, analysisIssued: true,
        automaticActionAuthorized: false });

      const baselineCategory = categoryMicro(current.assumptions, selected.category,
        selected.estimateId, base);
      const proposedCategory = categoryMicro(current.assumptions, selected.category,
        selected.estimateId, upper);
      const baselineSelected = roundedMicro(cents(selected.priceBeforeTax) * BigInt(base));
      const proposedSelected = roundedMicro(cents(selected.priceBeforeTax) * BigInt(upper));
      expect(analysis.forward.categoryTotal).toEqual({
        baselineAmount: amount(baselineCategory), proposedAmount: amount(proposedCategory),
        changeAmount: amount(proposedCategory - baselineCategory),
      });
      expect(analysis.forward.selectedEstimate).toEqual({
        baselineAmount: amount(baselineSelected), proposedAmount: amount(proposedSelected),
        changeAmount: amount(proposedSelected - baselineSelected),
      });
      let expected = lower;
      while (expected < upper && categoryMicro(current.assumptions, selected.category,
        selected.estimateId, expected) < BigInt(body.reverse.target.minimumAmount.replace('.', ''))) {
        expected += 1;
      }
      expect(analysis.reverse.requiredWeightPpm).toBe(expected);
      expect(analysis.reverse.categoryTotal.attainedAmount).toBe(amount(categoryMicro(
        current.assumptions, selected.category, selected.estimateId, expected)));

      const reordered = { purpose: body.purpose, reverse: body.reverse, forward: body.forward,
        estimate: body.estimate, scenario: body.scenario, version: body.version };
      const again = await request(f.app).post(`${root}/analyze`)
        .set(actor.session.headers).send(reordered);
      expect(again.status).toBe(200);
      expect(again.body.data.digests).toEqual(analysis.digests);
      expect(again.body.data.forward).toEqual(analysis.forward);
      expect(again.body.data.reverse).toEqual(analysis.reverse);
      expect(JSON.stringify(analysis)).not.toMatch(
        /"p(?:10|50|90)"|"bookingProbability"|"recommendedAction"/i);
    }, 120000);

  test('keeps complete zero distinct and fails closed for impossible or unsupported questions',
    async () => {
      const actor = f.actors.owner;
      const zero = await request(f.app).post(`${root}/analyze`).set(actor.session.headers)
        .send(sensitivityBody(current, selected, lower, '0.000000'));
      expect(zero.status).toBe(200);
      expect(zero.body.data).toMatchObject({ state: 'assumption_only',
        reverse: { state: 'assumption_only', requiredWeightPpm: lower,
          bindingConstraint: { kind: 'selected_weight_lower_bound', weightPpm: lower } } });
      const missing = sensitivityBody(current, selected, lower, '0.000000');
      delete missing.reverse.target.minimumAmount;
      expect((await request(f.app).post(`${root}/analyze`).set(actor.session.headers)
        .send(missing)).status).toBe(400);

      const maximum = categoryMicro(current.assumptions, selected.category,
        selected.estimateId, upper);
      const impossible = await request(f.app).post(`${root}/analyze`)
        .set(actor.session.headers).send(sensitivityBody(current, selected, base,
          amount(maximum + 1n)));
      expect(impossible.status).toBe(200);
      expect(impossible.body.data.reverse).toEqual({ state: 'impossible',
        reason: 'target_exceeds_selected_weight_bound', requiredWeightPpm: null,
        selectedEstimateAmount: null, categoryTotal: null,
        bindingConstraint: { kind: 'selected_weight_upper_bound', weightPpm: upper } });

      for (const [path, value, reason] of [
        ['target.kind', 'minimum_staffing_total', 'unsupported_target_kind'],
        ['constraint.kind', 'crew_hours', 'unsupported_constraint_kind'],
      ]) {
        const unsupported = structuredClone(body);
        if (path === 'target.kind') unsupported.reverse.target.kind = value;
        else unsupported.reverse.constraint.kind = value;
        const response = await request(f.app).post(`${root}/analyze`)
          .set(actor.session.headers).send(unsupported);
        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({ state: 'unavailable', reason,
          asOf: null, scenario: null, selectedEstimate: null, target: null,
          constraint: null, forward: null, reverse: null,
          analysisIssued: false, automaticActionAuthorized: false });
        expect(Object.values(response.body.data.digests).every(value => value === null)).toBe(true);
      }
      const outside = sensitivityBody(current, selected, upper + 1, body.reverse.target.minimumAmount);
      const out = await request(f.app).post(`${root}/analyze`)
        .set(actor.session.headers).send(outside);
      expect(out.status).toBe(200);
      expect(out.body.data).toMatchObject({ state: 'unavailable',
        reason: 'proposed_weight_outside_authenticated_bounds', analysisIssued: false });
    }, 120000);

  test('enforces tenant, role and private helper authority with idempotent reconciliation',
    async () => {
      for (const denied of ['member', 'viewer']) {
        expect((await request(f.app).post(`${root}/analyze`)
          .set(f.actors[denied].session.headers).send(body)).status).toBe(403);
      }
      const other = await request(f.app).post(`${root}/analyze`)
        .set(f.actors.otherOwner.session.headers).send(body);
      expect(other.status).toBe(200);
      expect(other.body.data).toMatchObject({ state: 'unavailable',
        reason: 'no_current_scenario_review', scenario: null, selectedEstimate: null,
        forward: null, reverse: null, analysisIssued: false });
      expect(JSON.stringify(other.body)).not.toContain(current.scenarioReview.id);

      const zero = (await f.ownerPool.query(`SELECT
        canonical_forecast_pipeline_sensitivity_v1_signed_amount(0) zero,
        canonical_forecast_pipeline_sensitivity_v1_signed_amount(-1) negative`)).rows[0];
      expect(zero).toEqual({ zero: '0.000000', negative: '-0.000001' });
      await expect(f.runtimePool.query(`SELECT
        canonical_forecast_pipeline_sensitivity_v1_value('[]','[]',$1,0,'preliminary_estimate')`,
      [selected.estimateId])).rejects.toMatchObject({ code: '42501' });
      const privileges = (await f.runtimePool.query(`SELECT
        has_function_privilege(current_user,
         'canonical_forecast_pipeline_sensitivity_v1_read(uuid,uuid,text,uuid,jsonb)','EXECUTE') reader,
        has_function_privilege(current_user,
         'canonical_forecast_pipeline_sensitivity_v1_value(jsonb,jsonb,uuid,integer,text)','EXECUTE') helper`))
        .rows[0];
      expect(privileges).toEqual({ reader: true, helper: false });
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
      for (const change of [
        `GRANT EXECUTE ON FUNCTION canonical_forecast_pipeline_sensitivity_v1_value(jsonb,jsonb,uuid,integer,text) TO PUBLIC`,
        `ALTER FUNCTION canonical_forecast_pipeline_sensitivity_v1_read(uuid,uuid,text,uuid,jsonb)
          RENAME TO canonical_forecast_pipeline_sensitivity_v1_read_missing_test`,
      ]) {
        const drift = await f.ownerPool.connect();
        try {
          await drift.query('BEGIN');
          await drift.query(change);
          await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(drift, authority))
            .rejects.toThrow(change.startsWith('GRANT') ?
              'Runtime database role privilege verification failed' :
              'Part 9D runtime authority functions are missing');
        } finally {
          await drift.query('ROLLBACK').catch(() => {}); drift.release();
        }
      }
    }, 120000);

  test('clears prior values when the exact scenario is stale', async () => {
    const actor = f.actors.owner;
    const before = (await f.ownerPool.query(`SELECT reviewed_at
      FROM canonical_forecast_named_scenario_reviews_v1 WHERE id=$1`,
    [current.scenarioReview.id])).rows[0];
    await setScenarioClock(f.ownerPool,
      new Date(new Date(before.reviewed_at).getTime() - 1000).toISOString());
    const reversed = await request(f.app).post(`${root}/analyze`)
      .set(actor.session.headers).send(body);
    expect(reversed.status).toBe(200);
    expect(reversed.body.data).toMatchObject({ state: 'unavailable', reason: 'clock_reversal',
      asOf: null, scenario: null, selectedEstimate: null, target: null,
      constraint: null, forward: null, reverse: null,
      currentness: { refreshRequired: true, correctionOrRevocationApplied: true },
      analysisIssued: false });
    expect(Object.values(reversed.body.data.digests).every(value => value === null)).toBe(true);
    await setScenarioClock(f.ownerPool, null);
    const recovered = await request(f.app).post(`${root}/analyze`)
      .set(actor.session.headers).send(body);
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.digests.output).toBe(analysis.digests.output);

    const changed = await request(f.app).post(`${pipelineRoot}/policies`)
      .set(actor.session.headers).set('Idempotency-Key', key()).send({ action: 'approve',
        reason: 'Change the bound policy and stale the issued scenario.', expectedRevision: 1,
        scenarioWeights: {
          preliminaryEstimate: { lowerPpm: lower, centralPpm: 444444, upperPpm: upper },
          approvedUnbooked: { lowerPpm: 222222, centralPpm: 555555,
            upperPpm: 888888 },
        }, confirmed: true, confirmationVersion: 'pipeline-scenario-policy-v1' });
    expect(changed.status).toBe(201);
    const stale = await request(f.app).post(`${root}/analyze`)
      .set(actor.session.headers).send(body);
    expect(stale.status).toBe(200);
    expect(stale.body.data).toMatchObject({ state: 'unavailable',
      reason: 'scenario_policy_changed', scenario: null, forward: null, reverse: null,
      analysisIssued: false });
  }, 120000);
});
