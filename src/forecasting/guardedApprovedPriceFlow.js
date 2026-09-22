'use strict';

const { summarizeApprovedPriceFlow } = require('./approvedPriceFlowPosition');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const uuid = value => typeof value === 'string' && UUID.test(value);

function ownValues(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch { return null; }
}

function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

function unavailable(reason) {
  return Object.freeze({ state: 'unavailable', reason, forecastIssued: false });
}

async function readGuardedApprovedPriceFlow({ pool, actor, snapshotId,
  window: requestedWindow, currency }) {
  const identity = ownValues(actor, ['organizationId', 'actorUserId',
    'authSessionId', 'actorAccessRole']);
  const window = ownValues(requestedWindow, ['startsAt', 'endsAt']);
  if (typeof pool?.connect !== 'function' || !identity || !window ||
      !uuid(snapshotId) || !uuid(identity.organizationId) ||
      !uuid(identity.actorUserId) || !uuid(identity.authSessionId) ||
      !['owner', 'admin'].includes(identity.actorAccessRole) ||
      !instant(window.startsAt) || !instant(window.endsAt) ||
      window.startsAt >= window.endsAt ||
      typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    return unavailable('invalid_source_request');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
    const params = [identity.organizationId, identity.actorUserId,
      identity.actorAccessRole, identity.authSessionId, snapshotId];
    const sourceResult = await client.query(
      'SELECT public.canonical_forecast_price_event_snapshot_read($1,$2,$3,$4,$5) source',
      params);
    const receipt = sourceResult.rows[0]?.source;
    if (!receipt) {
      await client.query('COMMIT');
      return unavailable('source_unavailable');
    }
    const position = summarizeApprovedPriceFlow(receipt, window, currency);
    if (position.organizationId !== identity.organizationId ||
        position.sourceSnapshotId !== snapshotId) {
      await client.query('COMMIT');
      return unavailable('source_identity_mismatch');
    }
    const currentnessResult = await client.query(
      'SELECT public.canonical_forecast_price_event_currentness_read($1,$2,$3,$4,$5) value',
      params);
    const currentness = currentnessResult.rows[0]?.value;
    if (!currentness || currentness.snapshotId !== snapshotId ||
        currentness.sourceSnapshotDigest !== position.sourceSnapshotDigest ||
        currentness.asOf !== position.asOf ||
        !instant(currentness.checkedAt) ||
        !['current', 'stale'].includes(currentness.state) ||
        !Number.isSafeInteger(currentness.capturedEventCount) ||
        currentness.capturedEventCount < 0 ||
        currentness.capturedEventCount > 1000 ||
        !Number.isSafeInteger(currentness.currentEventCount) ||
        currentness.currentEventCount < 0 ||
        currentness.currentEventCount > 1000 ||
        currentness.capturedEventCount !== receipt.eventCount ||
        typeof currentness.capturedEventsDigest !== 'string' ||
        !DIGEST.test(currentness.capturedEventsDigest) ||
        typeof currentness.currentEventsDigest !== 'string' ||
        !DIGEST.test(currentness.currentEventsDigest) ||
        currentness.forecastIssued !== false ||
        (currentness.state === 'current' &&
          (currentness.currentEventCount !== currentness.capturedEventCount ||
           currentness.currentEventsDigest !== currentness.capturedEventsDigest))) {
      await client.query('COMMIT');
      return unavailable('source_currentness_invalid');
    }
    await client.query('COMMIT');
    if (currentness.state !== 'current') return unavailable('source_changed');
    return Object.freeze({ state: 'current_historical_source_only',
      organizationId: position.organizationId, snapshotId,
      asOf: position.asOf, currentnessCheckedAt: currentness.checkedAt,
      sourceSnapshotDigest: position.sourceSnapshotDigest,
      position: position.position, sourceReadAuthorized: true,
      currentnessVerified: true, historicalOnly: true,
      forecastIssued: false, earnedRevenueMeasured: false,
      collectedCashMeasured: false });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { readGuardedApprovedPriceFlow };
