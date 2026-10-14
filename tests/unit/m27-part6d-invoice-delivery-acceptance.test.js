'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/invoicePart6Acceptance');
const part5Contract = require('../../src/customerFinancial/invoicePart5Acceptance');
const portalContract = require('../../src/customerFinancial/invoiceCustomerPortal');
const demo = require('../../src/customerFinancial/demoInvoicePart6Acceptance');
const demoPart5 = require('../../src/customerFinancial/demoInvoicePart5Acceptance');
const workspace = require('../../src/commandCenter/workspace');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);

function demoItem() {
  const tenant = '44444444-4444-4444-8444-444444444444';
  const state = workspace.createInitialDemoState(tenant, new Date('2026-10-14T12:00:00Z'),
    { seed: 'part6d-delivery' });
  const view = workspace.buildDemoWorkspace({ tenantId:tenant, sessionId:ESTIMATE, state, revision:1,
    simulationCount:0, persisted:true, expiresAt:new Date('2026-10-15T12:00:00Z') });
  return workspace.demoCanonicalItems(view)[0];
}

describe('Mission 27 Part 6D complete delivery and portal acceptance', () => {
  test.each(['paid','demo'])('strictly composes every value-free Part 6 boundary for %s', mode => {
    const item = demoItem();
    const demoBundle = demoPart5.bundle(item,1);
    const part5Bundle = mode === 'demo' ? demoBundle : {
      contractVersion:demoBundle.contractVersion,
      preview:{...demoBundle.preview,mode:'paid',fictional:false,
        documentPreview:{...demoBundle.preview.documentPreview,fictional:false},
        previewDigest:'b'.repeat(64)},
      acceptance:{...demoBundle.acceptance,mode:'paid',fictional:false,
        previewWitness:{...demoBundle.acceptance.previewWitness,mode:'paid',previewDigest:'b'.repeat(64)}} };
    const value = contract.unavailable(mode,part5Bundle.acceptance.previewWitness);
    expect(contract.project(JSON.parse(JSON.stringify(value)),mode)).toEqual(value);
    expect(value).toMatchObject({contractVersion:'m27-invoice-part6-acceptance-v1',
      state:'unavailable',reason:'issued_invoice_unavailable',mode,fictional:mode==='demo',
      exactCurrentnessRevalidated:true,exactDocumentCurrent:false,recipientReviewed:false,
      explicitDeliveryChoiceCurrent:false,invoiceSendCapabilityCurrent:false,
      recentAuthenticationCurrent:false,customerSessionCurrent:false,
      emailDeliveryAuthorized:false,smsDeliveryAuthorized:false,resendAuthorized:false,
      revocationAuthorized:false,recoveryAuthorized:false,mission28HandoffAuthorized:false,
      messageSent:false,deliveryReceiptCreated:false,accessRevocationRecorded:false,
      automaticSendAuthorized:false,automaticRetryAuthorized:false,
      providerCallCount:0,receiverMutationCount:0,outboundMessageCount:0});
    expect(value.delivery.actions.map(row=>[row.action,row.state,row.authorized,row.value])).toEqual([
      ['email_delivery_handoff','unavailable',false,null],
      ['sms_delivery_handoff','unavailable',false,null],
      ['resend','unavailable',false,null],
      ['revoke_customer_access','unavailable',false,null],
      ['delivery_recovery','unavailable',false,null],
      ['mission28_broader_communication_handoff','unavailable',false,null],
    ]);
    expect(value.delivery.requirements).toEqual([
      { requirement:'exact_current_issued_document',state:'unavailable' },
      { requirement:'reviewed_recipient_and_delivery_choice',state:'unavailable' },
      { requirement:'customer_financial_invoice_send_capability',state:'unavailable' },
      { requirement:'recent_auth_and_required_control',state:'unavailable' },
      { requirement:'exact_delivery_idempotency',state:'unavailable' },
      { requirement:'delivery_evidence_receipt',state:'unavailable' },
      { requirement:'scoped_customer_access_revocation',state:'unavailable' },
      { requirement:'mission28_broader_communication_adapter',state:'unavailable' },
    ]);
    expect(value.document.state).toBe('unavailable');
    expect(value.publicSession.state).toBe('unavailable');
    expect(value.customerPortal.state).toBe('unavailable');
    expect(JSON.stringify(value)).not.toMatch(
      /"(?:customerId|workId|minorUnits|currency|documentNumber|dueDate|invoiceDigest|receiptId|rawToken|tokenHash|recipient|phone|email)"\s*:/);
    const bundle = contract.bundle(part5Bundle,value);
    expect(contract.projectBundle(JSON.parse(JSON.stringify(bundle)),mode)).toEqual(bundle);
    expect(() => contract.project({...value,messageSent:true},mode)).toThrow();
    expect(() => contract.project({...value,delivery:{...value.delivery,
      requirements:value.delivery.requirements.slice(0,-1)}},mode)).toThrow();
    expect(() => contract.project({...value,delivery:{...value.delivery,
      requirements:value.delivery.requirements.map((row,index)=>index===4?
        {...row,requirement:'caller_claimed_idempotency'}:row)}},mode)).toThrow();
    expect(() => contract.bundle(part5Bundle,{...value,previewWitness:{...value.previewWitness,
      previewDigest:'c'.repeat(64)}})).toThrow();
  });

  test('revalidates the full paid chain before and after the customer-portal boundary', async () => {
    const item = demoItem();
    const demoBundle = demoPart5.bundle(item,1);
    const paidPreview = {...demoBundle.preview,mode:'paid',fictional:false,
      documentPreview:{...demoBundle.preview.documentPreview,fictional:false},previewDigest:'b'.repeat(64)};
    const paidPart5 = part5Contract.unavailable('paid',paidPreview);
    const paidBundle = part5Contract.bundle(paidPreview,paidPart5);
    const part5Repository = require('../../src/customerFinancial/invoicePart5AcceptanceRepository');
    const portalRepository = require('../../src/customerFinancial/invoiceCustomerPortalRepository');
    const part5Spy = jest.spyOn(part5Repository,'readBundle').mockResolvedValue(paidBundle);
    const portalSpy = jest.spyOn(portalRepository,'read')
      .mockResolvedValue(portalContract.unavailable('paid'));
    const repository = require('../../src/customerFinancial/invoicePart6AcceptanceRepository');
    const source={organizationId:ESTIMATE,actorUserId:RECEIPT,actorAccessRole:'owner',
      authSessionId:'33333333-3333-4333-8333-333333333333'};
    await expect(repository.readBundle({},source,ESTIMATE,RECEIPT,DIGEST)).resolves.toEqual(
      contract.bundle(paidBundle,contract.unavailable('paid',paidPart5.previewWitness)));
    expect(part5Spy).toHaveBeenCalledTimes(2);
    expect(portalSpy).toHaveBeenCalledWith({},source,ESTIMATE,RECEIPT,DIGEST);
    part5Spy.mockReset().mockResolvedValueOnce(paidBundle).mockResolvedValueOnce({
      ...paidBundle,preview:{...paidPreview,previewDigest:'c'.repeat(64)},
      acceptance:{...paidPart5,previewWitness:{...paidPart5.previewWitness,
        previewDigest:'c'.repeat(64)}}});
    await expect(repository.readBundle({},source,ESTIMATE,RECEIPT,DIGEST))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_INVOICE_PART6_CHANGED',status:409});
    part5Spy.mockRestore(); portalSpy.mockRestore();
  });

  test('builds the fictional bundle from one isolated demo-workspace revision', () => {
    const item=demoItem(), current=demoPart5.bundle(item,1);
    expect(demo.bundle(item,1)).toEqual(contract.bundle(current,
      contract.unavailable('demo',current.acceptance.previewWitness)));
    expect(() => demo.bundle({source:{type:'paid'}},1)).toThrow();
  });

  test('mounts one atomic private acceptance read and no delivery mutation or migration 273', () => {
    const paid=read('src/routes/customerFinancialEditableEstimate.js');
    const demoRoute=read('src/routes/demo.js');
    const ui=read('public/js/customer-financial-invoice-preview.js');
    expect(paid).toContain("router.get('/:estimateId/invoice-part6-acceptance', auth, role, throttle");
    expect(paid).not.toContain("router.post('/:estimateId/invoice-part6-acceptance'");
    expect(demoRoute).toContain("router.get('/customer-financial/invoice-drafts/:estimateId/part6-acceptance'");
    expect(demoRoute).not.toContain("router.post('/customer-financial/invoice-drafts/:estimateId/part6-acceptance'");
    expect(ui).toContain("'/invoice-part6-acceptance?");
    expect(ui).toContain("'/part6-acceptance'");
    expect(ui).toContain('function invalidPart6(value)');
    expect(ui).toContain("value.contractVersion !== 'm27-invoice-part6-preview-bundle-v1'");
    expect(ui).toContain('Customer document, portal, and delivery');
    expect(ui).toContain('Eight required delivery prerequisites');
    for (const requirement of contract.REQUIREMENTS) expect(ui).toContain(requirement.requirement);
    expect(ui).not.toMatch(/button[^\n]*(?:send|resend|revoke|deliver invoice)/i);
    const mountedBrowser=read('tests/browser/m27-part5e-mounted-acceptance.js');
    expect(mountedBrowser).not.toMatch(/window\.fetch\s*=/);
    expect(mountedBrowser).not.toMatch(/\.route\(|route\.fulfill|route\.continue/);
    const source=[read('src/customerFinancial/invoicePart6Acceptance.js'),
      read('src/customerFinancial/invoicePart6AcceptanceRepository.js'),
      read('src/customerFinancial/demoInvoicePart6Acceptance.js')].join('\n');
    expect(source).not.toMatch(/INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|fetch\(|axios/i);
    const names=fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(names.some(name=>/^273_/.test(name))).toBe(false);
  });
});
