'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { putBusinessProfile } = require('../../src/services/organizationAuthority');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();
const hex = value => crypto.createHash('sha256').update(value).digest('hex');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

realPostgres('Mission 26 original Part 7D mounted overhead and financed-asset cash forecast', () => {
  let fixture;
  let cutoff;
  let assetId;
  let estimateId;
  let current;
  let referenceBasis;

  function day(offset) {
    return new Date(cutoff.getTime() + offset * 86400000).toISOString().slice(0, 10);
  }

  function decisions(references = referenceBasis.references) {
    return references.map(reference => {
      if (reference.kind === 'equipment_pool' && reference.method === 'economic_recovery') {
        return { referenceKey: reference.referenceKey, treatment: 'economic_recovery_not_cash',
          scheduleKey: null, reason: 'Economic recovery remains a job-cost allocation, not a dated cash obligation.' };
      }
      return { referenceKey: reference.referenceKey, treatment: 'separate_cash_commitment',
        scheduleKey: reference.kind === 'equipment_pool' ? 'truck-finance-current' : 'office-rent-current',
        reason: 'Bind the exact Mission 24 reference while keeping this dated cash schedule separate.' };
    });
  }

  function nonCashDecisions(references = referenceBasis.references) {
    return references.map(reference => ({ referenceKey: reference.referenceKey,
      treatment: reference.kind === 'equipment_pool' && reference.method === 'economic_recovery' ?
        'economic_recovery_not_cash' : reference.kind === 'overhead_allocation' ?
          'job_overhead_allocation_not_cash' : 'not_same_obligation',
      scheduleKey: null, reason: 'This exact Mission 24 reference is not the same dated cash obligation.' }));
  }

  function body(overrides = {}) {
    return Object.assign({
      expectedRevision: current ? current.revision : 0,
      expectedDigest: current ? current.digest : 'none', action: 'replace', currency: 'USD',
      effectiveOn: day(0), coverage: { startsOn: day(0), endsOn: day(29),
        recordedThrough: cutoff.toISOString(), complete: true },
      schedules: [{ scheduleKey: 'office-rent-current', kind: 'overhead_expense', assetId: null,
        amount: '1200.00', currency: 'USD',
        dueDates: [{ dueOn: day(2), paymentStatus: 'scheduled' },
          { dueOn: day(12), paymentStatus: 'scheduled' },
          { dueOn: day(18), paymentStatus: 'canceled' }],
        recurrenceEnd: day(29), includedCategories: ['rent'],
        sourceAttestation: { kind: 'owner_attested', reference: 'Owner-confirmed current office lease',
          documentDigest: null, attestedAt: cutoff.toISOString() } },
      { scheduleKey: 'truck-finance-current', kind: 'financed_asset_obligation', assetId,
        amount: '500.00', currency: 'USD',
        dueDates: [{ dueOn: day(4), paymentStatus: 'scheduled' },
          { dueOn: day(14), paymentStatus: 'owner_marked_satisfied' },
          { dueOn: day(24), paymentStatus: 'canceled' }],
        recurrenceEnd: day(29), includedCategories: ['debt_service', 'principal', 'interest'],
        sourceAttestation: { kind: 'source_document', reference: 'Authenticated fixture lender schedule',
          documentDigest: 'a'.repeat(64), attestedAt: cutoff.toISOString() } }],
      allocationPolicy: { expectedMission24Digest: referenceBasis.digest,
        decisions: decisions(), reason: 'Reconcile every current saved Mission 24 equipment and overhead reference.' },
      reason: 'Replace the complete current fixture obligation schedule.', confirmed: true,
      confirmationVersion: 'operating-cost-schedule-snapshot-v1',
    }, overrides);
  }

  async function put(actor, payload, key = uuid(), csrf = null) {
    const call = request(fixture.app).put('/api/v1/business-profile/operating-cost-schedules/current')
      .set(actor.session.headers).set('Idempotency-Key', key);
    if (csrf !== null) call.set('X-CSRF-Token', csrf);
    return call.send(payload);
  }
  const get = actor => request(fixture.app).get('/api/v1/forecast/overhead-cash/current')
    .set(actor.session.headers);
  const getAsOf = (actor, value) => request(fixture.app)
    .get('/api/v1/forecast/overhead-cash/as-of?cutoff=' + encodeURIComponent(value.toISOString()))
    .set(actor.session.headers);
  const getSource = actor => request(fixture.app)
    .get('/api/v1/business-profile/operating-cost-schedules/current').set(actor.session.headers);
  const getLatestSource = actor => request(fixture.app)
    .get('/api/v1/business-profile/operating-cost-schedules/latest-recorded').set(actor.session.headers);
  const getSourceAsOf = (actor, value) => request(fixture.app)
    .get('/api/v1/business-profile/operating-cost-schedules/as-of?cutoff=' + encodeURIComponent(value.toISOString()))
    .set(actor.session.headers);
  const getReferences = actor => request(fixture.app)
    .get('/api/v1/business-profile/operating-cost-schedules/references').set(actor.session.headers);

  async function insertPricingPlan(revision, overlapResolved) {
    const pricingPlan = uuid();
    await fixture.ownerPool.query(
      `INSERT INTO canonical_pricing_plans(id,organization_id,estimate_id,revision,action,
       actor_user_id,membership_id,auth_session_id,actor_name,source_pins,evidence,inputs,result,evidence_digest,
       expected_decision_revision,expected_decision_digest,currency,reason,confirmation_version,
       request_key_hash,request_digest,digest)
       VALUES($1,$2,$3,$4,'save',$5,$5,$6,'Fixture owner','{}','{}',$7,$8,$9,0,'none','USD',
       'Fixture exact overhead allocation','estimate-pricing-plan-v1',$10,$11,$12)`,
      [pricingPlan, fixture.org, estimateId, revision, fixture.actors.owner.actorUserId,
        fixture.actors.owner.authSessionId,
        { overhead: { method: 'fixed', coverage: { included: [{ referenceId: 'rent', amount: '100.00' }] } } },
        { overhead: { overlapResolved } }, hex('pricing-evidence-' + revision), hex('pricing-key-' + revision),
        hex('pricing-request-' + revision), hex('pricing-plan-' + revision)]);
  }

  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true, timeZone: 'America/New_York' });
    await fixture.ownerPool.query("SET northstar.m26_part5a_disposable_clock='enabled'");
    cutoff = new Date('2026-03-07T17:30:00.000Z');
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [cutoff]);
    assetId = uuid();
    await fixture.ownerPool.query(
      `INSERT INTO tenant_assets(id,organization_id,category,name,internal_reference,created_by_user_id,updated_by_user_id)
       VALUES($1,$2,'vehicle','Synthetic financed truck','PART7D-TRUCK',$3,$3)`,
      [assetId, fixture.org, fixture.actors.owner.actorUserId]);

    const operation = uuid(), graph = uuid(), customer = uuid(), opportunity = uuid();
    await fixture.ownerPool.query(
      `INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,payload_fingerprint,
       state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
       VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
      [operation, fixture.org, graph, hex('part7d-operation')]);
    await fixture.ownerPool.query(
      "INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES($1,$2,$3,$4,'Part 7D fixture customer')",
      [customer, fixture.org, operation, graph]);
    await fixture.ownerPool.query(
      "INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,customer_id,status,service_type,job_scope) VALUES($1,$2,$3,$4,$5,'qualified','Plumbing','{}')",
      [opportunity, fixture.org, operation, graph, customer]);
    estimateId = uuid();
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,opportunity_id,
       calculation_version,normalized_input_fingerprint,business_profile_version,business_profile_hash,
       currency,line_items,calculation_output,snapshot_digest,business_profile_id)
       VALUES($1,$2,$3,$4,$5,'part7d-fixture',$6,'org-profile-v1',$7,'USD','[]','{}',$8,$9)`,
      [estimateId, fixture.org, operation, graph, opportunity,
        hex('estimate-input'), fixture.profiles[fixture.org].hash, hex('estimate-snapshot'),
        fixture.profiles[fixture.org].businessProfileId]);
    const equipmentPlan = uuid();
    await fixture.ownerPool.query(
      `INSERT INTO canonical_equipment_cost_plans(id,organization_id,estimate_id,revision,action,
       actor_user_id,membership_id,auth_session_id,actor_name,source_pins,inputs,evidence,
       expected_decision_revision,expected_decision_digest,currency,reason,confirmation_version,
       request_key_hash,request_digest,digest)
       VALUES($1,$2,$3,1,'save',$4,$4,$5,'Fixture owner','{}',$6,'{}',0,'none','USD',
       'Fixture exact equipment allocation','estimate-equipment-cost-plan-v1',$7,$8,$9)`,
      [equipmentPlan, fixture.org, estimateId, fixture.actors.owner.actorUserId,
        fixture.actors.owner.authSessionId, { lines: [
          { lineId: uuid(), method: 'economic_recovery', allocation: { includedCategories: ['capital_recovery'] } },
          { lineId: uuid(), method: 'financing_cash', allocation: { includedCategories: ['debt_service'] } }] },
        hex('equipment-key'), hex('equipment-request'), hex('equipment-plan')]);
    await insertPricingPlan(1, true);
    const references = await getReferences(fixture.actors.owner);
    expect(references.status).toBe(200);
    referenceBasis = references.body.data;
    expect(referenceBasis.references).toHaveLength(3);
  }, 180000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('binds exact Mission 24 references and preserves correction, payoff, cancellation, and revoke history', async () => {
    expect((await get(fixture.actors.owner)).body.data).toMatchObject({ state: 'unavailable',
      reason: 'owner_recorded_schedule_coverage_unavailable', forecastIssued: false });
    await insertPricingPlan(2, false);
    referenceBasis = (await getReferences(fixture.actors.owner)).body.data;
    expect(referenceBasis.references.find(value => value.kind === 'overhead_allocation').overlapResolved).toBe(false);
    expect((await put(fixture.actors.owner, body())).status).toBe(400);
    await insertPricingPlan(3, true);
    referenceBasis = (await getReferences(fixture.actors.owner)).body.data;
    expect(referenceBasis.references.every(value => value.overlapResolved)).toBe(true);
    expect((await put(fixture.actors.owner, body({ allocationPolicy: {
      expectedMission24Digest: 'f'.repeat(64), decisions: decisions(), reason: 'Wrong manifest must fail.' } }))).status).toBe(409);
    expect((await put(fixture.actors.owner, body({ allocationPolicy: {
      expectedMission24Digest: referenceBasis.digest, decisions: [], reason: 'Incomplete policy must fail.' } }))).status).toBe(400);

    const zeroSchedules = body().schedules;
    zeroSchedules[0].amount = '0.00';
    const zeroBody = body({ schedules: zeroSchedules,
      reason: 'A nonempty scheduled due cannot be recorded with a zero amount.' });
    expect((await put(fixture.actors.owner, zeroBody)).status).toBe(400);
    expect((await fixture.ownerPool.query(
      'SELECT canonical_operating_cost_snapshot_valid($1::jsonb) valid', [zeroBody])).rows[0].valid).toBe(false);
    const capacityDates = Array.from({ length: 30 }, (_value, index) => ({
      dueOn: day(index), paymentStatus: 'scheduled',
    }));
    const capacitySchedules = Array.from({ length: 34 }, (_value, index) => ({
      scheduleKey: `capacity-${String(index).padStart(2, '0')}`, kind: 'overhead_expense',
      assetId: null, amount: '999999999999.99', currency: 'USD', dueDates: capacityDates,
      recurrenceEnd: day(29), includedCategories: ['rent'], sourceAttestation: {
        kind: 'owner_attested', reference: `Owner-attested capacity source ${index}`,
        documentDigest: null, attestedAt: cutoff.toISOString(),
      },
    }));
    const capacityBody = body({ schedules: capacitySchedules,
      allocationPolicy: { expectedMission24Digest: referenceBasis.digest,
        decisions: nonCashDecisions(), reason: 'No Mission 24 reference is the same obligation.' },
      reason: 'The 34 by 30 maximum source must fail checked aggregate capacity.' });
    expect((await put(fixture.actors.owner, capacityBody)).status).toBe(400);
    expect((await fixture.ownerPool.query(
      'SELECT canonical_operating_cost_snapshot_valid($1::jsonb) valid', [capacityBody])).rows[0].valid).toBe(false);
    expect((await getSource(fixture.actors.owner)).body.data).toMatchObject({ state: 'absent', revision: 0 });

    const key = uuid();
    const created = await put(fixture.actors.owner, body(), key);
    expect(created.status).toBe(201); current = created.body.data;
    const originalDigest = current.digest;
    const replay = await put(fixture.actors.owner, body({ expectedRevision: 0, expectedDigest: 'none' }), key);
    expect(replay.status).toBe(200); expect(replay.headers['idempotency-replayed']).toBe('true');
    const changedReplay = await put(fixture.actors.owner,
      body({ expectedRevision: 0, expectedDigest: 'none', reason: 'Changed body under the same request key.' }), key);
    expect(changedReplay.status).toBe(409);

    const issued = await get(fixture.actors.admin);
    expect(issued.status).toBe(200);
    expect(issued.body.data).toMatchObject({ state: 'current', currency: 'USD',
      basis: { mode: 'current', sourceRevision: 1, sourceDigest: originalDigest },
      horizon: { kind: 'local_calendar_days', timeZone: 'America/New_York',
        startsOn: '2026-03-07', endsOnExclusive: '2026-04-06', days: 30 },
      scope: { sourceCoverageVerified: true, wholeBusinessCoverageVerified: false,
        offPlatformCoverageVerified: false },
      overhead: { amount: '2400.00', dueCount: 2 },
      financedAssetCash: { amount: '500.00', dueCount: 1,
        ownerMarkedSatisfiedCount: 1, canceledCount: 1 },
      evidence: { currentRevision: true, overlapReconciled: true,
        actualPaymentVerified: false }, forecastIssued: true });
    expect(JSON.stringify(issued.body.data)).not.toContain(assetId);
    expect(JSON.stringify(issued.body.data)).not.toContain(referenceBasis.references[0].planId);

    const futureSchedules = [{ ...body().schedules[0], amount: '1200.00',
      dueDates: [{ dueOn: '2026-03-09', paymentStatus: 'scheduled' },
        { dueOn: '2026-04-06', paymentStatus: 'scheduled' }], recurrenceEnd: '2026-05-05' },
    { ...body().schedules[1], dueDates: [{ dueOn: '2026-04-06', paymentStatus: 'scheduled' }],
      recurrenceEnd: '2026-05-05' }];
    const future = await put(fixture.actors.owner, body({ effectiveOn: '2026-04-05',
      coverage: { startsOn: '2026-03-07', endsOn: '2026-05-05',
        recordedThrough: cutoff.toISOString(), complete: true }, schedules: futureSchedules,
      reason: 'Record an exact future-effective source without making it current early.' }));
    expect(future.status).toBe(201); current = future.body.data;
    expect((await get(fixture.actors.owner)).body.data).toMatchObject({ state: 'current',
      basis: { sourceRevision: 1 }, overhead: { amount: '2400.00' } });
    expect((await getSource(fixture.actors.owner)).body.data).toMatchObject({ state: 'current', revision: 1 });
    expect((await getAsOf(fixture.actors.owner, cutoff)).body.data)
      .toMatchObject({ state: 'current', basis: { sourceRevision: 1 } });

    const pendingOwner = await getLatestSource(fixture.actors.owner);
    expect(pendingOwner.status).toBe(200);
    expect(pendingOwner.body.data).toMatchObject({ state: 'pending', revision: 2,
      digest: current.digest, action: 'replace', snapshot: { effectiveOn: '2026-04-05' } });
    expect((await getLatestSource(fixture.actors.admin)).body.data)
      .toMatchObject({ state: 'pending', revision: 2, digest: current.digest });
    expect((await getLatestSource(fixture.actors.member)).status).toBe(403);
    const otherLatest = await getLatestSource(fixture.actors.otherOwner);
    expect(otherLatest.status).toBe(200);
    expect(otherLatest.body.data).toMatchObject({ state: 'absent', revision: 0, digest: 'none' });
    expect(JSON.stringify(otherLatest.body.data)).not.toContain(current.digest);

    const stalePredecessor = body({ expectedRevision: 1, expectedDigest: originalDigest,
      effectiveOn: '2026-04-05', coverage: { startsOn: '2026-03-07', endsOn: '2026-05-05',
        recordedThrough: cutoff.toISOString(), complete: true }, schedules: futureSchedules,
      reason: 'A stale active revision cannot replace the latest recorded pending authority.' });
    expect((await put(fixture.actors.owner, stalePredecessor)).status).toBe(409);

    const pendingCorrectionAt = new Date(cutoff.getTime() + 600000);
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [pendingCorrectionAt]);
    current = { revision: pendingOwner.body.data.revision, digest: pendingOwner.body.data.digest };
    const correctedFutureSchedules = structuredClone(futureSchedules);
    correctedFutureSchedules[0].amount = '1300.00';
    const correctedPending = await put(fixture.actors.owner, body({ effectiveOn: '2026-04-05',
      coverage: { startsOn: '2026-03-07', endsOn: '2026-05-05',
        recordedThrough: cutoff.toISOString(), complete: true }, schedules: correctedFutureSchedules,
      reason: 'Correct the latest recorded future-effective authority after a private reload.' }));
    expect(correctedPending.status).toBe(201); current = correctedPending.body.data;
    const latestCorrection = await getLatestSource(fixture.actors.owner);
    expect(latestCorrection.body.data).toMatchObject({ state: 'pending', revision: 3,
      digest: current.digest, snapshot: { effectiveOn: '2026-04-05' } });

    const pendingRevokeAt = new Date(cutoff.getTime() + 1200000);
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [pendingRevokeAt]);
    current = { revision: latestCorrection.body.data.revision, digest: latestCorrection.body.data.digest };
    const pendingRevoked = await put(fixture.actors.owner, body({ action: 'revoke', currency: null,
      effectiveOn: null, coverage: null, schedules: [], allocationPolicy: null,
      reason: 'Revoke the corrected latest recorded pending authority after reload.' }));
    expect(pendingRevoked.status).toBe(201); current = pendingRevoked.body.data;
    expect((await getLatestSource(fixture.actors.owner)).body.data)
      .toMatchObject({ state: 'revoked', revision: 4, digest: current.digest });
    expect((await get(fixture.actors.owner)).body.data).toMatchObject({ state: 'unavailable',
      reason: 'owner_recorded_schedule_coverage_unavailable', basis: { sourceRevision: 4 } });

    const futureRestoreAt = new Date(cutoff.getTime() + 1800000);
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [futureRestoreAt]);
    const futureRestore = await put(fixture.actors.owner, body({ effectiveOn: '2026-04-05',
      coverage: { startsOn: '2026-03-07', endsOn: '2026-05-05',
        recordedThrough: cutoff.toISOString(), complete: true }, schedules: futureSchedules,
      reason: 'Record a replacement that remains pending after the explicit revocation.' }));
    expect(futureRestore.status).toBe(201); current = futureRestore.body.data;
    expect((await getLatestSource(fixture.actors.owner)).body.data)
      .toMatchObject({ state: 'pending', revision: 5, digest: current.digest });

    const beforeEffective = new Date('2026-04-04T16:00:00.000Z');
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [beforeEffective]);
    expect((await getSource(fixture.actors.owner)).body.data).toMatchObject({ state: 'revoked', revision: 4 });
    expect((await get(fixture.actors.owner)).body.data).toMatchObject({ state: 'unavailable',
      basis: { sourceRevision: 4 }, reason: 'owner_recorded_schedule_coverage_unavailable' });
    const onEffective = new Date('2026-04-05T16:00:00.000Z');
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [onEffective]);
    expect((await getSource(fixture.actors.owner)).body.data).toMatchObject({ revision: 5 });
    expect((await get(fixture.actors.owner)).body.data).toMatchObject({ state: 'current',
      basis: { sourceRevision: 5 }, horizon: { startsOn: '2026-04-05' },
      overhead: { amount: '1200.00', dueCount: 1 }, financedAssetCash: { amount: '500.00', dueCount: 1 } });
    const afterEffective = new Date('2026-04-06T16:00:00.000Z');
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [afterEffective]);
    expect((await getAsOf(fixture.actors.owner, afterEffective)).body.data)
      .toMatchObject({ state: 'current', basis: { sourceRevision: 5 }, horizon: { startsOn: '2026-04-06' } });

    const correctedAt = new Date(cutoff.getTime() + 3600000);
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [correctedAt]);
    const correctedSchedules = body().schedules;
    correctedSchedules[0].dueDates[0].paymentStatus = 'canceled';
    correctedSchedules[1].dueDates[0].paymentStatus = 'owner_marked_satisfied';
    const correction = await put(fixture.actors.owner, body({ schedules: correctedSchedules,
      coverage: { ...body().coverage, recordedThrough: correctedAt.toISOString() },
      reason: 'Record an exact cancellation and owner-marked payoff correction.' }));
    expect(correction.status).toBe(201); current = correction.body.data;

    const original = await getAsOf(fixture.actors.owner, cutoff);
    const corrected = await getAsOf(fixture.actors.owner, correctedAt);
    expect(original.body.data).toMatchObject({ state: 'current', basis: { mode: 'as_of', sourceRevision: 1 },
      overhead: { amount: '2400.00' }, financedAssetCash: { amount: '500.00' },
      evidence: { currentRevision: false, completeAsOf: true } });
    expect(corrected.body.data).toMatchObject({ state: 'unavailable',
      reason: 'nonempty_zero_schedule_unavailable', basis: { mode: 'as_of', sourceRevision: 6 },
      forecastIssued: false });
    expect((await getSourceAsOf(fixture.actors.owner, cutoff)).body.data).toMatchObject({ revision: 1, digest: originalDigest });
    expect((await getSourceAsOf(fixture.actors.owner, correctedAt)).body.data).toMatchObject({ revision: 6 });
    expect((await getSourceAsOf(fixture.actors.member, cutoff)).status).toBe(403);

    const revokedAt = new Date(cutoff.getTime() + 7200000);
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [revokedAt]);
    const revoked = await put(fixture.actors.owner, body({ action: 'revoke', currency: null,
      effectiveOn: null, coverage: null, schedules: [], allocationPolicy: null,
      reason: 'Revoke the owner-recorded source after the historical correction.' }));
    expect(revoked.status).toBe(201); current = revoked.body.data;
    expect((await get(fixture.actors.owner)).body.data).toMatchObject({ state: 'unavailable',
      reason: 'owner_recorded_schedule_coverage_unavailable' });
    expect((await getAsOf(fixture.actors.owner, correctedAt)).body.data)
      .toMatchObject({ state: 'unavailable', reason: 'nonempty_zero_schedule_unavailable',
        basis: { sourceRevision: 6 } });
  });

  test('enforces CSRF, role, tenant, record, and complete-empty boundaries', async () => {
    const restoredAt = new Date(cutoff.getTime() + 10800000);
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [restoredAt]);
    const restoredBody = body({ coverage: { ...body().coverage, recordedThrough: restoredAt.toISOString() } });
    expect((await put(fixture.actors.owner, restoredBody, uuid(), 'invalid-csrf-token')).status).toBe(403);
    expect((await put(fixture.actors.member, restoredBody)).status).toBe(403);
    const otherReferences = (await getReferences(fixture.actors.otherOwner)).body.data;
    const crossTenant = body({ expectedRevision: 0, expectedDigest: 'none', allocationPolicy: {
      expectedMission24Digest: otherReferences.digest, decisions: [], reason: 'Cross-tenant asset must fail.' } });
    expect((await put(fixture.actors.otherOwner, crossTenant)).status).toBe(400);

    const restored = await put(fixture.actors.owner, restoredBody);
    expect(restored.status).toBe(201); current = restored.body.data;
    const emptyAt = new Date(cutoff.getTime() + 14400000);
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [emptyAt]);
    const empty = await put(fixture.actors.owner, body({ schedules: [],
      coverage: { ...body().coverage, recordedThrough: emptyAt.toISOString() },
      allocationPolicy: { expectedMission24Digest: referenceBasis.digest,
        decisions: decisions().map(value => ({ ...value,
          treatment: value.treatment !== 'separate_cash_commitment' ? value.treatment :
            (value.referenceKey.startsWith('overhead:') ? 'job_overhead_allocation_not_cash' : 'not_same_obligation'),
          scheduleKey: null })), reason: 'All Mission 24 cash references are different obligations.' },
      reason: 'Owner attests that the exact covered schedule source is empty.' }));
    expect(empty.status).toBe(201); current = empty.body.data;
    expect((await get(fixture.actors.owner)).body.data).toMatchObject({ state: 'current',
      scope: { sourceCoverageVerified: true, wholeBusinessCoverageVerified: false },
      overhead: { amount: '0.00' }, financedAssetCash: { amount: '0.00' } });
  });

  test('holds shared source locks through return so asset and profile mutations cannot race current claims', async () => {
    const sourceAt = new Date(cutoff.getTime() + 18000000);
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [sourceAt]);
    const refreshed = await put(fixture.actors.owner, body({
      coverage: { ...body().coverage, recordedThrough: sourceAt.toISOString() } }));
    expect(refreshed.status).toBe(201); current = refreshed.body.data;

    const reader = await fixture.runtimePool.connect();
    const writer = await fixture.ownerPool.connect();
    await reader.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const args = [fixture.org, fixture.actors.owner.actorUserId, 'owner', fixture.actors.owner.authSessionId];
    const pinned = (await reader.query(
      'SELECT canonical_forecast_overhead_cash_v1_current($1,$2,$3,$4) value', args)).rows[0].value;
    expect(pinned).toMatchObject({ state: 'current', evidence: { currentRevision: true } });
    const assetMutation = (async () => {
      await writer.query('BEGIN');
      await writer.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [fixture.org]);
      await writer.query('UPDATE tenant_assets SET version=version+1,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2', [fixture.org, assetId]);
      await writer.query('COMMIT');
    })();
    expect(await Promise.race([assetMutation.then(() => 'completed'), delay(100).then(() => 'blocked')])).toBe('blocked');
    await reader.query('COMMIT'); await assetMutation; reader.release(); writer.release();
    expect((await get(fixture.actors.owner)).body.data).toMatchObject({ state: 'unavailable',
      reason: 'schedule_source_currentness_unavailable', evidence: { currentRevision: false } });

    const assetRefreshAt = new Date(cutoff.getTime() + 21600000);
    await fixture.ownerPool.query('SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [assetRefreshAt]);
    const assetRefresh = await put(fixture.actors.owner, body({
      coverage: { ...body().coverage, recordedThrough: assetRefreshAt.toISOString() } }));
    expect(assetRefresh.status).toBe(201); current = assetRefresh.body.data;
    const profileReader = await fixture.runtimePool.connect();
    await profileReader.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    expect((await profileReader.query(
      'SELECT canonical_forecast_overhead_cash_v1_current($1,$2,$3,$4) value', args)).rows[0].value.state).toBe('current');
    const active = (await fixture.ownerPool.query(
      'SELECT raw_profile,version_label FROM canonical_business_profiles WHERE organization_id=$1 AND is_active', [fixture.org])).rows[0];
    const profileMutation = putBusinessProfile(fixture.ownerPool, { organizationId: fixture.org,
      userId: fixture.actors.owner.actorUserId, expectedVersion: active.version_label,
      profile: { ...active.raw_profile, businessDescription: 'Changed while current forecast read held its pin.' } });
    expect(await Promise.race([profileMutation.then(() => 'completed'), delay(100).then(() => 'blocked')])).toBe('blocked');
    await profileReader.query('COMMIT'); await profileMutation; profileReader.release();
    expect((await get(fixture.actors.owner)).body.data).toMatchObject({ state: 'unavailable',
      reason: 'schedule_source_currentness_unavailable' });
  });

  test('keeps history immutable and exposes only guarded runtime entries', async () => {
    await expect(fixture.ownerPool.query(
      "UPDATE canonical_operating_cost_schedule_revisions SET reason='changed' WHERE organization_id=$1",
      [fixture.org])).rejects.toMatchObject({ code: '23514' });
    const signatures = [
      'public.canonical_operating_cost_snapshot_mutate(uuid,uuid,text,uuid,text,text,jsonb)',
      'public.canonical_operating_cost_reference_basis_read(uuid,uuid,text,uuid)',
      'public.canonical_operating_cost_snapshot_read(uuid,uuid,text,uuid)',
      'public.canonical_operating_cost_snapshot_read_latest_recorded(uuid,uuid,text,uuid)',
      'public.canonical_operating_cost_snapshot_read_as_of(uuid,uuid,text,uuid,timestamptz)',
      'public.canonical_forecast_overhead_cash_v1_current(uuid,uuid,text,uuid)',
      'public.canonical_forecast_overhead_cash_v1_as_of(uuid,uuid,text,uuid,timestamptz)'];
    for (const signature of signatures) {
      const row = (await fixture.ownerPool.query(
        'SELECT has_function_privilege($1,$2,\'EXECUTE\') runtime,has_function_privilege(\'public\',$2,\'EXECUTE\') public',
        [fixture.roles.runtime, signature])).rows[0];
      expect(row).toEqual({ runtime: true, public: false });
    }
    const table = (await fixture.ownerPool.query(
      "SELECT has_table_privilege($1,'public.canonical_operating_cost_schedule_revisions','SELECT,INSERT,UPDATE,DELETE') allowed",
      [fixture.roles.runtime])).rows[0];
    expect(table.allowed).toBe(false);
  });
});
