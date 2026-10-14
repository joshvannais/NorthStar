'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/invoicePublicSession');
const demo = require('../../src/customerFinancial/demoInvoicePublicSession');
const workspace = require('../../src/commandCenter/workspace');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);

function demoItem() {
  const tenant = '44444444-4444-4444-8444-444444444444';
  const state = workspace.createInitialDemoState(tenant, new Date('2026-10-14T12:00:00Z'),
    { seed: 'part6b-session' });
  const view = workspace.buildDemoWorkspace({ tenantId:tenant, sessionId:ESTIMATE, state, revision:1,
    simulationCount:0, persisted:true, expiresAt:new Date('2026-10-15T12:00:00Z') });
  return workspace.demoCanonicalItems(view)[0];
}

describe('Mission 27 Part 6B invoice public-session boundary', () => {
  test.each(['paid','demo'])('is strict, value-free and effect-free for %s', mode => {
    const value = contract.unavailable(mode);
    expect(contract.project(JSON.parse(JSON.stringify(value)), mode)).toEqual(value);
    expect(value).toMatchObject({ contractVersion:'m27-invoice-public-session-v1',
      state:'unavailable', reason:'issued_invoice_unavailable', mode, fictional:mode === 'demo',
      value:null, bearerIdentityLimitation:
        'possession_does_not_prove_customer_or_recipient_identity',
      rawTokenReturned:false, tokenHashStored:false, publicLookupMounted:false,
      publicRateLimitMounted:false, customerSessionCreated:false,
      exactIssuedVersionBound:false, expirationAssigned:false, revocationRecorded:false,
      downloadAuthorized:false, customerMutationAuthorized:false,
      thirdPartyContentIncluded:false, tokenInCookieUrlReferrerLogOrBrowserStorage:false,
      providerCallCount:0, receiverMutationCount:0 });
    expect(value.requirements.map(row=>[row.requirement,row.state])).toEqual([
      ['exact_current_issued_document','unavailable'],
      ['high_entropy_server_generated_token','not_created'],
      ['hash_only_token_storage','not_created'],
      ['bounded_invoice_public_session_expiration','unavailable'],
      ['exact_issued_version_binding','unavailable'],
      ['minimized_customer_session','not_created'],
      ['revocation_authority','unavailable'],
    ]);
    expect(JSON.stringify(value)).not.toMatch(
      /"(?:customerId|workId|minorUnits|currency|documentNumber|dueDate|invoiceDigest|receiptId|rawToken|tokenHash|staff|margin|cost)"\s*:/);
    expect(() => contract.project({ ...value, rawTokenReturned:true }, mode)).toThrow();
    expect(() => contract.project({ ...value, extra:true }, mode)).toThrow();
    expect(() => contract.unavailable('public')).toThrow();
  });

  test('revalidates and discards the paid Part 6A boundary before returning readiness', async () => {
    const documentRepository = require('../../src/customerFinancial/invoiceDocumentRepository');
    const documentContract = require('../../src/customerFinancial/invoiceDocument');
    const document = documentContract.unavailable('paid');
    const spy = jest.spyOn(documentRepository, 'read').mockResolvedValue(document);
    const validation = jest.spyOn(documentContract, 'project').mockReturnValue(document);
    const repository = require('../../src/customerFinancial/invoicePublicSessionRepository');
    const source = { organizationId:ESTIMATE, actorUserId:RECEIPT, actorAccessRole:'owner',
      authSessionId:'33333333-3333-4333-8333-333333333333' };
    await expect(repository.read({}, source, ESTIMATE, RECEIPT, DIGEST))
      .resolves.toEqual(contract.unavailable('paid'));
    expect(spy).toHaveBeenCalledWith({}, source, ESTIMATE, RECEIPT, DIGEST);
    expect(validation).toHaveBeenCalledWith(document, 'paid');
    validation.mockImplementationOnce(() => { throw new Error('invalid document boundary'); });
    await expect(repository.read({}, source, ESTIMATE, RECEIPT, DIGEST))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_INVOICE_PUBLIC_SESSION_UNAVAILABLE',status:503});
    spy.mockRestore(); validation.mockRestore();
  });

  test('revalidates the isolated fictional document without paid fallback', () => {
    const item = demoItem();
    expect(demo.project(item,1)).toEqual(contract.unavailable('demo'));
    expect(() => demo.project({source:{type:'paid'}},1)).toThrow();
  });

  test('mounts private no-store readiness reads and no public bearer surface or migration 273', () => {
    const paidRoute = read('src/routes/customerFinancialEditableEstimate.js');
    const demoRoute = read('src/routes/demo.js');
    expect(paidRoute).toContain("router.get('/:estimateId/invoice-public-session', auth, role, throttle");
    expect(paidRoute).not.toContain("router.post('/:estimateId/invoice-public-session'");
    expect(demoRoute).toContain("router.get('/customer-financial/invoice-drafts/:estimateId/public-session'");
    expect(demoRoute).not.toContain("router.post('/customer-financial/invoice-drafts/:estimateId/public-session'");
    const source = [read('src/customerFinancial/invoicePublicSession.js'),
      read('src/customerFinancial/invoicePublicSessionRepository.js'),
      read('src/customerFinancial/demoInvoicePublicSession.js')].join('\n');
    expect(source).not.toMatch(/randomBytes|createHash|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|Set-Cookie|localStorage|sessionStorage|fetch\(|axios/i);
    expect(source).not.toMatch(/rawToken\s*:/);
    expect(read('src/server.js')).not.toMatch(/invoice-public-session|invoice-public-token/);
    const names = fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(names.some(name=>/^273_/.test(name))).toBe(false);
  });
});
