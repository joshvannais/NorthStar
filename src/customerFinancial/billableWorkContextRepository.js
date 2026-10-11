'use strict';

const basisRepository = require('./editableEstimateBasisRepository');
const { readExecutionLink } = require('../operations/executionLinks');
const { readOperationalIntelligence } = require('../operations/intelligenceRepository');
const { handoff } = require('../operations/handoffRepository');
const contract = require('./billableWorkContext');

function unavailableFromFailure(error, evidence) {
  if (error?.status === 403) throw error;
  return contract.unavailable(error?.status === 404 ? 'source_authority_unavailable' :
    'source_currentness_unavailable', [evidence]);
}
async function withinWorkFence(pool, identity, action) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('Work fence unavailable');
  const client = await pool.connect(); let locked = false; let discard = false;
  try {
    await client.query("SET statement_timeout='10s'");
    await client.query("SET lock_timeout='2s'");
    await client.query("SET idle_in_transaction_session_timeout='15s'");
    await client.query('SELECT pg_advisory_lock_shared(230007,hashtext($1))', [identity]);
    locked = true;
    return await action();
  } finally {
    if (locked) await client.query(
      'SELECT pg_advisory_unlock_shared(230007,hashtext($1))', [identity],
    ).catch(() => { discard = true; });
    await client.query('RESET ALL').catch(() => { discard = true; });
    client.release(discard);
  }
}
async function read(pool, source, estimateId, dependencies = {}) {
  const readBasis = dependencies.readBasis || basisRepository.read;
  const readLink = dependencies.readExecutionLink || readExecutionLink;
  const readIntelligence = dependencies.readOperationalIntelligence || readOperationalIntelligence;
  const readHandoff = dependencies.readHandoff || handoff;
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
  return workFence(pool, `${source.organizationId}:${executionLink.executionId}`, async () => {
    // The released Mission 23 writers take this logical work fence exclusively.
    // Recheck the association after acquiring it so a reopen/correction either
    // wins before this read and clears value, or waits for this coherent join.
    let fencedLink;
    try { fencedLink = await readLink(pool, linkInput); }
    catch (error) { return unavailableFromFailure(error, 'mission23.execution_association'); }
    if (fencedLink.state !== 'available' || fencedLink.executionId !== executionLink.executionId) {
      return contract.unavailable('source_currentness_unavailable', [
        'mission23.execution_association',
      ]);
    }
    let intelligence; let handoffEvidence;
    try { intelligence = await readIntelligence(pool, workInput); }
    catch (error) { return unavailableFromFailure(error, 'mission23.current_operational_intelligence'); }
    try { handoffEvidence = await readHandoff(pool, workInput); }
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

module.exports = { read, withinWorkFence };
