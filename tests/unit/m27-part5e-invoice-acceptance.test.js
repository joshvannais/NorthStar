'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/invoicePart5Acceptance');
const demo = require('../../src/customerFinancial/demoInvoicePart5Acceptance');
const demoPreview = require('../../src/customerFinancial/demoInvoiceDraftPreview');
const previewContract = require('../../src/customerFinancial/invoiceDraftPreview');
const workspace = require('../../src/commandCenter/workspace');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);

function currentPreview(mode) {
  const tenant='44444444-4444-4444-8444-444444444444';
  const state=workspace.createInitialDemoState(tenant,new Date('2026-10-14T12:00:00Z'),
    {seed:'part5e-acceptance'});
  const view=workspace.buildDemoWorkspace({tenantId:tenant,sessionId:ESTIMATE,state,revision:1,
    simulationCount:0,persisted:true,expiresAt:new Date('2026-10-15T12:00:00Z')});
  const value=demoPreview.project(workspace.demoCanonicalItems(view)[0],1);
  if (mode === 'demo') return value;
  return previewContract.project({ ...value, mode:'paid',fictional:false,
    documentPreview:{...value.documentPreview,fictional:false},previewDigest:'b'.repeat(64) });
}

describe('Mission 27 Part 5E complete invoice acceptance boundary', () => {
  test.each(['paid','demo'])('strictly composes every released Part 5 boundary for %s', mode => {
    const preview=currentPreview(mode);
    const value = contract.unavailable(mode,preview);
    expect(contract.project(JSON.parse(JSON.stringify(value)), mode)).toEqual(value);
    expect(value).toMatchObject({ contractVersion:'m27-invoice-part5-acceptance-v1',
      state:'unavailable',reason:'invoice_issue_authority_unavailable',mode,
      fictional:mode==='demo',exactCurrentnessRevalidated:true,approvalAuthorized:false,
      issueAuthorized:false,reminderAuthorized:false,feeAuthorized:false,
      collectionAuthorized:false,automaticChargeAuthorized:false,correctionAuthorized:false,
      providerCallCount:0,receiverMutationCount:0 });
    expect(value.previewWitness).toEqual({contractVersion:'m27-invoice-part5-preview-witness-v1',
      mode,draftRevision:preview.draftIdentity.revision,draftDigest:preview.draftIdentity.draftDigest,
      previewDigest:preview.previewDigest});
    expect(value.lifecycle.axes).toHaveLength(7);
    expect(value.postIssueCorrection.records.map(record=>record.recordType))
      .toEqual(['credit','debit','replacement','void']);
    expect(JSON.stringify(value)).not.toMatch(
      /"customerId":|"workId":|"minorUnits":|"currency":|"documentNumber":|"dueDate":|"invoiceDigest":|"receiptId":/);
    expect(() => contract.project({ ...value, issueAuthorized:true }, mode)).toThrow();
    expect(() => contract.project({ ...value,previewWitness:{...value.previewWitness,
      previewDigest:'not-a-digest'} },mode)).toThrow();
    expect(() => contract.unavailable(mode,currentPreview(mode === 'paid' ? 'demo' : 'paid'))).toThrow();
    const bundle=contract.bundle(preview,value);
    expect(contract.projectBundle(JSON.parse(JSON.stringify(bundle)),mode)).toEqual(bundle);
    expect(() => contract.bundle({...preview,previewDigest:'c'.repeat(64)},value)).toThrow();
  });

  test('revalidates the full released repository chain before returning paid state', async () => {
    const correctionRepository = require('../../src/customerFinancial/invoicePostIssueCorrectionRepository');
    const previewRepository = require('../../src/customerFinancial/invoiceDraftPreviewRepository');
    const correctionContract = require('../../src/customerFinancial/invoicePostIssueCorrection');
    const spy = jest.spyOn(correctionRepository, 'read').mockResolvedValue(correctionContract.unavailable());
    const preview=currentPreview('paid');
    const previewSpy=jest.spyOn(previewRepository,'read').mockResolvedValue(preview);
    const repository = require('../../src/customerFinancial/invoicePart5AcceptanceRepository');
    const source = { organizationId:ESTIMATE,actorUserId:RECEIPT,actorAccessRole:'owner',
      authSessionId:'33333333-3333-4333-8333-333333333333' };
    await expect(repository.read({}, source, ESTIMATE, RECEIPT, DIGEST))
      .resolves.toEqual(contract.unavailable('paid',preview));
    expect(spy).toHaveBeenCalledWith({}, source, ESTIMATE, RECEIPT, DIGEST);
    spy.mockResolvedValueOnce({ ...correctionContract.unavailable(), issuedInvoiceCurrent:true });
    await expect(repository.read({}, source, ESTIMATE, RECEIPT, DIGEST))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_INVOICE_PART5_UNAVAILABLE',status:503});
    spy.mockResolvedValue(correctionContract.unavailable());
    previewSpy.mockResolvedValue(preview);
    await expect(repository.readBundle({}, source, ESTIMATE, RECEIPT, DIGEST))
      .resolves.toEqual(contract.bundle(preview,contract.unavailable('paid',preview)));
    previewSpy.mockResolvedValueOnce(preview).mockResolvedValueOnce({
      ...preview,previewDigest:'c'.repeat(64)});
    await expect(repository.readBundle({}, source, ESTIMATE, RECEIPT, DIGEST))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_INVOICE_PART5_CHANGED',status:409});
    spy.mockRestore();
    previewSpy.mockRestore();
  });

  test('derives the account-free result only after rebuilding the current fictional preview', () => {
    const tenant='44444444-4444-4444-8444-444444444444';
    const state=workspace.createInitialDemoState(tenant,new Date('2026-10-14T12:00:00Z'),
      {seed:'part5e-acceptance'});
    const view=workspace.buildDemoWorkspace({tenantId:tenant,sessionId:ESTIMATE,state,revision:1,
      simulationCount:0,persisted:true,expiresAt:new Date('2026-10-15T12:00:00Z')});
    const preview=demoPreview.project(workspace.demoCanonicalItems(view)[0],1);
    expect(demo.project(workspace.demoCanonicalItems(view)[0],1))
      .toEqual(contract.unavailable('demo',preview));
    expect(demo.bundle(workspace.demoCanonicalItems(view)[0],1))
      .toEqual(contract.bundle(preview,contract.unavailable('demo',preview)));
    expect(() => demo.project({ source:{type:'paid'} },1)).toThrow();
  });

  test('mounts paid and fictional no-store reads and no Part 5 mutation or migration 273', () => {
    const paidRoute=read('src/routes/customerFinancialEditableEstimate.js');
    const demoRoute=read('src/routes/demo.js');
    expect(paidRoute).toContain("router.get('/:estimateId/invoice-part5-acceptance', auth, role, throttle");
    expect(paidRoute).not.toContain("router.post('/:estimateId/invoice-part5-acceptance'");
    expect(demoRoute).toContain("router.get('/customer-financial/invoice-drafts/:estimateId/part5-acceptance'");
    expect(demoRoute).not.toContain("router.post('/customer-financial/invoice-drafts/:estimateId/part5-acceptance'");
    const ui=read('public/js/customer-financial-invoice-preview.js');
    expect(ui).toContain("'/collection-part10-acceptance?");
    expect(ui).toContain("'/part10-acceptance'");
    expect(ui).not.toContain("'/payment-part9-acceptance?");
    expect(ui).not.toContain("'/part9-acceptance'");
    expect(ui).toContain('function invalidPart5(value)');
    expect(ui).toContain('function invalidBundle(value)');
    expect(ui).toContain("value.contractVersion !== 'm27-collection-part10-preview-bundle-v1'");
    expect(ui).not.toContain("Promise.all([request(demoBase + '/preview')");
    expect(ui).toContain('requestToken += 1; data = null; part5 = null; part6 = null; part7 = null;');
    expect(ui).toContain('Seven independent lifecycle checks');
    expect(ui).toContain('Append-only correction boundaries');
    expect(ui).not.toMatch(/button[^\n]*(?:issue|collect|approve invoice)/i);
    const names=fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(names.some(name=>/^273_/.test(name))).toBe(false);
  });
});
