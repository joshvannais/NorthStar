'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const vm = require('node:vm');
const { createForecastOverheadCashRouter, sanitizeForecast } =
  require('../../src/routes/forecastOverheadCash');
const { createOperatingCostSchedulesRouter, normalizeSnapshot, sanitizeSource } =
  require('../../src/routes/operatingCostSchedules');

const ORG = '10000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000002';
const SESSION = '10000000-0000-4000-8000-000000000003';
const ASSET = '10000000-0000-4000-8000-000000000004';

function snapshot(overrides = {}) {
  return Object.assign({
    expectedRevision: 0, expectedDigest: 'none', action: 'replace', currency: 'USD',
    effectiveOn: '2026-10-07', coverage: { startsOn: '2026-10-07', endsOn: '2026-11-05',
      recordedThrough: '2026-10-07T12:00:00.000Z', complete: true },
    schedules: [{ scheduleKey: 'office-rent-2026', kind: 'overhead_expense', assetId: null,
      amount: '1200.00', currency: 'USD',
      dueDates: [{ dueOn: '2026-10-15', paymentStatus: 'scheduled' }],
      recurrenceEnd: '2026-11-05', includedCategories: ['rent'],
      sourceAttestation: { kind: 'owner_attested', reference: 'Owner-confirmed current lease',
        documentDigest: null, attestedAt: '2026-10-07T12:00:00.000Z' } },
    { scheduleKey: 'truck-finance-2026', kind: 'financed_asset_obligation', assetId: ASSET,
      amount: '500.00', currency: 'USD',
      dueDates: [{ dueOn: '2026-10-20', paymentStatus: 'scheduled' },
        { dueOn: '2026-11-01', paymentStatus: 'owner_marked_satisfied' }],
      recurrenceEnd: '2026-11-05', includedCategories: ['debt_service', 'principal', 'interest'],
      sourceAttestation: { kind: 'source_document', reference: 'Authenticated lender schedule',
        documentDigest: 'a'.repeat(64), attestedAt: '2026-10-07T12:00:00.000Z' } }],
    allocationPolicy: { expectedMission24Digest: 'f'.repeat(64), decisions: [],
      reason: 'Keep company obligations separate from per-job recovery and depreciation.' },
    reason: 'Replace the complete current obligation schedule.', confirmed: true,
    confirmationVersion: 'operating-cost-schedule-snapshot-v1',
  }, overrides);
}

function storedSnapshot(value = snapshot()) {
  const { expectedRevision: _revision, expectedDigest: _digest, reason: _reason,
    confirmed: _confirmed, confirmationVersion: _version, ...stored } = value;
  return stored;
}

function forecast(overrides = {}) {
  return Object.assign({
    version: 'm26-overhead-cash-forecast-v1', state: 'current', reason: null,
    fictional: false, checkedAt: '2026-10-07T12:00:00.000Z', currency: 'USD',
    basis: { mode: 'current', cutoff: '2026-10-07T12:00:00.000Z', sourceRevision: 1,
      sourceDigest: 'e'.repeat(64), sourceRecordedAt: '2026-10-07T12:00:00.000Z' },
    horizon: { kind: 'local_calendar_days', timeZone: 'America/New_York',
      startsOn: '2026-10-07', endsOnExclusive: '2026-11-06', days: 30 },
    scope: { label: 'Next 30 local calendar dates in the complete owner-recorded schedule source',
      sourceCoverageVerified: true, wholeBusinessCoverageVerified: false,
      offPlatformCoverageVerified: false },
    overhead: { state: 'current', amount: '1200.00', dueCount: 1,
      scheduleCount: 1, reason: null },
    financedAssetCash: { state: 'current', amount: '500.00', dueCount: 1,
      obligationCount: 1, ownerMarkedSatisfiedCount: 1, canceledCount: 0, reason: null },
    evidence: { ownerRecordedSchedules: true, exactAmounts: true, exactDueDates: true,
      recurrenceEndRecorded: true, sourceAttested: true, currentRevision: true,
      completeAsOf: true, overlapReconciled: true, actualPaymentVerified: false,
      learnedAdjustmentApplied: false },
    allocation: { state: 'reconciled', basis: 'server_reconciled_m24_reference_manifest',
      jobCostAllocationIncluded: false, economicDepreciationIncluded: false,
      actualPaymentClaimed: false,
      reason: 'dated_cash_commitments_kept_separate_from_bound_m24_job_cost_and_economic_recovery' },
    forecastIssued: true, completeOperatingCostForecastIssued: false,
    calibratedRangeIssued: false, probabilityIssued: false, automaticActionAuthorized: false,
  }, overrides);
}

