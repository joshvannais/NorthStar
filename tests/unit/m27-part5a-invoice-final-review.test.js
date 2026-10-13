'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/invoiceFinalReview');
const repository = require('../../src/customerFinancial/invoiceFinalReviewRepository');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const ORG = '55555555-5555-4555-8555-555555555555';
const DIGEST = 'a'.repeat(64);

describe('Mission 27 Part 5A invoice final-review boundary', () => {
  test('returns the frozen first failed prerequisite value-free', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value.state).toBe('unavailable');
    expect(value.reason).toBe('recent_auth_mfa_unavailable');
    expect(value.value).toBeNull();
    expect(value.requiredCapability).toBe('customer_financial.invoice.approve');
    expect(value.requiredAssurance).toBe('recent_auth_mfa');
    expect(value.missingEvidence.map(item => item.reason)).toEqual([
      'recent_auth_fact_unavailable', 'mfa_authority_unavailable',
      'invoice_due_terms_policy_unavailable', 'invoice_delivery_choice_policy_unavailable',
      'invoice_reconciliation_evidence_unavailable',
    ]);
    expect(value.approvalAuthorized).toBe(false);
    expect(value.invoiceAuthorized).toBe(false);
    expect(value.issueAuthorized).toBe(false);
    expect(value.providerCallCount).toBe(0);
    const serialized = JSON.stringify(value);
    ['customerId','workId','amount','minorUnits','draftDigest','receiptId','deliveryChoice']
      .forEach(privateKey => expect(serialized).not.toContain(`\"${privateKey}\"`));
  });

  test('revalidates the accepted database-owned preview but discards it', async () => {
    const spy = jest.spyOn(require('../../src/customerFinancial/invoiceDraftPreviewRepository'), 'read');
    // The repository captured the dependency at module load, so replace its implementation in place.
    spy.mockResolvedValue({ state: 'current', customerId: ACTOR, amount: { minorUnits: '9999' },
      previewDigest: DIGEST });
    const value = await repository.read({}, { organizationId: ORG, actorUserId: ACTOR,
      actorAccessRole: 'owner', authSessionId: SESSION }, ESTIMATE, RECEIPT, DIGEST);
    expect(spy).toHaveBeenCalledWith({}, expect.any(Object), ESTIMATE, RECEIPT, DIGEST);
    expect(value).toEqual(contract.unavailable());
    expect(JSON.stringify(value)).not.toContain('9999');
    spy.mockRestore();
  });

  test('mounts only a guarded no-store read and no approval action', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    expect(route).toContain("router.get('/:estimateId/invoice-final-review', auth, role, throttle");
    expect(route).not.toContain("router.post('/:estimateId/invoice-final-review'");
    const block = route.slice(route.indexOf("router.get('/:estimateId/invoice-final-review'"),
      route.indexOf("router.post('/:estimateId/invoice-draft/workflow-capability'"));
    expect(block).toContain("res.set('Cache-Control','no-store'); res.vary('Cookie');");
    expect(block).toContain("keys.length !== 2");
    expect(block).toContain("keys.includes('handoffReceiptId')");
    expect(block).toContain("keys.includes('handoffReceiptDigest')");
    expect(block).toContain('invoiceFinalReviewRead(poolProvider()');
  });

  test('keeps the frozen authority honest and adds no migration 273', () => {
    const threat = read('docs/architecture/MISSION_27_PART1C_THREAT_AND_CAPABILITY_MATRIX.md');
    const policy = JSON.parse(read('config/mission27-launch-contract.v1.json'));
    const architecture = read('docs/architecture/MISSION_27_PART5A_INVOICE_FINAL_REVIEW.md');
    expect(threat).toContain('Current code has no accepted recent-auth/MFA fact');
    expect(policy.actionControl['customer_financial.invoice.approve'].mode)
      .toBe('conditional_dual_control');
    expect(policy.team.mfaFreshnessSeconds).toBe(600);
    expect(architecture).toContain('Session creation, `last_used_at`, email verification, role and browser claims do not satisfy');
    expect(architecture).toContain('There is no final-review mutation route');
    const names=fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(names.some(name=>/^273_/.test(name))).toBe(false);
  });
});
