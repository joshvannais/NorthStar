'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/invoicePostIssueCorrection');
const repository = require('../../src/customerFinancial/invoicePostIssueCorrectionRepository');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const ORG = '55555555-5555-4555-8555-555555555555';
const DIGEST = 'a'.repeat(64);

describe('Mission 27 Part 5D post-issue correction boundary', () => {
  test('keeps every correction class explicit, append-only and value-free without an issue', () => {
    const value = contract.unavailable();
    expect(contract.project(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(value).toMatchObject({
      contractVersion:'m27-invoice-post-issue-correction-v1',state:'unavailable',
      reason:'issued_invoice_unavailable',value:null,issuedInvoiceCurrent:false,
      issuedVersionImmutable:true,originalIssuedVersionMutationAuthorized:false,
      creditRecordAuthorized:false,debitRecordAuthorized:false,
      replacementRecordAuthorized:false,voidRecordAuthorized:false,
      providerCallCount:0,receiverMutationCount:0,
    });
    expect(value.records.map(record => record.recordType)).toEqual(contract.RECORD_TYPES);
    expect(value.records.every(record => record.state === 'unavailable' &&
      record.reason === 'issued_invoice_unavailable' && record.value === null &&
      record.requiredLineage === contract.REQUIRED_LINEAGE &&
      record.appendOnlyRecordAuthorized === false &&
      record.issuedVersionMutationAuthorized === false)).toBe(true);
    expect(contract.REQUIRED_LINEAGE).toEqual([
      'organization_id','correction_record_id','correction_record_digest','correction_sequence',
      'record_type','original_issue_receipt_id','original_issue_receipt_digest',
      'original_issued_version_digest','previous_correction_record_id',
      'source_authority_digest','requested_by_actor_id','authorization_receipt_ids',
      'authorization_policy_version','reason','recorded_at',
    ]);
    expect(JSON.stringify(value)).not.toMatch(
      /customerId|workId|minorUnits|"amount"|currency|documentNumber|dueDate|invoiceDigest|receiptId/);
    expect(() => contract.project({ ...value, issuedInvoiceCurrent:true })).toThrow(
      'Invoice post-issue correction boundary invalid');
  });

  test('binds correction and void to the released machine controls without widening policy', () => {
    const launch = JSON.parse(read('config/mission27-launch-contract.v1.json'));
    expect(contract.RECORD_TYPES).toEqual(['credit','debit','replacement','void']);
    for (const type of ['credit','debit','replacement']) {
      expect(contract.RECORD_POLICY[type]).toMatchObject({
        requiredCapability:'customer_financial.invoice.correct',
        requiredControl:launch.actionControl['customer_financial.invoice.correct'].mode,
      });
      expect(contract.RECORD_POLICY[type].missingEvidence).toContain('correction_reason');
      expect(contract.RECORD_POLICY[type].missingEvidence).toContain('complete_correction_lineage');
    }
    expect(contract.RECORD_POLICY.void).toMatchObject({
      requiredCapability:'customer_financial.invoice.void',
      requiredControl:launch.actionControl['customer_financial.invoice.void'].mode,
    });
    expect(launch.actionControl['customer_financial.invoice.void']).toMatchObject({
      mode:'dual_control',singleControlAllowed:false,
    });
    expect(contract.RECORD_POLICY.void.missingEvidence).toEqual(expect.arrayContaining(
      launch.actionControl['customer_financial.invoice.void'].requires));
  });

  test('revalidates the exact sealed lifecycle boundary before returning correction state', async () => {
    const lifecycleRepository = require('../../src/customerFinancial/invoiceLifecycleProjectionRepository');
    const spy = jest.spyOn(lifecycleRepository, 'read').mockResolvedValue(
      require('../../src/customerFinancial/invoiceLifecycleProjection').unavailable());
    const value = await repository.read({}, { organizationId:ORG, actorUserId:ACTOR,
      actorAccessRole:'owner', authSessionId:SESSION }, ESTIMATE, RECEIPT, DIGEST);
    expect(spy).toHaveBeenCalledWith({}, expect.any(Object), ESTIMATE, RECEIPT, DIGEST);
    expect(value).toEqual(contract.unavailable());
    spy.mockRestore();
  });

  test('fails closed for invalid references or a non-exact lifecycle source', async () => {
    await expect(repository.read({}, {}, 'not-an-estimate', RECEIPT, DIGEST))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_INVOICE_CORRECTION_INVALID',status:400});
    const lifecycleRepository = require('../../src/customerFinancial/invoiceLifecycleProjectionRepository');
    const malformed = {
      ...require('../../src/customerFinancial/invoiceLifecycleProjection').unavailable(),
      issuedInvoiceCurrent:true,
    };
    const spy = jest.spyOn(lifecycleRepository, 'read').mockResolvedValue(malformed);
    await expect(repository.read({}, { organizationId:ORG, actorUserId:ACTOR,
      actorAccessRole:'owner', authSessionId:SESSION }, ESTIMATE, RECEIPT, DIGEST))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_INVOICE_CORRECTION_UNAVAILABLE',status:503});
    spy.mockRestore();
  });

  test('mounts one guarded no-store read, no correction mutation and no migration 273', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    expect(route).toContain(
      "router.get('/:estimateId/invoice-post-issue-correction', auth, role, throttle");
    expect(route).not.toContain("router.post('/:estimateId/invoice-post-issue-correction'");
    const start = route.indexOf("router.get('/:estimateId/invoice-post-issue-correction'");
    const end = route.indexOf("router.post('/:estimateId/invoice-draft/workflow-capability'", start);
    const block = route.slice(start, end);
    expect(block).toContain("res.set('Cache-Control','no-store'); res.vary('Cookie');");
    expect(block).toContain("keys.length !== 2");
    expect(block).toContain("keys.includes('handoffReceiptId')");
    expect(block).toContain("keys.includes('handoffReceiptDigest')");
    expect(block).toContain('invoicePostIssueCorrectionRead(');
    const roadmap = read('docs/roadmap/MISSION_27_CUSTOMER_FINANCIAL_LIFECYCLE.md');
    expect(roadmap).toContain(
      '| D | Post-issue correction through explicit credit/debit/replacement/void records with reasons and complete lineage; no mutation of the issued version. |');
    const ledger = read('docs/roadmap/MISSION_27_ACCEPTANCE_LEDGER.md');
    expect(ledger).toContain('| 5C | [Orthogonal lifecycle projections and display precedence]');
    expect(ledger).toContain('`33cf32d6bac00f23ce951312e384b8b388af81f3`');
    expect(ledger).toContain('| 5D | [Post-issue credit/debit/replacement/void lineage]');
    expect(ledger).toContain('**Candidate, value-free**');
    const names=fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(names.some(name=>/^273_/.test(name))).toBe(false);
  });
});