function unavailable(reason = 'owner_recorded_schedule_coverage_unavailable') {
  return forecast({ state: 'unavailable', reason, currency: null,
    basis: { mode: 'current', cutoff: '2026-10-07T12:00:00.000Z', sourceRevision: null,
      sourceDigest: null, sourceRecordedAt: null },
    scope: { label: 'Next 30 local calendar dates in the complete owner-recorded schedule source',
      sourceCoverageVerified: false, wholeBusinessCoverageVerified: false,
      offPlatformCoverageVerified: false },
    overhead: { state: 'unavailable', amount: null, dueCount: null,
      scheduleCount: null, reason },
    financedAssetCash: { state: 'unavailable', amount: null, dueCount: null,
      obligationCount: null, ownerMarkedSatisfiedCount: null, canceledCount: null, reason },
    evidence: { ownerRecordedSchedules: false, exactAmounts: false, exactDueDates: false,
      recurrenceEndRecorded: false, sourceAttested: false, currentRevision: false,
      completeAsOf: false, overlapReconciled: false, actualPaymentVerified: false,
      learnedAdjustmentApplied: false },
    allocation: { state: 'unavailable', basis: 'server_reconciled_m24_reference_manifest',
      jobCostAllocationIncluded: false, economicDepreciationIncluded: false,
      actualPaymentClaimed: false, reason }, forecastIssued: false });
}

function auth(req, _res, next) {
  req.tenantContext = { organizationId: ORG, userId: USER };
  req.userRole = 'owner'; req.authSession = { id: SESSION }; next();
}

