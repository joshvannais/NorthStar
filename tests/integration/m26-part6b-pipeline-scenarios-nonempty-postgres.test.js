'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { ingestLead } = require('../../src/services/canonicalGraphService');
const commercial = require('../../src/estimating/commercialContract');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');
const { fixture: pricingFixture } = require('../helpers/m24-pricing-input');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const root = '/api/v1/forecast/pipeline-scenarios';
const profileRoot = '/api/v1/forecast/reporting-windows/effective-anchors';
const demandRoot = '/api/v1/forecast/demand-to-schedule';
const priceRoot = '/api/v1/forecast/price-history';
const bookingRoot = '/api/v1/forecast/booking-reviews';
const key = () => crypto.randomUUID();

async function setScenarioClock(pool, instant) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL northstar.m26_part6b_disposable_clock='enabled'");
    await client.query(
      'SELECT canonical_forecast_pipeline_scenario_test_clock_set($1)', [instant]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function setScheduleClock(pool, instant) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL northstar.m26_part5a_disposable_clock='enabled'");
    await client.query(
      'SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [instant]);
    await client.query("SET LOCAL northstar.m26_part4c_disposable_clock='enabled'");
    await client.query(
      'SELECT canonical_forecast_demand_schedule_test_clock_v1_set($1)', [instant]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

function completeProfile() {
  const profile = canonicalFenceProfile();
  profile.company.timeZone = 'UTC';
  profile.hours = Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      .map(day => [day, { open: '00:00', close: '23:59', lunch: '',
        emergency: false, afterHours: false, holiday: false }]));
  return profile;
}

async function ingestScenarioEstimate(f, label) {
  const id = crypto.randomUUID();
  const profile = completeProfile();
  const scheduledStart = new Date(Date.UTC(2027, 9, 1,
    crypto.randomInt(1, 20), 0, 0));
  const result = await ingestLead(f.runtimePool, {
    tenantContext: { organizationId: f.org, trusted: true },
    idempotencyKey: id, sourceVersion: 'm26-part6b-nonempty-v1',
    external: { customerId: id, callId: id, transcriptId: id,
      communicationId: id, appointmentId: id },
    customer: { name: `Fictional Part 6B ${label} customer`,
      phone: `+1555${crypto.randomInt(1000000, 9999999)}`,
      email: `${id}@example.test`,
      address: { line1: '1 Test Way', city: 'Boston', state: 'MA', postalCode: '02108' } },
    transcript: [{ turnId: 'scope', speaker: 'customer',
      text: 'I need a 100-foot cedar fence.' }],
    facts: [{ variable: 'linearFeet', normalizedValue: 100, evidenceText: '100-foot',
      speaker: 'customer', evidenceTurnId: 'scope', confidence: 1 }],
    service: { key: 'fence', scope: { jobType: 'replace', linearFeet: 100,
      height: 6, material: 'cedar', removalRequired: true,
      gates: [{ type: 'walk' }], permitsRequired: true } },
    scheduledAppointment: { start: scheduledStart.toISOString(),
      end: new Date(scheduledStart.getTime() + 3600000).toISOString(),
      status: 'scheduled' },
    businessProfile: profile, businessProfileVersion: profile.version,
  });
  expect(result.status).toBe(201);
  return result.body;
}

async function primePriceCoverage(f, actor) {
  const snapshot = await request(f.app).post(`${priceRoot}/ordered-snapshots`)
    .set(actor.session.headers).set('Idempotency-Key', key()).send({});
  expect(snapshot.status).toBe(201);
  const activation = await request(f.app).post(`${priceRoot}/ordered-anchor/activate`)
    .set(actor.session.headers).send({});
  expect(activation.status).toBe(200);
}

async function approveAndIssue(f, actor, graph) {
  const route = `/api/v1/canonical/estimates/${graph.ids.estimate}`;
  const get = suffix => request(f.app).get(route + suffix).set(actor.session.headers);
  const post = (suffix, body) => request(f.app).post(route + suffix)
    .set(actor.session.headers).set('Idempotency-Key', key()).send(body);
  let review = (await get('/review')).body.data;
  const pricing = review.pricingPlans;
  const priced = await post('/pricing-plans', {
    action: 'save', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
    expectedDecisionRevision: review.decisions.writeBasis.revision,
    expectedDecisionDigest: review.decisions.writeBasis.digest,
    inputs: pricingFixture(pricing.serviceKey), currency: review.currency,
    reason: 'Price the frozen Part 6B approved scenario member.', confirmed: true,
    confirmationVersion: pricing.contract, evidenceDigest: pricing.sources.digest,
  });
  expect(priced.status).toBe(201);
  review = (await get('/review')).body.data;
  const terms = review.commercialTerms;
  const inputs = commercialFixture().value;
  inputs.version = terms.contract;
  inputs.jobApplicability = { serviceOperation: 'fence_installation',
    propertyUse: 'residential', workContext: 'new_construction',
    customerExemption: 'none', evidenceRef: { serviceOperation: 'Reviewed scope',
      propertyUse: 'Recorded property', workContext: 'Reviewed scope',
      customerExemption: 'Customer statement' } };
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
  const savedTerms = await post('/commercial-terms', {
    action: 'save', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
    expectedDecisionRevision: terms.decisionBasis.revision,
    expectedDecisionDigest: terms.decisionBasis.digest, inputs,
    currency: review.currency, reason: 'Record Part 6B commercial terms.',
    confirmed: true, confirmationVersion: terms.contract,
    evidenceDigest: terms.sources.digest,
  });
  expect(savedTerms.status).toBe(201);
  review = (await get('/review')).body.data;
  const currentTerms = review.commercialTerms;
  const approval = await post('/commercial-approvals', {
    termsPin: commercial.pin(currentTerms.current),
    evidenceDigest: currentTerms.sources.digest,
    expectedDecisionRevision: currentTerms.decisionBasis.revision,
    expectedDecisionDigest: currentTerms.decisionBasis.digest,
    scopeSummary: 'Install the recorded cedar fence and complete reviewed work.',
    reason: 'Approve the Part 6B frozen commercial member.', confirmed: true,
    confirmationVersion: currentTerms.contract,
    exceptions: { policyReason: '', policyUnknownAcknowledged: true,
      ownerRecordedTaxAcknowledged: true },
  });
  expect(approval.status).toBe(201);
  const issued = await post('/customer-estimate-versions', {
    reason: 'Issue the approved Part 6B customer estimate.', confirmed: true,
    confirmationVersion: 'customer-estimate-issue-v1',
  });
  expect(issued.status).toBe(201);
  return { route, versionId: issued.body.data.receipt.id };
}

async function acceptIssuedVersion(f, actor, approved) {
  const link = await request(f.app).post(`${approved.route}/customer-estimate-links`)
    .set(actor.session.headers).set('Idempotency-Key', key()).send({
      versionId: approved.versionId, expiresInDays: 14, confirmed: true,
      confirmationVersion: 'customer-estimate-delivery-v1',
    });
  expect(link.status).toBe(201);
  const token = decodeURIComponent(link.body.data.urlPath.split('/').pop());
  const accepted = await request(f.app)
    .post(`/api/public/customer-estimates/${token}/accept`)
    .set({ Host: 'localhost', Origin: 'http://localhost' })
    .set('Idempotency-Key', key()).send({ customerName: 'Taylor Customer',
      confirmed: true, confirmationVersion: 'customer-estimate-accept-v1' });
  expect(accepted.status).toBe(201);
}

async function scheduleWithHumanApproval(f, actor, graph, instant) {
  const appointment = graph.ids.appointment;
  const before = (await f.ownerPool.query(
    `SELECT revision,rtrim(canonical_digest) digest,appointment_status
       FROM canonical_schedule_assignments
      WHERE organization_id=$1 AND appointment_id=$2`, [f.org, appointment])).rows[0];
  const start = new Date(instant);
  start.setUTCHours(start.getUTCHours() + 2);
  const end = new Date(start);
  end.setUTCHours(end.getUTCHours() + 1);
  const reason = 'Schedule the accepted Part 6B estimate inside its frozen horizon.';
  const preview = await request(f.app)
    .post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
    .set(actor.session.headers).send({ expectedRevision: Number(before.revision),
      expectedDigest: before.digest, expectedTimeZone: 'UTC', action: 'reschedule',
      target: { kind: 'unassigned', id: null }, scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(), appointmentStatus: before.appointment_status, reason });
  if (preview.status !== 201) throw new Error(`Part 6B schedule preview failed: ${JSON.stringify({ body: preview.body, before })}`);
  const approved = await request(f.app)
    .post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
    .set(actor.session.headers).set('Idempotency-Key', key()).send({
      previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
      acknowledgedWarningDigests: preview.body.data.warningDigests,
      acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason,
    });
  if (approved.status !== 200) throw new Error(`Part 6B schedule approval failed: ${JSON.stringify(approved.body)}`);
  return (await f.ownerPool.query(
    `SELECT id FROM canonical_schedule_human_approvals
      WHERE organization_id=$1 AND appointment_id=$2
      ORDER BY approved_at DESC,id DESC LIMIT 1`, [f.org, appointment])).rows[0].id;
}

realPostgres('Mission 26 Part 6B non-empty pipeline scenario proof', () => {
  let f;
  beforeAll(async () => { f = await createEstimateReviewFixture({ operationalSchedule: true }); },
    120000);
  afterAll(async () => { if (f) await f.cleanup(); }, 120000);

  test('binds a mixed frozen cohort to first-booking price receipts and guarded access',
    async () => {
      const actor = f.actors.owner;
      const profile = await request(f.app).post(profileRoot)
        .set(actor.session.headers).set('Idempotency-Key', key())
        .send({ reason: 'Record the profile for the non-empty Part 6B cohort.',
          confirmed: true });
      expect(profile.status).toBe(201);
      expect((await request(f.app)
        .post(`${profileRoot}/${profile.body.data.anchorId}/activate`)
        .set(actor.session.headers).send({})).status).toBe(200);
      const epoch = await request(f.app).post(`${demandRoot}/epochs`)
        .set(actor.session.headers).set('Idempotency-Key', key())
        .send({ purpose: 'pipeline_first_booking',
          profileAnchorId: profile.body.data.anchorId });
      expect(epoch.status).toBe(201);

      const preliminary = await ingestScenarioEstimate(f, 'preliminary');
      const approvedGraph = await ingestScenarioEstimate(f, 'approved');
      const approvedUnbookedGraph = await ingestScenarioEstimate(f, 'approved unbooked');
      await primePriceCoverage(f, actor);
      const approved = await approveAndIssue(f, actor, approvedGraph);
      const approvedUnbooked = await approveAndIssue(f, actor, approvedUnbookedGraph);
      await acceptIssuedVersion(f, actor, approved);

      const policyBody = { action: 'approve',
        reason: 'Approve mixed-category Part 6B scenario assumptions.', expectedRevision: 0,
        scenarioWeights: {
          preliminaryEstimate: { lowerPpm: 111111, centralPpm: 333333,
            upperPpm: 777777 },
          approvedUnbooked: { lowerPpm: 222222, centralPpm: 555555,
            upperPpm: 888888 },
        }, confirmed: true, confirmationVersion: 'pipeline-scenario-policy-v1' };
      const policy = await request(f.app).post(`${root}/policies`)
        .set(actor.session.headers).set('Idempotency-Key', key()).send(policyBody);
      expect(policy.status).toBe(201);
      const nullWeight = await request(f.app).post(`${root}/policies`)
        .set(actor.session.headers).set('Idempotency-Key', key()).send({
          ...policyBody, expectedRevision: 1,
          scenarioWeights: { ...policyBody.scenarioWeights,
            preliminaryEstimate: {
              ...policyBody.scenarioWeights.preliminaryEstimate, lowerPpm: null } },
        });
      expect(nullWeight.status).toBe(400);
      await expect(f.ownerPool.query(`SELECT
        canonical_forecast_pipeline_scenario_weighted_micro(NULL,'preliminary_estimate',1)`))
        .rejects.toMatchObject({ code: '22023' });
      await expect(f.ownerPool.query(`SELECT
        canonical_forecast_pipeline_scenario_weighted_micro('[]'::jsonb,NULL,1)`))
        .rejects.toMatchObject({ code: '22023' });
      await expect(f.ownerPool.query(`SELECT
        canonical_forecast_pipeline_scenario_total_weighted_micro('[]'::jsonb,NULL,1)`))
        .rejects.toMatchObject({ code: '22023' });

      const otherTenant = await request(f.app).get(`${root}/policies/current`)
        .set('Cookie', f.actors.otherOwner.session.headers.Cookie);
      expect(otherTenant.status).toBe(200);
      expect(otherTenant.body).toEqual({ success: true, data: {
        state: 'pipeline_scenario_policy_unavailable', reason: 'no_review',
        weightsWithheld: true, weightsAreScenarioAssumptions: true,
        probabilityCalibrated: false, forecastIssued: false,
      } });
      const otherText = JSON.stringify(otherTenant.body);
      expect(otherText).not.toContain(f.org);
      expect(otherText).not.toContain(policy.body.data.id);
      expect(otherText).not.toContain(String(policy.body.data.revision));
      expect((await request(f.app).get(`${root}/policies/current`)
        .set(f.actors.admin.session.headers)).status).toBe(200);
      for (const denied of ['dispatcher', 'member', 'viewer']) {
        expect((await request(f.app).get(`${root}/policies/current`)
          .set(f.actors[denied].session.headers)).status).toBe(403);
      }
      expect((await request(f.app).get(`${root}/policies/current`)).status).toBe(401);
      expect((await request(f.app).post(`${root}/policies`)
        .set(actor.session.headers).set('X-CSRF-Token', 'invalid-csrf-token')
        .set('Idempotency-Key', key()).send({ ...policyBody, expectedRevision: 1 })).status)
        .toBe(403);
      await f.ownerPool.query(
        "UPDATE organization_memberships SET status='suspended' WHERE organization_id=$1 AND id=$2",
        [f.org, actor.actorUserId]);
      expect((await request(f.app).get(`${root}/policies/current`)
        .set(actor.session.headers)).status).toBe(403);
      await f.ownerPool.query(
        "UPDATE organization_memberships SET status='active' WHERE organization_id=$1 AND id=$2",
        [f.org, actor.actorUserId]);
      await f.ownerPool.query("UPDATE subscriptions SET status='past_due' WHERE organization_id=$1",
        [f.org]);
      expect((await request(f.app).get(`${root}/policies/current`)
        .set(actor.session.headers)).status).toBe(403);
      await f.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1",
        [f.org]);
      await f.ownerPool.query(
        "UPDATE auth_sessions SET status='revoked',revoked_at=clock_timestamp(),revoke_reason='test' WHERE id=$1",
        [actor.authSessionId]);
      expect((await request(f.app).get(`${root}/policies/current`)
        .set(actor.session.headers)).status).toBe(401);
      await f.ownerPool.query(
        "UPDATE auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1",
        [actor.authSessionId]);

      const origin = await request(f.app).post(`${root}/origins`)
        .set(actor.session.headers).set('Idempotency-Key', key()).send({
          reason: 'Capture the non-empty mixed-category Part 6B cohort.',
          confirmed: true, confirmationVersion: 'pipeline-open-value-scenario-v1',
        });
      if (origin.status !== 201) throw new Error(`Part 6B origin failed: ${JSON.stringify(origin.body)}`);
      const originId = origin.body.data.id;
      const crossTenantOrigin = await request(f.app).get(`${root}/origins/${originId}`)
        .set('Cookie', f.actors.otherOwner.session.headers.Cookie);
      expect(crossTenantOrigin.status).toBe(404);
      expect(crossTenantOrigin.body).toEqual({ success: false, error: 'Not found' });
      expect(JSON.stringify(crossTenantOrigin.body)).not.toMatch(
        new RegExp([f.org, originId].join('|')));
      const storedOrigin = (await f.ownerPool.query(
        `SELECT captured_at,horizon_starts_at,horizon_ends_at,evidence,private_output
           FROM canonical_forecast_pipeline_scenario_origins WHERE id=$1`, [originId])).rows[0];
      const commitPolicyWeight = async value => {
        const writer = await f.ownerPool.connect();
        try {
          await writer.query('BEGIN');
          await writer.query(`ALTER TABLE canonical_forecast_pipeline_scenario_policy_reviews
            DISABLE TRIGGER canonical_forecast_pipeline_scenario_policy_immutable`);
          await writer.query(`UPDATE canonical_forecast_pipeline_scenario_policy_reviews
            SET preliminary_lower_ppm=$2 WHERE id=$1`, [policy.body.data.id, value]);
          await writer.query(`ALTER TABLE canonical_forecast_pipeline_scenario_policy_reviews
            ENABLE TRIGGER canonical_forecast_pipeline_scenario_policy_immutable`);
          await writer.query('COMMIT');
        } catch (error) {
          await writer.query('ROLLBACK').catch(() => {});
          throw error;
        } finally { writer.release(); }
      };
      await commitPolicyWeight(111112);
      expect((await request(f.app).get(`${root}/policies/current`)
        .set(actor.session.headers)).status).toBe(503);
      const staleFromPolicyTamper = await request(f.app).get(`${root}/origins/${originId}`)
        .set(actor.session.headers);
      expect(staleFromPolicyTamper.status).toBe(200);
      expect(staleFromPolicyTamper.body.data.state).toBe('pipeline_scenario_origin_stale');
      await commitPolicyWeight(111111);
      const restoredPolicy = await request(f.app).get(`${root}/policies/current`)
        .set(actor.session.headers);
      expect(restoredPolicy.status).toBe(200);
      expect(restoredPolicy.body.data).toMatchObject({
        state: 'pipeline_scenario_policy_current', id: policy.body.data.id,
      });
      const policyLock = await f.ownerPool.connect();
      try {
        await policyLock.query('BEGIN');
        await policyLock.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('m26:pipeline-scenario-policy:'||$1::text,0))",
          [f.org]);
        const busyPolicy = await request(f.app).get(`${root}/policies/current`)
          .set(actor.session.headers);
        expect(busyPolicy.status).toBe(409);
        expect(busyPolicy.body).toEqual({ success: false,
          error: 'Pipeline scenario is busy' });
      } finally {
        await policyLock.query('ROLLBACK').catch(() => {});
        policyLock.release();
      }
      const restoredOrigin = await request(f.app).get(`${root}/origins/${originId}`)
        .set(actor.session.headers);
      expect(restoredOrigin.status).toBe(200);
      expect(restoredOrigin.body.data.captureInputsCurrentAtRead).toBe(true);
      const members = storedOrigin.evidence.members;
      expect(members).toHaveLength(3);
      expect(members.map(member => member.category).sort())
        .toEqual(['approved_unbooked', 'approved_unbooked', 'preliminary_estimate']);
      expect(members.map(member => member.estimateId).sort())
        .toEqual([preliminary.ids.estimate, approvedGraph.ids.estimate,
          approvedUnbookedGraph.ids.estimate].sort());
      expect(Number(storedOrigin.private_output.totalRangeMicro.lower)).toBeGreaterThan(0);
      const selectedWeights = {
        lower: { preliminary_estimate: 111111n, approved_unbooked: 222222n },
        central: { preliminary_estimate: 333333n, approved_unbooked: 555555n },
        upper: { preliminary_estimate: 777777n, approved_unbooked: 888888n },
      };
      const expectedTotals = Object.fromEntries(Object.entries(selectedWeights).map(
        ([range, weights]) => [range, String((members.reduce((sum, member) => {
          const cents = BigInt(member.priceBeforeTax.replace('.', ''));
          return sum + (cents * weights[member.category]);
        }, 0n) + 50n) / 100n)]));
      expect({ lower: String(storedOrigin.private_output.totalRangeMicro.lower),
        central: String(storedOrigin.private_output.totalRangeMicro.central),
        upper: String(storedOrigin.private_output.totalRangeMicro.upper) }).toEqual(expectedTotals);

      const progressedPreliminary = await approveAndIssue(f, actor, preliminary);
      expect(progressedPreliminary.versionId).toMatch(/^[0-9a-f-]{36}$/);
      const afterFrozenMemberProgress = await request(f.app)
        .get(`${root}/origins/${originId}`).set(actor.session.headers);
      if (afterFrozenMemberProgress.status !== 200 ||
          afterFrozenMemberProgress.body.data?.captureInputsCurrentAtRead !== true) {
        throw new Error(`Post-capture frozen-member progress staled origin: ${JSON.stringify(afterFrozenMemberProgress.body)}`);
      }
      expect(afterFrozenMemberProgress.body.data).toMatchObject({
        id: originId, captureInputsCurrentAtRead: true,
      });
      expect((await f.ownerPool.query(
        `SELECT evidence->'members' members
           FROM canonical_forecast_pipeline_scenario_origins WHERE id=$1`,
        [originId])).rows[0].members.find(member =>
        member.estimateId === preliminary.ids.estimate)).toMatchObject({
          category: 'preliminary_estimate',
          estimateId: preliminary.ids.estimate,
        });

      await new Promise(resolve => setTimeout(resolve, 10));
      const entrant = await ingestScenarioEstimate(f, 'post-cutoff entrant');
      const replacement = (await f.ownerPool.query(`WITH operation_value AS (
        INSERT INTO canonical_operations(organization_id,idempotency_key_hash,
          payload_fingerprint,state,lease_owner,lease_expires_at,result_status,
          result_body,completed_at)
        VALUES($1,$2,$3,'completed',gen_random_uuid(),clock_timestamp(),201,'{}',clock_timestamp())
        RETURNING id,graph_id
      ) INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,
        opportunity_id,calculation_version,normalized_input_fingerprint,
        business_profile_version,business_profile_hash,currency,customer_price,
        line_items,calculation_output,snapshot_digest,created_at)
      SELECT gen_random_uuid(),base.organization_id,operation_value.id,operation_value.graph_id,
        base.opportunity_id,base.calculation_version,base.normalized_input_fingerprint,
        base.business_profile_version,base.business_profile_hash,base.currency,
        base.customer_price,base.line_items,base.calculation_output,base.snapshot_digest,
        clock_timestamp()
      FROM canonical_estimates base CROSS JOIN operation_value
      WHERE base.organization_id=$1 AND base.id=$4 RETURNING id`,
      [f.org, crypto.randomBytes(32).toString('hex'),
        crypto.randomBytes(32).toString('hex'), approvedGraph.ids.estimate])).rows[0].id;
      expect(replacement).toMatch(/^[0-9a-f-]{36}$/);
      const afterProgress = await request(f.app).get(`${root}/origins/${originId}`)
        .set(actor.session.headers);
      expect(afterProgress.status).toBe(200);
      expect(afterProgress.body.data.captureInputsCurrentAtRead).toBe(true);
      const afterStored = (await f.ownerPool.query(
        'SELECT evidence FROM canonical_forecast_pipeline_scenario_origins WHERE id=$1',
        [originId])).rows[0].evidence;
      expect(afterStored.members.some(member => member.estimateId === entrant.ids.estimate)).toBe(false);
      expect(afterStored.members.some(member => member.estimateId === replacement)).toBe(false);

      const sourceLock = await f.ownerPool.connect();
      try {
        await sourceLock.query('BEGIN');
        await sourceLock.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('m26:pipeline-scenario-source:'||$1::text,0))",
          [f.org]);
        const busy = await request(f.app).get(`${root}/origins/${originId}`)
          .set(actor.session.headers);
        expect(busy.status).toBe(409);
        expect(busy.body).toEqual({ success: false, error: 'Pipeline scenario is busy' });
      } finally {
        await sourceLock.query('ROLLBACK').catch(() => {});
        sourceLock.release();
      }

      const eventTime = new Date(storedOrigin.horizon_starts_at);
      eventTime.setUTCDate(eventTime.getUTCDate() + 1);
      expect(Number((await f.ownerPool.query(
        `SELECT count(*) count FROM canonical_forecast_schedule_booking_events
          WHERE organization_id=$1 AND appointment_id=$2
            AND transition_kind='accepted_booking'`,
        [f.org, approvedGraph.ids.appointment])).rows[0].count)).toBe(0);
      await setScenarioClock(f.ownerPool, eventTime.toISOString());
      await setScheduleClock(f.ownerPool, eventTime.toISOString());
      const approvalId = await scheduleWithHumanApproval(f, actor, approvedGraph,
        eventTime.toISOString());
      const acceptedBookingEvent = (await f.ownerPool.query(
        `SELECT event.source_kind,revision.human_approval_id,event.transition_kind
           FROM canonical_forecast_schedule_booking_events event
           JOIN canonical_schedule_assignment_revisions revision
             ON revision.organization_id=event.organization_id
            AND revision.id=event.source_revision_id
          WHERE event.organization_id=$1 AND event.appointment_id=$2
            AND event.transition_kind='accepted_booking'`,
        [f.org, approvedGraph.ids.appointment])).rows;
      expect(acceptedBookingEvent).toEqual([expect.objectContaining({
        source_kind: 'human_preview_approved', human_approval_id: approvalId,
        transition_kind: 'accepted_booking',
      })]);
      const first = await request(f.app).post(`${bookingRoot}/first`)
        .set(actor.session.headers).set('Idempotency-Key', key()).send({ approvalId,
          reason: 'Review the accepted Part 6B booking at its event-time price.' });
      if (first.status !== 201) throw new Error(`Part 6B booking review failed: ${JSON.stringify(first.body)}`);
      const firstReviewId = first.body.data.reviewId;

      const afterHorizon = new Date(storedOrigin.horizon_ends_at);
      afterHorizon.setUTCDate(afterHorizon.getUTCDate() + 1);
      await setScenarioClock(f.ownerPool, afterHorizon.toISOString());
      const evaluation = await request(f.app)
        .post(`${root}/origins/${originId}/evaluations`)
        .set(actor.session.headers).set('Idempotency-Key', key()).send({
          reason: 'Evaluate the complete non-empty Part 6B frozen cohort.',
          confirmed: true,
          confirmationVersion: 'pipeline-cutoff-cohort-evaluation-v1',
        });
      if (evaluation.status !== 201) throw new Error(`Part 6B evaluation failed: ${JSON.stringify(evaluation.body)}`);
      const crossTenantEvaluation = await request(f.app)
        .get(`${root}/evaluations/${evaluation.body.data.id}`)
        .set('Cookie', f.actors.otherOwner.session.headers.Cookie);
      expect(crossTenantEvaluation.status).toBe(404);
      expect(crossTenantEvaluation.body).toEqual({ success: false, error: 'Not found' });
      expect(JSON.stringify(crossTenantEvaluation.body)).not.toMatch(
        new RegExp([f.org, originId, evaluation.body.data.id].join('|')));
      const storedEvaluation = (await f.ownerPool.query(
        `SELECT outcome_evidence,private_metrics
           FROM canonical_forecast_pipeline_scenario_evaluations WHERE id=$1`,
      [evaluation.body.data.id])).rows[0];
      if (Number(storedEvaluation.private_metrics.actualBookedWorkValueMicro) === 0) {
        throw new Error(`Part 6B nonzero outcome missing: ${JSON.stringify(storedEvaluation)}`);
      }
      expect(storedEvaluation.outcome_evidence.acceptedEventCount).toBe(1);
      expect(storedEvaluation.outcome_evidence.receipts).toHaveLength(3);
      const booked = storedEvaluation.outcome_evidence.receipts.find(
        receipt => receipt.state === 'first_accepted_booking_priced');
      const unbooked = storedEvaluation.outcome_evidence.receipts.find(
        receipt => receipt.estimateId === preliminary.ids.estimate);
      const approvedNoBooking = storedEvaluation.outcome_evidence.receipts.find(
        receipt => receipt.estimateId === approvedUnbookedGraph.ids.estimate);
      expect(booked).toMatchObject({ estimateId: approvedGraph.ids.estimate,
        reviewId: firstReviewId, bookingSourceKind: 'human_preview_approved',
        scheduleHumanApprovalId: approvalId, approvalId,
        priceEffectiveNoLaterThanBooking: true });
      expect(booked.reviewedPriceBeforeTax).toMatch(/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/);
      expect(booked.approvedDecisionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(booked.issuedVersionId).toBe(approved.versionId);
      expect(booked.acceptanceId).toMatch(/^[0-9a-f-]{36}$/);
      expect(booked.reviewHistory).toHaveLength(1);
      expect(unbooked).toMatchObject({ estimateId: preliminary.ids.estimate,
        frozenCategory: 'preliminary_estimate', state: 'no_accepted_booking', reviewHistory: [] });
      expect(approvedNoBooking).toMatchObject({
        estimateId: approvedUnbookedGraph.ids.estimate,
        frozenCategory: 'approved_unbooked', state: 'no_accepted_booking', reviewHistory: [],
      });
      for (const field of ['acceptedEventId', 'bookingSourceOrder',
        'bookingSourceRevisionId', 'bookingSourceRevision', 'bookingSourceKind',
        'assignmentId', 'appointmentId', 'sourceOccurredAt', 'observedAt',
        'bookingDigest', 'bookingObservationDigest', 'scheduleHumanApprovalId',
        'reviewId', 'reviewOrder', 'reviewedAt', 'approvalId', 'acceptanceId',
        'issuedVersionId', 'approvedDecisionId', 'reviewedPriceBeforeTax',
        'currency', 'reviewRequestDigest', 'reviewDigest']) {
        expect(unbooked[field]).toBeNull();
        expect(approvedNoBooking[field]).toBeNull();
      }
      expect(storedEvaluation.outcome_evidence.receipts.some(receipt =>
        receipt.estimateId === entrant.ids.estimate || receipt.estimateId === replacement)).toBe(false);

      const corrected = await request(f.app)
        .post(`${bookingRoot}/${firstReviewId}/correct`)
        .set(actor.session.headers).set('Idempotency-Key', key()).send({ approvalId,
          reason: 'Correct the reviewed Part 6B booking after checking its scope.' });
      expect(corrected.status).toBe(201);
      expect(corrected.body.data.state).toBe('booking_corrected');
      const staleAfterCorrection = await request(f.app)
        .get(`${root}/evaluations/${evaluation.body.data.id}`).set(actor.session.headers);
      expect(staleAfterCorrection.status).toBe(200);
      expect(staleAfterCorrection.body.data.state).toBe('pipeline_scenario_evaluation_stale');
      const cancelled = await request(f.app)
        .post(`${bookingRoot}/${corrected.body.data.reviewId}/cancel`)
        .set(actor.session.headers).set('Idempotency-Key', key())
        .send({ reason: 'Cancel the corrected Part 6B booking review for lifecycle proof.' });
      expect(cancelled.status).toBe(201);
      expect(cancelled.body.data.state).toBe('booking_cancelled');
      const refreshed = await request(f.app)
        .post(`${root}/origins/${originId}/evaluations`)
        .set(actor.session.headers).set('Idempotency-Key', key()).send({
          reason: 'Refresh the Part 6B evaluation after correction and cancellation.',
          confirmed: true,
          confirmationVersion: 'pipeline-cutoff-cohort-evaluation-v1',
        });
      expect(refreshed.status).toBe(201);
      expect(refreshed.body.data.revision).toBe(2);
      const refreshedEvidence = (await f.ownerPool.query(
        'SELECT outcome_evidence FROM canonical_forecast_pipeline_scenario_evaluations WHERE id=$1',
        [refreshed.body.data.id])).rows[0].outcome_evidence;
      expect(refreshedEvidence.receipts.find(receipt =>
        receipt.state === 'first_accepted_booking_priced').reviewHistory.map(row => row.action))
        .toEqual(['first_booking_reviewed', 'booking_corrected', 'booking_cancelled']);

      const latestReviewId = cancelled.body.data.reviewId;
      await f.ownerPool.query(`WITH seed AS (
        SELECT * FROM canonical_forecast_commercial_booking_reviews WHERE id=$1
      ), generated AS (
        SELECT value.ordinal,gen_random_uuid() id
        FROM generate_series(1,1001) value(ordinal)
      ), chained AS (
        SELECT generated.*,lag(generated.id) OVER(ORDER BY generated.ordinal) prior_id
        FROM generated
      )
      INSERT INTO canonical_forecast_commercial_booking_reviews(
        id,organization_id,appointment_id,opportunity_id,approval_id,acceptance_id,
        estimate_id,issued_version_id,approved_decision_id,approved_decision_digest,
        reviewed_price_before_tax,currency,action,previous_review_id,reason,
        actor_user_id,auth_session_id,request_key_hash,request_digest,review_order)
      SELECT chained.id,seed.organization_id,seed.appointment_id,seed.opportunity_id,
        seed.approval_id,seed.acceptance_id,seed.estimate_id,seed.issued_version_id,
        seed.approved_decision_id,seed.approved_decision_digest,
        seed.reviewed_price_before_tax,seed.currency,'booking_corrected',
        COALESCE(chained.prior_id,$1::uuid),
        'Bounded synthetic correction history for Part 6B outcome refusal.',
        seed.actor_user_id,seed.auth_session_id,
        encode(sha256(convert_to('bounded-key-'||chained.ordinal::text,'UTF8')),'hex'),
        encode(sha256(convert_to('bounded-request-'||chained.ordinal::text,'UTF8')),'hex'),
        nextval('canonical_forecast_commercial_review_sequence')
      FROM chained CROSS JOIN seed ORDER BY chained.ordinal`, [latestReviewId]);
      const boundedOutcome = (await f.ownerPool.query(`SELECT
        canonical_forecast_pipeline_scenario_outcome($1,origin) value
        FROM canonical_forecast_pipeline_scenario_origins origin WHERE id=$2`,
      [f.org, originId])).rows[0].value;
      expect(boundedOutcome).toEqual({ state: 'unavailable',
        reason: 'complete_outcome_unavailable' });

      const sourceInstant = new Date(new Date(storedOrigin.captured_at).getTime() - 1000)
        .toISOString();
      const clockOwner = await f.ownerPool.connect();
      try {
        await clockOwner.query('BEGIN');
        await clockOwner.query("SET LOCAL northstar.m26_part4c_disposable_clock='enabled'");
        await clockOwner.query(
          'SELECT canonical_forecast_demand_schedule_source_test_clock_v1_set($1)',
          [sourceInstant]);
        await clockOwner.query('COMMIT');
      } catch (error) {
        await clockOwner.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { clockOwner.release(); }
      try {
        await ingestScenarioEstimate(f, 'late pre-cutoff lineage');
      } finally {
        const clearOwner = await f.ownerPool.connect();
        try {
          await clearOwner.query('BEGIN');
          await clearOwner.query("SET LOCAL northstar.m26_part4c_disposable_clock='enabled'");
          await clearOwner.query(
            'SELECT canonical_forecast_demand_schedule_source_test_clock_v1_set(NULL)');
          await clearOwner.query('COMMIT');
        } catch (error) {
          await clearOwner.query('ROLLBACK').catch(() => {});
          throw error;
        } finally { clearOwner.release(); }
      }
      const staleAfterLateLineage = await request(f.app).get(`${root}/origins/${originId}`)
        .set(actor.session.headers);
      expect(staleAfterLateLineage.status).toBe(200);
      expect(staleAfterLateLineage.body.data).toEqual({
        state: 'pipeline_scenario_origin_stale', id: originId, refreshRequired: true,
        valuesWithheld: true, researchOnly: true, forecastIssued: false,
        paidNumericServing: false,
      });

      await expect(f.ownerPool.query(`SELECT
        canonical_forecast_pipeline_scenario_total_weighted_micro(
          (SELECT jsonb_agg(jsonb_build_object('category','preliminary_estimate',
            'priceBeforeTax','1.00')) FROM generate_series(1,257)),1,1)`))
        .rejects.toMatchObject({ code: '54000' });
    }, 240000);
});
