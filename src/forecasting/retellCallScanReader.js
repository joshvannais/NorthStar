'use strict';

const { reconcileRetellInboundCalls } = require('./retellCallReconciliation');

const READ = `SELECT public.canonical_forecast_retell_scan_inputs_read(
 $1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz) value`;

/** Internal only: the database guards tenant, actor, source consent and pins. */
async function inspectRetellCallWindow({ pool, actor, snapshotId, startsAt, endsAt, fetchPage }) {
  const params = [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
    actor.authSessionId, snapshotId, startsAt, endsAt];
  const first = (await pool.query(READ, params)).rows[0]?.value;
  if (!first || first.state !== 'ready_for_diagnostic') {
    return Object.freeze({ state: 'unavailable', reason: first?.reason || 'source_unavailable' });
  }
  const result = await reconcileRetellInboundCalls({
    agentId: first.agentId,
    startsAt: new Date(first.startsAt).toISOString(),
    endsAt: new Date(first.endsAt).toISOString(),
    canonicalCallDigests: first.canonicalCallDigests,
  }, fetchPage);
  if (result.state !== 'snapshot_matched') return result;
  // A permission, integration or source correction during the network scan
  // invalidates the comparison. Never turn this into a certified period.
  const second = (await pool.query(READ, params)).rows[0]?.value;
  if (!second || JSON.stringify(first) !== JSON.stringify(second)) {
    return Object.freeze({ state: 'unavailable', reason: 'source_changed_during_scan' });
  }
  return result;
}

module.exports = { inspectRetellCallWindow };
