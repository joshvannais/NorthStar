'use strict';

const crypto = require('node:crypto');
const policy = require('../../config/mission27-launch-contract.v1.json');
const { canonicalDigest } = require('./estimateCapabilityGrantIssuer');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY = 'customer_financial.billable_work.review';
const TARGET_CLASS = 'canonical_estimate';
const BUSINESS_PURPOSE = 'customer_financial.billable_work_review';
const POLICY_VERSION = 'mission27.launch.v1';
const POLICY_DIGEST = 'd24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a';
const ACTION_MODE = 'conditional_dual_control';
const ASSURANCE = 'recent_auth';

function failure() {
  const error = new Error('Billable-work review capability issuance is restricted.');
  error.code = 'CUSTOMER_FINANCIAL_BILLABLE_WORK_CAPABILITY_RESTRICTED'; return error;
}
function classify(role) {
  const capabilities = role === 'owner' ? policy?.team?.ownerDefaultCapabilities :
    role === 'admin' ? policy?.team?.adminDefaultCapabilities : null;
  const templateVersion = role === 'owner' ? policy?.team?.ownerBootstrapTemplate :
    role === 'admin' ? policy?.team?.adminBootstrapTemplate : null;
  const rule = policy?.actionControl?.[CAPABILITY];
  if (policy?.contractVersion !== POLICY_VERSION || canonicalDigest(policy) !== POLICY_DIGEST ||
      !Array.isArray(capabilities) || !capabilities.includes(CAPABILITY) || !templateVersion ||
      rule?.mode !== ACTION_MODE || rule.maximumMinorUnits !== '10000000' ||
      !rule.singleControlAllowedWhen?.includes('billable_amount_minor_units_lte_1000000') ||
      !rule.dualControlRequiredWhen?.includes('billable_amount_minor_units_gt_1000000_and_lte_10000000') ||
      !rule.denyWhen?.some(value => value.includes('missing'))) throw failure();
  return Object.freeze({ capability: CAPABILITY, targetClass: TARGET_CLASS,
    businessPurpose: BUSINESS_PURPOSE, policyVersion: POLICY_VERSION, policyDigest: POLICY_DIGEST,
    templateVersion, actionMode: ACTION_MODE, assurance: ASSURANCE });
}
async function issueBillableWorkReviewGrant(client, source, estimateId, options = {}) {
  if (!client?.query || !UUID.test(source?.organizationId || '') ||
      !UUID.test(source?.actorUserId || '') || !UUID.test(source?.membershipId || '') ||
      !UUID.test(estimateId || '') || !['owner','admin'].includes(source?.actorAccessRole) ||
      !options || typeof options !== 'object' || Array.isArray(options)) throw failure();
  const classified = classify(source.actorAccessRole);
  const grantId = options.grantId ?? crypto.randomUUID();
  const revision = options.revision ?? 1; const active = options.active ?? true;
  if (!UUID.test(grantId || '') || !Number.isSafeInteger(revision) || revision < 1 ||
      typeof active !== 'boolean') throw failure();
  for (const key of Object.keys(classified)) if (options[key] !== undefined &&
      options[key] !== classified[key]) throw failure();
  await client.query(`SELECT public.canonical_customer_financial_billable_review_v1_issue_grant(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [source.organizationId,
    grantId, revision, source.actorUserId, source.membershipId, estimateId.toLowerCase(),
    classified.capability, classified.targetClass, classified.businessPurpose,
    classified.policyVersion, classified.policyDigest, classified.templateVersion,
    classified.actionMode, classified.assurance, active]);
  return Object.freeze({ grantId, revision, ...classified });
}

module.exports = { issueBillableWorkReviewGrant, classify, CAPABILITY, TARGET_CLASS,
  BUSINESS_PURPOSE, POLICY_VERSION, POLICY_DIGEST, ACTION_MODE, ASSURANCE };
