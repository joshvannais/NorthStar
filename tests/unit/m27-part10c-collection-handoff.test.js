'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const providerBoundary = require('../../src/customerFinancial/paymentProviderBoundary');
const collectionReview = require('../../src/customerFinancial/collectionReview');
const contract = require('../../src/customerFinancial/collectionHandoffReadiness');
const repository = require('../../src/customerFinancial/collectionHandoffReadinessRepository');
const { corsOptions } = require('../../src/middleware/security');
const { createCustomerFinancialCollectionHandoffRouter } =
  require('../../src/routes/customerFinancialCollectionHandoff');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const source = Object.freeze({
  organizationId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  actorAccessRole: 'owner',
  authSessionId: '33333333-3333-4333-8333-333333333333',
});

describe('Mission 27 Part 10C reviewed handoff and manual resend readiness', () => {
  test('pins the exact Part 10B witness, access, conditional controls and paths', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({ contractVersion: 'm27-collection-handoff-readiness-v1',
      policyVersion: 'mission27.launch.v1', policyDigest: providerBoundary.POLICY_DIGEST,
      state: 'unavailable', reason: 'receivable_population_incomplete', value: null,
      sourceWitness: { collectionReviewVersion: 'm27-collection-review-v1',
        collectionReviewDigest: providerBoundary.digest(collectionReview.unavailable()),
        reviewState: 'unavailable', reviewReason: 'receivable_population_incomplete',
        receivablePopulationComplete: false, selectedNextStep: null,
        reviewRevision: null, reviewDigest: null },
      access: { tenantPrivate: true, eligibleAccessRoles: ['owner','admin'],
        collectionCapability: 'customer_financial.collection.action',
        manualResendAdditionalCapability: 'customer_financial.invoice.send',
        roleAloneAuthorizes: false, requiredAssurance: 'recent_auth_mfa',
        maximumRecentAuthenticationSeconds: 600, maximumMfaFreshnessSeconds: 600,
        maximumIndependentApprovalSeconds: 600 } });
    expect(value.pathOrder).toEqual([
      'mission28_reviewed_reminder_handoff','manual_payment_link_resend',
    ]);
    expect(value.controlPolicy).toMatchObject({ mode: 'conditional_dual_control',
      singleControlMaximumMinorUnits: '1000000', maximumMinorUnits: '10000000',
      aboveSingleControlRequiresTwoDifferentCurrentHumans: true,
      externalExecutionAuthority: 'mission28_only',
      manualResendControlMode: 'conditional_dual_control',
      manualResendSingleControlMaximumMinorUnits: '1000000',
      manualResendMaximumMinorUnits: '10000000' });
  });

  test('freezes the reviewed Mission 28 handoff without granting communication', () => {
    const value = contract.unavailable();
    expect(value.controlPolicy.mission28SingleControlAllowedWhen).toEqual([
      'collectible_balance_minor_units_lte_1000000',
      'exact_current_invoice_version_and_recipient',
      'current_due_dispute_and_pending_tender_axes', 'message_preview',
      'idempotency_and_cooldown', 'current_receiving_adapter',
    ]);
    expect(value.mission28ReminderHandoff).toMatchObject({
      selectedNextStepValue: 'request_mission28_reviewed_handoff',
      state: 'unavailable', reason: 'mission28_handoff_unavailable', value: null,
      adapter: 'mission28.collections_reviewed_handoff.v1',
      reviewedHandoffContractSupported: true, currentReceivingAdapterAvailable: false,
      mission27MayExecuteCommunication: false, automaticExecutionSupported: false,
    });
    expect(value.mission28ReminderHandoff.orderedRequirements.map(x => x.requirement)).toEqual([
      'explicit_next_step_request_mission28_reviewed_handoff',
      'collectible_balance_minor_units_lte_1000000',
      'exact_current_invoice_version_and_recipient',
      'current_due_dispute_and_pending_tender_axes', 'exact_message_preview',
      'exact_idempotency_and_cooldown', 'current_receiving_adapter',
      'recent_authentication_mfa_and_required_control',
    ]);
    expect(value.mission28ReminderHandoff.orderedRequirements
      .every(x => x.state === 'unavailable' && x.value === null)).toBe(true);
  });

  test('freezes a distinct founder-ratified human resend contract and never reuses checkout', () => {
    const value = contract.unavailable();
    expect(value.manualPaymentLinkResend).toMatchObject({
      selectedNextStepValue: 'request_manual_payment_link_resend',
      state: 'unavailable', reason: 'issued_invoice_unavailable', value: null,
      humanTriggeredOnly: true, founderRatificationRequired: true,
      currentFounderRatificationState: 'unavailable',
      existingCustomerStartedExactCheckoutRequired: true,
      currentExactCustomerStartedLinkMayBeRedeliveredOnlyAfterAllGates: true,
      terminalExpiredOrSupersededProviderSessionMayBeReused: false,
      newCheckoutMayBeCreatedByStaff: false,
      customerMayExplicitlyStartNewExactCheckoutAfterTerminalAttempt: true,
      automaticRetryOrResendSupported: false,
    });
    expect(value.manualPaymentLinkResend.orderedRequirementNames).toEqual([
      'explicit_next_step_request_manual_payment_link_resend',
      'founder_ratified_human_triggered_resend_policy',
      'exact_current_issued_invoice_version_and_document',
      'exact_current_customer_started_hosted_checkout_link',
      'one_reviewed_recipient_and_delivery_choice', 'exact_message_preview',
      'current_collection_action_and_invoice_send_capabilities',
      'current_balance_due_dispute_refund_and_pending_tender_axes',
      'recent_authentication_mfa_and_required_control',
      'exact_idempotency_and_cooldown_state', 'current_delivery_authority',
      'immutable_delivery_evidence_receipt',
    ]);
    expect(value.manualPaymentLinkResend.orderedRequirements.map(x => x.requirement))
      .toEqual(value.manualPaymentLinkResend.orderedRequirementNames);
  });

  test('pins preview, idempotency, cooldown and delivery evidence without raw link data', () => {
    const value = contract.unavailable();
    expect(value.messagePreviewPolicy.requiredFields).toEqual([
      'previewVersion','issuedInvoiceIdentity','issuedInvoiceVersionDigest',
      'recipientEvidenceDigest','deliveryChoice','subject','body',
      'hostedCheckoutSessionDigest','createdAt','expiresAt','digest',
    ]);
    expect(value.messagePreviewPolicy).toMatchObject({
      exactServerValidatedPreviewRequired: true,
      exactCurrentInvoiceRecipientAndLinkSessionRequired: true,
      rawLinkTokenOrProviderSecretMayBeExposedOrRetained: false,
      previewMaySubstituteForDeliveryAuthority: false, currentPreview: null,
    });
    expect(value.idempotencyAndCooldownPolicy).toMatchObject({
      exactIdempotencyKeyBoundToRequestDigestRequired: true,
      exactPriorAttemptStateAndTrustedClockRequired: true,
      currentCooldownPolicyVersionRequired: true, missingOrUnknownCooldownDenies: true,
      changedInvoiceRecipientPreviewPathOrAmountRequiresNewRequest: true,
      exactReplayMayExceedOriginalRequest: false,
      cooldownMayBeBypassedByRoleOrRetry: false, currentIdempotencyKey: null,
      currentRequestDigest: null, currentCooldownPolicyVersion: null,
      currentCooldownEvaluatedAt: null, currentNextEligibleAt: null,
    });
    expect(value.receiptPolicy).toMatchObject({ appendOnly: true,
      exactRequestAndDeliveryEvidenceMustRemainSeparate: true,
      receiverAcceptanceIsDeliveryEvidence: false, queuedStateIsDeliveryEvidence: false,
      missingOrUnknownDeliveryEvidenceMayBePresentedAsDelivered: false,
      actionReceipt: null, deliveryEvidence: null });
  });

  test('keeps every private value and external, financial or communication effect absent', () => {
    const value = contract.unavailable();
    expect(Object.values(value.authority).every(x => x === false)).toBe(true);
    expect(Object.values(value.privacy).every(x => x === false)).toBe(true);
    expect(Object.values(value.projection).every(x => x === null)).toBe(true);
    expect(value).toMatchObject({ requestContextCurrentnessRevalidated: true,
      collectionReviewCurrentnessRevalidated: false, handoffRequestRowCount: 0,
      manualResendRequestRowCount: 0, actionReceiptRowCount: 0,
      deliveryEvidenceRowCount: 0, outboundMessageCount: 0, providerCallCount: 0,
      providerMutationCount: 0, receiverMutationCount: 0, accountingMutationCount: 0,
      liveMoneyMovementCount: 0 });
    expect(JSON.stringify(value)).not.toMatch(
      /11111111-1111|22222222-2222|customer@example|https:\/\/pay|client_secret|acct_|pi_/i);
  });

  test('rejects stale, missing, reordered, contradictory, leaked and widened contracts', () => {
    const value = contract.unavailable();
    expect(() => contract.project({ ...value, sourceWitness: { ...value.sourceWitness,
      collectionReviewDigest: '0'.repeat(64) } })).toThrow('Collection-handoff boundary invalid');
    expect(() => contract.project({ ...value,
      pathOrder: [...value.pathOrder].reverse() })).toThrow();
    expect(() => contract.project({ ...value,
      mission28ReminderHandoff: { ...value.mission28ReminderHandoff,
        currentReceivingAdapterAvailable: true } })).toThrow();
    expect(() => contract.project({ ...value,
      manualPaymentLinkResend: { ...value.manualPaymentLinkResend,
        currentFounderRatificationState: 'ratified' } })).toThrow();
    expect(() => contract.project({ ...value,
      idempotencyAndCooldownPolicy: { ...value.idempotencyAndCooldownPolicy,
        cooldownMayBeBypassedByRoleOrRetry: true } })).toThrow();
    expect(() => contract.project({ ...value, projection: { ...value.projection,
      recipientEvidenceDigest: 'customer@example.test' } })).toThrow();
    expect(() => contract.project({ ...value, authority: { ...value.authority,
      manualPaymentLinkResendAuthorized: true } })).toThrow();
    const { receiptPolicy: _receipt, ...missing } = value;
    expect(() => contract.project(missing)).toThrow();
  });

  test('repository binds exact Part 10B source and route rejects widening before source entry', async () => {
    const sourceRead = jest.fn().mockResolvedValue(collectionReview.unavailable());
    await expect(repository.read(source, { readCollectionReview: sourceRead }))
      .resolves.toEqual(contract.unavailable());
    expect(sourceRead).toHaveBeenCalledWith(source);
    const malformedRead = jest.fn().mockResolvedValue({ ...collectionReview.unavailable(),
      nextStepSelectionRowCount: 1 });
    await expect(repository.read(source, { readCollectionReview: malformedRead }))
      .rejects.toMatchObject({ code: 'CUSTOMER_FINANCIAL_COLLECTION_HANDOFF_UNAVAILABLE',
        status: 503 });

    const repositoryRead = jest.fn().mockResolvedValue(contract.unavailable());
    const app = express();
    app.use((req,_res,next) => { req.tenantContext = { organizationId: source.organizationId,
      userId: source.actorUserId }; req.userRole = 'owner';
      req.authSession = { id: source.authSessionId }; next(); });
    app.use('/api/v1/customer-financial/collection-handoff',
      createCustomerFinancialCollectionHandoffRouter({ read: repositoryRead,
        auth: (_req,_res,next) => next(), role: (_req,_res,next) => next(),
        throttle: (_req,_res,next) => next() }));
    const widened = await request(app).get('/api/v1/customer-financial/collection-handoff')
      .query({ invoiceId: 'victim', recipient: 'customer@example.test',
        message: 'pay now', link: 'https://pay.example/secret', idempotencyKey: 'replay' });
    expect(widened.status).toBe(400); expect(repositoryRead).not.toHaveBeenCalled();
    expect(JSON.stringify(widened.body)).not.toMatch(/victim|customer@example|pay now|secret|replay/);
    for (const method of ['head','options','post','put','patch','delete']) {
      const response = await request(app)[method]('/api/v1/customer-financial/collection-handoff')
        .query({ path: 'manual_payment_link_resend', recipient: 'customer@example.test' });
      expect(response.status).toBe(405);
      expect(response.headers['cache-control']).toContain('no-store');
    }
    expect(repositoryRead).not.toHaveBeenCalled();
    const response = await request(app).get('/api/v1/customer-financial/collection-handoff');
    expect(response.status).toBe(200); expect(response.body.data).toEqual(contract.unavailable());
    expect(repositoryRead).toHaveBeenCalledTimes(1);
  });

  test('keeps OPTIONS in method gate and adds no mutation, demo, transport or migration', async () => {
    const resolveOptions = requestPath => new Promise((resolve, reject) => corsOptions({
      path: requestPath, header: () => undefined,
    }, (error, options) => error ? reject(error) : resolve(options)));
    await expect(resolveOptions('/api/v1/customer-financial/collection-handoff')).resolves
      .toMatchObject({ methods: ['GET'], preflightContinue: true });
    await expect(resolveOptions('/api/v1/customer-financial/collection-handoff/')).resolves
      .toMatchObject({ methods: ['GET'], preflightContinue: true });
    const route = read('src/routes/customerFinancialCollectionHandoff.js');
    const sourceCode = [read('src/customerFinancial/collectionHandoffReadiness.js'),
      read('src/customerFinancial/collectionHandoffReadinessRepository.js'), route].join('\n');
    expect(route).toContain("router.all('/', (req, res, next)");
    expect(route).toContain("req.method === 'GET'");
    expect(route).toContain("router.get('/', auth, role, throttle");
    expect(route).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(sourceCode).not.toMatch(/INSERT|UPDATE|DELETE|fetch\(|axios|stripe\./i);
    expect(read('src/routes/demo.js')).not.toContain('customer-financial/collection-handoff');
    expect(read('src/server.js')).toContain(
      "app.use('/api/v1/customer-financial/collection-handoff'");
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrations.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(migrations.some(name => /^273_/.test(name))).toBe(false);
  });
});
