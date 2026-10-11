'use strict';

const crypto = require('node:crypto');
const launchPolicy = require('../../config/mission27-launch-contract.v1.json');
const numberingPolicy = require('../../config/mission27-document-numbering-policy.v1.json');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const CAPABILITY = 'customer_financial.document_numbering.review';
const TARGET_CLASS = 'tenant_document_numbering_policy';
const BUSINESS_PURPOSE = 'customer_financial.document_numbering';
const POLICY_VERSION = 'mission27.document_numbering.v1';
const POLICY_DIGEST = '2b98aa283e4b3ad464419c7f8cb964892fc2fe28cbc6b7afdbac94ddc194b041';
const TEMPLATE_VERSION = 'm27.document_numbering.owner.v1';
const PREDECESSOR_POLICY_VERSION = 'mission27.launch.v1';
const PREDECESSOR_POLICY_DIGEST =
  'd24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a';
const ACTION_MODE = 'single_control';
const ASSURANCE = 'current_session';

function failure(code, message) {
  const error = new Error(message); error.code = code; return error;
}
function unique(list) {
  return Array.isArray(list) && new Set(list).size === list.length;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stable(value[key])]),
  );
  return value;
}
function canonicalDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}
function classifyNumberingReviewPolicy(policy = numberingPolicy, predecessor = launchPolicy) {
  const predecessorCapabilities = predecessor?.team?.ownerDefaultCapabilities;
  const predecessorActions = predecessor?.actionControl;
  const rule = policy?.actionControl;
  const template = policy?.template;
  const compatibility = policy?.compatibility;
  const predecessorLink = policy?.predecessor;
  if (predecessor?.contractVersion !== PREDECESSOR_POLICY_VERSION ||
      canonicalDigest(predecessor) !== PREDECESSOR_POLICY_DIGEST ||
      !unique(predecessorCapabilities) || predecessorCapabilities.includes(CAPABILITY) ||
      !predecessorActions || typeof predecessorActions !== 'object' ||
      Object.hasOwn(predecessorActions, CAPABILITY) ||
      Object.keys(predecessorActions).length !== predecessorCapabilities.length ||
      !predecessorCapabilities.every(value => Object.hasOwn(predecessorActions, value)) ||
      policy?.policyVersion !== POLICY_VERSION || policy?.policyKind !== 'subordinate_action_policy' ||
      canonicalDigest(policy) !== POLICY_DIGEST ||
      predecessorLink?.contractVersion !== PREDECESSOR_POLICY_VERSION ||
      predecessorLink?.canonicalDigest !== PREDECESSOR_POLICY_DIGEST ||
      predecessorLink?.compatibilityMode !== 'exact_predecessor_required_no_reinterpretation' ||
      policy?.scope?.targetClass !== TARGET_CLASS ||
      policy?.scope?.businessPurpose !== BUSINESS_PURPOSE ||
      template?.version !== TEMPLATE_VERSION ||
      !unique(template?.eligibleAccessRoles) ||
      template.eligibleAccessRoles.length !== 1 || template.eligibleAccessRoles[0] !== 'owner' ||
      !unique(template?.capabilities) ||
      template.capabilities.length !== 1 || template.capabilities[0] !== CAPABILITY ||
      rule?.capability !== CAPABILITY || rule.mode !== ACTION_MODE || rule.assurance !== ASSURANCE ||
      !Array.isArray(rule.requires) || !rule.requires.includes('exact_frozen_tenant_global_numbering_contract') ||
      !rule.requires.includes('current_owner_capability') ||
      !rule.requires.includes('fresh_confirmation') || !rule.requires.includes('reason') ||
      compatibility?.predecessorCapabilitiesRemainAuthoritative !== true ||
      compatibility?.predecessorRecordsRetainPolicyVersion !== true ||
      compatibility?.crossVersionSubstitutionAllowed !== false ||
      compatibility?.downgradeAllowed !== false) {
    throw failure('CUSTOMER_FINANCIAL_CAPABILITY_POLICY_INVALID',
      'Document numbering capability policy is unavailable.');
  }
  return Object.freeze({ capability: CAPABILITY, targetClass: TARGET_CLASS,
    businessPurpose: BUSINESS_PURPOSE, policyVersion: POLICY_VERSION, policyDigest: POLICY_DIGEST,
    templateVersion: TEMPLATE_VERSION, predecessorPolicyVersion: PREDECESSOR_POLICY_VERSION,
    predecessorPolicyDigest: PREDECESSOR_POLICY_DIGEST,
    actionMode: ACTION_MODE, assurance: ASSURANCE });
}
function checkedUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}
async function issueNumberingReviewGrant(client, source, options = {}) {
  if (!client || typeof client.query !== 'function' || !source || typeof source !== 'object' ||
      !checkedUuid(source.organizationId) || !checkedUuid(source.actorUserId) ||
      !checkedUuid(source.membershipId) || source.actorAccessRole !== 'owner' ||
      !options || typeof options !== 'object' || Array.isArray(options)) {
    throw failure('CUSTOMER_FINANCIAL_CAPABILITY_ISSUANCE_RESTRICTED',
      'Document numbering capability issuance is restricted.');
  }
  const classification = classifyNumberingReviewPolicy();
  const grantId = options.grantId === undefined ? crypto.randomUUID() : options.grantId;
  const revision = options.revision === undefined ? 1 : options.revision;
  const active = options.active === undefined ? true : options.active;
  for (const key of ['capability','policyVersion','policyDigest','templateVersion','predecessorPolicyVersion',
    'predecessorPolicyDigest','actionMode','assurance']) {
    if (options[key] !== undefined && options[key] !== classification[key]) {
      throw failure('CUSTOMER_FINANCIAL_CAPABILITY_ISSUANCE_RESTRICTED',
        'Document numbering capability issuance is restricted.');
    }
  }
  if (!checkedUuid(grantId) || !Number.isSafeInteger(revision) || revision < 1 ||
      typeof active !== 'boolean' || !DIGEST.test(classification.predecessorPolicyDigest)) {
    throw failure('CUSTOMER_FINANCIAL_CAPABILITY_ISSUANCE_RESTRICTED',
      'Document numbering capability issuance is restricted.');
  }
  await client.query(
    `INSERT INTO canonical_customer_financial_numbering_capability_grants_v1(
      organization_id,id,revision,actor_user_id,membership_id,capability,target_class,
      business_purpose,policy_version,policy_digest,template_version,predecessor_policy_version,
      predecessor_policy_digest,action_mode,assurance,active,valid_from,expires_at,issued_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
      clock_timestamp()-INTERVAL '1 minute',clock_timestamp()+INTERVAL '1 hour',clock_timestamp())`,
    [source.organizationId, grantId, revision, source.actorUserId, source.membershipId,
      classification.capability, classification.targetClass, classification.businessPurpose,
      classification.policyVersion, classification.policyDigest, classification.templateVersion,
      classification.predecessorPolicyVersion, classification.predecessorPolicyDigest,
      classification.actionMode, classification.assurance, active]);
  return Object.freeze({ grantId, revision, ...classification });
}

module.exports = { issueNumberingReviewGrant, classifyNumberingReviewPolicy, canonicalDigest,
  CAPABILITY, TARGET_CLASS, BUSINESS_PURPOSE, POLICY_VERSION, TEMPLATE_VERSION,
  POLICY_DIGEST, PREDECESSOR_POLICY_VERSION, PREDECESSOR_POLICY_DIGEST, ACTION_MODE, ASSURANCE };
