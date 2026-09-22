'use strict';

const { VERSION, normalizeForecastRunReceipt: normalize,
  compareForecastRuns: compare } = require('../../src/forecasting/forecastRunReceipt');

const org = '55555555-5555-4555-8555-555555555555';
const ids = ['11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'];
function run(index = 0) {
  return { version: VERSION, id: ids[index], organizationId: org,
    asOf: '2026-09-22T17:00:00.000Z',
    createdAt: `2026-09-22T17:0${index}:00.000Z`,
    settings: { revision: 1, digest: 'a'.repeat(64) },
    sourceSnapshotDigest: 'b'.repeat(64), reportingWindowDigest: 'c'.repeat(64),
    featureSetDigest: 'd'.repeat(64), algorithm: { key: 'baseline', version: 'v1',
      definitionDigest: 'e'.repeat(64), implementationDigest: 'f'.repeat(64) },
    calculationVersion: 'calc-v1', outputContractVersion: 'm26-forecast-output-v1',
    outputs: [
      { targetKey: 'revenue.approved_price_flow', targetVersion: 'v1',
        outputDigest: '2'.repeat(64) },
      { targetKey: 'demand.inbound_leads', targetVersion: 'v1',
        outputDigest: '1'.repeat(64) },
    ], supersedes: null, supersessionReason: null };
}

test('freezes a deterministic ordered receipt without trusting its claims', () => {
  const result = normalize(run());
  expect(result.outputs.map(value => value.targetKey)).toEqual([
    'demand.inbound_leads', 'revenue.approved_price_flow']);
  expect(result).toEqual(expect.objectContaining({ inputDigest: expect.any(String),
    resultDigest: expect.any(String), digest: expect.any(String) }));
  expect(Object.isFrozen(result.outputs[0])).toBe(true);
  const reordered = run();
  reordered.outputs.reverse();
  expect(normalize(reordered).digest).toBe(result.digest);
});

test('same frozen inputs and outputs reproduce despite new run identity and creation time', () => {
  const left = run(0), right = run(1);
  expect(compare(left, right)).toMatchObject({ state: 'reproduced',
    sameInputs: true, sameResults: true });
});

test('one run identity cannot prove its own rerun or name conflicting receipts', () => {
  const first = run(0);
  expect(() => compare(first, first)).toThrow(expect.objectContaining({
    code: 'M26_FORECAST_RUN_RECEIPT_INVALID' }));
  const conflicting = run(0);
  conflicting.outputs[0].outputDigest = '3'.repeat(64);
  expect(() => compare(first, conflicting)).toThrow(expect.objectContaining({
    code: 'M26_FORECAST_RUN_RECEIPT_INVALID' }));
});

test('same inputs with changed output is a result mismatch, not a reproduced run', () => {
  const left = run(0), right = run(1);
  right.outputs[0].outputDigest = '3'.repeat(64);
  expect(compare(left, right)).toMatchObject({ state: 'result_mismatch',
    sameInputs: true, sameResults: false });
});

test('changed inputs are incomparable even when output digests happen to match', () => {
  const left = run(0), right = run(1);
  right.algorithm.implementationDigest = '4'.repeat(64);
  expect(compare(left, right)).toMatchObject({ state: 'input_changed',
    sameInputs: false, sameResults: true });
});

test('supersession remains an immutable claimed link and rejects self-reference', () => {
  const original = normalize(run(0));
  const replacement = run(1);
  replacement.supersedes = { runId: original.id, runDigest: original.digest };
  replacement.supersessionReason = 'corrected_source';
  expect(normalize(replacement).supersedes).toEqual({
    runId: original.id, runDigest: original.digest });
  replacement.supersedes.runId = replacement.id;
  expect(() => normalize(replacement)).toThrow(expect.objectContaining({
    code: 'M26_FORECAST_RUN_RECEIPT_INVALID' }));
});

test('rejects duplicate targets, cross-tenant comparison and forged arrays', () => {
  const duplicate = run();
  duplicate.outputs[1] = { ...duplicate.outputs[0] };
  expect(() => normalize(duplicate)).toThrow();
  const other = run(1);
  other.organizationId = '66666666-6666-4666-8666-666666666666';
  expect(() => compare(run(0), other)).toThrow();
  const forged = run();
  Object.setPrototypeOf(forged.outputs,
    Object.assign(Object.create(Array.prototype), { map() { return []; } }));
  expect(() => normalize(forged)).toThrow();
});

test('rejects future as-of, extra fields and malformed supersession claims', () => {
  const future = run();
  future.asOf = '2026-09-22T18:00:00.000Z';
  expect(() => normalize(future)).toThrow();
  const extra = run();
  extra.approved = true;
  expect(() => normalize(extra)).toThrow();
  const missingReason = run();
  missingReason.supersedes = { runId: ids[1], runDigest: 'a'.repeat(64) };
  expect(() => normalize(missingReason)).toThrow();
});