describe('Mission 26 original Part 7D overhead and financed-asset cash forecast', () => {
  test('accepts only exact complete schedules and keeps cost, depreciation, cash, and payment separate', () => {
    expect(normalizeSnapshot(snapshot())).toEqual(snapshot());
    expect(() => normalizeSnapshot(snapshot({ schedules: [{ ...snapshot().schedules[0],
      includedCategories: ['rent', 'debt_service'] }] }))).toThrow(/categories/i);
    expect(() => normalizeSnapshot(snapshot({ schedules: [{ ...snapshot().schedules[1],
      assetId: null }] }))).toThrow(/schedule/i);
    expect(() => normalizeSnapshot(snapshot({ schedules: [{ ...snapshot().schedules[1],
      dueDates: [{ dueOn: '2026-10-20', paymentStatus: 'paid' }] }] }))).toThrow(/due date/i);
    expect(() => normalizeSnapshot(snapshot({ schedules: [{ ...snapshot().schedules[0],
      amount: '0.00' }] }))).toThrow(/schedule/i);
    expect(normalizeSnapshot(snapshot({ schedules: [{ ...snapshot().schedules[0],
      amount: '0.01' }, snapshot().schedules[1]] })).schedules[0].amount).toBe('0.01');
    const dates = Array.from({ length: 30 }, (_value, index) => ({
      dueOn: new Date(Date.UTC(2026, 9, 7 + index)).toISOString().slice(0, 10),
      paymentStatus: 'scheduled',
    }));
    const overCapacity = Array.from({ length: 34 }, (_value, index) => ({
      ...snapshot().schedules[0], scheduleKey: `capacity-${String(index).padStart(2, '0')}`,
      amount: '999999999999.99', dueDates: dates,
    }));
    expect(() => normalizeSnapshot(snapshot({ schedules: overCapacity }))).toThrow(/capacity/i);
    const revoke = snapshot({ expectedRevision: 2, expectedDigest: 'b'.repeat(64),
      action: 'revoke', currency: null, effectiveOn: null, coverage: null, schedules: [],
      allocationPolicy: null });
    expect(normalizeSnapshot(revoke)).toEqual(revoke);
    expect(sanitizeSource({ state: 'absent', revision: 0, digest: 'none',
      action: null, createdAt: null, snapshot: null })).not.toBeNull();
    expect(sanitizeSource({ state: 'current', revision: 1, digest: 'c'.repeat(64),
      action: 'replace', createdAt: '2026-10-07T12:00:00.000Z', snapshot: storedSnapshot() })).not.toBeNull();
    expect(sanitizeSource({ state: 'current', revision: 1, digest: 'c'.repeat(64),
      action: 'replace', createdAt: '2026-10-07T12:00:00.000Z',
      snapshot: { ...storedSnapshot(), hidden: 'extra' } })).toBeNull();
  });

  test('writes through one serializable idempotent owner-only mutation contract', async () => {
    const calls = [];
    const client = { query: jest.fn(async (sql, parameters) => {
      calls.push({ sql, parameters });
      return /canonical_operating_cost_snapshot_mutate/.test(sql) ? { rows: [{ value: {
        revision: 1, digest: 'c'.repeat(64), action: 'replace', replayed: false } }] } :
        /canonical_operating_cost_snapshot_read/.test(sql) ? { rows: [{ value: {
          state: 'current', revision: 1, digest: 'c'.repeat(64), action: 'replace',
          createdAt: '2026-10-07T12:00:00.000Z', snapshot: storedSnapshot() } }] } : { rows: [] };
    }), release: jest.fn() };
    const app = express(); app.use(express.json());
    app.use('/schedules', createOperatingCostSchedulesRouter({
      poolProvider: () => ({ connect: async () => client }), auth,
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    const response = await request(app).put('/schedules/current')
      .set('Idempotency-Key', 'part7d-unit-request-0001').set('X-CSRF-Token', 'csrf-token')
      .send(snapshot());
    expect(response.status).toBe(201);
    expect(calls[0].sql).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const mutation = calls.find(call => call.parameters);
    expect(mutation.parameters.slice(0, 6)).toEqual([
      ORG, USER, 'owner', SESSION, 'csrf-token', 'part7d-unit-request-0001']);
    expect(mutation.parameters[6]).toEqual(snapshot());
    expect(calls.at(-1).sql).toBe('COMMIT');
    const read = await request(app).get('/schedules/current');
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ state: 'current', revision: 1,
      digest: 'c'.repeat(64), action: 'replace' });
    expect(read.body.data.snapshot.schedules[1].assetId).toBe(ASSET);
    expect((await request(app).put('/schedules/current').send(snapshot())).status).toBe(400);
  });

  test('serves only strict aggregate projections and rolls back corrupt data', async () => {
    expect(sanitizeForecast(forecast())).toEqual(forecast());
    expect(sanitizeForecast(unavailable())).toEqual(unavailable());
    expect(sanitizeForecast(unavailable('nonempty_zero_schedule_unavailable'))).not.toBeNull();
    expect(sanitizeForecast(unavailable('schedule_amount_capacity_unavailable'))).not.toBeNull();
    expect(sanitizeForecast(forecast({ overhead: { ...forecast().overhead, amount: '0.00' } }))).toBeNull();
    const empty = forecast({
      overhead: { ...forecast().overhead, amount: '0.00', dueCount: 0, scheduleCount: 0 },
      financedAssetCash: { ...forecast().financedAssetCash, amount: '0.00', dueCount: 0,
        obligationCount: 0, ownerMarkedSatisfiedCount: 0, canceledCount: 0 },
    });
    expect(sanitizeForecast(empty)).toEqual(empty);
    expect(sanitizeForecast({ ...forecast(), assetId: ASSET })).toBeNull();
    expect(sanitizeForecast(forecast({ evidence: { ...forecast().evidence,
      actualPaymentVerified: true } }))).toBeNull();
    expect(sanitizeForecast(forecast({ allocation: { ...forecast().allocation,
      economicDepreciationIncluded: true } }))).toBeNull();
    expect(sanitizeForecast(unavailable('unsupported_reason'))).toBeNull();
    const calls = []; let projection = forecast();
    const client = { query: jest.fn(async (sql, parameters) => {
      calls.push({ sql, parameters });
      return /canonical_forecast_overhead_cash_v1_current/.test(sql) ?
        { rows: [{ value: projection }] } : { rows: [] };
    }), release: jest.fn() };
    const app = express(); app.use('/forecast', createForecastOverheadCashRouter({
      poolProvider: () => ({ connect: async () => client }), auth,
      permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    }));
    const current = await request(app).get('/forecast/current');
    expect(current.status).toBe(200);
    expect(current.headers['cache-control']).toBe('private, no-store');
    expect(calls.find(call => call.parameters).parameters).toEqual([ORG, USER, 'owner', SESSION]);
    projection = { ...forecast(), scheduleKey: 'private-source-key' }; calls.length = 0;
    expect((await request(app).get('/forecast/current')).status).toBe(503);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
    expect((await request(app).get('/forecast/current?tenant=other')).status).toBe(400);
  });

  test('keeps one compact fictional demo row inside the existing collapsed insight', () => {
    const context = { window: {}, console, Intl, Date, Number, Promise };
    context.window.window = context.window;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
      '../../public/js/command-center-overhead-cash-forecast.js'), 'utf8'), context);
    const api = context.window.NorthStarOverheadCashForecast;
    expect(api.validate(api.demoForecast())).not.toBeNull();
    expect(api.validate({ ...api.demoForecast(),
      overhead: { ...api.demoForecast().overhead, amount: '0.00' } })).toBeNull();
    expect(api.demoForecast()).toMatchObject({ fictional: true,
      forecastIssued: true, completeOperatingCostForecastIssued: false,
      calibratedRangeIssued: false, probabilityIssued: false });
    expect(api.validate({ ...api.demoForecast(), privateReference: 'Lease-7' })).toBeNull();
    const html = fs.readFileSync(path.resolve(__dirname, '../../public/demo-dashboard.html'), 'utf8');
    const details = html.indexOf('id="commandCenterCostRiskDetails"');
    const detailsEnd = html.indexOf('</details>', details);
    const value = html.indexOf('id="commandCenterOverheadCashForecast"');
    const status = html.indexOf('id="commandCenterOverheadCashForecastStatus"');
    const sectionEnd = html.indexOf('</section>', details);
    expect(value).toBeGreaterThan(details); expect(value).toBeLessThan(detailsEnd);
    expect(status).toBeGreaterThan(detailsEnd); expect(status).toBeLessThan(sectionEnd);
    expect(html).toMatch(/id="commandCenterOverheadCashForecastStatus"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/);
  });

  test('clears prior facts while loading and makes one atomic aggregate announcement', async () => {
    const context = { window: {}, console, Intl, Date, Number, Promise };
    context.window.window = context.window;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
      '../../public/js/command-center-overhead-cash-forecast.js'), 'utf8'), context);
    const elements = Object.fromEntries(['commandCenterOverheadCashForecast',
      'commandCenterOverheadCashForecastContext', 'commandCenterOverheadCashForecastStatus']
      .map(id => [id, { textContent: id.endsWith('Forecast') ? 'old private fact' : '' }]));
    let resolveFetch;
    const client = context.window.NorthStarOverheadCashForecast.create({
      mode: 'paid', document: { getElementById: id => elements[id] },
      fetcher: () => new Promise(resolve => { resolveFetch = resolve; }),
    });
    const pending = client.workspaceReady();
    expect(elements.commandCenterOverheadCashForecast.textContent).toMatch(/^Checking/);
    expect(elements.commandCenterOverheadCashForecastContext.textContent).toBe('');
    resolveFetch({ ok: true, json: async () => ({ success: true, data: forecast() }) });
    await pending;
    expect(elements.commandCenterOverheadCashForecast.textContent)
      .toBe('$1,200 overhead + $500 dated asset cash');
    expect(elements.commandCenterOverheadCashForecastContext.textContent)
      .toMatch(/Owner-marked satisfied dates are not proof of payment/);
    expect(elements.commandCenterOverheadCashForecastStatus.textContent)
      .toContain('$1,200 overhead + $500 dated asset cash');
  });
});
