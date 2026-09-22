'use strict';

// Part 8B prerequisite: one caller-supplied asset and one matching hours meter.
const VERSION = 'm26-asset-meter-position-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DECIMAL = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,3})?$/;
const MAX_USES = 100;
function invalid() {
  const error = new Error('Asset meter position details are invalid.');
  error.code = 'M26_ASSET_METER_POSITION_INVALID';
  throw error;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function dense(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > MAX_USES || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return value.every((_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}
function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function id(value) { return typeof value === 'string' && UUID.test(value); }
function digest(value) { return typeof value === 'string' && DIGEST.test(value); }
function label(value) { return typeof value === 'string' && value.length > 0 &&
  value.length <= 80 && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value); }
function thousandths(value) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) invalid();
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
}
function decimal(value) {
  const fraction = String(value % 1000n).padStart(3, '0').replace(/0+$/, '');
  return String(value / 1000n) + (fraction ? '.' + fraction : '');
}
function summarizeAssetMeterPosition(input) {
  if (!exact(input, ['version', 'organizationId', 'asOf', 'horizon',
    'sourceSnapshotDigest', 'coverage', 'asset']) || input.version !== VERSION ||
    !id(input.organizationId) || !instant(input.asOf) ||
    !exact(input.horizon, ['startsAt', 'endsAt']) ||
    !instant(input.horizon.startsAt) || !instant(input.horizon.endsAt) ||
    input.horizon.startsAt < input.asOf ||
    input.horizon.endsAt <= input.horizon.startsAt ||
    Date.parse(input.horizon.endsAt) - Date.parse(input.horizon.startsAt) > 366 * 86400000 ||
    !digest(input.sourceSnapshotDigest) ||
    !exact(input.coverage, ['state', 'hasMore']) ||
    !['complete', 'incomplete', 'revoked'].includes(input.coverage.state) ||
    typeof input.coverage.hasMore !== 'boolean' ||
    !exact(input.asset, ['assetId', 'organizationId', 'meterKey', 'unit',
      'reading', 'readingObservedAt', 'threshold', 'thresholdSourceDigest',
      'meterResetSinceReading', 'plannedUses']) ||
    !id(input.asset.assetId) || typeof input.asset.organizationId !== 'string' ||
    input.asset.organizationId !== input.organizationId ||
    !label(input.asset.meterKey) || input.asset.unit !== 'hours' ||
    !instant(input.asset.readingObservedAt) ||
    input.asset.readingObservedAt > input.asOf ||
    !digest(input.asset.thresholdSourceDigest) ||
    typeof input.asset.meterResetSinceReading !== 'boolean' ||
    !dense(input.asset.plannedUses)) invalid();

  const reading = thousandths(input.asset.reading);
  const threshold = thousandths(input.asset.threshold);
  if (threshold === 0n) invalid();
  let used = 0n, unresolved = input.coverage.state !== 'complete' ||
    input.coverage.hasMore || input.asset.meterResetSinceReading ||
    input.asset.readingObservedAt !== input.asOf;
  const ids = new Set(), windows = [];
  for (const use of input.asset.plannedUses) {
    if (!exact(use, ['useId', 'jobId', 'planDigest', 'startsAt', 'endsAt',
      'claimedOperatingHours']) || !id(use.useId) || !id(use.jobId) ||
      !digest(use.planDigest) ||
      !instant(use.startsAt) || !instant(use.endsAt) ||
      use.endsAt <= use.startsAt) invalid();
    if (ids.has(use.useId.toLowerCase())) invalid();
    ids.add(use.useId.toLowerCase());
    const hours = thousandths(use.claimedOperatingHours);
    if (hours === 0n) invalid();
    if (use.startsAt < input.horizon.startsAt ||
        use.endsAt > input.horizon.endsAt ||
        hours * 3600000n > BigInt(Date.parse(use.endsAt) - Date.parse(use.startsAt)) * 1000n) {
      unresolved = true;
    }
    used += hours;
    windows.push([use.startsAt, use.endsAt]);
  }
  windows.sort((a, b) => a[0].localeCompare(b[0]));
  for (let i = 1; i < windows.length; i += 1)
    if (windows[i][0] < windows[i - 1][1]) unresolved = true;
  const projected = reading + used;
  if (projected > 9999999999999n) invalid();
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    asOf: input.asOf, horizon: Object.freeze({ ...input.horizon }),
    sourceSnapshotDigest: input.sourceSnapshotDigest, assetId: input.asset.assetId,
    meterKey: input.asset.meterKey, unit: 'hours',
    state: unresolved ? 'unavailable' : 'deterministic_claimed_plan_only',
    reason: unresolved ? 'incomplete_or_conflicting_meter_coverage' : null,
    claimedOperatingHours: unresolved ? null : decimal(used),
    projectedReading: unresolved ? null : decimal(projected),
    claimedThresholdReached: unresolved ? null : projected >= threshold,
    thresholdCrossingDate: null, sourceAuthenticated: false,
    meterCurrentnessVerified: false, planCoverageVerified: false,
    maintenanceDueVerified: false, downtimeRisk: null, forecastIssued: false });
}
module.exports = { VERSION, MAX_USES, summarizeAssetMeterPosition };
