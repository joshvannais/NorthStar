'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/invoiceCustomerPortal');
const demo = require('../../src/customerFinancial/demoInvoiceCustomerPortal');
const workspace = require('../../src/commandCenter/workspace');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);

function demoItem() {
  const tenant = '44444444-4444-4444-8444-444444444444';
  const state = workspace.createInitialDemoState(tenant, new Date('2026-10-14T12:00:00Z'),
    { seed: 'part6c-portal' });
  const view = workspace.buildDemoWorkspace({ tenantId:tenant, sessionId:ESTIMATE, state, revision:1,
    simulationCount:0, persisted:true, expiresAt:new Date('2026-10-15T12:00:00Z') });
  return workspace.demoCanonicalItems(view)[0];
}

describe('Mission 27 Part 6C invoice customer-portal boundary', () => {
  test.each(['paid','demo'])('is strict, value-free and effect-free for %s', mode => {
    const value = contract.unavailable(mode);
    expect(contract.project(JSON.parse(JSON.stringify(value)), mode)).toEqual(value);
    expect(value).toMatchObject({ contractVersion:'m27-invoice-customer-portal-v1',
      state:'unavailable', reason:'issued_invoice_unavailable', mode, fictional:mode === 'demo',
      value:null, exactCurrentnessRevalidated:true, customerSessionCurrent:false,
      recipientVerified:false, customerViewAuthorized:false, downloadAuthorized:false,
      questionSubmissionAuthorized:false, billingDetailCorrectionRequestAuthorized:false,
      deliveryAcknowledgementAuthorized:false, viewAcknowledgementAuthorized:false,
      invoiceMutationAuthorized:false, publicViewMounted:false, publicDownloadMounted:false,
      customerMutationRouteMounted:false, originCsrfProtectionMounted:false,
      questionRecorded:false,billingDetailCorrectionRequestRecorded:false,
      deliveryAcknowledgementRecorded:false,viewAcknowledgementRecorded:false,
      privateFieldValuesExposed:false,thirdPartyContentIncluded:false,rawTokenReturned:false,
      providerCallCount:0, receiverMutationCount:0 });
    expect(value.requirements.map(row=>[row.requirement,row.state])).toEqual([
      ['exact_current_invoice_public_session','unavailable'],
      ['part1_recipient_verification_policy','unavailable'],
      ['customer_mutation_origin_csrf_protection','not_mounted'],
    ]);
    expect(value.actions.map(row=>[row.action,row.state,row.authorized,row.value])).toEqual([
      ['view','unavailable',false,null],
      ['download','unavailable',false,null],
      ['question','unavailable',false,null],
      ['billing_detail_correction_request','unavailable',false,null],
      ['delivery_acknowledgement','unavailable',false,null],
      ['view_acknowledgement','unavailable',false,null],
    ]);
    expect(JSON.stringify(value)).not.toMatch(
      /"(?:customerId|workId|minorUnits|currency|documentNumber|dueDate|invoiceDigest|receiptId|rawToken|tokenHash|staff|margin|cost)"\s*:/);
    expect(() => contract.project({ ...value, customerViewAuthorized:true }, mode)).toThrow();
    expect(() => contract.project({ ...value, extra:true }, mode)).toThrow();
    expect(() => contract.unavailable('public')).toThrow();
  });

  test('revalidates and discards the paid Part 6B boundary before returning readiness', async () => {
    const sessionRepository = require('../../src/customerFinancial/invoicePublicSessionRepository');
    const sessionContract = require('../../src/customerFinancial/invoicePublicSession');
    const session = sessionContract.unavailable('paid');
    const spy = jest.spyOn(sessionRepository, 'read').mockResolvedValue(session);
    const validation = jest.spyOn(sessionContract, 'project').mockReturnValue(session);
    const repository = require('../../src/customerFinancial/invoiceCustomerPortalRepository');
    const source = { organizationId:ESTIMATE, actorUserId:RECEIPT, actorAccessRole:'owner',
      authSessionId:'33333333-3333-4333-8333-333333333333' };
    await expect(repository.read({}, source, ESTIMATE, RECEIPT, DIGEST))
      .resolves.toEqual(contract.unavailable('paid'));
    expect(spy).toHaveBeenCalledWith({}, source, ESTIMATE, RECEIPT, DIGEST);
    expect(validation).toHaveBeenCalledWith(session, 'paid');
    validation.mockImplementationOnce(() => { throw new Error('invalid public-session boundary'); });
    await expect(repository.read({}, source, ESTIMATE, RECEIPT, DIGEST))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_INVOICE_CUSTOMER_PORTAL_UNAVAILABLE',
        status:503});
    spy.mockRestore(); validation.mockRestore();
  });

  test('revalidates the isolated fictional session without paid fallback', () => {
    const item = demoItem();
    expect(demo.project(item,1)).toEqual(contract.unavailable('demo'));
    expect(() => demo.project({source:{type:'paid'}},1)).toThrow();
  });

  test('mounts only private readiness reads and no public or mutation surface', () => {
    const paidRoute = read('src/routes/customerFinancialEditableEstimate.js');
    const demoRoute = read('src/routes/demo.js');
    expect(paidRoute).toContain("router.get('/:estimateId/invoice-customer-portal', auth, role, throttle");
    expect(paidRoute).not.toContain("router.post('/:estimateId/invoice-customer-portal'");
    expect(demoRoute).toContain("router.get('/customer-financial/invoice-drafts/:estimateId/customer-portal'");
    expect(demoRoute).not.toContain("router.post('/customer-financial/invoice-drafts/:estimateId/customer-portal'");
    const source = [read('src/customerFinancial/invoiceCustomerPortal.js'),
      read('src/customerFinancial/invoiceCustomerPortalRepository.js'),
      read('src/customerFinancial/demoInvoiceCustomerPortal.js')].join('\n');
    expect(source).not.toMatch(/INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|Set-Cookie|localStorage|sessionStorage|fetch\(|axios/i);
    expect(read('src/server.js')).not.toMatch(/invoice-customer-portal|invoice-customer-question/);
    const names = fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(names.some(name=>/^273_/.test(name))).toBe(false);
  });
});
