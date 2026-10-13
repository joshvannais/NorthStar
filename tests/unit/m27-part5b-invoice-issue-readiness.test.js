'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/invoiceIssueReadiness');
const repository = require('../../src/customerFinancial/invoiceIssueReadinessRepository');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const ORG = '55555555-5555-4555-8555-555555555555';
const DIGEST = 'a'.repeat(64);

describe('Mission 27 Part 5B invoice issue-readiness boundary', () => {
  test('returns the missing final approval value-free before number assignment', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion: 'm27-invoice-issue-readiness-v1',
      state: 'unavailable', reason: 'final_invoice_approval_unavailable', value: null,
      requiredCapability: 'customer_financial.invoice.issue',
      requiredAssurance: 'recent_auth_mfa', approvalCurrent: false,
      numberReservationAuthorized: false, numberAssigned: false,
      issueReceiptCreated: false, uncertainRetryAvailable: false,
      invoiceAuthorized: false, receivableAuthorized: false,
      providerCallCount: 0, receiverMutationCount: 0,
    });
    expect(value.missingEvidence.map(item => item.reason)).toEqual([
      'final_invoice_approval_unavailable', 'approved_invoice_digest_unavailable',
      'recent_auth_fact_unavailable', 'mfa_authority_unavailable',
      'invoice_issue_capability_unavailable',
    ]);
    const serialized = JSON.stringify(value);
    ['customerId','workId','amount','minorUnits','draftDigest','receiptId','documentNumber','sequence']
      .forEach(privateKey => expect(serialized).not.toContain(`\"${privateKey}\"`));
  });

  test('revalidates sealed Part 5A and performs no issue effect', async () => {
    const finalReviewRepository = require('../../src/customerFinancial/invoiceFinalReviewRepository');
    const spy = jest.spyOn(finalReviewRepository, 'read').mockResolvedValue(
      require('../../src/customerFinancial/invoiceFinalReview').unavailable());
    const value = await repository.read({}, { organizationId: ORG, actorUserId: ACTOR,
      actorAccessRole: 'owner', authSessionId: SESSION }, ESTIMATE, RECEIPT, DIGEST);
    expect(spy).toHaveBeenCalledWith({}, expect.any(Object), ESTIMATE, RECEIPT, DIGEST);
    expect(value).toEqual(contract.unavailable());
    spy.mockRestore();
  });

  test('mounts a guarded no-store readiness read and no issue mutation', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    expect(route).toContain("router.get('/:estimateId/invoice-issue-readiness', auth, role, throttle");
    expect(route).not.toContain("router.post('/:estimateId/invoice-issue'");
    const block = route.slice(route.indexOf("router.get('/:estimateId/invoice-issue-readiness'"),
      route.indexOf("router.post('/:estimateId/invoice-draft/workflow-capability'"));
    expect(block).toContain("res.set('Cache-Control','no-store'); res.vary('Cookie');");
    expect(block).toContain("keys.length !== 2");
    expect(block).toContain("keys.includes('handoffReceiptId')");
    expect(block).toContain("keys.includes('handoffReceiptDigest')");
    expect(block).toContain('invoiceIssueReadinessRead(poolProvider()');
  });

  test('keeps numbering private and adds no migration 273', () => {
    const sql = read('migrations/262_customer_financial_exact_money_numbering_v1.sql');
    const policy = JSON.parse(read('config/mission27-launch-contract.v1.json'));
    const architecture = read('docs/architecture/MISSION_27_PART5B_INVOICE_ISSUE_READINESS.md');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_reserve');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.canonical_customer_financial_numbering_v1_transition');
    expect(policy.actionControl['customer_financial.invoice.issue'].mode)
      .toBe('conditional_dual_control');
    expect(policy.actionControl['customer_financial.invoice.issue'].singleControlAllowedWhen)
      .toContain('exact_current_approved_invoice_digest');
    expect(architecture).toContain('does not accept an issue mutation or an idempotency key');
    const names=fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(names.some(name=>/^273_/.test(name))).toBe(false);
  });
});
