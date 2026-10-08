'use strict';

const fs = require('node:fs');
const express = require('express');
const request = require('supertest');
const { createForecastDeterministicBaselinesRouter, sanitizeBaseline } =
  require('../../src/routes/forecastDeterministicBaselines');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const ORIGIN = '44444444-4444-4444-8444-444444444444';
const PROFILE = '55555555-5555-4555-8555-555555555555';
const DIGEST = 'a'.repeat(64);
const ISSUED = '2026-09-01T00:00:00.000000Z';
const CHECKED = '2026-09-02T00:00:00.000000Z';

function observation(month, count, index) {
  const next = new Date(`${month}T00:00:00.000Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const end = next.toISOString().replace('.000Z', '.000000Z');
  return { localMonthStart: month, state: 'complete', count,
    sourceWindowStartsAt: `${month}T00:00:00.000000Z`, sourceWindowEndsAt: end,
    sourceRecordedThrough: end,
    certificationId: `66666666-6666-4666-8666-66666666666${index}`,
    certificationRevision: 1, certificationDigest: DIGEST,
    certificationAction: 'certify', certificationRecordedAt: end,
    snapshotId: `77777777-7777-4777-8777-77777777777${index}`,
    snapshotDigest: DIGEST, coverageEvidenceDigest: DIGEST, providerScanDigest: DIGEST,
    callerConsentAttested: true, providerCoverageAttestedRetellOnly: true,
    retentionAttested: true };
}

function current(amount = '0') {
  const observations = [observation('2026-06-01', 0, 1),
    observation('2026-07-01', 0, 2), observation('2026-08-01', 0, 3)];
  return { version: 'm26-deterministic-baseline-v1', state: 'current', reason: null,
    originId: ORIGIN, checkedAt: CHECKED, issuedAt: ISSUED, evaluationAsOf: null,
    target: { key: 'demand.inbound_leads', definitionVersion: 'v1',
      sourceScope: 'retell_only_tenant_all' },
    configuration: { version: 'm26-deterministic-baseline-configuration-v1',
      targetKey: 'demand.inbound_leads', targetVersion: 'v1',
      sourceScope: 'retell_only_tenant_all',
      algorithmId: 'retell_three_complete_month_mean',
      algorithmVersion: 'm26-retell-three-month-mean-v2',
      method: 'arithmetic_mean_comparable_prior_periods', minimumPeriods: 3,
      horizonGrain: 'business_local_month', unit: 'count', decimalScale: 6,
      rounding: 'half_up', observationOrder: 'local_month_start_ascending' },
    horizon: { localStart: '2026-10-01', startsAt: '2026-10-01T00:00:00.000000Z',
      endsAt: '2026-11-01T00:00:00.000000Z', grain: 'business_local_month',
      timeZone: 'UTC' }, unit: { key: 'count', currency: null },
    sourceSnapshot: { state: 'complete_as_of', completeAsOf: true,
      sourceScope: 'retell_only_tenant_all', sourceAsOf: ISSUED,
      profile: { businessProfileId: PROFILE, businessProfileVersion: 1,
        businessProfileHash: DIGEST, timeZone: 'UTC' },
      periodInventoryDigest: DIGEST, evidenceDigest: DIGEST,
      expectedPeriods: 3, includedPeriods: 3, excludedPeriods: 0,
      missingPeriods: 0, stalePeriods: 0, hasMore: false,
      paginationVersion: 'bounded_single_page', nextCursor: null, observations,
      providerCoverageAttestedRetellOnly: true, providerIndependentVerified: false,
      wholeBusinessCoverageVerified: false },
    output: { contractVersion: 'm26-forecast-output-v1',
      target: { key: 'demand.inbound_leads', definitionVersion: 'v1' },
      unit: { key: 'count', currency: null }, value: { kind: 'point', amount },
      confidence: { state: 'unavailable', backtestDigest: null },
      uncertainty: { state: 'unquantified',
        drivers: ['retell_only','human_attested_coverage','uncalibrated'] },
      applicability: { serviceKey: null, areaKey: null,
        limits: ['retell_only','tenant_all'] },
      calculationVersion: 'm26-retell-three-month-mean-v2', researchOnly: true,
      realForecastEligible: false, paidNumericServing: false,
      forecastServingEnabled: false },
    evaluation: { state: 'unavailable', evaluatedAt: null, outcomeDigest: null,
      reason: 'finalized_outcome_not_available' },
    digests: { configuration: DIGEST, input: DIGEST, output: DIGEST,
      baseline: DIGEST, receipt: DIGEST },
    currentness: { sourceCurrent: true, refreshRequired: false,
      correctionOrRevocationApplied: false }, sourceAuthenticated: true,
    researchOnly: true, realForecastEligible: false, forecastIssued: true,
    paidNumericServing: false, probabilityIssued: false, calibratedRangeIssued: false,
    automaticActionAuthorized: false };
}

function unavailable(reason = 'source_or_profile_changed_refresh_required') {
  return { version: 'm26-deterministic-baseline-v1', state: 'unavailable', reason,
    originId: ORIGIN, checkedAt: CHECKED, issuedAt: null, evaluationAsOf: null,
    target: null, configuration: null, horizon: null, unit: null,
    sourceSnapshot: null, output: null,
    evaluation: { state: 'unavailable', evaluatedAt: null, outcomeDigest: null,
      reason: 'finalized_outcome_not_available' },
    digests: { configuration: null, input: null, output: null, baseline: null,
      receipt: null }, currentness: { sourceCurrent: false, refreshRequired: true,
      correctionOrRevocationApplied: true }, sourceAuthenticated: false,
    researchOnly: true, realForecastEligible: false, forecastIssued: false,
    paidNumericServing: false, probabilityIssued: false, calibratedRangeIssued: false,
    automaticActionAuthorized: false };
}

function application(value = current(), { role = 'owner', organizationId = ORG,
  databaseError = null } = {}) {
  const app = express();
  const auth = (req, _res, next) => {
    req.tenantContext = { organizationId, userId: USER };
    req.userRole = role; req.authSession = { id: SESSION }; next();
  };
  const client = { query: jest.fn(async sql => {
    if (sql.startsWith('SELECT public.') && databaseError) throw databaseError;
    if (sql.startsWith('SELECT public.')) return { rows: [{ value }] };
    return { rows: [] };
  }), release: jest.fn() };
  const pool = { connect: jest.fn(async () => client) };
  app.use('/baselines', createForecastDeterministicBaselinesRouter({ auth,
    permission: (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
    poolProvider: () => pool }));
  return { app, client, pool };
}

describe('Mission 26 original Part 9A mounted deterministic baseline', () => {
  test('returns the source-authenticated future baseline and preserves complete zero', async () => {
    const { app, client } = application();
    const response = await request(app).get(`/baselines/${ORIGIN}`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data).toMatchObject({ state: 'current',
      output: { value: { kind: 'point', amount: '0' } },
      sourceAuthenticated: true, researchOnly: true, forecastIssued: true,
      paidNumericServing: false, probabilityIssued: false, calibratedRangeIssued: false,
      automaticActionAuthorized: false });
    expect(response.body.data.sourceSnapshot.observations.map(item => item.count))
      .toEqual([0, 0, 0]);
    const call = client.query.mock.calls.find(item => item[0].startsWith('SELECT public.'));
    expect(call[1]).toEqual([ORG, USER, 'owner', SESSION, ORIGIN]);
    expect(client.query.mock.calls.map(item => item[0])).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL statement_timeout = '20s'",
      "SET LOCAL lock_timeout = '2s'", expect.stringContaining(
        'canonical_forecast_deterministic_baseline_v1_read'), 'COMMIT']);
  });

  test('clears every issued value and digest when current source authority is withdrawn', async () => {
    const { app } = application(unavailable());
    const response = await request(app).get(`/baselines/${ORIGIN}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(unavailable());
    expect(response.body.data.output).toBeNull();
    expect(Object.values(response.body.data.digests).every(item => item === null)).toBe(true);
  });

  test('fails closed for malformed, reordered, cross-context or embellished projections', () => {
    const cases = [];
    const reordered = current(); reordered.sourceSnapshot.observations.reverse(); cases.push(reordered);
    const wrongPeriod = current(); wrongPeriod.sourceSnapshot.observations[0].localMonthStart =
      '2026-05-01'; cases.push(wrongPeriod);
    const mixedZone = current(); mixedZone.sourceSnapshot.profile.timeZone = 'America/New_York';
    cases.push(mixedZone);
    const changedConfiguration = current();
    changedConfiguration.configuration.algorithmVersion = 'unapproved-v2';
    cases.push(changedConfiguration);
    const missing = current(); missing.sourceSnapshot.missingPeriods = 1; cases.push(missing);
    const probability = current(); probability.probability = 0.8; cases.push(probability);
    const absentAsZero = unavailable(); absentAsZero.output = current().output; cases.push(absentAsZero);
    const paid = current(); paid.paidNumericServing = true; cases.push(paid);
    for (const value of cases) expect(sanitizeBaseline(value)).toBeNull();
    expect(sanitizeBaseline(current('1.666667'))).not.toBeNull();
  });

  test('rejects invalid ids before database access, scopes tenant identity and maps role denial', async () => {
    const invalid = application();
    expect((await request(invalid.app).get('/baselines/not-a-uuid')).status).toBe(400);
    expect(invalid.pool.connect).not.toHaveBeenCalled();
    const tenant = '99999999-9999-4999-8999-999999999999';
    const scoped = application(null, { organizationId: tenant });
    expect((await request(scoped.app).get(`/baselines/${ORIGIN}`)).status).toBe(404);
    const call = scoped.client.query.mock.calls.find(item => item[0].startsWith('SELECT public.'));
    expect(call[1][0]).toBe(tenant);
    const denied = application(null, { role: 'member', databaseError: { code: '42501' } });
    expect((await request(denied.app).get(`/baselines/${ORIGIN}`)).status).toBe(403);
  });

  test('migration reuses the immutable Part 4A output and sorts source periods once', () => {
    const sql = fs.readFileSync(
      'migrations/248_canonical_forecast_deterministic_baseline_v1.sql', 'utf8');
    expect(sql).toContain('saved.private_output');
    expect(sql).toContain("ORDER BY item->>'month'");
    expect(sql).toContain('canonical_forecast_retell_future_evidence_v2');
    expect(sql).toContain("'paginationVersion','bounded_single_page'");
    expect(sql).not.toContain('lead_total::numeric/3');
    expect(sql).not.toMatch(/P10|P50|P90|probability_value|scenario/i);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.canonical_forecast_deterministic');
  });
});
