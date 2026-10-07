'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();

realPostgres('Mission 26 original Part 7D mounted overhead and financed-asset cash forecast', () => {
  let fixture;
  let cutoff;
  let assetId;
  let current;

  function day(offset) {
    return new Date(cutoff.getTime() + offset * 86400000).toISOString().slice(0, 10);
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
      allocationPolicy: { status: 'reconciled', basis: 'owner_approved_schedule_policy',
        mission24EquipmentTreatment: 'separate_job_cost_allocation',
        mission24OverheadTreatment: 'separate_job_cost_allocation',
        economicDepreciationTreatment: 'excluded', actualPaymentTreatment: 'not_evidence',
        reason: 'Keep dated company obligations separate from job allocation and depreciation.' },
      reason: 'Replace the complete current fixture obligation schedule.', confirmed: true,
      confirmationVersion: 'operating-cost-schedule-snapshot-v1',
    }, overrides);
  }

  async function put(actor, payload, key = uuid()) {
    return request(fixture.app)
      .put('/api/v1/business-profile/operating-cost-schedules/current')
      .set(actor.session.headers).set('Idempotency-Key', key).send(payload);
  }

  async function get(actor) {
    return request(fixture.app).get('/api/v1/forecast/overhead-cash/current')
      .set(actor.session.headers);
  }

  async function getSource(actor) {
    return request(fixture.app)
      .get('/api/v1/business-profile/operating-cost-schedules/current')
      .set(actor.session.headers);
  }

  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    await fixture.ownerPool.query("SET northstar.m26_part5a_disposable_clock='enabled'");
    cutoff = new Date((await fixture.ownerPool.query(
      "SELECT date_trunc('second',clock_timestamp()) value")).rows[0].value);
    await fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [cutoff]);
    assetId = uuid();
    await fixture.ownerPool.query(
      `INSERT INTO tenant_assets(id,organization_id,category,name,internal_reference,
       created_by_user_id,updated_by_user_id)
       VALUES($1,$2,'vehicle','Synthetic financed truck','PART7D-TRUCK',$3,$3)`,
      [assetId, fixture.org, fixture.actors.owner.actorUserId]);
  }, 180000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('issues only exact aggregate scheduled commitments through a correction/revocation lifecycle', async () => {
    const missing = await get(fixture.actors.owner);
    expect(missing.status).toBe(200);
    expect(missing.body.data).toMatchObject({ state: 'unavailable', currency: null,
      reason: 'owner_recorded_schedule_coverage_unavailable', forecastIssued: false });
    expect(missing.body.data.overhead.amount).toBeNull();

    const key = uuid();
    const created = await put(fixture.actors.owner, body(), key);
    expect(created.status).toBe(201);
    current = created.body.data;
    expect(current).toMatchObject({ revision: 1, action: 'replace', replayed: false });
    const replay = await put(fixture.actors.owner, body({
      expectedRevision: 0, expectedDigest: 'none' }), key);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toMatchObject({ revision: 1, digest: current.digest,
      action: 'replace', replayed: true });
    const source = await getSource(fixture.actors.owner);
    expect(source.status).toBe(200);
    expect(source.body.data).toMatchObject({ state: 'current', revision: 1,
      digest: current.digest, action: 'replace', snapshot: {
        currency: 'USD', coverage: { complete: true }, allocationPolicy: {
          status: 'reconciled', basis: 'owner_approved_schedule_policy' } } });
    expect(source.body.data.snapshot.schedules).toHaveLength(2);

    const issued = await get(fixture.actors.admin);
    expect(issued.status).toBe(200);
    expect(issued.headers['cache-control']).toBe('private, no-store');
    expect(issued.body.data).toMatchObject({
      version: 'm26-overhead-cash-forecast-v1', state: 'current', currency: 'USD', fictional: false,
      horizon: { days: 30 },
      scope: { wholeBusinessCoverageVerified: true, offPlatformCoverageVerified: false },
      overhead: { state: 'current', amount: '2400.00', dueCount: 2,
        scheduleCount: 1, reason: null },
      financedAssetCash: { state: 'current', amount: '500.00', dueCount: 1,
        obligationCount: 1, ownerMarkedSatisfiedCount: 1, canceledCount: 1, reason: null },
      evidence: { actualPaymentVerified: false, learnedAdjustmentApplied: false,
        overlapReconciled: true, completeAsOf: true },
      allocation: { state: 'reconciled', jobCostAllocationIncluded: false,
        economicDepreciationIncluded: false, actualPaymentClaimed: false },
      forecastIssued: true, completeOperatingCostForecastIssued: false,
      calibratedRangeIssued: false, probabilityIssued: false, automaticActionAuthorized: false,
    });
    const serialized = JSON.stringify(issued.body.data);
    expect(serialized).not.toContain(assetId);
    expect(serialized).not.toContain('office-rent-current');
    expect(serialized).not.toContain('Authenticated fixture lender schedule');

    const stale = await put(fixture.actors.owner, body({ expectedRevision: 0,
      expectedDigest: 'none', reason: 'A stale writer must not replace the source.' }));
    expect(stale.status).toBe(409);
    expect((await get(fixture.actors.member)).status).toBe(403);
    expect((await getSource(fixture.actors.member)).status).toBe(403);
    const otherTenant = await get(fixture.actors.otherOwner);
    expect(otherTenant.status).toBe(200);
    expect(otherTenant.body.data).toMatchObject({ state: 'unavailable', currency: null,
      forecastIssued: false });
    expect((await getSource(fixture.actors.otherOwner)).body.data)
      .toEqual({ state: 'absent', revision: 0, digest: 'none', action: null, snapshot: null });

    await fixture.ownerPool.query(
      `UPDATE tenant_assets SET catalogue_state='archived',archived_by_user_id=$3,
       archived_at=clock_timestamp(),version=version+1 WHERE organization_id=$1 AND id=$2`,
      [fixture.org, assetId, fixture.actors.owner.actorUserId]);
    expect((await get(fixture.actors.owner)).body.data).toMatchObject({ state: 'unavailable',
      reason: 'schedule_source_currentness_unavailable', forecastIssued: false });
    await fixture.ownerPool.query(
      `UPDATE tenant_assets SET catalogue_state='active',archived_by_user_id=NULL,
       archived_at=NULL,version=version+1 WHERE organization_id=$1 AND id=$2`,
      [fixture.org, assetId]);

    const staleCoverage = await put(fixture.actors.owner, body({ schedules: [],
      coverage: { startsOn: day(0), endsOn: day(5),
        recordedThrough: cutoff.toISOString(), complete: true },
      reason: 'Record a bounded source that does not cover the forecast horizon.' }));
    expect(staleCoverage.status).toBe(201); current = staleCoverage.body.data;
    expect((await get(fixture.actors.owner)).body.data).toMatchObject({ state: 'unavailable',
      reason: 'owner_recorded_schedule_coverage_stale', forecastIssued: false });

    const currencyConflict = await put(fixture.actors.owner, body({ currency: 'CAD', schedules: [],
      reason: 'Record an exact source currency that conflicts with the Business Profile.' }));
    expect(currencyConflict.status).toBe(201); current = currencyConflict.body.data;
    expect((await get(fixture.actors.owner)).body.data).toMatchObject({ state: 'unavailable',
      reason: 'schedule_currency_conflict', forecastIssued: false });

    const empty = await put(fixture.actors.owner, body({ schedules: [],
      reason: 'Owner confirms a complete current empty schedule set.' }));
    expect(empty.status).toBe(201); current = empty.body.data;
    const zero = await get(fixture.actors.owner);
    expect(zero.body.data).toMatchObject({ state: 'current',
      overhead: { amount: '0.00', dueCount: 0, scheduleCount: 0 },
      financedAssetCash: { amount: '0.00', dueCount: 0, obligationCount: 0 },
      forecastIssued: true });

    const revoked = await put(fixture.actors.owner, body({ action: 'revoke', currency: null,
      effectiveOn: null, coverage: null, schedules: [], allocationPolicy: null,
      reason: 'Revoke the owner-recorded obligation source.' }));
    expect(revoked.status).toBe(201); current = revoked.body.data;
    expect((await get(fixture.actors.owner)).body.data).toMatchObject({ state: 'unavailable',
      reason: 'owner_recorded_schedule_coverage_unavailable', forecastIssued: false });
    expect((await getSource(fixture.actors.owner)).body.data).toMatchObject({ state: 'revoked',
      revision: current.revision, digest: current.digest, action: 'revoke' });
  });

  test('keeps the source append-only and exposes only the two guarded runtime entries', async () => {
    await expect(fixture.ownerPool.query(
      "UPDATE canonical_operating_cost_schedule_revisions SET reason='changed' WHERE organization_id=$1",
      [fixture.org])).rejects.toMatchObject({ code: '23514' });
    const privilege = (await fixture.ownerPool.query(
      `SELECT has_table_privilege($1,'public.canonical_operating_cost_schedule_revisions','SELECT') can_select,
       has_table_privilege($1,'public.canonical_operating_cost_schedule_revisions','INSERT') can_insert,
       has_table_privilege($1,'public.canonical_operating_cost_schedule_revisions','UPDATE') can_update,
       has_table_privilege($1,'public.canonical_operating_cost_schedule_revisions','DELETE') can_delete,
       has_function_privilege($1,
        'public.canonical_operating_cost_snapshot_mutate(uuid,uuid,text,uuid,text,text,jsonb)','EXECUTE') can_mutate,
       has_function_privilege($1,
        'public.canonical_operating_cost_snapshot_read(uuid,uuid,text,uuid)','EXECUTE') can_source_read,
       has_function_privilege($1,
        'public.canonical_forecast_overhead_cash_v1_current(uuid,uuid,text,uuid)','EXECUTE') can_read`,
      [fixture.roles.runtime])).rows[0];
    expect(privilege).toEqual({ can_select: false, can_insert: false, can_update: false,
      can_delete: false, can_mutate: true, can_source_read: true, can_read: true });
  });
});
