'use strict';

const crypto = require('node:crypto');

const CONTRACT_VERSION = 'm27-billable-work-context-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const REQUIRED_DOMAINS = Object.freeze([
  'completion', 'labor', 'materials', 'progress', 'fieldEvidence', 'equipment',
]);
const CAPACITY_MISSING = Object.freeze([
  'mission20.current_business_capacity_profile',
  'mission22.current_combined_capacity',
  'mission25.current_tenant_private_outcome_observation',
  'mission26.compatible_current_advisory_run',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stable(value[key])]),
  );
  return value;
}
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}
function validPin(value) {
  return value && UUID.test(value.id || '') && Number.isSafeInteger(Number(value.revision)) &&
    Number(value.revision) > 0 && DIGEST.test(value.digest || '');
}
function pin(value) {
  if (!validPin(value)) throw new Error('Billable work source pin invalid');
  return Object.freeze({ id: value.id, revision: Number(value.revision), digest: value.digest });
}
function samePin(left, right) {
  return validPin(left) && validPin(right) && left.id === right.id &&
    Number(left.revision) === Number(right.revision) && left.digest === right.digest;
}
function samePins(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const normalized = rows => rows.map(pin).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}
function unavailable(reason, missingEvidence) {
  if (!['source_authority_unavailable', 'source_currentness_unavailable'].includes(reason) ||
      !Array.isArray(missingEvidence) || !missingEvidence.length ||
      missingEvidence.some(item => typeof item !== 'string' || !item || item.length > 120)) {
    throw new Error('Billable work unavailable state invalid');
  }
  return Object.freeze({ contractVersion: CONTRACT_VERSION, state: 'unavailable', reason,
    category: reason === 'source_authority_unavailable' ? 'missing_source' : 'source_changed',
    value: null, missingEvidence: Object.freeze([...new Set(missingEvidence)]),
    refreshRequired: true, providerCallCount: 0, receiverMutationCount: 0,
    schedulingMutationCount: 0, workMutationCount: 0, financialActionAuthorized: false });
}
function assertBasis(basis) {
  if (!basis || basis.contractVersion !== 'm27-polaris-editable-estimate-v1' ||
      basis.mode !== 'paid_tenant' || basis.currentness?.current !== true ||
      !UUID.test(basis.estimate?.id || '') || !UUID.test(basis.estimate?.customerId || '') ||
      !UUID.test(basis.booking?.appointmentId || '') || !validPin({ id: basis.booking.assignmentId,
        revision: basis.booking.revision, digest: basis.booking.digest }) ||
      !DIGEST.test(basis.digest || '') || basis.providerCallCount !== 0 ||
      basis.receiverMutationCount !== 0 || basis.browserArithmeticUsed !== false) {
    throw new Error('Commercial basis invalid');
  }
}
function assertIntelligence(value) {
  if (!value || value.version !== 'm23-operational-intelligence-v1' ||
      value.authority !== 'postgresql_sources' || value.advisory !== true ||
      value.humanReviewRequired !== true || value.providerUsed !== false ||
      !Array.isArray(value.capabilities) || value.capabilities.length !== 0 ||
      !validPin(value.execution) || !validPin(value.assignment) ||
      !DIGEST.test(value.snapshotDigest || '') || !Array.isArray(value.evidence) ||
      !Array.isArray(value.missingInputs) || !Array.isArray(value.conflicts) ||
      !Array.isArray(value.comparisons) || !Array.isArray(value.recommendations)) {
    throw new Error('Operational intelligence invalid');
  }
}
function assertHandoff(value) {
  if (!value || value.version !== 'm23-downstream-handoffs-v1' ||
      value.sourceAvailable !== true || value.consumptionAuthorized !== false ||
      !UUID.test(value.executionId || '') ||
      value.audience !== 'tenant_owner_admin_review' ||
      value.consentVersion !== 'm23-internal-reference-consent-v1' ||
      value.delivery !== 'unavailable' ||
      !DIGEST.test(value.sourceDigest || '') || !Array.isArray(value.receipts) ||
      value.sourceSnapshot?.version !== 'm23-source-references-v1' ||
      value.sourceSnapshot.completionInferred !== false ||
      value.sourceSnapshot.factsIncluded !== false ||
      !validPin(value.sourceSnapshot.execution) || !validPin(value.sourceSnapshot.assignment)) {
    throw new Error('Downstream handoff evidence invalid');
  }
}
function currentMission27Receipt(handoff) {
  const matches = handoff.receipts.filter(receipt => receipt.action === 'prepare' &&
    receipt.mission === 27 && receipt.status === 'prepared' &&
    receipt.executionId === handoff.executionId &&
    receipt.audience === handoff.audience &&
    receipt.consentVersion === handoff.consentVersion &&
    receipt.sourceDigest === handoff.sourceDigest && receipt.delivery === 'unavailable' &&
    receipt.consumptionAuthorized === false && receipt.financialConsequence === false &&
    receipt.customerConsequence === false && UUID.test(receipt.id || '') &&
    DIGEST.test(receipt.digest || '') && typeof receipt.createdAt === 'string' &&
    Number.isFinite(Date.parse(receipt.createdAt)));
  if (!matches.length) return null;
  return [...matches].sort((left, right) => {
    const created = String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
    return created || right.id.localeCompare(left.id);
  })[0];
}
function evidenceAgrees(intelligence, handoff) {
  for (const domain of REQUIRED_DOMAINS) {
    const advisory = intelligence.evidence.find(item => item.domain === domain);
    const source = handoff.sourceSnapshot[domain];
    if (!advisory || !source || advisory.complete !== true ||
        advisory.visibleTotal !== source.count || !samePins(advisory.pins, source.pins)) return false;
  }
  return true;
}
function project({ basis, executionLink, intelligence, handoff }) {
  assertBasis(basis); assertIntelligence(intelligence); assertHandoff(handoff);
  if (!executionLink || executionLink.version !== 'm23-part9-execution-link-v1' ||
      executionLink.state !== 'available' || executionLink.appointmentId !== basis.booking.appointmentId ||
      executionLink.graphId !== basis.sourceEvidence?.receipt?.graphId ||
      executionLink.customerId !== basis.estimate.customerId ||
      executionLink.executionId !== intelligence.execution.id) {
    return unavailable('source_currentness_unavailable', ['mission23.execution_association']);
  }
  const bookingPin = { id: basis.booking.assignmentId, revision: basis.booking.revision,
    digest: basis.booking.digest };
  if (!samePin(bookingPin, intelligence.assignment) ||
      !samePin(intelligence.assignment, handoff.sourceSnapshot.assignment) ||
      !samePin(intelligence.execution, handoff.sourceSnapshot.execution) ||
      intelligence.execution.lifecycleState !== 'completed' ||
      handoff.sourceSnapshot.execution.lifecycleState !== 'completed' ||
      !evidenceAgrees(intelligence, handoff)) {
    return unavailable('source_currentness_unavailable', [
      'mission23.current_completion', 'mission23.current_source_pins',
    ]);
  }
  const receipt = currentMission27Receipt(handoff);
  if (!receipt) return unavailable('source_authority_unavailable', [
    'mission23.accepted_mission27_reference_handoff',
  ]);
  const context = {
    contractVersion: CONTRACT_VERSION, state: 'available', mode: 'paid_tenant',
    commercialBasis: basis,
    association: Object.freeze({ estimateId: basis.estimate.id,
      customerId: basis.estimate.customerId, appointmentId: basis.booking.appointmentId,
      assignment: pin(intelligence.assignment), execution: Object.freeze({
        ...pin(intelligence.execution), lifecycleState: 'completed' }) }),
    operationalRiskGuidance: Object.freeze({ state: 'available',
      sourceClass: 'mission23.operational_intelligence.v1',
      sourceIdentity: intelligence.execution.id, advisoryDigest: intelligence.snapshotDigest,
      generatedAt: intelligence.generatedAt, expiresAt: intelligence.expiresAt,
      summary: intelligence.summary, scope: intelligence.scope,
      confidence: intelligence.confidence, uncertainty: intelligence.uncertainty,
      missingInputs: intelligence.missingInputs, conflicts: intelligence.conflicts,
      comparisons: intelligence.comparisons, recommendations: intelligence.recommendations,
      evidence: intelligence.evidence, advisory: true, humanReviewRequired: true }),
    capacityGuidance: Object.freeze({ available: false, value: null,
      code: 'capacity_source_unavailable', category: 'missing_source',
      missingEvidence: CAPACITY_MISSING, refreshRequired: true,
      mayBookOrMutate: false }),
    handoffEvidence: Object.freeze({ version: handoff.version,
      receipt: Object.freeze({ id: receipt.id, digest: receipt.digest,
        sourceDigest: receipt.sourceDigest, mission: 27, status: 'prepared',
        audience: receipt.audience, consentVersion: receipt.consentVersion,
        createdAt: receipt.createdAt, delivery: 'unavailable',
        consumptionAuthorized: false, financialConsequence: false,
        customerConsequence: false }),
      sourceDigest: handoff.sourceDigest, factsIncluded: false,
      financialActionAuthorized: false }),
    billableWork: Object.freeze({ sourceClass: 'mission23.current_completion.v1',
      finalBalanceSourceCurrent: true, completionInferred: false,
      humanReviewRequired: true, reviewAuthority: 'mission27.part3c',
      financialActionAuthorized: false, invoiceAuthorized: false }),
    providerCallCount: 0, receiverMutationCount: 0, schedulingMutationCount: 0,
    workMutationCount: 0, browserArithmeticUsed: false,
  };
  return Object.freeze({ ...context, digest: digest(context) });
}

module.exports = { CONTRACT_VERSION, CAPACITY_MISSING, digest, project, unavailable,
  samePin, evidenceAgrees };
