'use strict';

const crypto = require('node:crypto');
const money = require('./exactMoney');

const CONTRACT_VERSION = 'm27-billable-work-review-v1';
const SOURCE_VERSION = 'm27-billable-work-review-source-v1';
const FINAL_BALANCE = 'final_balance';
const PRE_WORK_DEPOSIT = 'pre_work_deposit';
const MILESTONE = 'milestone';
const MAXIMUM = 10000000n;
const SINGLE_CONTROL_MAXIMUM = 1000000n;
const DEPOSIT_MAXIMUM = 2500000n;

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
function unavailable(reason, missingEvidence = []) {
  return Object.freeze({ contractVersion: CONTRACT_VERSION, state: 'unavailable', reason,
    value: null, missingEvidence: Object.freeze([...missingEvidence]),
    financialActionAuthorized: false, invoiceAuthorized: false,
    receiverMutationCount: 0, providerCallCount: 0 });
}
function exactMinor(value) {
  return BigInt(money.verify(value).minorUnits);
}
function controlFor(amount) {
  if (amount < 0n || amount > MAXIMUM) return null;
  return amount <= SINGLE_CONTROL_MAXIMUM ? 'single_control' : 'dual_control';
}
function commercialSourceDigest(basis) {
  // Part 3A deliberately includes the actor's capability grant in its complete
  // response digest. A billable decision may need two different authorized
  // reviewers, so bind the commercial source itself while excluding only that
  // per-reader authorization envelope.
  return digest({ estimate: basis.estimate, revision: basis.revision,
    options: basis.options, inputs: basis.inputs, provenance: basis.provenance,
    sourceEvidence: basis.sourceEvidence, intakeSources: basis.intakeSources,
    mission24: basis.mission24, booking: basis.booking,
    mission32Adapter: basis.mission32Adapter, currentness: basis.currentness });
}
function finalBalance(context) {
  if (!context || context.state !== 'available' ||
      context.billableWork?.finalBalanceSourceCurrent !== true ||
      context.commercialBasis?.currentness?.current !== true ||
      context.association?.execution?.lifecycleState !== 'completed' ||
      !/^[0-9a-f]{64}$/.test(context.handoffEvidence?.sourceDigest || '')) {
    return unavailable('source_currentness_unavailable', [
      'mission24.current_accepted_commercial_version', 'mission23.current_completion',
    ]);
  }
  const option = context.commercialBasis.options?.[0];
  if (!option || !option.totalBeforeTax) return unavailable('billable_amount_unavailable', [
    'mission24.accepted_option_total_before_tax',
  ]);
  const amount = exactMinor(option.totalBeforeTax); const mode = controlFor(amount);
  if (!mode) return unavailable('billable_amount_out_of_bounds', ['launch.billable_work.maximum']);
  // The Part 3B context also contains an advisory generation timestamp, so its
  // presentation digest intentionally changes on every read. Bind the decision
  // to the stable database-owned source aggregate instead: exact execution pin,
  // the Mission 23 handoff source digest, and the accepted Mission 24 basis.
  const commercialDigest = commercialSourceDigest(context.commercialBasis);
  const stableWorkSourceDigest = digest({
    contractVersion: 'm27-billable-work-current-source-v1',
    execution: context.association.execution,
    handoffSourceDigest: context.handoffEvidence.sourceDigest,
    commercialBasisDigest: commercialDigest,
  });
  const source = {
    contractVersion: SOURCE_VERSION, sourceClass: FINAL_BALANCE,
    estimateId: context.commercialBasis.estimate.id,
    customerId: context.commercialBasis.estimate.customerId,
    workId: context.association.execution.id,
    sourceIdentity: context.association.execution.id,
    sourceDigest: stableWorkSourceDigest,
    sourceAuthorityIdentity: context.handoffEvidence.receipt.id,
    sourceAuthorityDigest: context.handoffEvidence.receipt.digest,
    commercialBasisDigest: commercialDigest,
    amount: money.verify(option.totalBeforeTax), controlMode: mode,
    completionClaimed: true, completionInferred: false,
    sourceCurrent: true, reasonRequired: true,
  };
  return Object.freeze({ contractVersion: CONTRACT_VERSION, state: 'review_required',
    source: Object.freeze({ ...source, decisionDigest: digest(source) }),
    financialActionAuthorized: false, invoiceAuthorized: false,
    providerCallCount: 0, receiverMutationCount: 0 });
}
function preWorkDeposit(basis) {
  if (!basis || basis.state === 'unavailable' || basis.currentness?.current !== true) {
    return unavailable('source_currentness_unavailable', ['mission24.current_accepted_terms']);
  }
  const option = basis.options?.[0]; const payments = option?.pricingEvidence?.paymentSchedule;
  const deposits = Array.isArray(payments) ? payments.filter(value => value.paymentKind === 'deposit') : [];
  if (deposits.length !== 1) return unavailable('deposit_terms_unavailable', [
    'mission24.exact_accepted_deposit_schedule',
  ]);
  const amount = exactMinor(deposits[0].amount); const total = exactMinor(option.totalBeforeTax);
  if (amount <= 0n || amount > DEPOSIT_MAXIMUM || amount * 2n > total) {
    return unavailable('deposit_terms_out_of_bounds', ['launch.deposit.amount_and_percent_bounds']);
  }
  const mode = controlFor(amount);
  if (!mode) return unavailable('billable_amount_out_of_bounds', ['launch.billable_work.maximum']);
  const commercialDigest = commercialSourceDigest(basis);
  const source = {
    contractVersion: SOURCE_VERSION, sourceClass: PRE_WORK_DEPOSIT,
    estimateId: basis.estimate.id, customerId: basis.estimate.customerId,
    workId: null, sourceIdentity: deposits[0].id,
    sourceDigest: digest({ commercialBasisDigest: commercialDigest, payment: deposits[0] }),
    sourceAuthorityIdentity: basis.mission24.commercialApprovalId,
    sourceAuthorityDigest: basis.mission24.commercialApprovalDigest,
    commercialBasisDigest: commercialDigest, amount: money.verify(deposits[0].amount),
    controlMode: mode, completionClaimed: false, completionInferred: false,
    sourceCurrent: true, reasonRequired: true,
  };
  return Object.freeze({ contractVersion: CONTRACT_VERSION, state: 'review_required',
    source: Object.freeze({ ...source, decisionDigest: digest(source) }),
    financialActionAuthorized: false, invoiceAuthorized: false,
    providerCallCount: 0, receiverMutationCount: 0 });
}
function candidate(sourceClass, evidence) {
  if (sourceClass === FINAL_BALANCE) return finalBalance(evidence);
  if (sourceClass === PRE_WORK_DEPOSIT) return preWorkDeposit(evidence);
  if (sourceClass === MILESTONE) return unavailable('milestone_authority_unsupported', [
    'mission23.accepted_milestone_or_work_package_authority',
  ]);
  return unavailable('billable_source_class_unsupported', ['launch.supported_billable_source_class']);
}

module.exports = { CONTRACT_VERSION, SOURCE_VERSION, FINAL_BALANCE, PRE_WORK_DEPOSIT, MILESTONE,
  MAXIMUM, SINGLE_CONTROL_MAXIMUM, DEPOSIT_MAXIMUM, digest, unavailable, candidate,
  finalBalance, preWorkDeposit, controlFor, commercialSourceDigest };
