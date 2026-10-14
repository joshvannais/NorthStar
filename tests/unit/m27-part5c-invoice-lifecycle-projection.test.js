'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/invoiceLifecycleProjection');
const repository = require('../../src/customerFinancial/invoiceLifecycleProjectionRepository');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const ORG = '55555555-5555-4555-8555-555555555555';
const DIGEST = 'a'.repeat(64);

describe('Mission 27 Part 5C invoice lifecycle projection', () => {
  test('retains all orthogonal axes and never turns unavailable evidence into zero', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion:'m27-invoice-lifecycle-projection-v1', state:'unavailable',
      reason:'issued_invoice_unavailable', value:null, issuedInvoiceCurrent:false,
      trustedClockEvaluated:false, reminderAuthorized:false, feeAuthorized:false,
      collectionAuthorized:false, automaticChargeAuthorized:false,
      providerCallCount:0, receiverMutationCount:0,
    });
    expect(value.axes.map(axis => axis.axis)).toEqual(contract.AXIS_ORDER);
    expect(value.axes.every(axis => axis.state === 'unavailable' &&
      axis.reason === 'issued_invoice_unavailable' && axis.value === null)).toBe(true);
    expect(value.display).toEqual({
      policyVersion:'m27-invoice-lifecycle-display-precedence-v1',
      precedence:contract.AXIS_ORDER, primaryAxis:'documentRevision',
      primaryState:'unavailable', primaryReason:'issued_invoice_unavailable',
      everyAxisRetained:true,
    });
    expect(value.axes.find(axis=>axis.axis==='disputeRefund').missingEvidence)
      .toEqual(['dispute_action_unsupported','refund_unavailable']);
    expect(value.axes.find(axis=>axis.axis==='settlement').missingEvidence)
      .toEqual(['settlement_unavailable']);
    expect(value.axes.find(axis=>axis.axis==='accountingHandoff').missingEvidence)
      .toEqual(['accounting_adapter_unavailable']);
    expect(JSON.stringify(value)).not.toMatch(
      /customerId|workId|minorUnits|amount|currency|documentNumber|dueDate|invoiceDigest|receiptId/);
  });

  test('applies roadmap-order display precedence without removing any axis', () => {
    const axes = contract.AXIS_ORDER.map(axis => ({ axis, state:'current', reason:null }));
    axes[3] = { axis:'dueAging', state:'unavailable', reason:'issued_due_date_unavailable' };
    axes[5] = { axis:'settlement', state:'unavailable', reason:'settlement_unavailable' };
    const display = contract.selectDisplay(axes);
    expect(display).toEqual({
      policyVersion:'m27-invoice-lifecycle-display-precedence-v1',
      precedence:contract.AXIS_ORDER, primaryAxis:'dueAging', primaryState:'unavailable',
      primaryReason:'issued_due_date_unavailable', everyAxisRetained:true,
    });
    expect(axes).toHaveLength(7);
    expect(contract.selectDisplay(axes.map(axis=>({ ...axis, state:'current', reason:null }))))
      .toMatchObject({primaryAxis:null,primaryState:'current',primaryReason:null,
        everyAxisRetained:true});
    expect(()=>contract.selectDisplay(axes.slice(1))).toThrow('Invoice lifecycle axes invalid');
  });

  test('revalidates sealed Part 5B before returning the value-free projection', async () => {
    const issueReadinessRepository = require('../../src/customerFinancial/invoiceIssueReadinessRepository');
    const spy = jest.spyOn(issueReadinessRepository, 'read').mockResolvedValue(
      require('../../src/customerFinancial/invoiceIssueReadiness').unavailable());
    const value = await repository.read({}, { organizationId:ORG, actorUserId:ACTOR,
      actorAccessRole:'owner', authSessionId:SESSION }, ESTIMATE, RECEIPT, DIGEST);
    expect(spy).toHaveBeenCalledWith({}, expect.any(Object), ESTIMATE, RECEIPT, DIGEST);
    expect(value).toEqual(contract.unavailable());
    spy.mockRestore();
  });

  test('fails closed for invalid references or a non-exact Part 5B boundary', async () => {
    await expect(repository.read({}, {}, 'not-an-estimate', RECEIPT, DIGEST))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_INVOICE_LIFECYCLE_INVALID',status:400});
    const issueReadinessRepository = require('../../src/customerFinancial/invoiceIssueReadinessRepository');
    const malformed = { ...require('../../src/customerFinancial/invoiceIssueReadiness').unavailable(),
      numberAssigned:true };
    const spy = jest.spyOn(issueReadinessRepository, 'read').mockResolvedValue(malformed);
    await expect(repository.read({}, { organizationId:ORG, actorUserId:ACTOR,
      actorAccessRole:'owner', authSessionId:SESSION }, ESTIMATE, RECEIPT, DIGEST))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_INVOICE_LIFECYCLE_UNAVAILABLE',status:503});
    spy.mockRestore();
  });

  test('mounts one guarded no-store read, no lifecycle mutation and no migration 273', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    expect(route).toContain("router.get('/:estimateId/invoice-lifecycle', auth, role, throttle");
    expect(route).not.toContain("router.post('/:estimateId/invoice-lifecycle'");
    const start = route.indexOf("router.get('/:estimateId/invoice-lifecycle'");
    const end = route.indexOf("router.post('/:estimateId/invoice-draft/workflow-capability'", start);
    const block = route.slice(start, end);
    expect(block).toContain("res.set('Cache-Control','no-store'); res.vary('Cookie');");
    expect(block).toContain("keys.length !== 2");
    expect(block).toContain("keys.includes('handoffReceiptId')");
    expect(block).toContain("keys.includes('handoffReceiptDigest')");
    expect(block).toContain('invoiceLifecycleProjectionRead(poolProvider()');
    const names=fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(names.some(name=>/^273_/.test(name))).toBe(false);
  });
});
