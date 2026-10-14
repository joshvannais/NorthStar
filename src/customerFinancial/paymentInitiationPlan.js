'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const providerConnection = require('./paymentProviderConnection');
const invoicePublicSession = require('./invoicePublicSession');

const CONTRACT_VERSION = 'm27-payment-initiation-plan-v1';
const REASON = 'issued_invoice_unavailable';
const CAPABILITY = 'customer_financial.payment.initiate';

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const rule = launch.actionControl[CAPABILITY];
  const financial = launch.financial;
  const amount = launch.amountPolicy;
  if (rule?.mode !== 'customer_scoped_only' || rule.customerPath?.supported !== true ||
      JSON.stringify(rule.customerPath.requires) !== JSON.stringify([
        'one_exact_current_issued_invoice', 'current_scoped_customer_session',
        'immutable_exact_allocation', 'hosted_checkout',
      ]) || rule.staffPath?.supported !== false ||
      rule.staffPath?.state !== 'staff_payment_initiation_unsupported' ||
      !launch.team.customerSessionCapabilities.includes(CAPABILITY) ||
      !launch.team.ownerDefaultCapabilities.includes(CAPABILITY) ||
      !launch.team.adminDefaultCapabilities.includes(CAPABILITY) ||
      launch.team.memberGrantableCapabilities.includes(CAPABILITY) ||
      financial.checkout !== 'provider_hosted_direct_charge' ||
      financial.supportedCurrency !== 'USD' ||
      JSON.stringify(financial.supportedOnlineMethods) !== JSON.stringify(['card']) ||
      financial.partialProviderPayments !== false ||
      financial.multiInvoiceProviderPayments !== false ||
      financial.savedPaymentMethods !== false || financial.automaticCollection !== false ||
      amount.cardCheckoutMinimumMinorUnits !== '50' ||
      amount.cardCheckoutMaximumMinorUnits !== '10000000' ||
      amount.invoiceMaximumMinorUnits !== '10000000') {
    throw new Error('Payment-initiation launch policy is unavailable');
  }
  return launch;
}

function requirement(requirementName, state, reason) {
  return Object.freeze({ requirement: requirementName, state, reason, value: null });
}

function unavailable(publicSession = invoicePublicSession.unavailable('paid'),
  connection = providerConnection.unavailable()) {
  invoicePublicSession.project(publicSession, 'paid');
  providerConnection.project(connection);
  const launch = policy();
  const action = launch.actionControl[CAPABILITY];
  const financial = launch.financial;
  const amount = launch.amountPolicy;
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sourceWitnesses: Object.freeze({
      invoicePublicSessionContractVersion: publicSession.contractVersion,
      invoicePublicSessionDigest: providerBoundary.digest(publicSession),
      providerConnectionContractVersion: connection.contractVersion,
      providerConnectionDigest: providerBoundary.digest(connection),
    }),
    authority: Object.freeze({
      capability: CAPABILITY,
      actionMode: action.mode,
      customerPathPolicySupported: true,
      customerPathCurrent: false,
      staffPathSupported: false,
      staffPathState: action.staffPath.state,
      ownerOrAdministratorMaySubstituteForCustomerSession: false,
      roleAloneAuthorizes: false,
    }),
    planPolicy: Object.freeze({
      invoiceCount: 'exactly_one',
      partialProviderPaymentsSupported: financial.partialProviderPayments,
      multiInvoiceProviderPaymentsSupported: financial.multiInvoiceProviderPayments,
      currency: financial.supportedCurrency,
      method: financial.supportedOnlineMethods[0],
      checkout: financial.checkout,
      minimumMinorUnits: amount.cardCheckoutMinimumMinorUnits,
      maximumMinorUnits: amount.cardCheckoutMaximumMinorUnits,
      invoiceMaximumMinorUnits: amount.invoiceMaximumMinorUnits,
      amountMustEqualAllocationTotal: true,
      allocationMayExceedCurrentBalance: false,
      missingAmountMayBeTreatedAsZero: false,
      exactZeroInvoiceIsDistinctFromUnavailable: true,
    }),
    requirements: Object.freeze([
      requirement('one_exact_current_issued_invoice', 'unavailable', 'issued_invoice_unavailable'),
      requirement('current_scoped_customer_session', 'unavailable',
        'invoice_public_session_unavailable'),
      requirement('immutable_exact_allocation', 'unavailable', 'issued_balance_unavailable'),
      requirement('current_tenant_provider_connection', 'unavailable',
        'provider_connection_prerequisites_unavailable'),
      requirement('hosted_checkout', 'unavailable', 'provider_connection_prerequisites_unavailable'),
      requirement('exact_amount_currency_invoice_digest', 'unavailable',
        'issued_balance_unavailable'),
      requirement('bounded_expiration', 'not_created', 'payment_plan_not_authorized'),
      requirement('idempotency_receipt', 'not_created', 'payment_plan_not_authorized'),
      requirement('exact_return_and_cancel_boundaries', 'not_created',
        'payment_plan_not_authorized'),
    ]),
    plan: Object.freeze({
      invoiceId: null,
      invoiceVersion: null,
      invoiceDigest: null,
      currentBalanceMinorUnits: null,
      amountMinorUnits: null,
      currency: null,
      allocation: null,
      expiration: null,
      idempotencyKey: null,
      idempotencyReceipt: null,
      providerSessionId: null,
      hostedCheckoutUrl: null,
      returnUrl: null,
      cancelUrl: null,
    }),
    exactCurrentnessRevalidated: true,
    paymentInitiationAuthorized: false,
    providerSessionCreated: false,
    providerReturnAuthorizesPayment: false,
    rawPaymentInstrumentAccepted: false,
    rawPaymentInstrumentStored: false,
    browserProviderSecretExposed: false,
    paymentSuccessRecorded: false,
    settlementRecorded: false,
    providerCallCount: 0,
    providerMutationCount: 0,
    receiverMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw) {
  const expected = unavailable();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Payment-initiation plan boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, CAPABILITY, policy, unavailable, project };
