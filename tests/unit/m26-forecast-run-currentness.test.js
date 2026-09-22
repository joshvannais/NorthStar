'use strict';

const { VERSION: RUN_VERSION, normalizeForecastRunReceipt } =
  require('../../src/forecasting/forecastRunReceipt');
const { VERSION, projectForecastRunCurrentness: project } =
  require('../../src/forecasting/forecastRunCurrentness');

const run = { version: RUN_VERSION,
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: '55555555-5555-4555-8555-555555555555',
  asOf: '2026-09-22T17:00:00.000Z', createdAt: '2026-09-22T17:01:00.000Z',
  settings: { revision: 1, digest: 'a'.repeat(64) },
  sourceSnapshotDigest: 'b'.repeat(64), reportingWindowDigest: 'c'.repeat(64),
  featureSetDigest: 'd'.repeat(64), algorithm: { key: 'baseline', version: 'v1',
    definitionDigest: 'e'.repeat(64), implementationDigest: 'f'.repeat(64) },
  calculationVersion: 'calc-v1', outputContractVersion: 'm26-forecast-output-v1',
  outputs: [{ targetKey: 'demand.inbound_leads', targetVersion: 'v1',
    outputDigest: '1'.repeat(64) }], supersedes: null, supersessionReason: null };

function input() {
  return { run, source: { capturedDigest: run.sourceSnapshotDigest,
    status: 'current', currentDigest: run.sourceSnapshotDigest },
  algorithm: { status: 'current', current: { ...run.algorithm } } };
}

test('pins an unchanged candidate without claiming display authority', () => {
  const result = project(input());
  expect(result).toEqual({ version: VERSION, runId: run.id,
    runDigest: normalizeForecastRunReceipt(run).digest,
    state: 'unchanged_candidate', reasons: [], digest: expect.any(String) });
  expect(Object.isFrozen(result.reasons)).toBe(true);
  expect(Object.isFrozen(result)).toBe(true);
  expect(project(input())).toEqual(result);
});

test('a corrected source or replaced algorithm stales the whole candidate run', () => {
  const corrected = input();
  corrected.source = { ...corrected.source, status: 'changed',
    currentDigest: '2'.repeat(64) };
  expect(project(corrected)).toMatchObject({ state: 'stale',
    reasons: ['source_changed'] });
  corrected.algorithm = { status: 'replaced',
    current: { ...run.algorithm, version: 'v2' } };
  expect(project(corrected)).toMatchObject({ state: 'stale',
    reasons: ['source_changed', 'algorithm_replaced'] });
});

test.each(['revoked', 'deleted', 'retention_expired', 'unknown'])(
  'source %s withholds current use and source-derived output', status => {
    const candidate = input();
    candidate.source = { ...candidate.source, status, currentDigest: null };
    const result = project(candidate);
    expect(result).toMatchObject({ state: 'unavailable', reasons: [`source_${status}`],
      runId: null, runDigest: null });
    expect(JSON.stringify(result)).not.toContain(run.outputs[0].outputDigest);
  });

test.each(['withdrawn', 'unknown'])(
  'algorithm %s makes the run unavailable', status => {
    const candidate = input();
    candidate.algorithm = { status, current: null };
    expect(project(candidate)).toMatchObject({ state: 'unavailable',
      reasons: [`algorithm_${status}`], runId: null, runDigest: null });
  });

test('cannot claim current with mismatched source or algorithm pins', () => {
  const changedSource = input();
  changedSource.source.currentDigest = '2'.repeat(64);
  expect(() => project(changedSource)).toThrow();
  const changedAlgorithm = input();
  changedAlgorithm.algorithm.current.version = 'v2';
  expect(() => project(changedAlgorithm)).toThrow();
  const mislabeled = input();
  mislabeled.algorithm.status = 'replaced';
  expect(() => project(mislabeled)).toThrow();
});

test('a different algorithm key is a replacement, while one key/version cannot mutate', () => {
  const differentKey = input();
  differentKey.algorithm = { status: 'replaced',
    current: { ...run.algorithm, key: 'seasonal' } };
  expect(project(differentKey)).toMatchObject({ state: 'stale',
    reasons: ['algorithm_replaced'] });
  const mutatedDefinition = input();
  mutatedDefinition.algorithm = { status: 'replaced',
    current: { ...run.algorithm, definitionDigest: '2'.repeat(64) } };
  expect(() => project(mutatedDefinition)).toThrow();
  const mutatedImplementation = input();
  mutatedImplementation.algorithm = { status: 'replaced',
    current: { ...run.algorithm, implementationDigest: '3'.repeat(64) } };
  expect(() => project(mutatedImplementation)).toThrow();
});

test('rejects malformed or fabricated status records and run references', () => {
  const wrongReceipt = input();
  wrongReceipt.source.capturedDigest = '9'.repeat(64);
  expect(() => project(wrongReceipt)).toThrow();
  const unknownWithDigest = input();
  unknownWithDigest.source.status = 'unknown';
  expect(() => project(unknownWithDigest)).toThrow();
  const forgedAlgorithm = input();
  forgedAlgorithm.algorithm.current.extra = true;
  expect(() => project(forgedAlgorithm)).toThrow();
  const extra = input();
  extra.approved = true;
  expect(() => project(extra)).toThrow(expect.objectContaining({
    code: 'M26_FORECAST_RUN_CURRENTNESS_INVALID' }));
});
