'use strict';

const crypto = require('node:crypto');
const launchPolicy = require('../../config/mission27-launch-contract.v1.json');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY = 'customer_financial.document_numbering.review';
const TARGET_CLASS = 'tenant_document_numbering_policy';
const BUSINESS_PURPOSE = 'customer_financial.document_numbering';
const POLICY_VERSION = 'mission27.launch.v1';
const TEMPLATE_VERSION = 'm27.owner.v1';
const ACTION_MODE = 'single_control';
const ASSURANCE = 'current_session';

function failure(code, message) {
  const error = new Error(message); error.code = code; return error;
}
function unique(list) {
  return Array.isArray(list) && new Set(list).size === list.length;
}
function classifyNumberingReviewPolicy(policy = launchPolicy) {
  const team = policy?.team;
  const rule = policy?.actionControl?.[CAPABILITY];
  if (policy?.contractVersion !== POLICY_VERSION || !team || typeof team !== 'object' ||
      team.ownerBootstrapTemplate !== TEMPLATE_VERSION ||
      !unique(team.ownerDefaultCapabilities) || !team.ownerDefaultCapabilities.includes(CAPABILITY) ||
      !unique(team.adminDefaultCapabilities) || team.adminDefaultCapabilities.includes(CAPABILITY) ||
      !unique(team.memberDefaultCapabilities) || team.memberDefaultCapabilities.includes(CAPABILITY) ||
      !unique(team.memberGrantableCapabilities) || team.memberGrantableCapabilities.includes(CAPABILITY) ||
      !unique(team.customerSessionCapabilities) || team.customerSessionCapabilities.includes(CAPABILITY) ||
      !unique(team.ownerOnlyCapabilities) || !team.ownerOnlyCapabilities.includes(CAPABILITY) ||
      !rule || rule.mode !== ACTION_MODE || rule.assurance !== ASSURANCE ||
      !Array.isArray(rule.requires) || !rule.requires.includes('exact_frozen_tenant_global_numbering_contract') ||
      !rule.requires.includes('current_owner_capability') ||
      !rule.requires.includes('fresh_confirmation') || !rule.requires.includes('reason')) {
    throw failure('CUSTOMER_FINANCIAL_CAPABILITY_POLICY_INVALID',
      'Document numbering capability policy is unavailable.');
  }
  return Object.freeze({ capability: CAPABILITY, targetClass: TARGET_CLASS,
    businessPurpose: BUSINESS_PURPOSE, policyVersion: POLICY_VERSION,
    templateVersion: TEMPLATE_VERSION, actionMode: ACTION_MODE, assurance: ASSURANCE });
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
  const capability = options.capability === undefined ? classification.capability : options.capability;
  const templateVersion = options.templateVersion === undefined ?
    classification.templateVersion : options.templateVersion;
  const actionMode = options.actionMode === undefined ? classification.actionMode : options.actionMode;
  const assurance = options.assurance === undefined ? classification.assurance : options.assurance;
  if (!checkedUuid(grantId) || !Number.isSafeInteger(revision) || revision < 1 ||
      typeof active !== 'boolean' || capability !== classification.capability ||
      templateVersion !== classification.templateVersion || actionMode !== classification.actionMode ||
      assurance !== classification.assurance) {
    throw failure('CUSTOMER_FINANCIAL_CAPABILITY_ISSUANCE_RESTRICTED',
      'Document numbering capability issuance is restricted.');
  }
  await client.query(
    `INSERT INTO canonical_customer_financial_numbering_capability_grants_v1(
      organization_id,id,revision,actor_user_id,membership_id,capability,target_class,
      business_purpose,policy_version,template_version,action_mode,assurance,active,
      valid_from,expires_at,issued_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
      clock_timestamp()-INTERVAL '1 minute',clock_timestamp()+INTERVAL '1 hour',clock_timestamp())`,
    [source.organizationId, grantId, revision, source.actorUserId, source.membershipId,
      classification.capability, classification.targetClass, classification.businessPurpose,
      classification.policyVersion, classification.templateVersion, classification.actionMode,
      classification.assurance, active]);
  return Object.freeze({ grantId, revision, ...classification });
}

module.exports = { issueNumberingReviewGrant, classifyNumberingReviewPolicy,
  CAPABILITY, TARGET_CLASS, BUSINESS_PURPOSE, POLICY_VERSION, TEMPLATE_VERSION,
  ACTION_MODE, ASSURANCE };
