'use strict';

const basisRepository = require('./editableEstimateBasisRepository');
const { readExecutionLink } = require('../operations/executionLinks');
const { readOperationalIntelligence } = require('../operations/intelligenceRepository');
const handoffRepository = require('../operations/handoffRepository');
const contract = require('./billableWorkContext');

function unavailableFromFailure(error, evidence) {
  if (error?.status === 403) throw error;
  return contract.unavailable(error?.status === 404 ? 'source_authority_unavailable' :
    'source_currentness_unavailable', [evidence]);
}
async function withinWorkFence(pool, organizationId, executionId, action) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('Work fence unavailable');
  const client = await pool.connect(); let transaction = false; let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ'); transaction = true;
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
    await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
    // The database-owned helper takes tenant, execution and advisory locks in
    // the one safe global order used with actual Mission 23 writers. Keeping
    // direct table authority out of the runtime role also prevents this fence
    // from becoming a second source reader.
    const fence = await client.query(
      'SELECT public.canonical_customer_financial_billable_work_reader_fence_v1($1,$2) locked',
      [organizationId, executionId],
    );
    if (fence.rows[0]?.locked !== true) throw Object.assign(new Error('Work fence unavailable'), {
      code: '42501', status: 403,
    });
    const result = await action(client);
    await client.query('COMMIT'); transaction = false;
    return result;
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => { discard = true; });
    throw error;
  } finally {
    await client.query('RESET ALL').catch(() => { discard = true; });
    client.release(discard);
  }
}
async function readHandoffWithinFence(client, input) {
  const values = [input.organizationId, input.actorUserId, input.actorAccessRole,
    input.authSessionId, input.executionId];
  const value = (await client.query(
    'SELECT public.canonical_handoff_read($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid) result',
    values,
  )).rows[0]?.result;
  if (!value || value.version !== handoffRepository.VERSION) {
    throw Object.assign(new Error('Current handoff evidence unavailable'), { status: 404 });
  }
  return { ...value, missions: handoffRepository.MISSIONS };
}
async function read(pool, source, estimateId, dependencies = {}) {
  const readBasis = dependencies.readBasis || basisRepository.read;
  const readLink = dependencies.readExecutionLink || readExecutionLink;
  const readIntelligence = dependencies.readOperationalIntelligence || readOperationalIntelligence;
  const readHandoff = dependencies.readHandoff || readHandoffWithinFence;
  const workFence = dependencies.withWorkFence || withinWorkFence;
  const basis = await readBasis(pool, source, estimateId);
  if (basis?.state === 'unavailable') return contract.unavailable(
    basis.reason === 'commercial_lineage_unavailable' ? 'source_authority_unavailable' :
      'source_currentness_unavailable', ['mission24.current_commercial_basis']);
  const linkInput = { ...source, appointmentId: basis.booking.appointmentId,
    graphId: basis.sourceEvidence.receipt.graphId, customerId: basis.estimate.customerId };
  let executionLink;
  try { executionLink = await readLink(pool, linkInput); }
  catch (error) { return unavailableFromFailure(error, 'mission23.execution_association'); }
  // The accepted execution-link reader deliberately does not distinguish a
  // never-created execution from a previously associated execution that is no
  // longer current. Treat that bounded miss as currentness unavailable; never
  // turn it into an affirmative "no execution" fact.
  if (executionLink.state !== 'available') return contract.unavailable(
    'source_currentness_unavailable', ['mission23.execution_association']);
  const workInput = { ...source, executionId: executionLink.executionId };
  let intelligence;
  try { intelligence = await readIntelligence(pool, workInput); }
  catch (error) { return unavailableFromFailure(error, 'mission23.current_operational_intelligence'); }
  return workFence(pool, source.organizationId, executionLink.executionId, async client => {
    // The database enforces this logical work fence for every joined Mission 23
    // source writer. Recheck after acquiring it so a source mutation either
    // wins before this read and clears value, or waits for the coherent join.
    let fencedLink;
    try { fencedLink = await readLink(pool, linkInput); }
    catch (error) { return unavailableFromFailure(error, 'mission23.execution_association'); }
    if (fencedLink.state !== 'available' || fencedLink.executionId !== executionLink.executionId) {
      return contract.unavailable('source_currentness_unavailable', [
        'mission23.execution_association',
      ]);
    }
    // Read the current handoff directly on the fenced transaction. Its source
    // snapshot is the aggregate currentness witness for the earlier operational
    // snapshot; the contract rejects any changed source set value-free.
    let handoffEvidence;
    try { handoffEvidence = await readHandoff(client, workInput); }
    catch (error) { return unavailableFromFailure(error, 'mission23.current_handoff_evidence'); }

    // These accepted readers own separate database snapshots. Re-read the
    // commercial and association sources after all work reads so no older
    // execution snapshot is joined to a changed basis.
    let verifiedLink;
    try { verifiedLink = await readLink(pool, linkInput); }
    catch (error) { return unavailableFromFailure(error, 'mission23.execution_association'); }
    if (verifiedLink.state !== 'available' || verifiedLink.executionId !== executionLink.executionId) {
      return contract.unavailable('source_currentness_unavailable', [
        'mission23.execution_association',
      ]);
    }
    // The work fence still protects the verified execution association. Read
    // the commercial basis last so no await remains between its currentness
    // decision and the synchronous joined projection.
    const verifiedBasis = await readBasis(pool, source, estimateId);
    if (verifiedBasis?.state === 'unavailable' || verifiedBasis.digest !== basis.digest) {
      return contract.unavailable('source_currentness_unavailable', [
        'mission24.current_commercial_basis',
      ]);
    }
    return contract.project({ basis, executionLink, intelligence, handoff: handoffEvidence });
  });
}

module.exports = { read, withinWorkFence, readHandoffWithinFence };
