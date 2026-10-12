'use strict';

const crypto = require('node:crypto');
const policy = require('../../config/mission27-launch-contract.v1.json');
const { canonicalDigest } = require('./estimateCapabilityGrantIssuer');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POLICY_VERSION = 'mission27.launch.v1';
const POLICY_DIGEST = 'd24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a';
const TARGET_CLASS = 'canonical_estimate';
const PURPOSE = Object.freeze({
  'customer_financial.estimate.edit_draft': 'customer_financial.polaris_quote_draft',
  'customer_financial.estimate.edit_options': 'customer_financial.polaris_quote_options',
  'customer_financial.estimate.request_signature': 'customer_financial.polaris_quote_signature_request',
  'customer_financial.estimate.review_signature': 'customer_financial.polaris_quote_signature_review',
  'customer_financial.estimate.request_work_handoff': 'customer_financial.polaris_quote_work_handoff',
});
const ASSURANCE = Object.freeze({
  'customer_financial.estimate.edit_draft': 'current_session',
  'customer_financial.estimate.edit_options': 'current_session',
  'customer_financial.estimate.request_signature': 'recent_auth',
  'customer_financial.estimate.review_signature': 'recent_auth',
  'customer_financial.estimate.request_work_handoff': 'recent_auth',
});

function failure() {
  return Object.assign(new Error('Quote journey capability issuance is restricted.'), {
    code: 'CUSTOMER_FINANCIAL_QUOTE_CAPABILITY_RESTRICTED',
  });
}
function classify(role, capability) {
  const capabilities = role === 'owner' ? policy?.team?.ownerDefaultCapabilities :
    role === 'admin' ? policy?.team?.adminDefaultCapabilities : null;
  const templateVersion = role === 'owner' ? policy?.team?.ownerBootstrapTemplate :
    role === 'admin' ? policy?.team?.adminBootstrapTemplate : null;
  const rule = policy?.actionControl?.[capability];
  if (policy?.contractVersion !== POLICY_VERSION || canonicalDigest(policy) !== POLICY_DIGEST ||
      !PURPOSE[capability] || !Array.isArray(capabilities) || !capabilities.includes(capability) ||
      !templateVersion || !rule || !['single_control','conditional_dual_control'].includes(rule.mode)) {
    throw failure();
  }
  return Object.freeze({ capability, targetClass: TARGET_CLASS,
    businessPurpose: PURPOSE[capability], policyVersion: POLICY_VERSION,
    policyDigest: POLICY_DIGEST, templateVersion, actionMode: rule.mode,
    assurance: ASSURANCE[capability] });
}
async function issueEstimateJourneyGrant(client, source, estimateId, capability, options = {}) {
  if (!client?.query || !UUID.test(source?.organizationId || '') ||
      !UUID.test(source?.actorUserId || '') || !UUID.test(source?.membershipId || '') ||
      !UUID.test(estimateId || '') || !['owner','admin'].includes(source?.actorAccessRole) ||
      !options || typeof options !== 'object' || Array.isArray(options)) throw failure();
  const classified = classify(source.actorAccessRole, capability);
  const grantId = options.grantId ?? crypto.randomUUID();
  const revision = options.revision ?? 1; const active = options.active ?? true;
  if (!UUID.test(grantId || '') || !Number.isSafeInteger(revision) || revision < 1 ||
      typeof active !== 'boolean') throw failure();
  for (const key of Object.keys(classified)) if (options[key] !== undefined &&
      options[key] !== classified[key]) throw failure();
  await client.query(`SELECT public.canonical_customer_financial_estimate_journey_v1_issue_grant(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [source.organizationId,
    grantId, revision, source.actorUserId, source.membershipId, estimateId.toLowerCase(),
    classified.capability, classified.targetClass, classified.businessPurpose,
    classified.policyVersion, classified.policyDigest, classified.templateVersion,
    classified.actionMode, classified.assurance, active]);
  return Object.freeze({ grantId, revision, ...classified });
}

module.exports = { issueEstimateJourneyGrant, classify, PURPOSE, ASSURANCE,
  POLICY_VERSION, POLICY_DIGEST, TARGET_CLASS };
