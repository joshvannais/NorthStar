'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/invoiceDocument');
const demo = require('../../src/customerFinancial/demoInvoiceDocument');
const workspace = require('../../src/commandCenter/workspace');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);

function demoItem() {
  const tenant = '44444444-4444-4444-8444-444444444444';
  const state = workspace.createInitialDemoState(tenant, new Date('2026-10-14T12:00:00Z'),
    { seed: 'part6a-document' });
  const view = workspace.buildDemoWorkspace({ tenantId:tenant, sessionId:ESTIMATE, state, revision:1,
    simulationCount:0, persisted:true, expiresAt:new Date('2026-10-15T12:00:00Z') });
  return workspace.demoCanonicalItems(view)[0];
}

describe('Mission 27 Part 6A customer-safe invoice document boundary', () => {
  test.each(['paid','demo'])('is strict, value-free, private and effect-free for %s', mode => {
    const value = contract.unavailable(mode);
    expect(contract.project(JSON.parse(JSON.stringify(value)), mode)).toEqual(value);
    expect(value).toMatchObject({ contractVersion:'m27-customer-invoice-document-v1',
      state:'unavailable', reason:'issued_invoice_unavailable', mode, fictional:mode === 'demo',
      value:null, exactCurrentnessRevalidated:true, issuedDocumentCurrent:false,
      customerSafeProjectionCurrent:false, htmlRenderingAuthorized:false,
      pdfRenderingAuthorized:false, downloadAuthorized:false, publicAccessAuthorized:false,
      deliveryAuthorized:false, privateFieldValuesExposed:false, thirdPartyContentIncluded:false,
      providerCallCount:0, receiverMutationCount:0,
      formats:{ html:{format:'html',state:'unavailable',reason:'issued_invoice_unavailable',value:null},
        pdf:{format:'pdf',state:'unavailable',reason:'issued_invoice_unavailable',value:null} } });
    expect(value.evidence.map(row => row.requirement)).toEqual([
      'immutable_invoice_issue_receipt','exact_issued_document_revision',
      'customer_safe_document_projection']);
    expect(JSON.stringify(value)).not.toMatch(
      /customerId|workId|minorUnits|currency|documentNumber|dueDate|invoiceDigest|receiptId|staff|margin|cost/);
    expect(() => contract.project({ ...value, htmlRenderingAuthorized:true }, mode)).toThrow();
    expect(() => contract.project({ ...value, extra:true }, mode)).toThrow();
    expect(() => contract.unavailable('provider')).toThrow();
  });

  test('revalidates and discards the exact paid Part 5 bundle before projecting a document', async () => {
    const part5Repository = require('../../src/customerFinancial/invoicePart5AcceptanceRepository');
    const part5Contract = require('../../src/customerFinancial/invoicePart5Acceptance');
    const bundle = { exact:'server-owned-part5-bundle' };
    const spy = jest.spyOn(part5Repository, 'readBundle').mockResolvedValue(bundle);
    const validation = jest.spyOn(part5Contract, 'projectBundle').mockReturnValue(bundle);
    const repository = require('../../src/customerFinancial/invoiceDocumentRepository');
    const source = { organizationId:ESTIMATE, actorUserId:RECEIPT, actorAccessRole:'owner',
      authSessionId:'33333333-3333-4333-8333-333333333333' };
    await expect(repository.read({}, source, ESTIMATE, RECEIPT, DIGEST))
      .resolves.toEqual(contract.unavailable('paid'));
    expect(spy).toHaveBeenCalledWith({}, source, ESTIMATE, RECEIPT, DIGEST);
    expect(validation).toHaveBeenCalledWith(bundle, 'paid');
    validation.mockImplementationOnce(() => { throw new Error('invalid bundle'); });
    await expect(repository.read({}, source, ESTIMATE, RECEIPT, DIGEST))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_INVOICE_DOCUMENT_UNAVAILABLE',status:503});
    spy.mockRestore();
    validation.mockRestore();
  });

  test('rebuilds the isolated fictional Part 5 boundary without paid fallback', () => {
    const item = demoItem();
    expect(demo.project(item,1)).toEqual(contract.unavailable('demo'));
    expect(() => demo.project({source:{type:'paid'}},1)).toThrow();
  });

  test('mounts no-store reads only and adds no renderer, public token, delivery or migration 273', () => {
    const paidRoute = read('src/routes/customerFinancialEditableEstimate.js');
    const demoRoute = read('src/routes/demo.js');
    expect(paidRoute).toContain("router.get('/:estimateId/invoice-document', auth, role, throttle");
    expect(paidRoute).not.toContain("router.post('/:estimateId/invoice-document'");
    expect(demoRoute).toContain("router.get('/customer-financial/invoice-drafts/:estimateId/document'");
    expect(demoRoute).not.toContain("router.post('/customer-financial/invoice-drafts/:estimateId/document'");
    const source = [read('src/customerFinancial/invoiceDocument.js'),
      read('src/customerFinancial/invoiceDocumentRepository.js'),
      read('src/customerFinancial/demoInvoiceDocument.js')].join('\n');
    expect(source).not.toMatch(/puppeteer|playwright|pdfkit|renderToString|createWriteStream|fetch\(|axios|retell/i);
    const names = fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(names.some(name=>/^273_/.test(name))).toBe(false);
  });
});
