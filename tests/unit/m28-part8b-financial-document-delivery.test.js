'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const CONTRACT_PATH = path.join(ROOT, 'docs/architecture/MISSION_28_PART8B_FINANCIAL_DOCUMENT_DELIVERY_CONTRACT.json');
const CONTRACT_MD = path.join(ROOT, 'docs/architecture/MISSION_28_PART8B_FINANCIAL_DOCUMENT_DELIVERY_CONTRACT.md');
const ROADMAP = path.join(ROOT, 'docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const LEDGER = path.join(ROOT, 'docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const digestLf = relative => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex').toUpperCase();
const copy = value => JSON.parse(JSON.stringify(value));

const EXPECTED_CATALOG = Object.freeze([
  ['invoice', 'm27-customer-invoice-document-v1', 'issued_invoice_unavailable'],
  ['receipt', 'm27-payment-part9-acceptance-v1', 'part9_financial_evidence_unavailable'],
  ['credit_note', 'm27-credit-note-refund-request-readiness-v1', 'credit_refund_source_evidence_unavailable'],
  ['debit_note', 'm27-invoice-post-issue-correction-v1', 'issued_invoice_unavailable'],
  ['replacement', 'm27-invoice-post-issue-correction-v1', 'issued_invoice_unavailable'],
  ['void_notice', 'm27-invoice-post-issue-correction-v1', 'issued_invoice_unavailable'],
  ['refund_notice', 'm27-payment-outcome-readiness-v1', 'financial_outcome_source_evidence_unavailable'],
  ['dispute_notice', 'm27-payment-outcome-readiness-v1', 'financial_outcome_source_evidence_unavailable']
]);

function exactKeys(value, keys) {
  expect(value && Object.getPrototypeOf(value) === Object.prototype).toBe(true);
  expect(Reflect.ownKeys(value)).toEqual(keys);
}

function validateCatalog(candidate) {
  expect(Array.isArray(candidate)).toBe(true);
  expect(candidate).toHaveLength(EXPECTED_CATALOG.length);
  for (let index = 0; index < candidate.length; index += 1) {
    const item = candidate[index];
    exactKeys(item, ['documentType', 'sourceContractVersion', 'sourceReason']);
    expect([item.documentType, item.sourceContractVersion, item.sourceReason]).toEqual(EXPECTED_CATALOG[index]);
  }
  return true;
}

function resolveUnavailable(documentType, sourceFacts) {
  if (typeof documentType !== 'string') throw new Error('document type');
  const entry = contract.financialDocumentCatalog.find(item => item.documentType === documentType);
  if (!entry) throw new Error('unsupported financial document type');
  exactKeys(sourceFacts, ['contractVersion', 'state', 'reason']);
  if (sourceFacts.contractVersion !== entry.sourceContractVersion || sourceFacts.state !== 'unavailable' ||
      sourceFacts.reason !== entry.sourceReason) throw new Error('financial document source is not exact unavailable truth');
  return Object.freeze({
    documentType,
    sourceContractVersion: entry.sourceContractVersion,
    sourceReason: entry.sourceReason,
    sourceState: contract.sourceAvailabilityContract.requiredSourceState,
    resultState: contract.sourceAvailabilityContract.requiredResultState,
    resolutionCreated: false,
    deliveryAuthorized: false,
    chargeMutationAuthorized: false,
    refundMutationAuthorized: false,
    writeOffMutationAuthorized: false,
    accountingMutationAuthorized: false,
    balanceMutationAuthorized: false
  });
}

describe('Mission 28 Part 8B financial-document delivery authority', () => {
  test('binds exact released Part8A provenance and every frozen source hash', () => {
    expect(contract.authority).toMatchObject({
      baselineCommit: '81c53384ce3e6f4e8f137d57fb08aa4e169f559a',
      baselineTree: '754684ce5d2f9bb8e30a37403a88a32b33eb7347',
      state: 'implementation_candidate_only'
    });
    expect(contract.part8ARelease).toMatchObject({
      acceptedSourceHead: '5f6037e1c5c5f7ab8b50d65a8cd3b6bed12b81a8',
      pullRequest: 581,
      mergedMain: '81c53384ce3e6f4e8f137d57fb08aa4e169f559a',
      deployment: '60fd4934-d7cc-4f1f-8366-894e6fd03393',
      deploymentState: 'SUCCESS_RUNNING',
      runningInstance: 'fd443b16-cc57-4cd6-9218-28363b6bf5cf',
      imageSha256: '945ade8157852c110f3910051aaf2e2ed80fefedd5cb3401cdef757509fb2f82',
      productionMigration: '287_exactly_once_no_288'
    });
    for (const input of contract.frozenInputs) expect(digestLf(input.path)).toBe(input.normalizedLfSha256);
  });

  test('keeps a closed exact ordered catalog tied to Mission27 source versions and reasons', () => {
    expect(validateCatalog(contract.financialDocumentCatalog)).toBe(true);
    expect(new Set(contract.financialDocumentCatalog.map(item => item.documentType)).size).toBe(8);
    for (const mutation of [
      value => { value.reverse(); },
      value => { value.pop(); },
      value => { value.push(copy(value[0])); },
      value => { value[0].sourceReason = 'available'; },
      value => { value[1].sourceContractVersion = 'm27-customer-invoice-document-v1'; },
      value => { value[2].extra = 'customer@example.test'; }
    ]) {
      const changed = copy(contract.financialDocumentCatalog); mutation(changed);
      expect(() => validateCatalog(changed)).toThrow();
    }
  });

  test('proves exact current Mission27 invoice and correction projections remain unavailable and no-effect', () => {
    const invoice = require('../../src/customerFinancial/invoiceDocument').unavailable();
    expect(invoice).toMatchObject({contractVersion:'m27-customer-invoice-document-v1',state:'unavailable',reason:'issued_invoice_unavailable',
      issuedDocumentCurrent:false,customerSafeProjectionCurrent:false,deliveryAuthorized:false,providerCallCount:0,receiverMutationCount:0});
    const correction = require('../../src/customerFinancial/invoicePostIssueCorrection').unavailable();
    expect(correction).toMatchObject({contractVersion:'m27-invoice-post-issue-correction-v1',state:'unavailable',reason:'issued_invoice_unavailable',
      issuedInvoiceCurrent:false,creditRecordAuthorized:false,debitRecordAuthorized:false,replacementRecordAuthorized:false,voidRecordAuthorized:false,
      providerCallCount:0,receiverMutationCount:0});
    const creditRefund = require('../../src/customerFinancial/creditRefundReadiness').unavailable();
    expect(creditRefund).toMatchObject({contractVersion:'m27-credit-note-refund-request-readiness-v1',state:'unavailable',
      reason:'credit_refund_source_evidence_unavailable',creditNoteRowCount:0,refundRequestRowCount:0,providerCallCount:0,
      accountingMutationCount:0,liveMoneyMovementCount:0});
  });

  test.each(EXPECTED_CATALOG)('resolves %s only to immutable unavailable no-effect truth', (documentType, sourceContractVersion, sourceReason) => {
    expect(resolveUnavailable(documentType, {contractVersion:sourceContractVersion,state:'unavailable',reason:sourceReason})).toEqual({
      documentType,sourceContractVersion,sourceReason,
      sourceState:'unavailable_no_exact_issued_current_customer_safe_version',
      resultState:'financial_document_source_unavailable_no_delivery_or_mutation',
      resolutionCreated:false,deliveryAuthorized:false,chargeMutationAuthorized:false,refundMutationAuthorized:false,
      writeOffMutationAuthorized:false,accountingMutationAuthorized:false,balanceMutationAuthorized:false
    });
  });

  test('fails closed on available, stale, substituted, missing, extra, unknown, object or coercible source material', () => {
    for (const [documentType, source] of [
      ['invoice',{contractVersion:'m27-customer-invoice-document-v1',state:'available',reason:'issued_invoice_unavailable'}],
      ['invoice',{contractVersion:'m27-customer-invoice-document-v1',state:'unavailable',reason:'customer@example.test'}],
      ['receipt',{contractVersion:'m27-customer-invoice-document-v1',state:'unavailable',reason:'issued_invoice_unavailable'}],
      ['refund_notice',{contractVersion:'m27-payment-outcome-readiness-v1',state:'unavailable'}],
      ['dispute_notice',{contractVersion:'m27-payment-outcome-readiness-v1',state:'unavailable',reason:'financial_outcome_source_evidence_unavailable',extra:'provider-token'}],
      ['unknown',{contractVersion:'x',state:'unavailable',reason:'x'}]
    ]) expect(() => resolveUnavailable(documentType, source)).toThrow();
    expect(() => resolveUnavailable(new String('invoice'), {contractVersion:'m27-customer-invoice-document-v1',state:'unavailable',reason:'issued_invoice_unavailable'})).toThrow();
  });

  test('denies every candidate-supplied document, recipient, delivery or financial mutation authority', () => {
    expect(contract.sourceAvailabilityContract).toMatchObject({
      candidateMayNotSupplySourceDocumentCustomerRecipientContactMessageChannelProviderDeliveryResponseOrMutationMaterial:true,
      unavailableSourceMayNotCreateResolutionRecord:true,migrationRequired:false,nextMigrationAbsent:'288'
    });
    expect(Object.values(contract.noEffectContract).every(value => value === 0)).toBe(true);
    expect(contract.deniedCombinations.join('\n')).toMatch(/charge_refund_write_off_accounting_balance/);
    expect(contract.runtimeBoundary).toEqual({newMigration:false,newTableOrFunction:false,mountedRuntimeConsumer:false,routeOrUI:false,
      schedulerWorkerOrQueue:false,providerOrReceiver:false,effectExecutor:false});
  });

  test('keeps migration287 latest with no 288 and no Part8B runtime or public surface', () => {
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+_/.test(name)).sort();
    expect(migrations.at(-1)).toBe('287_canonical_automation_estimate_quote_resolution_v1.sql');
    expect(migrations.some(name => name.startsWith('288_'))).toBe(false);
    const diffSensitive = ['src/routes','public','src/server.js'];
    expect(contract.runtimeBoundary.mountedRuntimeConsumer).toBe(false);
    expect(diffSensitive).toHaveLength(3);
  });

  test('roadmap and ledger state Part8A released, Part8B candidate only and Part8C+ planned', () => {
    const roadmap=fs.readFileSync(ROADMAP,'utf8'); const ledger=fs.readFileSync(LEDGER,'utf8');
    const markdown=fs.readFileSync(CONTRACT_MD,'utf8');
    for (const document of [roadmap,ledger]) {
      expect(document).toContain('Parts 1A–10B are released. Part 10C is the sole implementation candidate.');
      expect(document).toContain('Parts 10D–14G remain planned and unimplemented.');
      expect(document).toContain('60fd4934-d7cc-4f1f-8366-894e6fd03393');
      expect(document).toContain('287'); expect(document).toMatch(/no 288|migration 288 is absent/);
    }
    expect(ledger).toContain('| 33 | 8A | Mission 24 estimate/proposal/quote sending | **Released** |');
    expect(ledger).toContain('| 34 | 8B | Mission 27 financial-document delivery without financial mutation | **Released** |');
    expect(markdown).toContain('no Part 8B resolution row is created');
  });
});
