'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createPart4ePaidBrowserFixture } =
  require('../helpers/m27-part4e-paid-journey-fixture');
const contract = require('../../src/customerFinancial/paymentOutcomeReadiness');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 27 Part 9E mounted payment-outcome readiness', () => {
  let prepared; let transport; let route; let query;

  async function completeCurrentPart4() {
    const { fixture, actor, estimate, receipt } = prepared;
    const base = `/api/v1/customer-financial/editable-estimates/${estimate}`;
    query = { handoffReceiptId: receipt.receiptId,
      handoffReceiptDigest: receipt.receiptDigest };
    route = `${base}/payment-outcome-readiness`;
    const capability = await request(fixture.app)
      .post(`${base}/invoice-draft/workflow-capability`).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ confirmed: true,
        confirmationVersion: 'm27-invoice-draft-workflow-capability-v1' });
    expect(capability.status).toBe(200);
    const grant = capability.body.data;
    const adminCapability = await request(fixture.app)
      .post(`${base}/invoice-draft/workflow-capability`)
      .set(fixture.actors.admin.session.headers)
      .set('X-CSRF-Token', fixture.actors.admin.csrfToken)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ confirmed: true,
        confirmationVersion: 'm27-invoice-draft-workflow-capability-v1' });
    expect(adminCapability.status).toBe(200);
    const originRoute = `${base}/invoice-draft-origin`;
    const candidate = await request(fixture.app).get(originRoute).query(query)
      .set(actor.session.headers);
    expect(candidate.status).toBe(200);
    expect(candidate.body.data.state).toBe('ready_to_capture');
    const origin = await request(fixture.app).post(originRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ ...query, capabilityGrantId: grant.grantId,
        capabilityGrantRevision: Number(grant.revision), businessPurpose: grant.businessPurpose,
        policyVersion: grant.policyVersion,
        expectedCandidateDigest: candidate.body.data.candidateDigest,
        reason: 'Owner captured the exact synthetic Part 9E invoice source.', confirmed: true,
        confirmationVersion: 'm27-invoice-draft-origin-capture-v1' });
    expect(origin.status).toBe(201);

    const draftRoute = `${base}/invoice-draft`;
    const baseline = await request(fixture.app).get(draftRoute).query(query)
      .set(actor.session.headers);
    expect(baseline.status).toBe(200);
    const edit = { contractVersion: 'm27-invoice-draft-edit-v1',
      originId: baseline.body.data.originId, originDigest: baseline.body.data.originDigest,
      lines: baseline.body.data.lines.map((line, ordinal) => ({ ordinal,
        sourceLineDigest: line.sourceLineDigest, group: line.group,
        description: ordinal === 0 ? `${line.description} — reviewed for Part 9E` : line.description,
        allocatedMinorUnits: line.allocatedAmount.minorUnits })) };
    const draft = await request(fixture.app).post(draftRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ ...query, capabilityGrantId: grant.grantId,
        capabilityGrantRevision: Number(grant.revision), businessPurpose: grant.businessPurpose,
        policyVersion: grant.policyVersion, expectedRevision: Number(baseline.body.data.revision),
        expectedDraftDigest: baseline.body.data.draftDigest, draft: edit,
        reason: 'Owner reviewed exact wording for the Part 9E outcome boundary.', confirmed: true,
        confirmationVersion: 'm27-invoice-draft-revision-save-v1' });
    expect(draft.status).toBe(201);

    const taxRoute = `${base}/invoice-draft/tax-review`;
    const taxCandidate = await request(fixture.app).get(taxRoute).query(query)
      .set(actor.session.headers);
    expect(taxCandidate.status).toBe(200);
    expect(taxCandidate.body.data.state).toBe('ready_to_record');
    const tax = await request(fixture.app).post(taxRoute).set(actor.session.headers)
      .set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', crypto.randomUUID())
      .send({ ...query, capabilityGrantId: grant.grantId,
        capabilityGrantRevision: Number(grant.revision), businessPurpose: grant.businessPurpose,
        policyVersion: grant.policyVersion,
        expectedCandidateDigest: taxCandidate.body.data.candidateDigest,
        reason: 'Owner reviewed exact synthetic Part 9E tax preparation.', confirmed: true,
        confirmationVersion: 'm27-invoice-date-tax-review-record-v1' });
    expect(tax.status).toBe(201);
  }

  beforeAll(async () => {
    for (const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OPENAI_API_KEY',
      'RETELL_API_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) {
      delete process.env[key];
    }
    transport = jest.spyOn(require('https'), 'request').mockImplementation(() => {
      throw new Error('Provider transport forbidden in Part 9E');
    });
    prepared = await createPart4ePaidBrowserFixture();
    await completeCurrentPart4();
  }, 240000);

  afterAll(async () => {
    try { if (prepared) await prepared.fixture.cleanup(); }
    finally { jest.restoreAllMocks(); }
  }, 180000);

  test('paid owner and administrator receive only the exact value-free outcome projection', async () => {
    const owner = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(owner.status).toBe(200);
    expect(owner.headers['cache-control']).toContain('private');
    expect(owner.headers['cache-control']).toContain('no-store');
    expect(owner.headers.vary).toContain('Cookie');
    expect(owner.body.data).toEqual(JSON.parse(JSON.stringify(contract.unavailable())));
    expect(owner.body.data).toMatchObject({
      contractVersion: 'm27-payment-outcome-readiness-v1',
      state: 'unavailable', reason: 'financial_outcome_source_evidence_unavailable', value: null,
      access: { eligibleAccessRoles: ['owner','admin'],
        roleAloneAuthorizesOutcomeOrWriteOff: false,
        writeOffCapability: 'customer_financial.write_off.record',
        maximumRecentAuthenticationSeconds: 600, maximumMfaFreshnessSeconds: 600,
        maximumIndependentApprovalSeconds: 600 },
      providerOutcomePolicy: { normalizedOutcomeStates: ['failed','canceled','reversed'],
        disputeOutcomeStates: ['dispute_won','dispute_lost'],
        authenticatedProviderEvidenceOnly: true, arrivalOrderAuthorizesOutcome: false,
        failureOrCancellationAuthorizesRetry: false,
        automaticRetryState: 'automatic_payment_retry_unsupported',
        disputeActionState: 'dispute_action_unsupported',
        automaticConcessionOrEvidenceSubmission: false,
        disputeMayAutomaticallyRefundOrWriteOff: false,
        disputeMayContactCustomer: false,
        disputeMayChangeTaxOrRecognizeRevenue: false },
      offlineOutcomePolicy: { receivedCheckState: 'check_clearance_unknown',
        returnedCheckState: 'check_returned', offlineReversalState: 'offline_reversed',
        acceptedReturnSourceRuntimeAvailable: false,
        missingReturnAuthorityState: 'returned_check_authority_unavailable',
        returnReopensOnlyExactPendingAllocation: true,
        nsfFeeState: 'nsf_fee_unsupported', returnFeeEffect: 'none',
        offlineReversalMayClaimPhysicalCashReturn: false,
        checkUnknownMayBecomeClearedCash: false },
      refundSettlementPolicy: { originalSettledCardChargeOnly: true,
        requestIsCompletedRefund: false, providerAcknowledgementIsSettlement: false,
        refundSettlementState: 'settlement_unavailable', missingSettlementMayBecomeZero: false },
      writeOffPolicy: { requiredCapability: 'customer_financial.write_off.record',
        controlMode: 'conditional_dual_control', maximumMinorUnitsPerAction: '1000000',
        singleControlMaximumMinorUnits: '50000',
        aboveSingleControlRequiresTwoDifferentCurrentHumans: true,
        mayChangeTaxOrRevenueRecognition: false, mayMoveProviderOrOfflineMoney: false,
        missingAmountOrBalanceMayBecomeZero: false },
      balanceProjectionPolicy: { failureOrCancellationAloneReopensBalance: false,
        disputeDoesNotEraseOriginalPayment: true,
        returnedCheckReopensOnlyExactPendingAllocation: true,
        refundRequestOrAcknowledgementReopensBalance: false,
        missingOutcomeMayChangeBalance: false, missingAmountMayBecomeZero: false,
        negativeBalanceCreditRevenueAndExpenseRemainSeparate: true },
      projection: { failureState: 'unavailable', cancellationState: 'unavailable',
        returnedOfflinePaymentState: 'returned_check_authority_unavailable',
        nsfFeeState: 'nsf_fee_unsupported', disputeActionState: 'dispute_action_unsupported',
        disputeOutcomeState: 'unavailable', chargebackState: 'unavailable',
        reversalState: 'unavailable', offlineReversalState: 'unavailable',
        refundSettlementState: 'settlement_unavailable', writeOffReviewState: 'unavailable',
        reopenedBalanceState: 'unavailable', outcomeAmountMinorUnits: null,
        providerFeeMinorUnits: null, writeOffAmountMinorUnits: null,
        reopenedBalanceMinorUnits: null },
      outcomeRowCount: 0, disputeRowCount: 0, returnedOfflinePaymentRowCount: 0,
      offlineReversalRowCount: 0, refundSettlementRowCount: 0,
      writeOffReviewRowCount: 0, balanceProjectionRowCount: 0,
      providerCallCount: 0, providerMutationCount: 0, receiverMutationCount: 0,
      accountingMutationCount: 0, liveMoneyMovementCount: 0,
    });
    expect(owner.body.data.axes.map(item => item.axis)).toEqual([
      'paymentFailure', 'paymentCancellation', 'returnedOfflinePayment', 'nsfFee',
      'disputeDeadline', 'disputeFee', 'disputeOutcome', 'chargeback',
      'paymentReversal', 'offlineReversal', 'refundSettlement',
      'badDebtWriteOffReview', 'reopenedBalance',
    ]);
    expect(owner.body.data.axes.every(item => item.value === null && item.accepted === false))
      .toBe(true);
    expect(owner.body.data.requirements).toHaveLength(17);
    expect(owner.body.data.requirements.every(value => value.state === 'unavailable' &&
      value.value === null)).toBe(true);
    expect(Object.values(owner.body.data.authority).every(value => value === false)).toBe(true);
    expect(Object.values(owner.body.data.privacy).every(value => value === false)).toBe(true);
    const mounted = owner.body.data;
    expect(() => contract.project({ ...mounted, axes: [...mounted.axes].reverse() })).toThrow();
    const { offlineOutcomePolicy: _missing, ...missingOffline } = mounted;
    expect(() => contract.project(missingOffline)).toThrow();
    expect(() => contract.project({ ...mounted,
      providerOutcomePolicy: { ...mounted.providerOutcomePolicy,
        disputeOutcomeStates: ['dispute_lost','dispute_won'] } })).toThrow();
    expect(() => contract.project({ ...mounted,
      offlineOutcomePolicy: { ...mounted.offlineOutcomePolicy,
        missingReturnAuthorityState: 'unavailable' } })).toThrow();
    expect(() => contract.project({ ...mounted,
      refundSettlementPolicy: { ...mounted.refundSettlementPolicy,
        providerAcknowledgementIsSettlement: true } })).toThrow();
    expect(() => contract.project({ ...mounted,
      projection: { ...mounted.projection, outcomeAmountMinorUnits: '0' } })).toThrow();
    expect(() => contract.project({ ...mounted,
      authority: { ...mounted.authority, reopenedBalanceAuthorized: true } })).toThrow();
    expect(JSON.stringify(mounted)).not.toMatch(
      /acct_victim|evt_victim|pi_victim|sk_test|customer@example|123 main/i);
    const admin = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.admin.session.headers);
    expect(admin.status).toBe(200); expect(admin.body.data).toEqual(mounted);
    expect(transport).not.toHaveBeenCalled();
  }, 120000);

  test('session, role, tenant, exact query and subscription gates fail closed', async () => {
    expect((await request(prepared.fixture.app).get(route).query(query)).status).toBe(401);
    expect((await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.member.session.headers)).status).toBe(403);
    expect((await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.viewer.session.headers)).status).toBe(403);
    const crossTenant = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.fixture.actors.otherOwner.session.headers);
    expect([403,404,503]).toContain(crossTenant.status);
    expect(JSON.stringify(crossTenant.body)).not.toMatch(
      new RegExp(`${prepared.estimate}|${prepared.receipt.receiptId}`, 'i'));
    expect((await request(prepared.fixture.app).get(route)
      .query({ handoffReceiptId: query.handoffReceiptId })
      .set(prepared.actor.session.headers)).status).toBe(400);
    const widened = await request(prepared.fixture.app).get(route)
      .query({ ...query, providerEventId: 'evt_victim', providerAccountId: 'acct_victim',
        outcome: 'dispute_won', returnCode: 'R01', feeMinorUnits: '3500',
        writeOffMinorUnits: '50000', reopenedBalanceMinorUnits: '50000',
        reason: 'caller supplied outcome' }).set(prepared.actor.session.headers);
    expect(widened.status).toBe(400);
    expect(JSON.stringify(widened.body)).not.toMatch(
      /evt_victim|acct_victim|dispute_won|R01|3500|50000|caller supplied outcome/i);
    expect((await request(prepared.fixture.app).post(route).set(prepared.actor.session.headers)
      .set('X-CSRF-Token', prepared.actor.csrfToken)
      .send({ outcome: 'failed', amountMinorUnits: '0', confirmed: true })).status).toBe(404);
    await prepared.fixture.ownerPool.query(
      "UPDATE subscriptions SET status='canceled',updated_at=clock_timestamp() WHERE organization_id=$1",
      [prepared.fixture.org]);
    expect((await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers)).status).toBe(403);
    await prepared.fixture.ownerPool.query(
      "UPDATE subscriptions SET status='active',updated_at=clock_timestamp() WHERE organization_id=$1",
      [prepared.fixture.org]);
    expect(transport).not.toHaveBeenCalled();
  }, 120000);

  test('reads are deterministic, restart-safe and create no outcome or financial residue', async () => {
    const count = async () => (await prepared.fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM integration_credentials) credentials,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_origins_v1) origins,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_draft_revisions_v1) drafts,
      (SELECT count(*)::int FROM canonical_customer_financial_invoice_tax_reviews_v1) tax_reviews,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND
       (table_name LIKE '%provider%event%' OR table_name LIKE '%event%normal%' OR
        table_name LIKE '%payment%alloc%' OR table_name LIKE '%balance%projection%' OR
        table_name LIKE '%settlement%' OR table_name LIKE '%payout%' OR
        table_name LIKE '%payment%attempt%' OR table_name LIKE '%unapplied%credit%' OR
        table_name LIKE '%refund%review%' OR table_name LIKE '%deposit%application%' OR
        table_name LIKE '%credit%note%' OR table_name LIKE '%refund%request%' OR
        table_name LIKE '%provider%acknowledgement%' OR table_name LIKE '%offline%payment%' OR
        table_name LIKE '%offline%receipt%' OR table_name LIKE '%cash%receipt%' OR
        table_name LIKE '%check%receipt%' OR table_name LIKE '%dispute%' OR
        table_name LIKE '%chargeback%' OR table_name LIKE '%write%off%' OR
        table_name LIKE '%payment%reversal%' OR table_name LIKE '%payment%outcome%'))
        part8_and_part9_tables`)).rows[0];
    const before = await count();
    const first = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    const second = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(first.status).toBe(200); expect(second.body.data).toEqual(first.body.data);
    expect(await count()).toEqual(before);
    expect(await prepared.fixture.db.initDatabase()).toBe(true);
    const restarted = await request(prepared.fixture.app).get(route).query(query)
      .set(prepared.actor.session.headers);
    expect(restarted.status).toBe(200); expect(restarted.body.data).toEqual(first.body.data);
    expect(await count()).toEqual(before);
    expect((await prepared.fixture.ownerPool.query(
      "SELECT count(*)::int count FROM public._migrations WHERE filename LIKE '273_%'"))
      .rows[0].count).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  }, 180000);
});
