'use strict';

const { sha256 } = require('../../src/services/businessProfileAdapter');
const { VERSION: MANIFEST_VERSION } = require('../../src/forecasting/asOfSourceManifest');
const { VALUE_VERSION } = require('../../src/forecasting/featureContract');
const { registeredFeatureDefinition } = require('../../src/forecasting/featureDefinitions');
const { reconcileFeatureLineage, replayFeatureLineage } =
  require('../../src/forecasting/lineageCurrentness');

const org = '11111111-1111-4111-8111-111111111111';
const approval = '22222222-2222-4222-8222-222222222222';
const corrected = '33333333-3333-4333-8333-333333333333';
const cutoff = '2026-09-21T12:00:00.000000Z';
const later = '2026-09-21T13:00:00.000000Z';
const sourceTime = '2026-09-21T11:59:00.000000Z';
const definition = registeredFeatureDefinition('pipeline.approved_estimate_stock', 'v1');

function source(changes = {}) {
  return { sourceKind: 'estimate_decision', sourceId: approval, revision: 1,
    digest: 'a'.repeat(64), recordedAt: sourceTime, eventAt: null,
    state: 'active', ...changes };
}

function receipt(time, sources, digest = 'c'.repeat(64)) {
  return { digest, manifest: { version: MANIFEST_VERSION,
    organizationId: org, asOf: time, capturedAt: time,
    purposeKey: 'forecast_pipeline', targetKey: 'pipeline.approved_estimates',
    sources } };
}

const captured = () => receipt(cutoff, [source()]);
const current = () => receipt(later, [source()], 'd'.repeat(64));

function feature(changes = {}) {
  return { contractVersion: VALUE_VERSION, organizationId: org,
    definitionKey: definition.key, definitionVersion: definition.definitionVersion,
    definitionDigest: sha256(definition), asOf: cutoff, reportingWindow: null,
    sourceSnapshotDigest: 'c'.repeat(64), latestSourceRecordedAt: sourceTime,
    state: 'known', amount: '1', reason: null,
    unit: { key: 'count', currency: null, scale: 0 }, ...changes };
}

function check(changes = {}) {
  return { feature: feature(), captured: captured(), current: current(),
    sourceAccess: 'granted', retention: 'current', ...changes };
}

describe('Mission 26 Part 2D pull-based feature lineage', () => {
  test('later as-of time alone does not stale identical source pins', () => {
    expect(reconcileFeatureLineage(check())).toEqual({
      version: 'm26-feature-lineage-v1', lineageState: 'current', reason: null,
      featureState: 'known', amount: '1',
    });
  });

  test('correction, withdrawal, new source and deletion of a source mask saved amounts', () => {
    for (const sources of [
      [source({ sourceId: corrected, revision: 2, digest: 'b'.repeat(64),
        recordedAt: '2026-09-21T12:30:00.000000Z' })],
      [source({ sourceId: corrected, revision: 2, digest: 'b'.repeat(64),
        recordedAt: '2026-09-21T12:30:00.000000Z', state: 'tombstone' })],
      [source(), source({ sourceId: corrected })],
      [],
    ]) {
      expect(reconcileFeatureLineage(check({ current: receipt(later, sources) })))
        .toMatchObject({ lineageState: 'stale', reason: 'source_set_changed',
          amount: null, featureState: null });
    }
  });

  test('revocation and retention/deletion mask before returning saved values', () => {
    expect(reconcileFeatureLineage(check({ sourceAccess: 'revoked',
      feature: { sensitive: 'not read' }, current: null })))
      .toMatchObject({ lineageState: 'unavailable',
        reason: 'source_access_revoked', amount: null });
    expect(reconcileFeatureLineage(check({ retention: 'expired', current: null })))
      .toMatchObject({ lineageState: 'unavailable',
        reason: 'source_retention_expired', amount: null });
    expect(reconcileFeatureLineage(check({ retention: 'deleted', current: null })))
      .toMatchObject({ lineageState: 'unavailable',
        reason: 'source_deleted', amount: null });
  });

  test('rejects mismatched source, tenant, purpose, time and digest', () => {
    for (const change of [
      { feature: feature({ sourceSnapshotDigest: 'b'.repeat(64) }) },
      { feature: feature({ asOf: later }) },
      { captured: receipt(cutoff, [source()], 'b'.repeat(64)) },
      { current: receipt('2026-09-21T11:00:00.000000Z', [source()]) },
    ]) {
      expect(() => reconcileFeatureLineage(check(change)))
        .toThrow('Forecast feature lineage details are invalid.');
    }
    const otherTenant = receipt(later, [source()]);
    otherTenant.manifest.organizationId = '44444444-4444-4444-8444-444444444444';
    expect(() => reconcileFeatureLineage(check({ current: otherTenant })))
      .toThrow('Forecast feature lineage details are invalid.');
    const wrongPurpose = receipt(later, [source()]);
    wrongPurpose.manifest.purposeKey = 'other';
    expect(() => reconcileFeatureLineage(check({ current: wrongPurpose })))
      .toThrow('Forecast feature lineage details are invalid.');
  });

  test('bounded replay resumes against the same pinned input and source receipt', () => {
    const items = [
      { feature: feature(), captured: captured() },
      { feature: feature(), captured: captured() },
      { feature: feature(), captured: captured() },
    ];
    const request = { items, current: current(), cursor: null, limit: 2,
      sourceAccess: 'granted', retention: 'current' };
    const first = replayFeatureLineage(request);
    expect(first.results).toHaveLength(2);
    expect(first.results[0].lineageState).toBe('current');
    expect(first.nextCursor.offset).toBe(2);
    expect(replayFeatureLineage(request)).toEqual(first);
    const last = replayFeatureLineage({ ...request, cursor: first.nextCursor });
    expect(last.results).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    expect(() => replayFeatureLineage({ ...request, cursor: first.nextCursor,
      current: receipt(later, [source({ digest: 'b'.repeat(64) })], 'e'.repeat(64)) }))
      .toThrow('Forecast feature lineage details are invalid.');
    expect(() => replayFeatureLineage({ ...request, cursor: first.nextCursor,
      items: items.slice(0, 2) }))
      .toThrow('Forecast feature lineage details are invalid.');
  });

  test('replay remains bounded and cannot bypass revocation', () => {
    const request = { items: [{ feature: feature(), captured: captured() }],
      current: current(), cursor: null, limit: 1,
      sourceAccess: 'granted', retention: 'current' };
    expect(() => replayFeatureLineage({ ...request, limit: 26 }))
      .toThrow('Forecast feature lineage details are invalid.');
    expect(() => replayFeatureLineage({ ...request, sourceAccess: 'revoked' }))
      .toThrow('Forecast feature lineage is unavailable.');
    expect(() => replayFeatureLineage({ ...request, retention: 'deleted' }))
      .toThrow('Forecast feature lineage is unavailable.');
  });
});
